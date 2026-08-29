import { summaryFromPerson } from '#project/agents/roster'
import { capabilityPresentation } from '#project/agents/roster-people'
import { getConnectionKind } from '#project/connections/registry'
import {
  capabilityHost,
  capabilityUrlForSandbox,
  createCoordinator,
  hostLanAddress,
  parseContainerProvider,
  parseSandboxProvider,
  sandboxCpus,
  sandboxMemMib,
} from './coordinator'
import { createSqliteBulletinStore } from './features/bulletins/bulletin-store'
import { createSqliteChatStore } from './features/chats/chat-store'
import {
  createSqliteIssueStore,
  resolveIssue,
  type Issue,
  type IssueOwner,
} from './features/issues/issue-store'
import {
  attachmentDirectory,
  createRoomAttachmentSource,
} from './features/rooms/attachments'
import { createRoomMessageHub } from './features/rooms/room-hub'
import { createSqliteRoomStore } from './features/rooms/room-store'
import { createRunControl } from './features/runs/run-control'
import { createSqliteScheduleStore } from './features/schedules/schedule-store'
import { createAgentDefinitionStore } from './features/agents/agent-definition-store'
import { createWorkspaceConnections } from './features/workspace/workspace-connections'
import {
  createWorkspaceSkillStore,
  skillDirectory,
} from './features/workspace/workspace-skills'

if (import.meta.main) {
  const sandboxProviderName = parseSandboxProvider(
    process.env.SWEAT_SANDBOX_PROVIDER,
  )
  const containerProviderName = parseContainerProvider(
    process.env.SWEAT_CONTAINER_PROVIDER,
    sandboxProviderName,
  )
  const { fileURLToPath } = await import('node:url')
  // Load the database first: auth and the session authenticator both depend on it.
  const { migrateDatabase, sqlite } = await import('../lib/database')
  await migrateDatabase(
    fileURLToPath(new URL('../../drizzle', import.meta.url)),
  )
  const [
    { auth },
    { betterAuthSessionAuthenticator },
    { createAdmissionStore },
    { createWorkspaceLlmConfig },
    { createWorkspaceCursorRuntimeConfig },
    { createWorkspacePreviewConfig },
    { createWorkspaceAgentsExecutor },
    {
      createGitHubSoftwareEngineerAdapter,
      createLinearSoftwareEngineerAdapter,
      createWorkspaceIssuesAdapter,
      createWorkspaceAgentsAdapter,
      createWorkspaceSoftwareEngineerAdapter,
    },
    { createGitHubTokenClient },
    { createMcpGatewayHttpServer },
    { createAppleContainerClient },
    { createAppleContainerSandboxProvider },
    { createDockerSandboxProvider },
    { createSmolvmSandboxProvider },
    { createWorkspaceGrantToolsConfig },
    { selectGrantedTools },
    { createOpenAIGrantPicker },
  ] = await Promise.all([
    import('../lib/auth'),
    import('./features/accounts/session-auth'),
    import('./features/accounts/admission'),
    import('./features/workspace/llm-config'),
    import('./features/workspace/cursor-runtime-config'),
    import('./features/workspace/preview-config'),
    import('../../../agents/roster'),
    import('../../../agents/software-engineer-adapters'),
    import('../../../mcp/github'),
    import('../../../mcp/http'),
    import('../../../sdk/src'),
    import('../../../providers/apple-container-sandbox'),
    import('../../../providers/docker-sandbox'),
    import('../../../providers/smolvm-sandbox'),
    import('./features/workspace/grant-tools-config'),
    import('../../../agents/grant-tools'),
    import('../../../agents/grant-tools-model'),
  ])
  const admissionStore = createAdmissionStore(sqlite)
  const llm = createWorkspaceLlmConfig(sqlite)
  const cursorRuntime = createWorkspaceCursorRuntimeConfig(sqlite)
  const preview = createWorkspacePreviewConfig(sqlite)
  const grantTools = createWorkspaceGrantToolsConfig(sqlite)
  const connections = createWorkspaceConnections(sqlite)
  const skillsDirectory = skillDirectory(
    process.env.SWEAT_DATABASE_PATH ?? './sweat.sqlite',
  )
  const skills = createWorkspaceSkillStore({
    sqlite,
    directory: skillsDirectory,
  })
  const authContext = await auth.$context
  const githubRepository = process.env.SWEAT_GITHUB_REPOSITORY
  const store = createSqliteRoomStore(sqlite)
  const scheduleStore = createSqliteScheduleStore(sqlite)
  const issueStore = createSqliteIssueStore(sqlite, githubRepository)
  const bulletinStore = createSqliteBulletinStore(sqlite)
  const chatStore = createSqliteChatStore(sqlite)
  const agentDefinitionStore = createAgentDefinitionStore(sqlite)
  const firstAdmin = sqlite
    .prepare(
      `SELECT id FROM user WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`,
    )
    .get() as { id: string } | undefined
  if (firstAdmin) agentDefinitionStore.ensureSeeded(firstAdmin.id)
  const linearAccessToken = process.env.LINEAR_MCP_API_KEY
  const githubBase = process.env.SWEAT_GITHUB_BASE ?? 'main'
  const agentCaCertificate = process.env.SWEAT_AGENT_CA_CERT
  if (githubRepository && !process.env.SWEAT_GITHUB_TOKEN?.trim()) {
    throw new Error(
      'SWEAT_GITHUB_TOKEN is required when SWEAT_GITHUB_REPOSITORY is set. See docs/github-token.md.',
    )
  }
  const github = githubRepository
    ? createGitHubTokenClient(process.env.SWEAT_GITHUB_TOKEN ?? '')
    : undefined
  const issueNotify = {
    onCreated: (_issue: Issue) => {},
    onChanged: (_issue: Issue) => {},
    assignOwner: (issueId: string, owner: IssueOwner | undefined) => {
      const issue = issueStore.assignIssue(issueId, owner, Date.now())
      return { issue }
    },
    maybeStartForOwner: (issueId: string) => {
      const issue = issueStore.getIssue(issueId)
      if (!issue) throw new Error('Issue not found')
      return { issue }
    },
  }
  const messages = createRoomMessageHub(store)
  const attachmentsDirectory = attachmentDirectory(
    process.env.SWEAT_DATABASE_PATH ?? './sweat.sqlite',
  )
  const fallbackMcpHost = () =>
    capabilityHost(
      process.env.SWEAT_MCP_HOST,
      sandboxProviderName,
      hostLanAddress(),
    )
  const smolvmProvider =
    sandboxProviderName === 'smolvm'
      ? createSmolvmSandboxProvider({
          // A microVM guest resolves through public DNS and trusts only public
          // CAs, so an internal model or MCP endpoint needs both named here.
          ...(process.env.SWEAT_SANDBOX_DNS
            ? { dns: process.env.SWEAT_SANDBOX_DNS }
            : {}),
          ...(agentCaCertificate ? { caCertificate: agentCaCertificate } : {}),
          // Bounds one runaway guest. smolvm's own defaults are 8192 and 4, and
          // nothing caps how many sandboxes run at once.
          mem: sandboxMemMib(process.env.SWEAT_SANDBOX_MEM_MIB),
          cpus: sandboxCpus(process.env.SWEAT_SANDBOX_CPUS),
        })
      : undefined
  const containerProvider =
    containerProviderName === 'docker'
      ? createDockerSandboxProvider({
          // Same two as the microVM: Docker hands a container 8.8.8.8 when the
          // host resolves through a stub, and installs no private CA of its own.
          ...(process.env.SWEAT_SANDBOX_DNS
            ? { dns: process.env.SWEAT_SANDBOX_DNS }
            : {}),
          ...(agentCaCertificate ? { caCertificate: agentCaCertificate } : {}),
        })
      : createAppleContainerSandboxProvider({
          container: createAppleContainerClient(),
        })
  const control = createRunControl(
    createWorkspaceAgentsExecutor({
      sandboxProvider: smolvmProvider ?? containerProvider,
      image: process.env.SWEAT_AGENT_IMAGE,
      cursorImage: process.env.SWEAT_CURSOR_AGENT_IMAGE,
      model: () => llm.model(),
      cursor: () => cursorRuntime.cursor(),
      getPreviewConfig: () => preview.preview(),
      selectTools: (input) =>
        selectGrantedTools(grantTools.policy(), input, {
          pick: createOpenAIGrantPicker(() => llm.model()),
        }),
      attachmentSource: createRoomAttachmentSource({
        store,
        directory: attachmentsDirectory,
      }),
      skillSource: {
        async listForAgent(agentDefinitionId) {
          const packages = await skills.listAttachedPackages(agentDefinitionId)
          return packages.map(({ skill, files }) => ({
            name: skill.name,
            files,
          }))
        },
        layoutForAgent(agentDefinitionId) {
          return agentDefinitionStore.get(agentDefinitionId)?.kind
        },
      },
      connectionAdapters: (agentDefinitionId) =>
        connections.adaptersForAgent(agentDefinitionId),
      getPerson: (id) => {
        const record = agentDefinitionStore.get(id)
        if (!record) return undefined
        return {
          id: record.id,
          kind: record.kind,
          instructions: record.instructions,
          githubAccess: record.githubAccess,
          archived: record.archivedAt !== undefined,
          visibility: record.visibility,
          creatorAccountId: record.creatorAccountId,
        }
      },
      adapters: [
        createWorkspaceSoftwareEngineerAdapter({
          port: {
            listMessages: (id) =>
              messages
                .listMessages(id)
                .map(({ attachments: _, ...message }) => message),
            listThreadMessages: (id, rootId) =>
              messages
                .listThreadMessages(id, rootId)
                .map(({ attachments: _, ...message }) => message),
            postMessage: (input) => {
              messages.postMessage(input)
            },
          },
        }),
        createWorkspaceIssuesAdapter({
          port: {
            listIssues: (filter) => issueStore.listIssues(filter),
            getIssue: (ref) => resolveIssue(issueStore, ref),
            createIssue: (input) => {
              if (input.owner?.kind === 'agent') {
                const known = Boolean(agentDefinitionStore.get(input.owner!.id))
                if (!known) throw new Error('Unknown agent definition')
              }
              if (input.owner?.kind === 'account') {
                const known = store
                  .listWorkspaceUsers()
                  .some((user) => user.id === input.owner!.id)
                if (!known) throw new Error('Unknown account')
              }
              const issue = issueStore.createIssue({
                id: crypto.randomUUID(),
                title: input.title,
                ...(input.description !== undefined
                  ? { description: input.description }
                  : {}),
                ...(input.status ? { status: input.status } : {}),
                ...(input.priority ? { priority: input.priority } : {}),
                ...(input.tags ? { tags: input.tags } : {}),
                ...(input.parentId ? { parentId: input.parentId } : {}),
                ...(input.owner ? { owner: input.owner } : {}),
                createdBy: input.createdBy,
                createdAt: Date.now(),
              })
              issueNotify.onCreated(issue)
              if (input.owner?.kind === 'agent')
                return issueNotify.maybeStartForOwner(issue.id).issue
              return issue
            },
            updateIssue: (ref, patch) => {
              const issue = resolveIssue(issueStore, ref)
              if (!issue) throw new Error(`Issue not found: ${ref}`)
              const updated = issueStore.updateIssue(
                issue.id,
                {
                  ...(patch.title !== undefined ? { title: patch.title } : {}),
                  ...(patch.description !== undefined
                    ? { description: patch.description }
                    : {}),
                  ...(patch.status !== undefined
                    ? { status: patch.status }
                    : {}),
                  ...(patch.priority !== undefined
                    ? { priority: patch.priority }
                    : {}),
                  ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
                  ...(patch.timeSpent !== undefined
                    ? { timeSpent: patch.timeSpent }
                    : {}),
                  ...(patch.parentId !== undefined
                    ? { parentId: patch.parentId }
                    : {}),
                  ...(patch.branch !== undefined
                    ? { branch: patch.branch }
                    : {}),
                },
                Date.now(),
              )
              issueNotify.onChanged(updated)
              return updated
            },
            assignIssue: (ref, owner) => {
              const issue = resolveIssue(issueStore, ref)
              if (!issue) throw new Error(`Issue not found: ${ref}`)
              if (owner?.kind === 'agent') {
                const known = Boolean(agentDefinitionStore.get(owner.id))
                if (!known) throw new Error('Unknown agent definition')
              }
              if (owner?.kind === 'account') {
                const known = store
                  .listWorkspaceUsers()
                  .some((user) => user.id === owner.id)
                if (!known) throw new Error('Unknown account')
              }
              return issueNotify.assignOwner(issue.id, owner ?? undefined).issue
            },
          },
          listAssignableOwners: () => [
            ...agentDefinitionStore
              .listAll()
              .filter(
                (agent) =>
                  agent.archivedAt === undefined &&
                  agent.visibility === 'workspace',
              )
              .map((agent) => ({
                kind: 'agent' as const,
                id: agent.id,
                name: agent.name,
              })),
            ...store.listWorkspaceUsers().map((user) => ({
              kind: 'account' as const,
              id: user.id,
              name: user.displayName || user.name,
            })),
          ],
        }),
        createWorkspaceAgentsAdapter({
          port: {
            createAgent(input, responsibleAccountId, creatingAgentId) {
              const record = agentDefinitionStore.create(
                {
                  ...input,
                  creatorAccountId: responsibleAccountId,
                  creatingAgentId,
                },
                Date.now(),
              )
              return {
                id: record.id,
                name: record.name,
                description: record.description,
                kind: record.kind,
                visibility: record.visibility,
                creatorAccountId: record.creatorAccountId,
                creatingAgentId: record.creatingAgentId,
              }
            },
            duplicateAgent(id, responsibleAccountId, creatingAgentId) {
              const record = agentDefinitionStore.duplicate(
                id,
                { creatorAccountId: responsibleAccountId, creatingAgentId },
                Date.now(),
              )
              return {
                id: record.id,
                name: record.name,
                description: record.description,
                kind: record.kind,
                visibility: record.visibility,
                creatorAccountId: record.creatorAccountId,
                creatingAgentId: record.creatingAgentId,
              }
            },
          },
        }),
        ...(linearAccessToken
          ? [
              createLinearSoftwareEngineerAdapter({
                accessToken: linearAccessToken,
              }),
            ]
          : []),
        ...(github && githubRepository
          ? [
              createGitHubSoftwareEngineerAdapter({
                octokit: github,
                repository: githubRepository,
                base: githubBase,
                verifyCommand: process.env.SWEAT_VERIFY_COMMAND,
                bindIssueBranch: (issueId, branch) => {
                  const issue = issueStore.getIssue(issueId)
                  if (!issue || issue.branch) return
                  const updated = issueStore.updateIssue(
                    issueId,
                    { branch },
                    Date.now(),
                  )
                  issueNotify.onChanged(updated)
                },
              }),
            ]
          : []),
      ],
      createCapabilityEndpoint: (gateway, context) => {
        const server = createMcpGatewayHttpServer({
          gateway,
          hostname: '0.0.0.0',
        })
        return {
          url: capabilityUrlForSandbox(
            server.url,
            context.sandbox,
            fallbackMcpHost(),
            process.env.SWEAT_MCP_HOST,
          ),
          close: server.close,
        }
      },
    }),
  )
  const coordinator = createCoordinator({
    control,
    ...(smolvmProvider ? { vmControl: smolvmProvider } : {}),
    store,
    messages,
    authenticator: betterAuthSessionAuthenticator,
    authHandler: (request) => auth.handler(request),
    origin: process.env.SWEAT_GUI_ORIGIN ?? 'tauri://localhost',
    attachmentDirectory: attachmentsDirectory,
    port: Number(process.env.SWEAT_COORDINATOR_PORT ?? 3001),
    scheduleStore,
    issueStore,
    bulletinStore,
    chatStore,
    issueNotify,
    agentDefinitionStore,
    agentDefinitions: (viewerAccountId) => {
      const attachments = skills.listAttachments()
      const byAgent = new Map<
        string,
        { id: string; name: string; description: string }[]
      >()
      for (const [agentId, skillIds] of Object.entries(attachments)) {
        byAgent.set(
          agentId,
          skillIds.flatMap((skillId) => {
            const skill = skills.get(skillId)
            return skill
              ? [
                  {
                    id: skill.id,
                    name: skill.name,
                    description: skill.description,
                  },
                ]
              : []
          }),
        )
      }
      const linksByAgent = connections.listLinksByAgent()
      const connectionCapabilities = new Map<
        string,
        { id: string; name: string; tools: string[] }[]
      >()
      for (const [agentId, kindIds] of Object.entries(linksByAgent)) {
        connectionCapabilities.set(
          agentId,
          kindIds.flatMap((kindId) => {
            const kind = getConnectionKind(kindId)
            const connection = connections
              .list()
              .find((item) => item.id === kindId)
            if (!kind || !connection?.configured) return []
            const presentation = capabilityPresentation[kind.capabilityId]
            return [
              {
                id: kind.capabilityId,
                name: presentation?.name ?? kind.name,
                tools: kind.tools.map(
                  (tool) => presentation?.tools[tool] ?? tool,
                ),
              },
            ]
          }),
        )
      }
      return agentDefinitionStore.listVisible(viewerAccountId).map((record) =>
        summaryFromPerson(
          {
            id: record.id,
            name: record.name,
            description: record.description,
            kind: record.kind,
            githubAccess: record.githubAccess,
            visibility: record.visibility,
            creatorAccountId: record.creatorAccountId,
            creatingAgentId: record.creatingAgentId,
            updaterAccountId: record.updaterAccountId,
            updatedAt: record.updatedAt,
            archivedAt: record.archivedAt,
            instructions: record.instructions,
            color: record.color,
          },
          byAgent.get(record.id) ?? [],
          connectionCapabilities.get(record.id) ?? [],
        ),
      )
    },
    admission: {
      store: admissionStore,
      llm,
      cursorRuntime,
      preview,
      grantTools,
      skills,
      connections,
      agentMentionHandles: () => agentDefinitionStore.mentionHandles(),
      listAgents: () =>
        agentDefinitionStore
          .listAll()
          .filter((agent) => agent.archivedAt === undefined)
          .map((agent) => ({ id: agent.id, name: agent.name })),
      knownAgent: (id) => {
        const agent = agentDefinitionStore.get(id)
        return Boolean(agent && agent.archivedAt === undefined)
      },
      listUsers: () => authContext.internalAdapter.listUsers(100),
      banUser: (request, userId) =>
        auth.api.banUser({ body: { userId }, headers: request.headers }),
      unbanUser: (request, userId) =>
        auth.api.unbanUser({ body: { userId }, headers: request.headers }),
      resetUserPassword: async (request, userId, newPassword) => {
        const response = await auth.api.setUserPassword({
          body: { userId, newPassword },
          headers: request.headers,
          asResponse: true,
        })
        if (!response.ok) return response
        return auth.api.revokeUserSessions({
          body: { userId },
          headers: request.headers,
          asResponse: true,
        })
      },
      createAccount: async (body, role) => {
        const created = await auth.api.createUser({
          body: {
            email: body.email,
            password: body.password,
            name: body.name,
            role,
            data: {
              username: body.username,
              displayUsername: body.username,
            },
          },
          asResponse: true,
        })
        if (!created.ok) return created
        if (role === 'admin') {
          const row = sqlite
            .prepare('SELECT id FROM user WHERE email = ?')
            .get(body.email) as { id: string } | undefined
          if (row) agentDefinitionStore.ensureSeeded(row.id)
        }
        const signedIn = await auth.api.signInEmail({
          body: { email: body.email, password: body.password },
          asResponse: true,
        })
        return signedIn.ok ? signedIn : created
      },
    },
    agentReady: (agentDefinitionId) => {
      const person = agentDefinitionStore.get(agentDefinitionId ?? '')
      if (!person || person.archivedAt !== undefined) return false
      return person.kind === 'cursor'
        ? cursorRuntime.public().configured
        : llm.public().configured
    },
  })
  process.stdout.write(`Coordinator listening on ${coordinator.port}\n`)
  const setupToken = admissionStore.ensureSetupToken()
  if (setupToken) process.stdout.write(`Colony setup token: ${setupToken}\n`)
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
    try {
      await coordinator.stop()
      // Fork bases outlive a run, so nothing else would ever delete them.
      await smolvmProvider?.disposeGoldens()
      sqlite.close()
      process.exit(0)
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    }
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
