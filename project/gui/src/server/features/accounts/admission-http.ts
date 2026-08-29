import type { AdmissionStore } from './admission'
import type { RoomUser } from '#/server/features/rooms/room-store'
import { AGENT_MENTION_HANDLES } from '#/server/features/rooms/attention'
import type {
  LlmConfigInput,
  PublicLlmConfig,
} from '#/server/features/workspace/llm-config'
import type {
  CursorModelSummary,
  CursorRuntimeConfigInput,
  PublicCursorRuntimeConfig,
} from '#/server/features/workspace/cursor-runtime-config'
import type {
  PreviewConfigInput,
  PublicPreviewConfig,
} from '#/server/features/workspace/preview-config'
import type {
  GrantToolsConfigInput,
  PublicGrantToolsConfig,
} from '#/server/features/workspace/grant-tools-config'
import type { WorkspaceSkillStore } from '#/server/features/workspace/workspace-skills'
import type {
  ConnectionSaveInput,
  PublicConnection,
  WorkspaceConnectionStore,
} from '#/server/features/workspace/workspace-connections'
import {
  extractZipToDirectory,
  normalizeExtractedPackage,
} from '#/server/features/workspace/workspace-skills'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canManageAgentAccess } from '#/server/features/agents/agent-access'
import { WORKSPACE_PEOPLE } from '#project/agents/roster-people'

export type AccountInput = {
  email: string
  username: string
  password: string
  name: string
}

export type WorkspaceAccount = {
  id: string
  name: string
  email: string
  username?: string | null
  role?: string | null
  banned?: boolean | null
}

export type AdmissionOptions = {
  store: AdmissionStore
  createAccount: (
    body: AccountInput,
    role: 'admin' | 'user',
  ) => Promise<Response>
  listUsers: () => Promise<WorkspaceAccount[]>
  banUser: (request: Request, userId: string) => Promise<unknown>
  unbanUser: (request: Request, userId: string) => Promise<unknown>
  resetUserPassword: (
    request: Request,
    userId: string,
    newPassword: string,
  ) => Promise<Response>
  llm?: {
    public(): PublicLlmConfig
    save(input: LlmConfigInput): PublicLlmConfig
  }
  cursorRuntime?: {
    public(): PublicCursorRuntimeConfig
    save(input: CursorRuntimeConfigInput): Promise<PublicCursorRuntimeConfig>
    listModels(): Promise<CursorModelSummary[]>
  }
  preview?: {
    public(): PublicPreviewConfig
    save(input: PreviewConfigInput): PublicPreviewConfig
  }
  grantTools?: {
    public(): PublicGrantToolsConfig
    save(input: GrantToolsConfigInput): PublicGrantToolsConfig
  }
  skills?: WorkspaceSkillStore
  connections?: WorkspaceConnectionStore
  agentMentionHandles?: () => ReadonlySet<string>
  listAgents?: () => { id: string; name: string }[]
  knownAgent?: (id: string) => boolean
}

export function invitationUrl(
  token: string,
  guiOrigin: string,
  serverOrigin: string,
): string {
  const gui = new URL(guiOrigin)
  const path = `/invite/${encodeURIComponent(token)}`
  if (gui.protocol !== 'tauri:') return new URL(path, gui).toString()

  const server = new URL(serverOrigin)
  if (server.protocol !== 'http:' && server.protocol !== 'https:')
    throw new Error('Invite server origin must use HTTP or HTTPS')

  const url = new URL(`sweat://invite/${encodeURIComponent(token)}`)
  url.searchParams.set('server', server.toString().replace(/\/$/, ''))
  return url.toString()
}

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status })

const readBody = async (
  request: Request,
): Promise<Record<string, unknown> | undefined> => {
  try {
    const body: unknown = await request.json()
    return body && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

const accountFrom = (
  body: Record<string, unknown> | undefined,
  agentMentionHandles: ReadonlySet<string> = AGENT_MENTION_HANDLES,
): AccountInput | undefined => {
  const email = body?.email
  const username = body?.username
  const password = body?.password
  const displayName = body?.displayName
  if (
    typeof email !== 'string' ||
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    (displayName !== undefined && typeof displayName !== 'string') ||
    !email.trim() ||
    !username.trim()
  )
    return undefined
  if (agentMentionHandles.has(username.trim().toLowerCase()))
    return undefined
  return {
    email: email.trim(),
    username: username.trim(),
    password,
    name:
      (typeof displayName === 'string' && displayName.trim()) ||
      username.trim(),
  }
}

export function createAdmissionHttpHandler(
  options: AdmissionOptions & {
    authenticate: (request: Request) => Promise<RoomUser | undefined>
    guiOrigin: string
    onSuspend: (userId: string) => void
  },
) {
  const administrator = async (
    request: Request,
  ): Promise<RoomUser | Response> => {
    const user = await options.authenticate(request)
    if (!user) return json({ error: 'Unauthorized' }, 401)
    return user.role === 'admin' ? user : json({ error: 'Forbidden' }, 403)
  }

  const agentHandles = () =>
    options.agentMentionHandles?.() ?? AGENT_MENTION_HANDLES
  const listedAgents = () =>
    options.listAgents?.() ??
    WORKSPACE_PEOPLE.map((person) => ({ id: person.id, name: person.name }))
  const isKnownAgent = (id: string) =>
    options.knownAgent?.(id) ??
    WORKSPACE_PEOPLE.some((person) => person.id === id)

  return async (request: Request, url: URL): Promise<Response | undefined> => {
    if (url.pathname === '/api/admission/status' && request.method === 'GET')
      return json({ setupRequired: !options.store.hasUsers() })

    if (url.pathname === '/api/admission/setup' && request.method === 'POST') {
      const account = accountFrom(await readBody(request), agentHandles())
      const setupToken = request.headers.get('x-sweat-setup-token')
      if (!account || !setupToken || !options.store.claimSetupToken(setupToken))
        return json({ error: 'Invalid or already-used setup token' }, 400)
      let response: Response
      try {
        response = await options.createAccount(account, 'admin')
      } catch {
        options.store.releaseSetupToken()
        return json({ error: 'Unable to create account' }, 502)
      }
      if (!response.ok) {
        options.store.releaseSetupToken()
        return response
      }
      options.store.redeemSetupToken()
      return response
    }

    const redemption = url.pathname.match(
      /^\/api\/(?:admission|workspace)\/invitations\/([^/]+)\/redeem$/,
    )
    if (redemption && request.method === 'POST') {
      const account = accountFrom(await readBody(request), agentHandles())
      const claimed = account
        ? options.store.claimInvitation(redemption[1])
        : undefined
      if (!account || !claimed)
        return json({ error: 'Invitation is not redeemable' }, 400)
      let response: Response
      try {
        response = await options.createAccount(account, 'user')
      } catch {
        options.store.releaseInvitation(claimed.id)
        return json({ error: 'Unable to create account' }, 502)
      }
      if (!response.ok) {
        options.store.releaseInvitation(claimed.id)
        return response
      }
      options.store.redeemInvitation(claimed.id)
      return response
    }

    if (/^\/api\/auth\/(?:sign-up|admin)(?:\/|$)/.test(url.pathname))
      return json({ error: 'Account admission is required' }, 403)

    if (url.pathname === '/api/workspace/invitations') {
      const user = await administrator(request)
      if (user instanceof Response) return user
      if (request.method === 'GET')
        return json({ invitations: options.store.listInvitations() })
      if (request.method === 'POST') {
        const rawDays = (await readBody(request))?.days
        const days = rawDays === undefined ? 3 : rawDays
        if (days !== 1 && days !== 3 && days !== 7)
          return json(
            { error: 'Invitation lifetime must be 1, 3, or 7 days' },
            400,
          )
        const created = options.store.createInvitation(user.id, days)
        return json(
          {
            ...created,
            url: invitationUrl(created.token, options.guiOrigin, url.origin),
          },
          201,
        )
      }
    }

    const revokeInvitation = url.pathname.match(
      /^\/api\/workspace\/invitations\/([^/]+)$/,
    )
    if (revokeInvitation && request.method === 'DELETE') {
      const user = await administrator(request)
      if (user instanceof Response) return user
      return options.store.revokeInvitation(revokeInvitation[1])
        ? json({ ok: true })
        : json({ error: 'Invitation cannot be revoked' }, 400)
    }

    if (
      url.pathname === '/api/workspace/settings/members' &&
      request.method === 'GET'
    ) {
      const user = await administrator(request)
      return user instanceof Response
        ? user
        : json({ users: await options.listUsers() })
    }

    const memberPassword = url.pathname.match(
      /^\/api\/workspace\/settings\/members\/([^/]+)\/password$/,
    )
    if (memberPassword && request.method === 'POST') {
      const user = await administrator(request)
      if (user instanceof Response) return user
      const newPassword = (await readBody(request))?.newPassword
      if (typeof newPassword !== 'string')
        return json({ error: 'A new password is required' }, 400)
      const response = await options.resetUserPassword(
        request,
        memberPassword[1],
        newPassword,
      )
      if (response.ok) options.onSuspend(memberPassword[1])
      return response
    }

    if (url.pathname === '/api/workspace/settings/llm' && options.llm) {
      const user = await administrator(request)
      if (user instanceof Response) return user
      if (request.method === 'GET') return json(options.llm.public())
      if (request.method === 'POST') {
        const body = await readBody(request)
        try {
          return json(
            options.llm.save({
              provider: body?.provider,
              baseUrl: typeof body?.baseUrl === 'string' ? body.baseUrl : '',
              model: typeof body?.model === 'string' ? body.model : '',
              ...(typeof body?.apiKey === 'string'
                ? { apiKey: body.apiKey }
                : {}),
            }),
          )
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error ? error.message : 'Invalid LLM provider',
            },
            400,
          )
        }
      }
    }

    if (
      url.pathname === '/api/workspace/settings/cursor-runtime' &&
      options.cursorRuntime
    ) {
      const user = await administrator(request)
      if (user instanceof Response) return user
      if (request.method === 'GET') return json(options.cursorRuntime.public())
      if (request.method === 'POST') {
        const body = await readBody(request)
        try {
          return json(
            await options.cursorRuntime.save({
              model: typeof body?.model === 'string' ? body.model : '',
              ...(typeof body?.apiKey === 'string'
                ? { apiKey: body.apiKey }
                : {}),
            }),
          )
        } catch (error) {
          console.error('Cursor agent runtime save failed:', error)
          return json({ error: 'Unable to save Cursor agent runtime' }, 400)
        }
      }
    }

    if (
      url.pathname === '/api/workspace/settings/cursor-runtime/models' &&
      options.cursorRuntime &&
      request.method === 'GET'
    ) {
      const user = await administrator(request)
      if (user instanceof Response) return user
      try {
        return json({ models: await options.cursorRuntime.listModels() })
      } catch (error) {
        console.error('Cursor model list failed:', error)
        return json({ error: 'Unable to list Cursor models' }, 400)
      }
    }

    if (url.pathname === '/api/workspace/settings/preview' && options.preview) {
      const user = await administrator(request)
      if (user instanceof Response) return user
      if (request.method === 'GET') return json(options.preview.public())
      if (request.method === 'POST') {
        try {
          return json(options.preview.save((await readBody(request)) ?? {}))
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Invalid Preview configuration',
            },
            400,
          )
        }
      }
    }

    if (
      url.pathname === '/api/workspace/settings/grant-tools' &&
      options.grantTools
    ) {
      const user = await administrator(request)
      if (user instanceof Response) return user
      if (request.method === 'GET') return json(options.grantTools.public())
      if (request.method === 'POST') {
        try {
          return json(options.grantTools.save((await readBody(request)) ?? {}))
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Invalid run tool configuration',
            },
            400,
          )
        }
      }
    }

    if (url.pathname === '/api/workspace/settings/skills' && options.skills) {
      const user = await administrator(request)
      if (user instanceof Response) return user
      if (request.method === 'GET') {
        return json({
          skills: options.skills.list(),
          attachments: options.skills.listAttachments(),
          agents: listedAgents(),
        })
      }
      if (request.method === 'POST') {
        const form = await request.formData().catch(() => undefined)
        const file = form?.get('package')
        if (!(file instanceof File)) {
          return json(
            { error: 'Skill package zip or SKILL.md file is required' },
            400,
          )
        }
        const temporary = await mkdtemp(join(tmpdir(), 'sweat-skill-'))
        try {
          const bytes = new Uint8Array(await file.arrayBuffer())
          const filename = file.name.toLowerCase()
          const isMarkdown =
            filename.endsWith('.md') ||
            file.type === 'text/markdown' ||
            file.type === 'text/x-markdown'
          const files = isMarkdown
            ? [{ path: 'SKILL.md', bytes }]
            : await (async () => {
                await extractZipToDirectory(bytes, temporary)
                return normalizeExtractedPackage(temporary)
              })()
          const skill = await options.skills.importFiles(files)
          return json({ skill })
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unable to import skill package',
            },
            400,
          )
        } finally {
          await rm(temporary, { force: true, recursive: true })
        }
      }
    }

    if (
      url.pathname === '/api/workspace/settings/connections' &&
      options.connections
    ) {
      const user = await administrator(request)
      if (user instanceof Response) return user
      if (request.method === 'GET') {
        return json({
          connections: options.connections.list(),
          agents: listedAgents(),
        })
      }
      if (request.method === 'PUT') {
        const body = await readBody(request)
        const kind = typeof body?.kind === 'string' ? body.kind : ''
        const fields =
          body?.fields &&
          typeof body.fields === 'object' &&
          !Array.isArray(body.fields)
            ? (body.fields as Record<string, unknown>)
            : {}
        try {
          const saved: PublicConnection = options.connections.save({
            kind,
            fields,
            ...(typeof body?.apiKey === 'string'
              ? { apiKey: body.apiKey }
              : {}),
          } satisfies ConnectionSaveInput)
          return json({ connection: saved })
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unable to save connection',
            },
            400,
          )
        }
      }
    }

    const connectionClear = url.pathname.match(
      /^\/api\/workspace\/settings\/connections\/([^/]+)\/clear$/,
    )
    if (
      connectionClear &&
      options.connections &&
      request.method === 'POST'
    ) {
      const user = await administrator(request)
      if (user instanceof Response) return user
      const kind = decodeURIComponent(connectionClear[1]!)
      try {
        return json({ connection: options.connections.clear(kind) })
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Unable to clear connection',
          },
          400,
        )
      }
    }

    const connectionLinks = url.pathname.match(
      /^\/api\/workspace\/settings\/connections\/([^/]+)\/links$/,
    )
    if (
      connectionLinks &&
      options.connections &&
      request.method === 'PUT'
    ) {
      const user = await administrator(request)
      if (user instanceof Response) return user
      if (!canManageAgentAccess(user))
        return json({ error: 'Forbidden' }, 403)
      const kind = decodeURIComponent(connectionLinks[1]!)
      const body = await readBody(request)
      const agentDefinitionIds = Array.isArray(body?.agentDefinitionIds)
        ? body.agentDefinitionIds.filter(
            (id): id is string => typeof id === 'string',
          )
        : undefined
      if (!agentDefinitionIds)
        return json({ error: 'agentDefinitionIds array is required' }, 400)
      for (const agentDefinitionId of agentDefinitionIds) {
        if (!isKnownAgent(agentDefinitionId))
          return json({ error: 'Unknown agent definition' }, 400)
      }
      try {
        const linkedAgentIds = options.connections.setLinks(
          kind,
          agentDefinitionIds,
        )
        return json({ kind, linkedAgentIds })
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Unable to update connection links',
          },
          400,
        )
      }
    }

    const skillItem = url.pathname.match(
      /^\/api\/workspace\/settings\/skills\/([^/]+)$/,
    )
    if (skillItem && options.skills) {
      const user = await administrator(request)
      if (user instanceof Response) return user
      const skillId = decodeURIComponent(skillItem[1]!)
      if (request.method === 'GET') {
        const detail = await options.skills.readPackage(skillId)
        return detail
          ? json(detail)
          : json({ error: 'Skill not found' }, 404)
      }
      if (request.method === 'DELETE') {
        await options.skills.delete(skillId)
        return json({ ok: true })
      }
    }

    const skillAttachments = url.pathname.match(
      /^\/api\/workspace\/settings\/skills\/attachments\/([^/]+)$/,
    )
    if (skillAttachments && options.skills && request.method === 'PUT') {
      const user = await administrator(request)
      if (user instanceof Response) return user
      const agentDefinitionId = decodeURIComponent(skillAttachments[1]!)
      if (!isKnownAgent(agentDefinitionId)) {
        return json({ error: 'Unknown agent definition' }, 400)
      }
      const body = await readBody(request)
      const skillIds = Array.isArray(body?.skillIds)
        ? body.skillIds.filter((id): id is string => typeof id === 'string')
        : undefined
      if (!skillIds) return json({ error: 'skillIds array is required' }, 400)
      try {
        options.skills.setAttachments(agentDefinitionId, skillIds)
        return json({
          agentDefinitionId,
          skillIds: options.skills.listAttachedSkillIds(agentDefinitionId),
        })
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Unable to update skill attachments',
          },
          400,
        )
      }
    }

    const memberAction = url.pathname.match(
      /^\/api\/workspace\/settings\/members\/([^/]+)\/(suspend|restore)$/,
    )
    if (memberAction && request.method === 'POST') {
      const user = await administrator(request)
      if (user instanceof Response) return user
      const userId = memberAction[1]
      if (memberAction[2] === 'suspend' && userId === user.id)
        return json(
          {
            error: 'The workspace administrator cannot suspend themselves',
          },
          400,
        )
      const result =
        memberAction[2] === 'suspend'
          ? await options.banUser(request, userId)
          : await options.unbanUser(request, userId)
      if (memberAction[2] === 'suspend') options.onSuspend(userId)
      return json(result)
    }

    return undefined
  }
}
