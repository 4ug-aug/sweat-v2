import { canManageAgentAccess } from './agent-access'
import {
  AgentDefinitionError,
  type AgentDefinitionRecord,
  type AgentDefinitionStore,
  type AgentVisibility,
} from './agent-definition-store'
import type { AgentRuntimeKind } from '#project/agents/definition'
import type { AgentDefinitionSummary } from '#/server/protocol'
import type { RoomUser } from '#/server/features/rooms/room-store'
import { json, readBody } from '#/server/http/respond'

const isKind = (value: unknown): value is AgentRuntimeKind =>
  value === 'cursor' || value === 'openai-agents'

const isVisibility = (value: unknown): value is AgentVisibility =>
  value === 'private' || value === 'workspace'

const errorStatus = (error: unknown): number => {
  if (error instanceof AgentDefinitionError) {
    if (error.code === 'not_found') return 404
    if (error.code === 'forbidden') return 403
    return 400
  }
  return 400
}

export function createAgentDefinitionsHttp(deps: {
  store: AgentDefinitionStore
  toSummary: (record: AgentDefinitionRecord) => AgentDefinitionSummary
  list?: (viewerAccountId: string) => AgentDefinitionSummary[]
  pauseSchedules?: (agentDefinitionId: string, now: number) => void
  now?: () => number
}): (
  request: Request,
  url: URL,
  user: RoomUser,
) => Promise<Response | undefined> {
  const now = deps.now ?? Date.now
  const payload = (record: AgentDefinitionRecord) => deps.toSummary(record)

  return async (request, url, user) => {
    if (url.pathname === '/api/agent-definitions' && request.method === 'GET')
      return json({
        agents:
          deps.list?.(user.id) ?? deps.store.listVisible(user.id).map(payload),
      })

    if (url.pathname === '/api/agent-definitions' && request.method === 'POST') {
      const body = await readBody(request)
      if (!body) return json({ error: 'Invalid agent definition' }, 400)
      const githubAccess =
        body.githubAccess === true
          ? canManageAgentAccess(user)
            ? true
            : undefined
          : false
      if (body.githubAccess === true && githubAccess !== true)
        return json({ error: 'Forbidden' }, 403)
      try {
        const agent = deps.store.create(
          {
            name: typeof body.name === 'string' ? body.name : '',
            description:
              typeof body.description === 'string' ? body.description : '',
            instructions:
              typeof body.instructions === 'string' ? body.instructions : '',
            kind: isKind(body.kind) ? body.kind : ('' as AgentRuntimeKind),
            visibility: isVisibility(body.visibility)
              ? body.visibility
              : 'workspace',
            creatorAccountId: user.id,
            githubAccess,
            ...(typeof body.color === 'string' ? { color: body.color } : {}),
          },
          now(),
        )
        return json({ agent: payload(agent) }, 201)
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Unable to create agent definition',
          },
          errorStatus(error),
        )
      }
    }

    const duplicate = url.pathname.match(
      /^\/api\/agent-definitions\/([^/]+)\/duplicate$/,
    )
    if (duplicate && request.method === 'POST') {
      const source = deps.store.get(decodeURIComponent(duplicate[1]!))
      if (!source || (source.archivedAt && source.creatorAccountId !== user.id))
        return json({ error: 'Unknown agent definition' }, 404)
      if (
        source.visibility === 'private' &&
        source.creatorAccountId !== user.id
      )
        return json({ error: 'Unknown agent definition' }, 404)
      try {
        const agent = deps.store.duplicate(
          source.id,
          { creatorAccountId: user.id },
          now(),
        )
        return json({ agent: payload(agent) }, 201)
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Unable to duplicate agent definition',
          },
          errorStatus(error),
        )
      }
    }

    const archive = url.pathname.match(
      /^\/api\/agent-definitions\/([^/]+)\/archive$/,
    )
    if (archive && request.method === 'POST') {
      try {
        const at = now()
        const agent = deps.store.archive(
          decodeURIComponent(archive[1]!),
          user.id,
          at,
        )
        deps.pauseSchedules?.(agent.id, at)
        return json({ agent: payload(agent) })
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Unable to archive agent definition',
          },
          errorStatus(error),
        )
      }
    }

    const item = url.pathname.match(/^\/api\/agent-definitions\/([^/]+)$/)
    if (item && request.method === 'PATCH') {
      const body = await readBody(request)
      if (!body) return json({ error: 'Invalid agent definition' }, 400)
      if (body.githubAccess !== undefined && !canManageAgentAccess(user))
        return json({ error: 'Forbidden' }, 403)
      try {
        const agent = deps.store.update(
          decodeURIComponent(item[1]!),
          user.id,
          {
            ...(typeof body.name === 'string' ? { name: body.name } : {}),
            ...(typeof body.description === 'string'
              ? { description: body.description }
              : {}),
            ...(typeof body.instructions === 'string'
              ? { instructions: body.instructions }
              : {}),
            ...(isVisibility(body.visibility)
              ? { visibility: body.visibility }
              : {}),
            ...(typeof body.githubAccess === 'boolean'
              ? { githubAccess: body.githubAccess }
              : {}),
            ...(typeof body.color === 'string' ? { color: body.color } : {}),
          },
          now(),
        )
        return json({ agent: payload(agent) })
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Unable to update agent definition',
          },
          errorStatus(error),
        )
      }
    }

    return undefined
  }
}
