import type { AgentDefinitionSummary } from '#/server/protocol'
import type { RoomUser } from '#/server/features/rooms/room-store'
import { json, readBody } from '#/server/http/respond'
import {
  chatFollowUpTask,
  type ChatStore,
} from './chat-store'
import {
  chatRunIsLive,
  type ChatLinkedRuns,
} from './chat-linked-runs'

const maxTextLength = 20_000

export function createChatsHttp(deps: {
  chatStore: ChatStore
  linkedRuns: ChatLinkedRuns
  agentDefinitions: (viewerAccountId: string) => AgentDefinitionSummary[]
}): (
  request: Request,
  url: URL,
  user: RoomUser,
) => Promise<Response | undefined> {
  const knownAgent = (id: unknown, viewerAccountId: string): id is string =>
    typeof id === 'string' &&
    deps.agentDefinitions(viewerAccountId).some((agent) => agent.id === id)

  const owned = (id: string, userId: string) =>
    deps.chatStore.getForAccount(id, userId)

  const payload = (chatId: string, accountId: string) => {
    const chat = owned(chatId, accountId)
    if (!chat) return undefined
    return {
      chat,
      messages: deps.chatStore.listMessages(chatId),
      liveSteps: deps.linkedRuns.getTurnSteps(chatId),
      linkedRun: deps.linkedRuns.getLinkedRun(chatId) ?? null,
    }
  }

  return async (request, url, user) => {
    if (url.pathname === '/api/chats' && request.method === 'GET')
      return json({ chats: deps.chatStore.listForAccount(user.id) })

    if (url.pathname === '/api/chats' && request.method === 'POST') {
      const body = await readBody(request)
      const agentDefinitionId = body?.agentDefinitionId
      if (!knownAgent(agentDefinitionId, user.id))
        return json({ error: 'Unknown agent definition' }, 400)
      const chat = deps.chatStore.create({
        id: crypto.randomUUID(),
        accountId: user.id,
        agentDefinitionId,
        createdAt: Date.now(),
      })
      return json({ chat }, 201)
    }

    const messageMatch = url.pathname.match(
      /^\/api\/chats\/([^/]+)\/messages$/,
    )
    if (messageMatch && request.method === 'POST') {
      const chatId = decodeURIComponent(messageMatch[1]!)
      const chat = owned(chatId, user.id)
      if (!chat) return json({ error: 'Chat not found' }, 404)
      const body = await readBody(request)
      const text =
        typeof body?.text === 'string' ? body.text.trim() : ''
      if (!text) return json({ error: 'Text is required' }, 400)
      if (text.length > maxTextLength)
        return json({ error: 'Message too long' }, 400)
      if (deps.linkedRuns.getLinkedRun(chatId)?.turnActive)
        return json({ error: 'A turn is already in progress' }, 409)
      const prior = deps.chatStore.listMessages(chatId)
      const message = deps.chatStore.appendMessage({
        id: crypto.randomUUID(),
        chatId,
        role: 'user',
        text,
        createdAt: Date.now(),
      })
      const live = deps.linkedRuns.getLinkedRun(chatId)
      if (live && chatRunIsLive(live.state))
        void deps.linkedRuns.followUp(chatId, text)
      else
        deps.linkedRuns.start({
          chatId,
          task: chatFollowUpTask(prior, text),
          agentDefinitionId: chat.agentDefinitionId,
          responsibleAccountId: user.id,
        })
      return json({ chat: owned(chatId, user.id), message }, 202)
    }

    const cancelMatch = url.pathname.match(/^\/api\/chats\/([^/]+)\/cancel$/)
    if (cancelMatch && request.method === 'POST') {
      const chatId = decodeURIComponent(cancelMatch[1]!)
      if (!owned(chatId, user.id)) return json({ error: 'Chat not found' }, 404)
      await deps.linkedRuns.dispose(chatId)
      return json({ chat: owned(chatId, user.id) })
    }

    const chatMatch = url.pathname.match(/^\/api\/chats\/([^/]+)$/)
    if (!chatMatch) return undefined
    const chatId = decodeURIComponent(chatMatch[1]!)

    if (request.method === 'GET') {
      const body = payload(chatId, user.id)
      if (!body) return json({ error: 'Chat not found' }, 404)
      return json(body)
    }

    if (request.method === 'DELETE') {
      if (!owned(chatId, user.id)) return json({ error: 'Chat not found' }, 404)
      await deps.linkedRuns.dispose(chatId)
      deps.chatStore.deleteForAccount(chatId, user.id)
      return json({ ok: true })
    }

    return undefined
  }
}
