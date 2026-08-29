import { canDeleteRoom } from '#/features/rooms/permissions'
import {
  rosterMentionPattern,
  rosterNotConfiguredMessage,
  rosterPerson,
} from '#project/agents/roster'
import {
  attachmentBytes,
  MAX_REQUEST_BYTES,
  removeAttachmentFiles,
  stageAttachments,
} from './attachments'
import type {
  RoomServerMessage,
  WorkspaceRoom,
  WorkspaceServerMessage,
} from '#/server/protocol'
import type { RunControl } from '#/server/features/runs/run-control'
import {
  MESSAGE_SEARCH_DEFAULT_LIMIT,
  MESSAGE_SEARCH_MAX_LIMIT,
  type RoomMessage,
  type RoomRun,
  type RoomStore,
  type RoomUser,
} from './room-store'
import {
  EditMessageError,
  PostMessageError,
  type RoomMessageHub,
} from './room-hub'
import { json } from '#/server/http/respond'

async function textFrom(request: Request): Promise<string | undefined> {
  try {
    const body: unknown = await request.json()
    const text =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>).text
        : undefined
    return typeof text === 'string' && text.trim() && text.length <= 10_000
      ? text.trim()
      : undefined
  } catch {
    return undefined
  }
}

async function messageInputFrom(
  request: Request,
): Promise<
  { text: string; files: File[]; rootId?: string } | { error: string }
> {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) {
    try {
      const body: unknown = await request.json()
      const raw =
        body && typeof body === 'object'
          ? (body as Record<string, unknown>)
          : undefined
      const rawText = raw?.text
      const text =
        typeof rawText === 'string' &&
        rawText.trim() &&
        rawText.length <= 10_000
          ? rawText.trim()
          : undefined
      if (!text) return { error: 'Invalid message' }
      const rawRootId = raw?.rootId
      const rootId =
        typeof rawRootId === 'string' && rawRootId ? rawRootId : undefined
      return { text, files: [], ...(rootId ? { rootId } : {}) }
    } catch {
      return { error: 'Invalid message' }
    }
  }
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_REQUEST_BYTES)
    return { error: 'Attachments must total 50 MiB or less' }
  try {
    const bytes = await request.arrayBuffer()
    if (bytes.byteLength > MAX_REQUEST_BYTES)
      return { error: 'Attachments must total 50 MiB or less' }
    const contentType = request.headers.get('content-type')
    if (!contentType) return { error: 'Invalid message' }
    const form = await new Response(bytes, {
      headers: { 'content-type': contentType },
    }).formData()
    const rawText = form.get('text')
    const text = typeof rawText === 'string' ? rawText.trim() : ''
    if (text.length > 10_000) return { error: 'Invalid message' }
    const files = form
      .getAll('attachments')
      .filter((entry): entry is File => entry instanceof File)
    if (form.getAll('attachments').length !== files.length)
      return { error: 'Invalid attachment' }
    const rawRootId = form.get('rootId')
    const rootId =
      typeof rawRootId === 'string' && rawRootId ? rawRootId : undefined
    return text || files.length
      ? { text, files, ...(rootId ? { rootId } : {}) }
      : { error: 'Invalid message' }
  } catch {
    return { error: 'Invalid message' }
  }
}

type RoomBody =
  | {
      name: string
      visibility: 'public' | 'private'
      visibilityInvalid?: false
    }
  | { visibilityInvalid: true; name?: string; visibility?: never }

async function roomBodyFrom(request: Request): Promise<RoomBody | undefined> {
  try {
    const body: unknown = await request.json()
    const raw =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : undefined
    if (!raw) return undefined
    const name = raw.name
    if (typeof name !== 'string') return undefined
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 50) return undefined
    const rawVisibility = raw.visibility
    if (
      rawVisibility !== undefined &&
      rawVisibility !== 'public' &&
      rawVisibility !== 'private'
    )
      return { visibilityInvalid: true }
    const visibility: 'public' | 'private' =
      rawVisibility === 'private' ? 'private' : 'public'
    return { name: trimmed, visibility }
  } catch {
    return undefined
  }
}

export function createRoomsHttp(deps: {
  store: RoomStore
  messages: RoomMessageHub
  control: RunControl
  attachmentsDirectory: string
  historyPageSize: number
  agentReady?: (agentDefinitionId?: string) => boolean
  mentionPattern?: () => RegExp
  lookupPerson?: (id: string) => { kind: 'cursor' | 'openai-agents' } | undefined
  roomsFor: (userId: string) => WorkspaceRoom[]
  broadcastWorkspace: (message: WorkspaceServerMessage) => void
  broadcastWorkspaceToUsers: (
    userIds: Set<string>,
    message: WorkspaceServerMessage,
  ) => void
  broadcastRoom: (roomId: string, message: RoomServerMessage) => void
}): (
  request: Request,
  url: URL,
  user: RoomUser,
) => Promise<Response | undefined> {
  return async (
    request: Request,
    url: URL,
    user: RoomUser,
  ): Promise<Response | undefined> => {
    if (url.pathname === '/api/account/analytics' && request.method === 'GET')
      return json({ analytics: deps.store.getAccountRunAnalytics(user.id) })
    if (url.pathname === '/api/rooms' && request.method === 'GET')
      return json({ rooms: deps.roomsFor(user.id) })
    if (url.pathname === '/api/search/messages' && request.method === 'GET') {
      const query = url.searchParams.get('q') ?? ''
      const limitParam = url.searchParams.get('limit')
      const parsedLimit =
        limitParam != null && limitParam !== ''
          ? Number.parseInt(limitParam, 10)
          : MESSAGE_SEARCH_DEFAULT_LIMIT
      const limit = Number.isFinite(parsedLimit)
        ? Math.max(
            1,
            Math.min(MESSAGE_SEARCH_MAX_LIMIT, Math.floor(parsedLimit)),
          )
        : MESSAGE_SEARCH_DEFAULT_LIMIT
      return json({
        hits: deps.store.searchMessages({
          userId: user.id,
          query,
          limit,
        }),
      })
    }
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const body = await roomBodyFrom(request)
      if (!body) return json({ error: 'Invalid room name' }, 400)
      if (body.visibilityInvalid)
        return json({ error: 'Invalid visibility' }, 400)
      const room = {
        id: crypto.randomUUID(),
        name: body.name,
        visibility: body.visibility,
        createdBy: user.id,
      }
      if (!deps.store.createRoom(room))
        return json({ error: 'Room already exists' }, 409)
      if (room.visibility === 'public')
        deps.broadcastWorkspace({
          type: 'room.created',
          room: { ...room, attentionCount: 0, mentionCount: 0 },
        })
      else
        deps.broadcastWorkspaceToUsers(new Set([user.id]), {
          type: 'room.created',
          room: { ...room, attentionCount: 0, mentionCount: 0 },
        })
      return json(
        { room: { ...room, attentionCount: 0, mentionCount: 0 } },
        201,
      )
    }
    const roomRoute = url.pathname.match(/^\/api\/rooms\/([^/]+)$/)
    if (roomRoute && request.method === 'DELETE') {
      const room = deps.store.getRoom(roomRoute[1]!)
      if (!room) return json({ error: 'Room not found' }, 404)
      if (!canDeleteRoom(user, room)) return json({ error: 'Forbidden' }, 403)
      const recipients =
        room.visibility === 'private'
          ? new Set(deps.store.listMembers(room.id).map(({ id }) => id))
          : undefined
      const storageKeys = deps.store.listAttachmentStorageKeys(room.id)
      deps.store.deleteRoom(room.id)
      try {
        await removeAttachmentFiles(deps.attachmentsDirectory, storageKeys)
      } catch (error) {
        console.error(
          'Attachment cleanup orphaned files:',
          room.id,
          storageKeys,
          error,
        )
      }
      const removed = { type: 'room.removed' as const, roomId: room.id }
      if (recipients) deps.broadcastWorkspaceToUsers(recipients, removed)
      else deps.broadcastWorkspace(removed)
      return json({ ok: true })
    }
    const messages = url.pathname.match(/^\/api\/rooms\/([^/]+)\/messages$/)
    if (messages && request.method === 'GET') {
      const roomId = messages[1]!
      if (!deps.store.canAccessRoom(roomId, user.id))
        return json({ error: 'Room not found' }, 404)
      const around = url.searchParams.get('around') ?? undefined
      const cursor = url.searchParams.get('cursor') ?? undefined
      if (around != null && cursor != null)
        return json({ error: 'Use either around or cursor, not both' }, 400)
      try {
        const page =
          around != null
            ? deps.store.listRoomHistoryAround(roomId, {
                messageId: around,
                limit: deps.historyPageSize,
              })
            : deps.store.listRoomHistoryPage(roomId, {
                limit: deps.historyPageSize,
                cursor,
              })
        return json(page)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Invalid room history'
        const status = message === 'Message not found' ? 404 : 400
        return json({ error: message }, status)
      }
    }
    const thread = url.pathname.match(
      /^\/api\/rooms\/([^/]+)\/messages\/([^/]+)\/thread$/,
    )
    if (thread && request.method === 'GET') {
      const roomId = thread[1]!
      const rootId = thread[2]!
      if (!deps.store.canAccessRoom(roomId, user.id))
        return json({ error: 'Room not found' }, 404)
      const found = deps.store.getThread(roomId, rootId)
      if (!found) return json({ error: 'Thread not found' }, 404)
      return json(found)
    }
    const messageEdit = url.pathname.match(
      /^\/api\/rooms\/([^/]+)\/messages\/([^/]+)$/,
    )
    if (messageEdit && request.method === 'PATCH') {
      const roomId = messageEdit[1]!
      const messageId = messageEdit[2]!
      if (!deps.store.canAccessRoom(roomId, user.id))
        return json({ error: 'Room not found' }, 404)
      const text = await textFrom(request)
      if (!text) return json({ error: 'Invalid message' }, 400)
      try {
        const message = deps.messages.editMessage({
          roomId,
          messageId,
          authorId: user.id,
          text,
        })
        return json({ message })
      } catch (error) {
        if (error instanceof EditMessageError) {
          if (error.code === 'not_found')
            return json({ error: 'Message not found' }, 404)
          if (error.code === 'forbidden')
            return json({ error: 'Forbidden' }, 403)
          return json({ error: 'Invalid message' }, 400)
        }
        return json({ error: 'Unable to edit message' }, 500)
      }
    }
    if (messages && request.method === 'POST') {
      const roomId = messages[1]!
      if (!deps.store.canAccessRoom(roomId, user.id))
        return json({ error: 'Room not found' }, 404)
      const input = await messageInputFrom(request)
      if ('error' in input) return json({ error: input.error }, 400)
      const { text, files, rootId } = input
      const mention = (deps.mentionPattern ?? rosterMentionPattern)()
      const mentionMatch = text.match(mention)
      const agentDefinitionId = mentionMatch?.[2]
      const isAgentMessage = Boolean(agentDefinitionId)
      const task = isAgentMessage
        ? text.replace(mention, (_, prefix: string) => prefix).trim()
        : undefined
      if (isAgentMessage && !task)
        return json({ error: 'Agent task is required' }, 400)
      if (
        task &&
        agentDefinitionId &&
        deps.agentReady &&
        !deps.agentReady(agentDefinitionId)
      ) {
        const person =
          deps.lookupPerson?.(agentDefinitionId) ??
          rosterPerson(agentDefinitionId)
        return json(
          {
            error: person
              ? rosterNotConfiguredMessage(person.kind)
              : 'Unknown agent',
          },
          409,
        )
      }
      let attachments
      try {
        attachments = await stageAttachments(files, deps.attachmentsDirectory)
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Unable to store attachments',
          },
          400,
        )
      }
      let message: RoomMessage
      try {
        message = deps.messages.postMessage({
          roomId,
          author: { kind: 'user', ...user },
          text,
          attachments,
          ...(rootId ? { rootId } : {}),
        })
      } catch (error) {
        try {
          await removeAttachmentFiles(
            deps.attachmentsDirectory,
            attachments.map(({ storageKey }) => storageKey),
          )
        } catch (cleanupError) {
          console.error('Attachment cleanup orphaned files:', cleanupError)
        }
        if (error instanceof PostMessageError)
          return json({ error: 'Invalid thread root' }, 400)
        return json({ error: 'Unable to save message' }, 500)
      }
      if (!task) return json({ message }, 201)
      try {
        const run = deps.control.start(task, {
          roomId,
          // Write binding: a top-level mention roots writes at its own
          // trigger message; a reply mention writes into the existing
          // thread root it already belongs to (never a nested root).
          rootId: rootId ?? message.id,
          // Read scope: only a reply mention gets a thread-scoped read;
          // top-level mentions keep the flat Room scope.
          ...(rootId ? { threadReadRootId: rootId } : {}),
          agentDefinitionId,
          attachments: attachments.map((attachment) => ({
            type: 'attachment' as const,
            id: attachment.id,
            roomId,
            filename: attachment.filename,
            byteSize: attachment.byteSize,
            sha256: attachment.sha256,
          })),
          responsibleAccountId: user.id,
          onCreate: (source) => {
            const run: RoomRun = {
              ...source,
              roomId,
              triggerMessageId: message.id,
              requestedBy: user,
            }
            deps.store.createRun(run)
            return run
          },
        })
        return json({ message, run }, 202)
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error ? error.message : 'Unable to start agent',
            message,
          },
          502,
        )
      }
    }
    const attachmentRoute = url.pathname.match(/^\/api\/attachments\/([^/]+)$/)
    if (attachmentRoute && request.method === 'GET') {
      const attachment = deps.store.getAttachment(attachmentRoute[1]!)
      if (!attachment || !deps.store.canAccessRoom(attachment.roomId, user.id))
        return json({ error: 'Attachment not found' }, 404)
      const bytes = await attachmentBytes(
        deps.attachmentsDirectory,
        attachment.storageKey,
      )
      if (!bytes) return json({ error: 'Attachment not found' }, 404)
      return new Response(bytes as unknown as BodyInit, {
        headers: {
          'content-type': attachment.contentType,
          'content-length': String(bytes.byteLength),
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
          'x-content-type-options': 'nosniff',
        },
      })
    }
    const stepsRoute = url.pathname.match(
      /^\/api\/rooms\/([^/]+)\/runs\/([^/]+)\/steps$/,
    )
    if (stepsRoute && request.method === 'GET') {
      const [, roomId, runId] = stepsRoute
      const stored =
        runId && runId.length <= 200 ? deps.store.getRun(runId) : undefined
      if (
        !roomId ||
        !deps.store.canAccessRoom(roomId, user.id) ||
        !stored ||
        stored.roomId !== roomId
      )
        return json({ error: 'Run not found' }, 404)
      return json({ steps: deps.store.listSteps(runId) })
    }
    const cancellation = url.pathname.match(
      /^\/api\/rooms\/([^/]+)\/runs\/([^/]+)\/cancel$/,
    )
    if (cancellation && request.method === 'POST') {
      const [, roomId, runId] = cancellation
      const stored =
        runId && runId.length <= 200 ? deps.store.getRun(runId) : undefined
      if (
        !roomId ||
        !deps.store.canAccessRoom(roomId, user.id) ||
        !stored ||
        stored.roomId !== roomId
      )
        return json({ error: 'Run not found' }, 404)
      const run = await deps.control.cancel(runId)
      return run
        ? json({ run: deps.store.getRun(runId) })
        : json({ error: 'Run not found' }, 404)
    }
    return undefined
  }
}
