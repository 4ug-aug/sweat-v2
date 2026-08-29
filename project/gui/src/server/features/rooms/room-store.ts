import type { RunState } from '#project/runs'
import type { RunSummary } from '#/server/features/runs/run-control'
import { failStaleRuns, type RunStep } from '#/server/features/runs/run-storage'
import type { Sqlite } from '#/server/sqlite'

export const GENERAL_ROOM_ID = 'general' as const

export type RoomUser = {
  id: string
  name: string
  image?: string
  color?: string
  email?: string
  displayName?: string
  username?: string
  role?: string
  banned?: boolean | null
}
export type MessageAuthor =
  | ({ kind: 'user' } & RoomUser)
  | { kind: 'agent'; id: string; name: string; image?: string }
export type RoomSummary = {
  id: string
  name: string
  visibility: 'public' | 'private'
  createdBy?: string
}
export type ThreadParticipant = {
  id: string
  name: string
}
export type ThreadSummary = {
  replyCount: number
  /** Distinct reply authors, most-recent-first, capped at 3. */
  participants: ThreadParticipant[]
  latestReplyAt: number
}
export type RoomMessage = {
  id: string
  roomId: string
  author: MessageAuthor
  text: string
  createdAt: number
  editedAt?: number
  attachments: RoomAttachment[]
  /** Set only on thread replies: the id of the top-level message they reply to. */
  rootId?: string
  /** Set only on top-level messages that have durable replies. */
  replySummary?: ThreadSummary
}
/** A successful Room-linked run's final output, presented as a thread reply. */
export type RunResultReply = {
  id: string
  agentId: string
  text: string
  createdAt: number
}
export type RoomThread = {
  root: RoomMessage
  replies: RoomMessage[]
  /** Successful run results rooted at this thread, chronological, counted as replies. */
  results: RunResultReply[]
}
export type RoomMessageMarker = {
  id: string
  createdAt: number
  authorId: string
}
export type RoomAttachment = {
  id: string
  filename: string
  contentType: string
  byteSize: number
}
export type NewRoomAttachment = RoomAttachment & {
  sha256: string
  storageKey: string
  createdAt: number
}
export type StoredRoomAttachment = NewRoomAttachment & { roomId: string }
export type RoomMessageInput = Omit<
  RoomMessage,
  'attachments' | 'replySummary'
> & {
  attachments?: RoomAttachment[]
}
export type RoomHistoryPage = {
  messages: RoomMessage[]
  runs: RoomRun[]
  nextCursor?: string
}
export type MessageSearchHit = {
  messageId: string
  roomId: string
  roomName: string
  author: MessageAuthor
  text: string
  createdAt: number
  /** Set only when the hit is a thread reply: the id of its top-level root message. */
  rootId?: string
}

const MESSAGE_SEARCH_MIN_QUERY_LENGTH = 2
export const MESSAGE_SEARCH_DEFAULT_LIMIT = 20
export const MESSAGE_SEARCH_MAX_LIMIT = 50

/** Build a safe FTS5 MATCH expression from user input (quoted tokens + prefix). */
function buildFtsMatchQuery(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (trimmed.length < MESSAGE_SEARCH_MIN_QUERY_LENGTH) return undefined
  const tokens = trimmed.split(/\s+/).flatMap((token) => {
    const safe = token.replace(/["*^:]/g, ' ').trim()
    if (!safe) return []
    return [`"${safe.replace(/"/g, '""')}"*`]
  })
  if (!tokens.length) return undefined
  return tokens.join(' AND ')
}
export type AttentionKind = 'mention' | 'run_terminal' | 'thread_reply'
export type RoomAttention = {
  id: string
  roomId: string
  recipientId: string
  kind: AttentionKind
  sourceId: string
  /** Root message id of the thread this attention belongs to, when applicable. */
  rootId?: string
  createdAt: number
}

export type RoomRun = RunSummary & {
  roomId: string
  triggerMessageId: string
  requestedBy: RoomUser
}

export type OneshotUsage = Pick<
  RunSummary,
  'id' | 'state' | 'createdAt' | 'startedAt' | 'completedAt'
> & { accountId: string }

export type AccountRunAnalytics = {
  delegations: number
  oneshots: number
  agentCreatedIssues: number
  agentCompletedIssues: number
  runtimeMs: number
  rhythm: { day: string; delegations: number }[]
}

/** A run step plus the Room it belongs to — `run_step` denormalises `room_id`. */
export type StoredStep = RunStep & { roomId: string }

export interface RoomStore {
  listRooms(): RoomSummary[]
  getRoom(roomId: string): RoomSummary | undefined
  createRoom(room: {
    id: string
    name: string
    visibility: 'public' | 'private'
    createdBy?: string
  }): boolean
  deleteRoom(roomId: string): boolean
  listAttachmentStorageKeys(roomId: string): string[]
  getAttachment(id: string): StoredRoomAttachment | undefined
  canAccessRoom(roomId: string, userId: string): boolean
  listRoomsForUser(userId: string): RoomSummary[]
  listMembers(roomId: string): RoomUser[]
  isOwner(roomId: string, userId: string): boolean
  addMember(roomId: string, userId: string, addedBy: string): void
  removeMember(roomId: string, userId: string): void
  listWorkspaceUsers(): RoomUser[]
  listMentionableAccounts(roomId: string): RoomUser[]
  listMessages(roomId: string): RoomMessage[]
  getMessage(roomId: string, messageId: string): RoomMessage | undefined
  /** True when rootId is a top-level message in the same room (not itself a reply). */
  canReplyTo(roomId: string, rootId: string): boolean
  getThread(roomId: string, rootId: string): RoomThread | undefined
  /** Distinct non-agent author ids across a thread's root and replies. */
  listThreadParticipantIds(roomId: string, rootId: string): string[]
  latestMessageFromOther(
    roomId: string,
    userId: string,
  ): RoomMessageMarker | undefined
  listRoomHistoryPage(
    roomId: string,
    options: { limit: number; cursor?: string },
  ): RoomHistoryPage
  listRoomHistoryAround(
    roomId: string,
    options: { messageId: string; limit: number },
  ): RoomHistoryPage
  searchMessages(input: {
    userId: string
    query: string
    limit?: number
  }): MessageSearchHit[]
  getAccountRunAnalytics: (
    accountId: string,
    now?: number,
  ) => AccountRunAnalytics
  listRuns(roomId: string): RoomRun[]
  createMessage(
    message: RoomMessageInput,
    attachments?: NewRoomAttachment[],
  ): void
  updateMessageText(input: {
    id: string
    roomId: string
    text: string
    editedAt: number
  }): RoomMessage | undefined
  createAttention(attention: RoomAttention): boolean
  listMentionRecipientIds(messageId: string): string[]
  listAttentionCounts(userId: string, kind?: AttentionKind): Map<string, number>
  /** Distinct unacked thread_reply root ids for a recipient in one room. */
  listOpenThreadAttentionRootIds(userId: string, roomId: string): string[]
  /** Clears all open attention for a room except thread_reply, which requires opening the thread itself. */
  acknowledgeRoomAttention(roomId: string, userId: string, at: number): void
  /** Clears only the open thread_reply attention for one root, leaving other threads and room-level attention untouched. */
  acknowledgeThreadAttention(
    roomId: string,
    rootId: string,
    userId: string,
    at: number,
  ): void
  createOneshotUsage(run: OneshotUsage): void
  updateOneshotUsage(run: OneshotUsage): void
  createRun(run: RoomRun): void
  updateRun(run: RoomRun): void
  failStaleRuns(): RoomRun[]
  getRun(id: string): RoomRun | undefined
  appendStep(step: StoredStep): void
  listSteps(runId: string): StoredStep[]
  latestStepsForActiveRuns(roomId: string): Map<string, StoredStep>
}

type RoomRow = {
  id: string
  name: string
  visibility: 'public' | 'private'
  created_by: string | null
}
type UserRow = {
  id: string
  name: string
  username?: string | null
  image: string | null
  color?: string | null
  email?: string | null
  display_name?: string | null
}
type MessageRow = {
  id: string
  room_id: string
  author_id: string
  author_name: string
  author_image: string | null
  author_color?: string | null
  author_kind: string
  author_email?: string | null
  author_display_name?: string | null
  text: string
  created_at: number
  edited_at?: number | null
  root_id?: string | null
}
type AttachmentRow = {
  id: string
  message_id: string
  filename: string
  content_type: string
  byte_size: number
  sha256: string
  storage_key: string
  created_at: number
  room_id?: string
}
type RunRow = {
  id: string
  room_id: string
  author_id: string
  author_name: string
  author_image: string | null
  created_at: number
  task: string
  agent_id: string
  provider: 'openai' | 'custom' | 'cursor'
  model: string
  state: RunState
  started_at: number | null
  completed_at: number | null
  exit_code: number | null
  error: string | null
  stdout: string
  stderr: string
  trigger_message_id: string
}
type StepRow = {
  id: string
  run_id: string
  room_id: string
  idx: number
  kind: string
  tool: string | null
  call_id: string | null
  text: string
  created_at: number
}

const roomFrom = (row: RoomRow): RoomSummary => ({
  id: row.id,
  name: row.name,
  visibility: row.visibility,
  ...(row.created_by != null ? { createdBy: row.created_by } : {}),
})
const userFrom = (row: UserRow): RoomUser => ({
  id: row.id,
  name: row.name,
  ...(row.username != null ? { username: row.username } : {}),
  ...(row.display_name != null ? { displayName: row.display_name } : {}),
  ...(row.email != null ? { email: row.email } : {}),
  ...(row.image != null ? { image: row.image } : {}),
  ...(row.color ? { color: row.color } : {}),
})
const attachmentFrom = (row: AttachmentRow): RoomAttachment => ({
  id: row.id,
  filename: row.filename,
  contentType: row.content_type,
  byteSize: row.byte_size,
})
const messageFrom = (
  row: MessageRow,
  attachments: RoomAttachment[] = [],
): RoomMessage => ({
  id: row.id,
  roomId: row.room_id,
  author:
    row.author_kind === 'agent'
      ? {
          kind: 'agent',
          id: row.author_id,
          name: row.author_name,
          ...(row.author_image ? { image: row.author_image } : {}),
        }
      : {
          kind: 'user',
          id: row.author_id,
          name: row.author_name,
          ...(row.author_display_name
            ? { displayName: row.author_display_name }
            : {}),
          ...(row.author_email ? { email: row.author_email } : {}),
          ...(row.author_image ? { image: row.author_image } : {}),
          ...(row.author_color ? { color: row.author_color } : {}),
        },
  text: row.text,
  createdAt: row.created_at,
  ...(row.edited_at != null ? { editedAt: row.edited_at } : {}),
  ...(row.root_id != null ? { rootId: row.root_id } : {}),
  attachments,
})
const stepFrom = (row: StepRow): StoredStep => ({
  id: row.id,
  runId: row.run_id,
  roomId: row.room_id,
  idx: row.idx,
  kind: row.kind as StoredStep['kind'],
  ...(row.tool != null ? { tool: row.tool } : {}),
  ...(row.call_id != null ? { callId: row.call_id } : {}),
  text: row.text,
  createdAt: row.created_at,
  at: row.created_at,
})
const runFrom = (row: RunRow): RoomRun => ({
  id: row.id,
  roomId: row.room_id,
  task: row.task,
  agentId: row.agent_id,
  provider: row.provider,
  model: row.model,
  state: row.state,
  createdAt: row.created_at,
  startedAt: row.started_at ?? undefined,
  completedAt: row.completed_at ?? undefined,
  exitCode: row.exit_code ?? undefined,
  error: row.error ?? undefined,
  stdout: row.stdout,
  stderr: row.stderr,
  triggerMessageId: row.trigger_message_id,
  requestedBy: {
    id: row.author_id,
    name: row.author_name,
    ...(row.author_image ? { image: row.author_image } : {}),
  },
})

type MessageCursor = { createdAt: number; id: string }

const encodeMessageCursor = (cursor: MessageCursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url')

const decodeMessageCursor = (value: string): MessageCursor => {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Partial<MessageCursor>
    if (
      typeof parsed.createdAt !== 'number' ||
      !Number.isFinite(parsed.createdAt) ||
      typeof parsed.id !== 'string' ||
      !parsed.id
    )
      throw new Error()
    return { createdAt: parsed.createdAt, id: parsed.id }
  } catch {
    throw new Error('Invalid room history cursor')
  }
}

export function createSqliteRoomStore(sqlite: Sqlite): RoomStore {
  const dayMs = 86_400_000
  const hasFts = Boolean(
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'room_message_fts'",
      )
      .get(),
  )
  const hasAttachments = Boolean(
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'room_attachment'",
      )
      .get(),
  )
  const messageColumns = sqlite
    .prepare('PRAGMA table_info(room_message)')
    .all() as { name?: string }[]
  const hasEditedAt = messageColumns.some(
    (column) => column.name === 'edited_at',
  )
  const editedAtSelect = hasEditedAt ? ', m.edited_at' : ''
  const hasRootId = messageColumns.some((column) => column.name === 'root_id')
  const rootIdSelect = hasRootId ? ', m.root_id' : ''
  const attentionColumns = sqlite
    .prepare('PRAGMA table_info(room_attention)')
    .all() as { name?: string }[]
  const hasAttentionRootId = attentionColumns.some(
    (column) => column.name === 'root_id',
  )
  const topLevelOnly = hasRootId ? 'm.root_id IS NULL' : '1 = 1'
  const userColumns = sqlite.prepare('PRAGMA table_info(user)').all() as {
    name?: string
  }[]
  const hasUsername = userColumns.some((column) => column.name === 'username')
  const hasBanned = userColumns.some((column) => column.name === 'banned')
  const hasColor = userColumns.some((column) => column.name === 'color')
  const activeUser = hasBanned ? 'AND COALESCE(u.banned, 0) = 0' : ''
  const userName = hasUsername ? 'COALESCE(u.username, u.name)' : 'u.name'
  const colorSelect = hasColor ? ', u.color' : ''
  const authorColorSelect = hasColor ? ', u.color AS author_color' : ''
  const userProfile = hasUsername
    ? `, u.username, u.email, u.name AS display_name${colorSelect}`
    : colorSelect
  const messageProfile = hasUsername
    ? `, u.email AS author_email, u.name AS author_display_name${authorColorSelect}`
    : authorColorSelect
  const messageProfileJoin = hasUsername
    ? " LEFT JOIN user u ON m.author_kind = 'user' AND u.id = m.author_id"
    : ''
  const hydrateMessages = (roomId: string, rows: MessageRow[]) => {
    if (!rows.length) return []
    const attachments = hasAttachments
      ? (sqlite
          .prepare(
            `SELECT a.id, a.message_id, a.filename, a.content_type, a.byte_size, a.sha256, a.storage_key, a.created_at
         FROM room_attachment a JOIN room_message m ON m.id = a.message_id
         WHERE m.room_id = ? AND a.message_id IN (${rows.map(() => '?').join(', ')}) ORDER BY a.created_at, a.id`,
          )
          .all(roomId, ...rows.map(({ id }) => id)) as AttachmentRow[])
      : []
    const byMessage = new Map<string, RoomAttachment[]>()
    for (const attachment of attachments) {
      const list = byMessage.get(attachment.message_id) ?? []
      list.push(attachmentFrom(attachment))
      byMessage.set(attachment.message_id, list)
    }
    return rows.map((row) => messageFrom(row, byMessage.get(row.id) ?? []))
  }
  const messageSelect = `SELECT m.id, m.room_id, m.author_id, m.author_name, m.author_image, m.author_kind, m.text, m.created_at${editedAtSelect}${rootIdSelect}${messageProfile}
           FROM room_message m${messageProfileJoin}`
  const replySummaries = (rootIds: string[]): Map<string, ThreadSummary> => {
    const map = new Map<string, ThreadSummary>()
    if (!hasRootId || !rootIds.length) return map
    const placeholders = rootIds.map(() => '?').join(', ')
    const messageRows = sqlite
      .prepare(
        `SELECT root_id, author_id, author_name, created_at, id FROM room_message
         WHERE root_id IN (${placeholders})`,
      )
      .all(...rootIds) as {
      root_id: string
      author_id: string
      author_name: string
      created_at: number
      id: string
    }[]
    // Successful run results count as thread replies without a room_message
    // row. A run's trigger may itself be a reply (an in-thread invocation),
    // so its result is attributed to that reply's thread root, not its own id.
    const runRows = sqlite
      .prepare(
        `SELECT COALESCE(trig.root_id, room_run.trigger_message_id) AS root_id,
                room_run.agent_id AS author_id, room_run.agent_id AS author_name,
                room_run.completed_at AS created_at, room_run.id
         FROM room_run
         LEFT JOIN room_message trig ON trig.id = room_run.trigger_message_id
         WHERE COALESCE(trig.root_id, room_run.trigger_message_id) IN (${placeholders})
           AND room_run.state = 'succeeded' AND room_run.completed_at IS NOT NULL`,
      )
      .all(...rootIds) as {
      root_id: string
      author_id: string
      author_name: string
      created_at: number
      id: string
    }[]
    const rows = [...messageRows, ...runRows].sort(
      (a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id),
    )
    const grouped = new Map<string, typeof rows>()
    for (const row of rows) {
      const list = grouped.get(row.root_id) ?? []
      list.push(row)
      grouped.set(row.root_id, list)
    }
    for (const [rootId, list] of grouped) {
      const participants: ThreadParticipant[] = []
      for (const row of list) {
        if (
          !participants.some((participant) => participant.id === row.author_id)
        )
          participants.push({ id: row.author_id, name: row.author_name })
        if (participants.length >= 3) break
      }
      map.set(rootId, {
        replyCount: list.length,
        participants,
        latestReplyAt: list[0]!.created_at,
      })
    }
    return map
  }
  const attachReplySummaries = (list: RoomMessage[]): RoomMessage[] => {
    const topLevelIds = list
      .filter((message) => message.rootId == null)
      .map((message) => message.id)
    if (!topLevelIds.length) return list
    const summaries = replySummaries(topLevelIds)
    if (!summaries.size) return list
    return list.map((message) =>
      message.rootId == null && summaries.has(message.id)
        ? { ...message, replySummary: summaries.get(message.id)! }
        : message,
    )
  }
  const messages = (roomId: string): RoomMessage[] => {
    const rows = sqlite
      .prepare(
        `${messageSelect}
           WHERE m.room_id = ? AND ${topLevelOnly} ORDER BY m.created_at, m.id`,
      )
      .all(roomId) as MessageRow[]
    return attachReplySummaries(hydrateMessages(roomId, rows))
  }
  const getMessage = (
    roomId: string,
    messageId: string,
  ): RoomMessage | undefined => {
    const row = sqlite
      .prepare(`${messageSelect} WHERE m.room_id = ? AND m.id = ?`)
      .get(roomId, messageId) as MessageRow | undefined
    if (!row) return undefined
    return hydrateMessages(roomId, [row])[0]
  }
  const latestMessageFromOther = (
    roomId: string,
    userId: string,
  ): RoomMessageMarker | undefined => {
    const topLevel = hasRootId ? 'root_id IS NULL' : '1 = 1'
    const row = sqlite
      .prepare(
        `SELECT id, created_at, author_id
         FROM room_message
         WHERE room_id = ? AND author_id <> ? AND ${topLevel}
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
      )
      .get(roomId, userId) as
      { id: string; created_at: number; author_id: string } | undefined
    return row
      ? { id: row.id, createdAt: row.created_at, authorId: row.author_id }
      : undefined
  }
  const messageRows = (
    roomId: string,
    before: MessageCursor | undefined,
    limit: number,
  ): MessageRow[] => {
    const where = before
      ? `WHERE m.room_id = ? AND ${topLevelOnly} AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))`
      : `WHERE m.room_id = ? AND ${topLevelOnly}`
    const values = before
      ? [roomId, before.createdAt, before.createdAt, before.id, limit + 1]
      : [roomId, limit + 1]
    return sqlite
      .prepare(
        `${messageSelect}
           ${where} ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
      )
      .all(...values) as MessageRow[]
  }
  const selectRuns = (where = '', ...values: unknown[]): RoomRun[] =>
    (
      sqlite
        .prepare(
          `SELECT id, room_id, requested_by_id AS author_id, requested_by_name AS author_name, requested_by_image AS author_image, task, agent_id, provider, model, state, created_at, started_at, completed_at, exit_code, error, stdout, stderr, trigger_message_id FROM room_run ${where} ORDER BY created_at, id`,
        )
        .all(...values) as RunRow[]
    ).map(runFrom)
  const values = (run: RoomRun) => [
    run.id,
    run.roomId,
    run.triggerMessageId,
    run.requestedBy.id,
    run.requestedBy.name,
    run.requestedBy.image ?? null,
    run.task,
    run.agentId,
    run.provider,
    run.model,
    run.state,
    run.createdAt,
    run.startedAt ?? null,
    run.completedAt ?? null,
    run.exitCode ?? null,
    run.error ?? null,
    run.stdout,
    run.stderr,
  ]
  const ROOM_ORDER =
    "ORDER BY CASE WHEN id = 'general' THEN 0 ELSE 1 END, name COLLATE NOCASE, id"
  const listRoomHistoryPage = (
    roomId: string,
    options: { limit: number; cursor?: string },
  ): RoomHistoryPage => {
    const limit = Math.max(1, Math.min(100, Math.floor(options.limit)))
    const before =
      options.cursor !== undefined
        ? decodeMessageCursor(options.cursor)
        : undefined
    const rows = messageRows(roomId, before, limit)
    const pageRows = rows.slice(0, limit)
    const messages = attachReplySummaries(
      hydrateMessages(roomId, [...pageRows].reverse()),
    )
    const messageIds = pageRows.map(({ id }) => id)
    const runWhere = messageIds.length
      ? `WHERE room_id = ? AND (trigger_message_id IN (${messageIds.map(() => '?').join(', ')}) OR state IN ('preparing', 'running'))`
      : "WHERE room_id = ? AND state IN ('preparing', 'running')"
    const runs = selectRuns(runWhere, roomId, ...messageIds)
    return {
      messages,
      runs,
      ...(rows.length > limit && pageRows.length
        ? {
            nextCursor: encodeMessageCursor({
              createdAt: pageRows.at(-1)!.created_at,
              id: pageRows.at(-1)!.id,
            }),
          }
        : {}),
    }
  }
  const historyPageFromRows = (
    roomId: string,
    pageRows: MessageRow[],
    hasOlder: boolean,
  ): RoomHistoryPage => {
    const messages = attachReplySummaries(hydrateMessages(roomId, pageRows))
    const messageIds = pageRows.map(({ id }) => id)
    const runWhere = messageIds.length
      ? `WHERE room_id = ? AND (trigger_message_id IN (${messageIds.map(() => '?').join(', ')}) OR state IN ('preparing', 'running'))`
      : "WHERE room_id = ? AND state IN ('preparing', 'running')"
    const runs = selectRuns(runWhere, roomId, ...messageIds)
    const oldest = pageRows[0]
    return {
      messages,
      runs,
      ...(hasOlder && oldest
        ? {
            nextCursor: encodeMessageCursor({
              createdAt: oldest.created_at,
              id: oldest.id,
            }),
          }
        : {}),
    }
  }
  const listRoomHistoryAround = (
    roomId: string,
    options: { messageId: string; limit: number },
  ): RoomHistoryPage => {
    const limit = Math.max(1, Math.min(100, Math.floor(options.limit)))
    const target = sqlite
      .prepare(
        `${messageSelect} WHERE m.room_id = ? AND ${topLevelOnly} AND m.id = ?`,
      )
      .get(roomId, options.messageId) as MessageRow | undefined
    if (!target) throw new Error('Message not found')
    const olderDesc = sqlite
      .prepare(
        `${messageSelect}
           WHERE m.room_id = ? AND ${topLevelOnly} AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))
           ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
      )
      .all(
        roomId,
        target.created_at,
        target.created_at,
        target.id,
        limit,
      ) as MessageRow[]
    const newerAsc = sqlite
      .prepare(
        `${messageSelect}
           WHERE m.room_id = ? AND ${topLevelOnly} AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))
           ORDER BY m.created_at ASC, m.id ASC LIMIT ?`,
      )
      .all(
        roomId,
        target.created_at,
        target.created_at,
        target.id,
        limit,
      ) as MessageRow[]
    let takeOlder = Math.min(Math.floor((limit - 1) / 2), olderDesc.length)
    let takeNewer = Math.min(limit - 1 - takeOlder, newerAsc.length)
    takeOlder = Math.min(limit - 1 - takeNewer, olderDesc.length)
    const hasOlder = olderDesc.length > takeOlder
    const older = olderDesc.slice(0, takeOlder).reverse()
    const newer = newerAsc.slice(0, takeNewer)
    return historyPageFromRows(roomId, [...older, target, ...newer], hasOlder)
  }
  const searchMessages = (input: {
    userId: string
    query: string
    limit?: number
  }): MessageSearchHit[] => {
    if (!hasFts) return []
    const match = buildFtsMatchQuery(input.query)
    if (!match) return []
    const limit = Math.max(
      1,
      Math.min(
        MESSAGE_SEARCH_MAX_LIMIT,
        Math.floor(input.limit ?? MESSAGE_SEARCH_DEFAULT_LIMIT),
      ),
    )
    type SearchRow = MessageRow & { room_name: string }
    let rows: SearchRow[]
    try {
      rows = sqlite
        .prepare(
          `SELECT m.id, m.room_id, r.name AS room_name, m.author_id, m.author_name, m.author_image, m.author_kind, m.text, m.created_at${editedAtSelect}${rootIdSelect}${messageProfile}
           FROM room_message_fts
           JOIN room_message m ON m.rowid = room_message_fts.rowid
           JOIN room r ON r.id = m.room_id
           LEFT JOIN room_member rm ON rm.room_id = r.id AND rm.user_id = ?
           ${messageProfileJoin}
           WHERE room_message_fts MATCH ?
             AND (r.visibility = 'public' OR rm.user_id IS NOT NULL)
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT ?`,
        )
        .all(input.userId, match, limit) as SearchRow[]
    } catch {
      return []
    }
    return rows.map((row) => {
      const message = messageFrom(row)
      return {
        messageId: message.id,
        roomId: message.roomId,
        roomName: row.room_name,
        author: message.author,
        text: message.text,
        createdAt: message.createdAt,
        ...(message.rootId != null ? { rootId: message.rootId } : {}),
      }
    })
  }
  return {
    listRooms: () =>
      (
        sqlite
          .prepare(
            `SELECT id, name, visibility, created_by FROM room ${ROOM_ORDER}`,
          )
          .all() as RoomRow[]
      ).map(roomFrom),
    getRoom: (roomId) => {
      const row = sqlite
        .prepare(
          'SELECT id, name, visibility, created_by FROM room WHERE id = ?',
        )
        .get(roomId) as RoomRow | undefined
      return row ? roomFrom(row) : undefined
    },
    createRoom: (room) => {
      const result = sqlite
        .prepare(
          'INSERT OR IGNORE INTO room (id, name, visibility, created_by) VALUES (?, ?, ?, ?)',
        )
        .run(room.id, room.name, room.visibility, room.createdBy ?? null) as {
        changes?: number
      }
      const inserted = result.changes === 1
      if (inserted && room.visibility === 'private' && room.createdBy != null) {
        sqlite
          .prepare(
            'INSERT OR IGNORE INTO room_member (room_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)',
          )
          .run(room.id, room.createdBy, room.createdBy, Date.now())
      }
      return inserted
    },
    deleteRoom: (roomId) =>
      ((
        sqlite.prepare('DELETE FROM room WHERE id = ?').run(roomId) as {
          changes?: number
        }
      ).changes ?? 0) > 0,
    listAttachmentStorageKeys: (roomId) =>
      (
        sqlite
          .prepare(
            `SELECT a.storage_key FROM room_attachment a
             JOIN room_message m ON m.id = a.message_id WHERE m.room_id = ?`,
          )
          .all(roomId) as { storage_key: string }[]
      ).map(({ storage_key }) => storage_key),
    getAttachment: (id) => {
      const row = sqlite
        .prepare(
          `SELECT a.id, a.message_id, a.filename, a.content_type, a.byte_size, a.sha256, a.storage_key, a.created_at, m.room_id
           FROM room_attachment a JOIN room_message m ON m.id = a.message_id WHERE a.id = ?`,
        )
        .get(id) as AttachmentRow | undefined
      return row && row.room_id
        ? {
            ...attachmentFrom(row),
            sha256: row.sha256,
            storageKey: row.storage_key,
            createdAt: row.created_at,
            roomId: row.room_id,
          }
        : undefined
    },
    canAccessRoom: (roomId, userId) => {
      const row = sqlite
        .prepare(
          `SELECT CASE
            WHEN r.id IS NULL THEN 0
            WHEN r.visibility = 'public' THEN 1
            WHEN m.user_id IS NOT NULL THEN 1
            ELSE 0
          END AS can_access
          FROM (SELECT NULL) AS dummy
          LEFT JOIN room r ON r.id = ?
          LEFT JOIN room_member m ON m.room_id = ? AND m.user_id = ?`,
        )
        .get(roomId, roomId, userId) as { can_access: number } | undefined
      return (row?.can_access ?? 0) === 1
    },
    listRoomsForUser: (userId) =>
      (
        sqlite
          .prepare(
            `SELECT id, name, visibility, created_by FROM room
           WHERE visibility = 'public'
              OR id IN (SELECT room_id FROM room_member WHERE user_id = ?)
           ${ROOM_ORDER}`,
          )
          .all(userId) as RoomRow[]
      ).map(roomFrom),
    listMembers: (roomId) =>
      (
        sqlite
          .prepare(
            `SELECT u.id, ${userName} AS name, u.image${userProfile} FROM room_member rm
           JOIN user u ON u.id = rm.user_id
           WHERE rm.room_id = ?
           ORDER BY u.name COLLATE NOCASE, u.id`,
          )
          .all(roomId) as UserRow[]
      ).map(userFrom),
    isOwner: (roomId, userId) => {
      const row = sqlite
        .prepare('SELECT created_by FROM room WHERE id = ?')
        .get(roomId) as { created_by: string | null } | undefined
      return row?.created_by === userId
    },
    addMember: (roomId, userId, addedBy) => {
      sqlite
        .prepare(
          'INSERT OR IGNORE INTO room_member (room_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)',
        )
        .run(roomId, userId, addedBy, Date.now())
    },
    removeMember: (roomId, userId) => {
      sqlite
        .prepare('DELETE FROM room_member WHERE room_id = ? AND user_id = ?')
        .run(roomId, userId)
      sqlite
        .prepare(
          'DELETE FROM room_attention WHERE room_id = ? AND recipient_id = ?',
        )
        .run(roomId, userId)
    },
    listWorkspaceUsers: () =>
      (
        sqlite
          .prepare(
            `SELECT u.id, ${userName} AS name, u.image${userProfile} FROM user u ORDER BY ${userName} COLLATE NOCASE, u.id`,
          )
          .all() as UserRow[]
      ).map(userFrom),
    listMentionableAccounts: (roomId) =>
      (
        sqlite
          .prepare(
            `SELECT u.id, ${userName} AS name, u.image${userProfile}
             FROM user u
             JOIN room r ON r.id = ?
             LEFT JOIN room_member rm ON rm.room_id = r.id AND rm.user_id = u.id
             WHERE (r.visibility = 'public' OR rm.user_id IS NOT NULL)
               ${activeUser}
             ORDER BY ${userName} COLLATE NOCASE, u.id`,
          )
          .all(roomId) as UserRow[]
      ).map(userFrom),
    listMessages: messages,
    getMessage,
    canReplyTo: (roomId, rootId) => {
      if (!hasRootId) return false
      const row = sqlite
        .prepare(
          'SELECT 1 FROM room_message WHERE id = ? AND room_id = ? AND root_id IS NULL',
        )
        .get(rootId, roomId)
      return Boolean(row)
    },
    getThread: (roomId, rootId) => {
      if (!hasRootId) return undefined
      const rootRow = sqlite
        .prepare(
          `${messageSelect} WHERE m.room_id = ? AND m.id = ? AND ${topLevelOnly}`,
        )
        .get(roomId, rootId) as MessageRow | undefined
      if (!rootRow) return undefined
      const replyRows = sqlite
        .prepare(
          `${messageSelect}
           WHERE m.room_id = ? AND m.root_id = ? ORDER BY m.created_at, m.id`,
        )
        .all(roomId, rootId) as MessageRow[]
      const resultRows = sqlite
        .prepare(
          `SELECT room_run.id, room_run.agent_id, room_run.stdout, room_run.completed_at
           FROM room_run
           LEFT JOIN room_message trig
             ON trig.id = room_run.trigger_message_id AND trig.room_id = room_run.room_id
           WHERE room_run.room_id = ?
             AND (room_run.trigger_message_id = ? OR trig.root_id = ?)
             AND room_run.state = 'succeeded' AND room_run.completed_at IS NOT NULL
           ORDER BY room_run.completed_at, room_run.id`,
        )
        .all(roomId, rootId, rootId) as {
        id: string
        agent_id: string
        stdout: string
        completed_at: number
      }[]
      const [root] = attachReplySummaries(hydrateMessages(roomId, [rootRow]))
      return {
        root: root!,
        replies: hydrateMessages(roomId, replyRows),
        results: resultRows.map((row) => ({
          id: row.id,
          agentId: row.agent_id,
          text: row.stdout,
          createdAt: row.completed_at,
        })),
      }
    },
    listThreadParticipantIds: (roomId, rootId) => {
      if (!hasRootId) return []
      return (
        sqlite
          .prepare(
            `SELECT DISTINCT author_id FROM room_message
             WHERE room_id = ? AND author_kind = 'user' AND (id = ? OR root_id = ?)
             ORDER BY author_id`,
          )
          .all(roomId, rootId, rootId) as { author_id: string }[]
      ).map(({ author_id }) => author_id)
    },
    latestMessageFromOther,
    listRoomHistoryPage,
    listRoomHistoryAround,
    searchMessages,
    getAccountRunAnalytics: (accountId, now = Date.now()) => {
      const summary = sqlite
        .prepare(
          `SELECT COUNT(*) AS delegations,
                  (SELECT COUNT(*) FROM oneshot_usage WHERE account_id = ?) AS oneshots,
                  (SELECT COUNT(*) FROM issue WHERE created_by_kind = 'agent') AS agent_created_issues,
                  (SELECT COUNT(*) FROM issue WHERE status = 'done' AND owner_kind = 'agent') AS agent_completed_issues,
                  COALESCE(SUM(CASE
                    WHEN room_run.state IN ('succeeded', 'failed', 'cancelled')
                      AND room_run.started_at IS NOT NULL AND room_run.completed_at IS NOT NULL
                      AND room_run.completed_at >= room_run.started_at
                    THEN room_run.completed_at - room_run.started_at ELSE 0 END), 0)
                  + (SELECT COALESCE(SUM(CASE
                      WHEN state IN ('succeeded', 'failed', 'cancelled')
                        AND started_at IS NOT NULL AND completed_at IS NOT NULL
                        AND completed_at >= started_at
                      THEN completed_at - started_at ELSE 0 END), 0)
                    FROM oneshot_usage WHERE account_id = ?) AS runtime_ms
           FROM room_run WHERE room_run.requested_by_id = ?`,
        )
        .get(accountId, accountId, accountId) as {
        delegations: number
        oneshots: number
        agent_created_issues: number
        agent_completed_issues: number
        runtime_ms: number
      }
      const today = Math.floor(now / dayMs) * dayMs
      const firstDay = today - 6 * dayMs
      const rows = sqlite
        .prepare(
          `SELECT CAST(created_at / ${dayMs} AS INTEGER) * ${dayMs} AS day_start,
                  COUNT(*) AS delegations
           FROM room_run
           WHERE requested_by_id = ? AND created_at >= ? AND created_at < ?
           GROUP BY day_start ORDER BY day_start`,
        )
        .all(accountId, firstDay, today + dayMs) as {
        day_start: number
        delegations: number
      }[]
      const byDay = new Map(
        rows.map(({ day_start, delegations }) => [day_start, delegations]),
      )
      return {
        delegations: summary.delegations,
        oneshots: summary.oneshots,
        agentCreatedIssues: summary.agent_created_issues,
        agentCompletedIssues: summary.agent_completed_issues,
        runtimeMs: summary.runtime_ms,
        rhythm: Array.from({ length: 7 }, (_, index) => {
          const day = firstDay + index * dayMs
          return {
            day: new Date(day).toISOString().slice(0, 10),
            delegations: byDay.get(day) ?? 0,
          }
        }),
      }
    },
    listRuns: (roomId) => selectRuns('WHERE room_id = ?', roomId),
    createMessage: (message, attachments = []) => {
      const run = () => {
        if (hasRootId) {
          sqlite
            .prepare(
              'INSERT INTO room_message (id, room_id, author_id, author_name, author_image, author_kind, text, created_at, root_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
              message.id,
              message.roomId,
              message.author.id,
              message.author.name,
              message.author.image ?? null,
              message.author.kind,
              message.text,
              message.createdAt,
              message.rootId ?? null,
            )
        } else {
          sqlite
            .prepare(
              'INSERT INTO room_message (id, room_id, author_id, author_name, author_image, author_kind, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
              message.id,
              message.roomId,
              message.author.id,
              message.author.name,
              message.author.image ?? null,
              message.author.kind,
              message.text,
              message.createdAt,
            )
        }
        if (!attachments.length) return
        const insert = sqlite.prepare(
          'INSERT INTO room_attachment (id, message_id, filename, content_type, byte_size, sha256, storage_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        for (const attachment of attachments)
          insert.run(
            attachment.id,
            message.id,
            attachment.filename,
            attachment.contentType,
            attachment.byteSize,
            attachment.sha256,
            attachment.storageKey,
            attachment.createdAt,
          )
      }
      if (!attachments.length) return run()
      // SQLite transactions keep message and attachment rows inseparable.
      sqlite.prepare('BEGIN').run()
      try {
        run()
        sqlite.prepare('COMMIT').run()
      } catch (error) {
        sqlite.prepare('ROLLBACK').run()
        throw error
      }
    },
    updateMessageText: ({ id, roomId, text, editedAt }) => {
      if (!hasEditedAt) return undefined
      const result = sqlite
        .prepare(
          'UPDATE room_message SET text = ?, edited_at = ? WHERE id = ? AND room_id = ?',
        )
        .run(text, editedAt, id, roomId) as { changes?: number }
      // FTS sync triggers can inflate sqlite changes beyond 1.
      if ((result.changes ?? 0) < 1) return undefined
      return getMessage(roomId, id)
    },
    createAttention: (attention) => {
      const result = (
        hasAttentionRootId
          ? sqlite
              .prepare(
                'INSERT OR IGNORE INTO room_attention (id, room_id, recipient_id, kind, source_id, root_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
              )
              .run(
                attention.id,
                attention.roomId,
                attention.recipientId,
                attention.kind,
                attention.sourceId,
                attention.rootId ?? null,
                attention.createdAt,
              )
          : sqlite
              .prepare(
                'INSERT OR IGNORE INTO room_attention (id, room_id, recipient_id, kind, source_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
              )
              .run(
                attention.id,
                attention.roomId,
                attention.recipientId,
                attention.kind,
                attention.sourceId,
                attention.createdAt,
              )
      ) as { changes?: number }
      return (result.changes ?? 0) === 1
    },
    listMentionRecipientIds: (messageId) =>
      (
        sqlite
          .prepare(
            "SELECT recipient_id FROM room_attention WHERE kind = 'mention' AND source_id = ? ORDER BY recipient_id",
          )
          .all(messageId) as { recipient_id: string }[]
      ).map(({ recipient_id }) => recipient_id),
    listAttentionCounts: (userId, kind) => {
      const kindFilter = kind ? ' AND a.kind = ?' : ''
      const rows = sqlite
        .prepare(
          `SELECT a.room_id, COUNT(*) AS count
           FROM room_attention a
           JOIN room r ON r.id = a.room_id
           LEFT JOIN room_member rm
             ON rm.room_id = r.id AND rm.user_id = a.recipient_id
           WHERE a.recipient_id = ?
             AND a.acknowledged_at IS NULL
             AND (r.visibility = 'public' OR rm.user_id IS NOT NULL)
             ${kindFilter}
           GROUP BY a.room_id`,
        )
        .all(...(kind ? [userId, kind] : [userId])) as {
        room_id: string
        count: number
      }[]
      return new Map(rows.map(({ room_id, count }) => [room_id, count]))
    },
    listOpenThreadAttentionRootIds: (userId, roomId) => {
      if (!hasAttentionRootId) return []
      return (
        sqlite
          .prepare(
            `SELECT DISTINCT a.root_id AS root_id
             FROM room_attention a
             WHERE a.recipient_id = ?
               AND a.room_id = ?
               AND a.kind = 'thread_reply'
               AND a.acknowledged_at IS NULL
               AND a.root_id IS NOT NULL
             ORDER BY a.root_id`,
          )
          .all(userId, roomId) as { root_id: string }[]
      ).map(({ root_id }) => root_id)
    },
    acknowledgeRoomAttention: (roomId, userId, at) => {
      sqlite
        .prepare(
          "UPDATE room_attention SET acknowledged_at = ? WHERE room_id = ? AND recipient_id = ? AND acknowledged_at IS NULL AND kind != 'thread_reply'",
        )
        .run(at, roomId, userId)
    },
    acknowledgeThreadAttention: (roomId, rootId, userId, at) => {
      if (!hasAttentionRootId) return
      sqlite
        .prepare(
          "UPDATE room_attention SET acknowledged_at = ? WHERE room_id = ? AND root_id = ? AND recipient_id = ? AND acknowledged_at IS NULL AND kind = 'thread_reply'",
        )
        .run(at, roomId, rootId, userId)
    },
    createOneshotUsage: (run) => {
      sqlite
        .prepare(
          'INSERT INTO oneshot_usage (run_id, account_id, state, created_at, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          run.id,
          run.accountId,
          run.state,
          run.createdAt,
          run.startedAt ?? null,
          run.completedAt ?? null,
        )
    },
    updateOneshotUsage: (run) => {
      sqlite
        .prepare(
          'UPDATE oneshot_usage SET state = ?, started_at = ?, completed_at = ? WHERE run_id = ?',
        )
        .run(run.state, run.startedAt ?? null, run.completedAt ?? null, run.id)
    },
    createRun: (run) => {
      sqlite
        .prepare(
          'INSERT INTO room_run (id, room_id, trigger_message_id, requested_by_id, requested_by_name, requested_by_image, task, agent_id, provider, model, state, created_at, started_at, completed_at, exit_code, error, stdout, stderr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(...values(run))
    },
    updateRun: (run) => {
      sqlite
        .prepare(
          'UPDATE room_run SET task = ?, agent_id = ?, state = ?, started_at = ?, completed_at = ?, exit_code = ?, error = ?, stdout = ?, stderr = ? WHERE id = ? AND room_id = ?',
        )
        .run(
          run.task,
          run.agentId,
          run.state,
          run.startedAt ?? null,
          run.completedAt ?? null,
          run.exitCode ?? null,
          run.error ?? null,
          run.stdout,
          run.stderr,
          run.id,
          run.roomId,
        )
    },
    failStaleRuns: () =>
      failStaleRuns(sqlite, 'room_run', Date.now()).flatMap((id) =>
        selectRuns('WHERE id = ?', id),
      ),
    getRun: (id) => selectRuns('WHERE id = ?', id).at(0),
    appendStep: (step) => {
      sqlite
        .prepare(
          'INSERT INTO run_step (id, run_id, room_id, idx, kind, tool, call_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          step.id,
          step.runId,
          step.roomId,
          step.idx,
          step.kind,
          step.tool ?? null,
          step.callId ?? null,
          step.text,
          step.createdAt,
        )
    },
    listSteps: (runId) =>
      (
        sqlite
          .prepare(
            'SELECT id, run_id, room_id, idx, kind, tool, call_id, text, created_at FROM run_step WHERE run_id = ? ORDER BY idx',
          )
          .all(runId) as StepRow[]
      ).map(stepFrom),
    latestStepsForActiveRuns: (roomId) => {
      const rows = sqlite
        .prepare(
          `SELECT s.id, s.run_id, s.room_id, s.idx, s.kind, s.tool, s.call_id, s.text, s.created_at
           FROM run_step s
           JOIN room_run r ON r.id = s.run_id
           WHERE r.room_id = ? AND r.state IN ('preparing', 'running')
             AND s.idx = (SELECT MAX(s2.idx) FROM run_step s2 WHERE s2.run_id = s.run_id)`,
        )
        .all(roomId) as StepRow[]
      const map = new Map<string, StoredStep>()
      for (const row of rows) map.set(row.run_id, stepFrom(row))
      return map
    },
  }
}
