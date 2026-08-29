import { migratedDatabase, seedAccounts } from '#/server/test-db'
import { expect, test } from 'bun:test'
import { createSqliteChatStore } from './chat-store'
import { createChatsHttp } from './chats-http'
import type { ChatLinkedRuns } from './chat-linked-runs'
import type { RoomUser } from '#/server/features/rooms/room-store'
import type { RunSummary } from '#/server/features/runs/run-control'

const ada: RoomUser = { id: 'ada', name: 'Ada' }
const bob: RoomUser = { id: 'bob', name: 'Bob' }

const agents = [
  {
    id: 'antboy',
    name: 'Antboy',
    description: '',
    includeRepository: false,
    capabilities: [],
    skills: [],
  },
  {
    id: 'software-engineer',
    name: 'Software engineer',
    description: '',
    includeRepository: true,
    capabilities: [],
    skills: [],
  },
]

const run = (id: string, overrides: Partial<RunSummary> = {}): RunSummary => ({
  id,
  task: 't',
  state: 'running',
  createdAt: 1,
  agentId: 'antboy',
  provider: 'openai',
  model: 'm',
  stdout: '',
  stderr: '',
  ...overrides,
})

function fakeLinked(
  overrides: Partial<ChatLinkedRuns> = {},
): ChatLinkedRuns & { started: { chatId: string; task: string }[] } {
  const started: { chatId: string; task: string }[] = []
  const followUps: { chatId: string; task: string }[] = []
  const runs = new Map<string, RunSummary & { turnActive: boolean }>()
  const linked: ChatLinkedRuns & {
    started: { chatId: string; task: string }[]
  } = {
    started,
    start: ({ chatId, task }) => {
      started.push({ chatId, task })
      const created = { ...run(`run-${chatId}`), turnActive: true }
      runs.set(chatId, created)
      return created
    },
    followUp: async (chatId, task) => {
      followUps.push({ chatId, task })
      return runs.get(chatId)
    },
    dispose: async (chatId) => {
      runs.delete(chatId)
    },
    getLinkedRun: (chatId) => runs.get(chatId),
    getTurnSteps: () => [],
    ...overrides,
  }
  return linked
}

function harness(linked: ChatLinkedRuns = fakeLinked()) {
  const sqlite = migratedDatabase()
  seedAccounts(sqlite, ['ada', 'bob'])
  const chatStore = createSqliteChatStore(sqlite)
  const http = createChatsHttp({
    chatStore,
    linkedRuns: linked,
    agentDefinitions: () => agents,
  })
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    user: RoomUser = ada,
  ) => {
    const url = new URL(`http://localhost${path}`)
    const response = await http(
      new Request(url, {
        method,
        ...(body === undefined
          ? {}
          : {
              body: JSON.stringify(body),
              headers: { 'content-type': 'application/json' },
            }),
      }),
      url,
      user,
    )
    if (!response) throw new Error(`unrouted: ${method} ${path}`)
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    }
  }
  return { call, sqlite, linked, chatStore }
}

test('chats HTTP creates, messages privately, and rejects unknown agents', async () => {
  const linked = fakeLinked()
  const { call, sqlite } = harness(linked)

  expect(
    (await call('POST', '/api/chats', { agentDefinitionId: 'nope' })).status,
  ).toBe(400)

  const created = await call('POST', '/api/chats', {
    agentDefinitionId: 'antboy',
  })
  expect(created.status).toBe(201)
  const id = created.body.chat.id as string
  expect(created.body.chat.agentDefinitionId).toBe('antboy')

  const denied = await call('GET', `/api/chats/${id}`, undefined, bob)
  expect(denied.status).toBe(404)

  const sent = await call('POST', `/api/chats/${id}/messages`, {
    text: 'Who is on call?',
  })
  expect(sent.status).toBe(202)
  expect(sent.body.message).toMatchObject({
    role: 'user',
    text: 'Who is on call?',
  })
  expect(linked.started[0]).toMatchObject({
    chatId: id,
    task: 'Who is on call?',
  })

  const listed = await call('GET', '/api/chats', undefined, bob)
  expect(listed.body.chats).toEqual([])
  const mine = await call('GET', '/api/chats')
  expect(mine.body.chats[0].title).toBe('Who is on call?')

  const got = await call('GET', `/api/chats/${id}`)
  expect(got.body.messages).toHaveLength(1)
  expect(got.body.chat.agentDefinitionId).toBe('antboy')

  expect((await call('DELETE', `/api/chats/${id}`, undefined, bob)).status).toBe(
    404,
  )
  expect((await call('DELETE', `/api/chats/${id}`)).status).toBe(200)
  expect((await call('GET', `/api/chats/${id}`)).status).toBe(404)
  sqlite.close()
})

test('chats HTTP rejects a second send while a turn is active', async () => {
  const { call, sqlite } = harness()
  const created = await call('POST', '/api/chats', {
    agentDefinitionId: 'software-engineer',
  })
  const id = created.body.chat.id as string
  expect(
    (await call('POST', `/api/chats/${id}/messages`, { text: 'first' })).status,
  ).toBe(202)
  expect(
    (await call('POST', `/api/chats/${id}/messages`, { text: 'second' })).status,
  ).toBe(409)
  sqlite.close()
})
