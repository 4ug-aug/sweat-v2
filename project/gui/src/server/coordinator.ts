import type { ServerWebSocket } from 'bun'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import {
  overlayLivePreparation,
  type RunControl,
  type RunSummary,
} from './features/runs/run-control'
import { runStep } from './features/runs/run-storage'
import {
  type RoomRun,
  type RoomStore,
  type RoomUser,
  type StoredStep,
} from './features/rooms/room-store'
import { type RoomMessageHub } from './features/rooms/room-hub'
import {
  createAdmissionHttpHandler,
  type AdmissionOptions,
} from './features/accounts/admission-http'
import { mentionedAccounts } from './features/rooms/attention'
import { rosterDefinitionSummaries } from '#project/agents/roster'
import { attachmentDirectory } from './features/rooms/attachments'
import { type ScheduleStore } from './features/schedules/schedule-store'
import {
  type Issue,
  type IssueOwner,
  type IssueRun,
  type IssueStore,
} from './features/issues/issue-store'
import { type BulletinStore } from './features/bulletins/bulletin-store'
import { type DocStore } from './features/docs/doc-store'
import { type Grill, type GrillStore } from './features/grills/grill-store'
import {
  createIssueRunner,
  type IssueRunner,
} from './features/issues/issue-runner'
import {
  createScheduleRunner,
  type ScheduleRunner,
} from './features/schedules/schedule-runner'
import { allowedOrigin, json, withCors } from './http/respond'
import { createIssuesHttp } from './features/issues/issues-http'
import { createSchedulesHttp } from './features/schedules/schedules-http'
import { createBulletinsHttp } from './features/bulletins/bulletins-http'
import { createDocsHttp } from './features/docs/docs-http'
import { createGrillsHttp } from './features/grills/grills-http'
import { createGrillLinkedRuns } from './features/grills/grill-linked-runs'
import { createRoomsHttp } from './features/rooms/rooms-http'
import { createMembersHttp } from './features/rooms/members-http'
import { createOneshotsHttp } from './features/oneshots/oneshots-http'
import { createOneshotSession } from './features/oneshots/oneshot-session'
import { type ChatStore } from './features/chats/chat-store'
import { createChatLinkedRuns } from './features/chats/chat-linked-runs'
import { createChatsHttp } from './features/chats/chats-http'
import { createVmsHttp } from './features/vms/vms-http'
import type { SmolvmMachineControl } from '#project/providers/smolvm-sandbox'
import type {
  AgentDefinitionSummary,
  GrillLeaseMessage,
  GrillParticipantMessage,
  GrillServerMessage,
  RoomServerMessage,
  ServerMessage,
  WorkspaceRoom,
  WorkspaceServerMessage,
} from './protocol'

export { allowedOrigin }

export interface SessionAuthenticator {
  authenticate(request: Request): Promise<RoomUser | undefined>
}

// Short-lived, single-process HMAC ticket used to authenticate the realtime
// WebSocket. The desktop client authenticates over HTTP (cookie jar), fetches a
// ticket, and passes it in the stream URL — the WebSocket transport cannot carry
// the HTTP session, so the ticket bridges an already-authenticated HTTP request
// to the upgrade.
const realtimeTicketSecret = randomBytes(32)
const realtimeTicketTtlMs = 30_000
export const mintRealtimeTicket = (userId: string): string => {
  const body = Buffer.from(
    `${userId}|${Date.now() + realtimeTicketTtlMs}`,
  ).toString('base64url')
  const sig = createHmac('sha256', realtimeTicketSecret)
    .update(body)
    .digest('base64url')
  return `${body}.${sig}`
}
export const verifyRealtimeTicket = (ticket: string): string | undefined => {
  const [body, sig] = ticket.split('.')
  if (!body || !sig) return undefined
  const expected = createHmac('sha256', realtimeTicketSecret)
    .update(body)
    .digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf))
    return undefined
  const [userId, expiry] = Buffer.from(body, 'base64url').toString().split('|')
  if (!userId || !expiry || Date.now() > Number(expiry)) return undefined
  return userId
}

const roomHistoryPageSize = 50
const grillLeaseTtlMs = 4_000

type SocketData =
  | { scope: 'room'; roomId: string; userId: string }
  | { scope: 'workspace'; userId: string }
  | {
      scope: 'grill'
      grillId: string
      userId: string
      presenceId: string
      user: RoomUser
    }

const send = (
  socket: ServerWebSocket<SocketData>,
  message: ServerMessage,
): void => {
  socket.send(JSON.stringify(message))
}

const CONTAINER_PROVIDERS = ['apple-container', 'docker'] as const
const SANDBOX_PROVIDERS = [...CONTAINER_PROVIDERS, 'smolvm'] as const

export type SandboxProviderName = (typeof SANDBOX_PROVIDERS)[number]
/** A microVM cannot boot a person that gets no repository checkout cheaply. */
export type ContainerProviderName = (typeof CONTAINER_PROVIDERS)[number]

function parseProvider<Name extends SandboxProviderName>(
  variable: string,
  accepted: readonly Name[],
  value: string | undefined,
): Name {
  const name = accepted.find((candidate) => candidate === value)
  if (name) return name
  throw new Error(`${variable} must be set to one of: ${accepted.join(', ')}`)
}

export function parseSandboxProvider(
  value: string | undefined,
): SandboxProviderName {
  return parseProvider('SWEAT_SANDBOX_PROVIDER', SANDBOX_PROVIDERS, value)
}

/**
 * A sandbox needs room for the guest page cache the image brings (measured:
 * ~700MiB for sweat-agent, ~1.25GiB for the cursor image) plus whatever the
 * agent builds. 4096 clears both with headroom; 2048 is the measured floor
 * that still leaves ~1GiB free, and 1024 leaves 79MiB and will OOM.
 */
const DEFAULT_SANDBOX_MEM_MIB = 4096
const DEFAULT_SANDBOX_CPUS = 2

/** A positive integer, or the default — a typo must not silently mean "8192". */
function positiveInteger(
  variable: string,
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${variable} must be a positive integer, got: ${value}`)
  }
  return parsed
}

export function sandboxMemMib(value: string | undefined): number {
  return positiveInteger(
    'SWEAT_SANDBOX_MEM_MIB',
    value,
    DEFAULT_SANDBOX_MEM_MIB,
  )
}

export function sandboxCpus(value: string | undefined): number {
  return positiveInteger('SWEAT_SANDBOX_CPUS', value, DEFAULT_SANDBOX_CPUS)
}

type HostAddress = { family: string | number; internal: boolean; address: string }

/** Hypervisor, VPN, and peer-to-peer nics a guest cannot use as "the LAN". */
const VIRTUAL_NIC =
  /^(lo|bridge|vmenet|vmnet|utun|awdl|llw|gif|stf|anpi|ap|vnic|docker|cni|flannel|tailscale|zt)/i

const isIpv4 = (address: HostAddress) =>
  !address.internal && (address.family === 'IPv4' || address.family === 4)

const nics = (
  interfaces: NodeJS.Dict<HostAddress[]>,
  allow: (name: string, address: HostAddress) => boolean,
): string | undefined =>
  Object.entries(interfaces)
    .flatMap(([name, addresses]) =>
      (addresses ?? [])
        .filter((address) => allow(name, address))
        .map((address) => address.address),
    )
    .at(0)

/** The host IPv4 a LAN guest can route to, skipping vmnet/bridge/VPN nics. */
export function hostLanAddress(
  interfaces: NodeJS.Dict<HostAddress[]> = networkInterfaces(),
): string | undefined {
  return (
    nics(
      interfaces,
      (name, address) =>
        isIpv4(address) && /^(en|eth|wlan)\d+$/i.test(name),
    ) ??
    nics(
      interfaces,
      (name, address) => isIpv4(address) && !VIRTUAL_NIC.test(name),
    ) ??
    nics(interfaces, (_name, address) => isIpv4(address))
  )
}

/**
 * Fallback host a guest should use when the sandbox did not report its own
 * gateway. `host.container.internal` is a container DNS name that does not
 * resolve inside a microVM; the host's LAN address is the last shared route.
 */
export function capabilityHost(
  configured: string | undefined,
  sandbox: SandboxProviderName,
  lanAddress: string | undefined,
): string {
  if (configured) return configured
  if (sandbox === 'smolvm' && lanAddress) return `http://${lanAddress}`
  return 'http://host.container.internal'
}

/** Rewrite a 0.0.0.0 listen URL to the host the guest can actually reach. */
export function advertisedCapabilityUrl(listenUrl: string, host: string): string {
  const listen = new URL(listenUrl)
  const advertised = new URL(host.includes('://') ? host : `http://${host}`)
  listen.protocol = advertised.protocol
  listen.hostname = advertised.hostname
  return listen.href.replace(/\/$/, '')
}

/**
 * An operator naming SWEAT_MCP_HOST wins: a sandbox only knows its own default
 * gateway, and rootless Docker cannot route that to the host's loopback. Then
 * the sandbox's own gateway, then the process-wide host.
 */
export function capabilityUrlForSandbox(
  listenUrl: string,
  sandbox: { hostGateway?: string } | undefined,
  fallbackHost: string,
  configuredHost?: string,
): string {
  return advertisedCapabilityUrl(
    listenUrl,
    configuredHost ?? sandbox?.hostGateway ?? fallbackHost,
  )
}

/**
 * Which container runtime boots the persons that get no repository. Only asked
 * for when the sandbox provider is the microVM; otherwise it is that provider.
 */
export function parseContainerProvider(
  value: string | undefined,
  sandbox: SandboxProviderName,
): ContainerProviderName {
  if (sandbox !== 'smolvm') return sandbox
  return parseProvider('SWEAT_CONTAINER_PROVIDER', CONTAINER_PROVIDERS, value)
}

export function createCoordinator(options: {
  control: RunControl
  store: RoomStore
  messages: RoomMessageHub
  authenticator: SessionAuthenticator
  authHandler: (request: Request) => Promise<Response>
  origin: string
  attachmentDirectory?: string
  port?: number
  admission?: AdmissionOptions
  agentReady?: (agentDefinitionId?: string) => boolean
  scheduleStore?: ScheduleStore
  issueStore?: IssueStore
  bulletinStore?: BulletinStore
  docStore?: DocStore
  grillStore?: GrillStore
  chatStore?: ChatStore
  grillNotify?: {
    onChanged: (grill: Grill) => void
  }
  issueNotify?: {
    onCreated: (issue: Issue) => void
    onChanged: (issue: Issue) => void
    assignOwner: (
      issueId: string,
      owner: IssueOwner | undefined,
    ) => { issue: Issue; run?: IssueRun }
    maybeStartForOwner: (issueId: string) => { issue: Issue; run?: IssueRun }
  }
  agentDefinitions?: () => AgentDefinitionSummary[]
  vmControl?: SmolvmMachineControl
}) {
  const attachmentsDirectory =
    options.attachmentDirectory ??
    attachmentDirectory(process.env.SWEAT_DATABASE_PATH ?? './sweat.sqlite')
  const sockets = new Set<ServerWebSocket<SocketData>>()
  type GrillLease = GrillLeaseMessage & {
    socket: ServerWebSocket<SocketData>
    lastSeen: number
  }
  const grillLeases = new Map<string, Map<string, GrillLease>>()
  const admissionHandler = options.admission
    ? createAdmissionHttpHandler({
        ...options.admission,
        authenticate: (request) => options.authenticator.authenticate(request),
        guiOrigin: options.origin,
        onSuspend: (userId) => {
          for (const socket of sockets)
            if (socket.data.userId === userId)
              socket.close(1008, 'Account suspended')
        },
      })
    : undefined
  const roomsFor = (userId: string): WorkspaceRoom[] => {
    const counts = options.store.listAttentionCounts(userId)
    const mentionCounts = options.store.listAttentionCounts(userId, 'mention')
    return options.store.listRoomsForUser(userId).map((room) => {
      const latestOtherMessage = options.store.latestMessageFromOther(
        room.id,
        userId,
      )
      const threadAttentionRootIds =
        options.store.listOpenThreadAttentionRootIds(userId, room.id)
      return {
        ...room,
        attentionCount: counts.get(room.id) ?? 0,
        mentionCount: mentionCounts.get(room.id) ?? 0,
        ...(latestOtherMessage ? { latestOtherMessage } : {}),
        ...(threadAttentionRootIds.length > 0
          ? { threadAttentionRootIds }
          : {}),
      }
    })
  }
  const agentDefinitions = (): AgentDefinitionSummary[] =>
    options.agentDefinitions?.() ?? rosterDefinitionSummaries()
  const broadcastWorkspace = (message: WorkspaceServerMessage): void => {
    for (const socket of sockets)
      if (socket.data.scope === 'workspace') send(socket, message)
  }
  if (options.issueNotify) {
    options.issueNotify.onCreated = (issue) =>
      broadcastWorkspace({ type: 'issue.created', issue })
    options.issueNotify.onChanged = (issue) =>
      broadcastWorkspace({ type: 'issue.changed', issue })
  }
  const broadcastRoom = (roomId: string, message: RoomServerMessage): void => {
    for (const socket of sockets)
      if (socket.data.scope === 'room' && socket.data.roomId === roomId)
        send(socket, message)
  }
  const broadcastGrill = (
    grillId: string,
    message: GrillServerMessage,
  ): void => {
    for (const socket of sockets)
      if (socket.data.scope === 'grill' && socket.data.grillId === grillId)
        send(socket, message)
  }
  const broadcastGrillChanged = (grillId: string, grill: Grill): void =>
    broadcastGrill(grillId, { type: 'grill.changed', grill })
  if (options.grillNotify) {
    options.grillNotify.onChanged = (grill) =>
      broadcastGrillChanged(grill.id, grill)
  }
  const grillLinkedRuns = options.grillStore
    ? createGrillLinkedRuns({
        startWarm: ({
          grillId,
          task,
          agentDefinitionId,
          idleTtlMs,
          onCreate,
        }) =>
          options.control.start(task, {
            grillId,
            agentDefinitionId,
            warm: true,
            idleTtlMs,
            onCreate,
          }),
        followUp: (runId, task) => options.control.followUp(runId, task),
        cancel: (runId) => options.control.cancel(runId),
        getRun: (runId) => options.control.getRun(runId),
        subscribe: (listener) => options.control.subscribe(listener),
        subscribeSteps: (listener) => options.control.subscribeSteps(listener),
        onActivityChanged: ({ grillId, linkedRun, latestStep, narration }) =>
          broadcastGrill(grillId, {
            type: 'grill.activity.changed',
            ...(linkedRun ? { linkedRun } : {}),
            ...(latestStep ? { latestStep } : {}),
            narration,
          }),
      })
    : undefined
  const grillParticipants = (grillId: string): GrillParticipantMessage[] => {
    const participants = new Map<string, GrillParticipantMessage>()
    for (const socket of sockets) {
      if (socket.data.scope !== 'grill' || socket.data.grillId !== grillId)
        continue
      const user = socket.data.user
      participants.set(user.id, {
        id: user.id,
        name: user.name,
        ...(user.image ? { image: user.image } : {}),
        ...(user.color ? { color: user.color } : {}),
        ...(user.displayName ? { displayName: user.displayName } : {}),
      })
    }
    return [...participants.values()]
  }
  const broadcastGrillPresence = (grillId: string): void =>
    broadcastGrill(grillId, {
      type: 'grill.presence.changed',
      participants: grillParticipants(grillId),
    })
  const publicLease = ({
    questionId,
    presenceId,
    editor,
  }: GrillLease): GrillLeaseMessage => ({ questionId, presenceId, editor })
  const releaseGrillLease = (grillId: string, questionId: string): void => {
    const leases = grillLeases.get(grillId)
    if (!leases?.delete(questionId)) return
    if (leases.size === 0) grillLeases.delete(grillId)
    broadcastGrill(grillId, { type: 'grill.lease.changed', questionId })
  }
  const expireGrillLeases = (now = Date.now()): void => {
    for (const [grillId, leases] of grillLeases)
      for (const [questionId, lease] of leases)
        if (now - lease.lastSeen >= grillLeaseTtlMs)
          releaseGrillLease(grillId, questionId)
  }
  const releaseSocketGrillLeases = (
    socket: ServerWebSocket<SocketData>,
    exceptQuestionId?: string,
  ): void => {
    if (socket.data.scope !== 'grill') return
    const leases = grillLeases.get(socket.data.grillId)
    if (!leases) return
    for (const [questionId, lease] of leases)
      if (lease.socket === socket && questionId !== exceptQuestionId)
        releaseGrillLease(socket.data.grillId, questionId)
  }
  const hasActiveGrillLeases = (grillId: string): boolean => {
    expireGrillLeases()
    return (grillLeases.get(grillId)?.size ?? 0) > 0
  }
  const broadcastWorkspaceToUsers = (
    userIds: Set<string>,
    message: WorkspaceServerMessage,
  ): void => {
    for (const socket of sockets)
      if (socket.data.scope === 'workspace' && userIds.has(socket.data.userId))
        send(socket, message)
  }
  const broadcastWorkspaceMessage = (message: {
    roomId: string
    messageId: string
    createdAt: number
    authorId: string
  }): void => {
    for (const socket of sockets)
      if (
        socket.data.scope === 'workspace' &&
        socket.data.userId !== message.authorId &&
        options.store.canAccessRoom(message.roomId, socket.data.userId)
      )
        send(socket, { type: 'message.created', ...message })
  }
  let scheduleRunner: ScheduleRunner | undefined
  if (options.scheduleStore) {
    scheduleRunner = createScheduleRunner({
      store: options.scheduleStore,
      control: options.control,
      onScheduleChange: (schedule) =>
        broadcastWorkspace({ type: 'schedule.changed', schedule }),
      onRunCreated: (run) =>
        broadcastWorkspace({ type: 'schedule_run.created', run }),
      onRunChange: (run) =>
        broadcastWorkspace({ type: 'schedule_run.changed', run }),
      onStep: (step) =>
        broadcastWorkspace({
          type: 'schedule_run.step',
          runId: step.runId,
          step,
        }),
    })
  }
  let issueRunner: IssueRunner | undefined
  if (options.issueStore) {
    issueRunner = createIssueRunner({
      store: options.issueStore,
      control: options.control,
      onIssueChange: (issue) =>
        broadcastWorkspace({ type: 'issue.changed', issue }),
      onRunCreated: (run) =>
        broadcastWorkspace({ type: 'issue_run.created', run }),
      onRunChange: (run) =>
        broadcastWorkspace({ type: 'issue_run.changed', run }),
      onStep: (step) =>
        broadcastWorkspace({
          type: 'issue_run.step',
          runId: step.runId,
          step,
        }),
    })
    if (options.issueNotify) {
      options.issueNotify.assignOwner = (issueId, owner) =>
        issueRunner!.assignOwner(issueId, owner)
      options.issueNotify.maybeStartForOwner = (issueId) =>
        issueRunner!.maybeStartForOwner(issueId)
      const broadcastChanged = options.issueNotify.onChanged
      options.issueNotify.onChanged = (issue) => {
        broadcastChanged(issue)
        issueRunner!.noteChanged(issue)
      }
    }
  }
  const oneshotSession = createOneshotSession({ control: options.control })
  const broadcastAttention = (
    userId: string,
    roomId: string,
    kind?: 'mention' | 'run_terminal' | 'thread_reply',
    rootId?: string,
  ): void => {
    const attentionCount =
      options.store.listAttentionCounts(userId).get(roomId) ?? 0
    const mentionCount =
      options.store.listAttentionCounts(userId, 'mention').get(roomId) ?? 0
    broadcastWorkspaceToUsers(new Set([userId]), {
      type: 'attention.changed',
      roomId,
      roomName: options.store.getRoom(roomId)?.name ?? 'Room',
      attentionCount,
      mentionCount,
      ...(kind ? { kind } : {}),
      ...(rootId ? { rootId } : {}),
    })
  }
  const broadcastGrillAttention = (userId: string, grillId: string): void => {
    if (!options.grillStore) return
    const attentionCount =
      options.grillStore.listGrillAttentionCounts(userId).get(grillId) ?? 0
    broadcastWorkspaceToUsers(new Set([userId]), {
      type: 'grill_attention.changed',
      grillId,
      attentionCount,
      kind: 'grill_invite',
    })
  }
  const createAttention = (
    roomId: string,
    recipientId: string,
    kind: 'mention' | 'run_terminal' | 'thread_reply',
    sourceId: string,
    createdAt: number,
    rootId?: string,
  ): void => {
    if (
      options.store.createAttention({
        id: crypto.randomUUID(),
        roomId,
        recipientId,
        kind,
        sourceId,
        ...(rootId ? { rootId } : {}),
        createdAt,
      })
    )
      broadcastAttention(recipientId, roomId, kind, rootId)
  }
  const sendSnapshot = (socket: ServerWebSocket<SocketData>): void => {
    if (socket.data.scope === 'workspace') {
      send(socket, {
        type: 'workspace.snapshot',
        rooms: roomsFor(socket.data.userId),
      })
      return
    }
    if (socket.data.scope === 'grill') {
      const grill = options.grillStore?.getGrillForUser(
        socket.data.grillId,
        socket.data.userId,
      )
      if (!grill) return socket.close()
      expireGrillLeases()
      const latestStep = grillLinkedRuns?.getLatestStep(socket.data.grillId)
      send(socket, {
        type: 'grill.snapshot',
        grill,
        presenceId: socket.data.presenceId,
        leases: [...(grillLeases.get(socket.data.grillId)?.values() ?? [])].map(
          publicLease,
        ),
        participants: grillParticipants(socket.data.grillId),
        ...(latestStep ? { latestStep } : {}),
        narration: grillLinkedRuns?.getNarration(socket.data.grillId) ?? [],
      })
      return
    }
    const room = options.store.getRoom(socket.data.roomId)
    if (!room) return socket.close()
    const page = options.store.listRoomHistoryPage(socket.data.roomId, {
      limit: roomHistoryPageSize,
    })
    const roomState = roomsFor(socket.data.userId).find(
      ({ id }) => id === room.id,
    )
    send(socket, {
      type: 'room.snapshot',
      room: {
        ...room,
        attentionCount: roomState?.attentionCount ?? 0,
        mentionCount: roomState?.mentionCount ?? 0,
        ...(roomState?.latestOtherMessage
          ? { latestOtherMessage: roomState.latestOtherMessage }
          : {}),
        ...(roomState?.threadAttentionRootIds
          ? { threadAttentionRootIds: roomState.threadAttentionRootIds }
          : {}),
      },
      messages: page.messages,
      runs: page.runs.map((run) =>
        overlayLivePreparation(run, options.control.getRun(run.id)),
      ),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      latestSteps: [
        ...options.store.latestStepsForActiveRuns(socket.data.roomId).values(),
      ],
    })
  }
  const handleGrillMessage = (
    socket: ServerWebSocket<SocketData>,
    raw: string,
  ): void => {
    if (socket.data.scope !== 'grill' || !options.grillStore) return
    let input: Record<string, unknown>
    try {
      input = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    const questionId = input.questionId
    if (typeof questionId !== 'string' || !questionId) return
    const { grillId } = socket.data
    const grill = options.grillStore.getGrillForUser(
      grillId,
      socket.data.userId,
    )
    if (!grill) return socket.close()
    if (!grill.frontier.questions.some(({ id }) => id === questionId)) {
      send(socket, {
        type: 'grill.edit.rejected',
        questionId,
        reason: 'question-not-found',
      })
      return
    }
    expireGrillLeases()
    const leases = grillLeases.get(grillId) ?? new Map<string, GrillLease>()
    const current = leases.get(questionId)

    if (input.type === 'grill.focus') {
      releaseSocketGrillLeases(socket, questionId)
      if (current && current.socket !== socket) {
        send(socket, {
          type: 'grill.lease.changed',
          questionId,
          lease: publicLease(current),
        })
        return
      }
      const user = socket.data.user
      const lease: GrillLease = {
        questionId,
        presenceId: socket.data.presenceId,
        editor: {
          id: user.id,
          name: user.name,
          ...(user.image ? { image: user.image } : {}),
          ...(user.color ? { color: user.color } : {}),
          ...(user.displayName ? { displayName: user.displayName } : {}),
        },
        socket,
        lastSeen: Date.now(),
      }
      leases.set(questionId, lease)
      grillLeases.set(grillId, leases)
      broadcastGrill(grillId, {
        type: 'grill.lease.changed',
        questionId,
        lease: publicLease(lease),
      })
      return
    }

    if (input.type === 'grill.blur') {
      if (current?.socket === socket) releaseGrillLease(grillId, questionId)
      return
    }

    if (input.type === 'grill.heartbeat') {
      if (current?.socket === socket) current.lastSeen = Date.now()
      return
    }

    if (input.type !== 'grill.draft' || typeof input.value !== 'string') return
    if (current && current.socket !== socket) {
      send(socket, {
        type: 'grill.edit.rejected',
        questionId,
        reason: 'lease-held',
      })
      return
    }
    if (current) current.lastSeen = Date.now()
    const updated = options.grillStore.updateDrafts(
      grillId,
      { [questionId]: input.value },
      Date.now(),
    )
    if (!updated) return
    broadcastGrill(grillId, {
      type: 'grill.draft.changed',
      questionId,
      value: input.value,
      presenceId: socket.data.presenceId,
      updatedAt: updated.updatedAt,
    })
  }
  const threadRootIdForRun = (run: RoomRun): string | undefined => {
    const trigger = options.store.getMessage(run.roomId, run.triggerMessageId)
    if (!trigger) return undefined
    return trigger.rootId ?? trigger.id
  }
  const notifyRunTerminal = (run: RoomRun): void => {
    const eligible = new Set(
      options.store.listMentionableAccounts(run.roomId).map(({ id }) => id),
    )
    const recipients = new Set([
      run.requestedBy.id,
      ...options.store.listMentionRecipientIds(run.triggerMessageId),
    ])
    const trigger = options.store.getMessage(run.roomId, run.triggerMessageId)
    const rootId = trigger?.rootId
    for (const recipientId of recipients)
      if (eligible.has(recipientId))
        createAttention(
          run.roomId,
          recipientId,
          'run_terminal',
          run.id,
          run.completedAt ?? Date.now(),
          rootId,
        )
  }
  /** Successful results are Thread replies: Attention goes to Account participants. */
  const notifySuccessfulRunThreadAttention = (run: RoomRun): void => {
    const rootId = threadRootIdForRun(run)
    if (!rootId) return
    const at = run.completedAt ?? Date.now()
    for (const participantId of options.store.listThreadParticipantIds(
      run.roomId,
      rootId,
    )) {
      createAttention(
        run.roomId,
        participantId,
        'thread_reply',
        run.id,
        at,
        rootId,
      )
    }
  }
  const project = (run: RunSummary): void => {
    const saved = options.store.getRun(run.id)
    if (!saved) return
    const changed = { ...saved, ...run }
    options.store.updateRun(changed)
    broadcastRoom(changed.roomId, { type: 'run.changed', run: changed })
    if (
      changed.state === 'succeeded' ||
      changed.state === 'failed' ||
      changed.state === 'cancelled'
    )
      notifyRunTerminal(changed)
    if (changed.state === 'succeeded')
      notifySuccessfulRunThreadAttention(changed)
  }
  const unsubscribe = options.control.subscribe(project)
  const unsubscribeMessages = options.messages.subscribe((event) => {
    broadcastRoom(event.message.roomId, event)
    if (event.type !== 'message.created') return
    for (const account of mentionedAccounts(
      event.message.text,
      options.store.listMentionableAccounts(event.message.roomId),
    )) {
      if (
        event.message.author.kind === 'user' &&
        event.message.author.id === account.id
      )
        continue
      createAttention(
        event.message.roomId,
        account.id,
        'mention',
        event.message.id,
        event.message.createdAt,
      )
    }
    if (event.message.rootId) {
      const rootId = event.message.rootId
      for (const participantId of options.store.listThreadParticipantIds(
        event.message.roomId,
        rootId,
      )) {
        if (
          event.message.author.kind === 'user' &&
          event.message.author.id === participantId
        )
          continue
        createAttention(
          event.message.roomId,
          participantId,
          'thread_reply',
          event.message.id,
          event.message.createdAt,
          rootId,
        )
      }
    }
    broadcastWorkspaceMessage({
      roomId: event.message.roomId,
      messageId: event.message.id,
      createdAt: event.message.createdAt,
      authorId: event.message.author.id,
    })
  })
  const stepIndex = new Map<string, number>()
  const unsubscribeSteps = options.control.subscribeSteps((runId, step) => {
    const run = options.store.getRun(runId)
    if (!run) return
    const idx = stepIndex.get(runId) ?? 0
    stepIndex.set(runId, idx + 1)
    const stored: StoredStep = {
      ...runStep(runId, idx, step),
      roomId: run.roomId,
    }
    options.store.appendStep(stored)
    broadcastRoom(run.roomId, { type: 'run.step', runId, step: stored })
  })
  options.store.failStaleRuns().forEach((run) => {
    broadcastRoom(run.roomId, { type: 'run.changed', run })
    notifyRunTerminal(run)
  })
  scheduleRunner?.failStaleRuns()
  scheduleRunner?.tick()
  issueRunner?.failStaleRuns()
  const scheduleInterval = scheduleRunner
    ? setInterval(() => scheduleRunner!.tick(), 15_000)
    : undefined
  const grillLeaseInterval = options.grillStore
    ? setInterval(() => expireGrillLeases(), 1_000)
    : undefined
  const schedulesHttp = options.scheduleStore
    ? createSchedulesHttp({
        scheduleStore: options.scheduleStore,
        scheduleRunner,
        agentDefinitions,
        broadcastWorkspace,
        liveRun: (id) => options.control.getRun(id),
      })
    : undefined
  const issuesHttp = options.issueStore
    ? createIssuesHttp({
        issueStore: options.issueStore,
        issueRunner,
        agentDefinitions,
        listWorkspaceUsers: () => options.store.listWorkspaceUsers(),
        broadcastWorkspace,
        liveRun: (id) => options.control.getRun(id),
      })
    : undefined
  const bulletinsHttp = options.bulletinStore
    ? createBulletinsHttp({
        bulletinStore: options.bulletinStore,
        broadcastWorkspace,
      })
    : undefined
  const docsHttp = options.docStore
    ? createDocsHttp({
        docStore: options.docStore,
        broadcastWorkspace,
      })
    : undefined
  const grillsHttp = options.grillStore
    ? createGrillsHttp({
        grillStore: options.grillStore,
        broadcastGrillAttention,
        broadcastGrillChanged,
        hasActiveEditLeases: hasActiveGrillLeases,
        linkedRuns: grillLinkedRuns,
      })
    : undefined
  const oneshotsHttp = createOneshotsHttp({
    oneshotSession,
    agentDefinitions,
  })
  const chatLinkedRuns = options.chatStore
    ? createChatLinkedRuns({
        startWarm: ({
          chatId,
          task,
          agentDefinitionId,
          idleTtlMs,
          onCreate,
        }) =>
          options.control.start(task, {
            chatId,
            agentDefinitionId,
            warm: true,
            idleTtlMs,
            onCreate,
          }),
        followUp: (runId, task) => options.control.followUp(runId, task),
        cancel: (runId) => options.control.cancel(runId),
        getRun: (runId) => options.control.getRun(runId),
        subscribe: (listener) => options.control.subscribe(listener),
        subscribeSteps: (listener) => options.control.subscribeSteps(listener),
        onTurnComplete: (turn) => {
          try {
            options.chatStore?.appendMessage({
              id: crypto.randomUUID(),
              chatId: turn.chatId,
              role: 'assistant',
              text: turn.text.trim() || 'Completed.',
              createdAt: Date.now(),
              runId: turn.runId,
              steps: turn.steps,
            })
          } catch {
            // Chat was deleted while the turn finished.
          }
        },
      })
    : undefined
  const chatsHttp =
    options.chatStore && chatLinkedRuns
      ? createChatsHttp({
          chatStore: options.chatStore,
          linkedRuns: chatLinkedRuns,
          agentDefinitions,
        })
      : undefined
  const roomsHttp = createRoomsHttp({
    store: options.store,
    messages: options.messages,
    control: options.control,
    attachmentsDirectory,
    historyPageSize: roomHistoryPageSize,
    agentReady: options.agentReady,
    roomsFor,
    broadcastWorkspace,
    broadcastWorkspaceToUsers,
    broadcastRoom,
  })
  const membersHttp = createMembersHttp({
    store: options.store,
    broadcastWorkspaceToUsers,
    broadcastRoom,
    broadcastAttention: (userId, roomId) => broadcastAttention(userId, roomId),
  })
  const vmsHttp = options.vmControl
    ? createVmsHttp(options.vmControl)
    : undefined
  const server = Bun.serve<SocketData>({
    port: options.port ?? 3001,
    async fetch(request, server) {
      const url = new URL(request.url)
      const origin = allowedOrigin(
        request.headers.get('origin'),
        options.origin,
      )
      const cors = (response: Response): Response => withCors(response, origin!)
      if (!origin) return json({ error: 'Forbidden' }, 403)
      if (request.method === 'OPTIONS')
        return cors(
          new Response(null, {
            status: 204,
            headers: {
              'access-control-allow-headers':
                'content-type, x-sweat-setup-token',
              'access-control-allow-methods':
                'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            },
          }),
        )
      const admissionResponse = admissionHandler
        ? await admissionHandler(request, url)
        : undefined
      if (admissionResponse) return cors(admissionResponse)
      if (url.pathname.startsWith('/api/auth/'))
        return cors(await options.authHandler(request))
      const stream = url.pathname.match(/^\/api\/rooms\/([^/]+)\/stream$/)
      const grillStream = url.pathname.match(/^\/api\/grills\/([^/]+)\/stream$/)
      const workspaceStream = url.pathname === '/api/workspace/stream'
      if (
        (stream || grillStream || workspaceStream) &&
        request.headers.get('upgrade')?.toLowerCase() === 'websocket'
      ) {
        // Authenticate the upgrade by realtime ticket (desktop) or session (browser).
        const ticket = url.searchParams.get('ticket')
        const ticketUserId = ticket ? verifyRealtimeTicket(ticket) : undefined
        const sessionUser = ticketUserId
          ? undefined
          : await options.authenticator.authenticate(request)
        const userId = ticketUserId ?? sessionUser?.id
        if (!userId) return cors(json({ error: 'Unauthorized' }, 401))
        if (workspaceStream)
          return server.upgrade(request, {
            data: { scope: 'workspace', userId },
          })
            ? undefined
            : json({ error: 'Upgrade failed' }, 400)
        if (grillStream) {
          const grillId = grillStream[1]!
          if (!options.grillStore?.getGrillForUser(grillId, userId))
            return cors(json({ error: 'Grill not found' }, 404))
          const user = sessionUser ??
            options.store
              .listWorkspaceUsers()
              .find(({ id }) => id === userId) ?? { id: userId, name: userId }
          return server.upgrade(request, {
            data: {
              scope: 'grill',
              grillId,
              userId,
              user,
              presenceId: crypto.randomUUID(),
            },
          })
            ? undefined
            : json({ error: 'Upgrade failed' }, 400)
        }
        const roomId = stream![1]!
        if (!options.store.canAccessRoom(roomId, userId))
          return cors(json({ error: 'Room not found' }, 404))
        return server.upgrade(request, {
          data: { scope: 'room', roomId, userId },
        })
          ? undefined
          : json({ error: 'Upgrade failed' }, 400)
      }
      const user = await options.authenticator.authenticate(request)
      if (!user) return cors(json({ error: 'Unauthorized' }, 401))
      if (url.pathname === '/api/realtime-ticket' && request.method === 'GET')
        return cors(json({ ticket: mintRealtimeTicket(user.id) }))
      if (url.pathname === '/api/agent-definitions' && request.method === 'GET')
        return cors(json({ agents: agentDefinitions() }))
      const handled =
        (vmsHttp ? await vmsHttp(request, url, user) : undefined) ??
        (schedulesHttp ? await schedulesHttp(request, url, user) : undefined) ??
        (issuesHttp ? await issuesHttp(request, url, user) : undefined) ??
        (bulletinsHttp ? await bulletinsHttp(request, url, user) : undefined) ??
        (docsHttp ? await docsHttp(request, url, user) : undefined) ??
        (grillsHttp ? await grillsHttp(request, url, user) : undefined) ??
        (chatsHttp ? await chatsHttp(request, url, user) : undefined) ??
        (await oneshotsHttp(request, url, user)) ??
        (await roomsHttp(request, url, user)) ??
        (await membersHttp(request, url, user))
      if (handled) return cors(handled)
      return cors(json({ error: 'Not found' }, 404))
    },
    websocket: {
      open(socket) {
        sockets.add(socket)
        sendSnapshot(socket)
        if (socket.data.scope === 'grill')
          broadcastGrillPresence(socket.data.grillId)
      },
      message(socket, message) {
        const raw = message.toString()
        if (raw === 'snapshot') sendSnapshot(socket)
        else handleGrillMessage(socket, raw)
      },
      close(socket) {
        releaseSocketGrillLeases(socket)
        sockets.delete(socket)
        if (socket.data.scope === 'grill')
          broadcastGrillPresence(socket.data.grillId)
      },
    },
  })
  let stopping: Promise<void> | undefined
  return {
    port: server.port,
    stop: () =>
      (stopping ??= (async () => {
        unsubscribe()
        unsubscribeMessages()
        unsubscribeSteps()
        if (scheduleInterval) clearInterval(scheduleInterval)
        if (grillLeaseInterval) clearInterval(grillLeaseInterval)
        scheduleRunner?.stop()
        issueRunner?.stop()
        oneshotSession.stop()
        await Promise.all([server.stop(true), options.control.stop()])
      })()),
  }
}
