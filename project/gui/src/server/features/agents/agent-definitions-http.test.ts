import { migratedDatabase, seedAccounts } from '#/server/test-db'
import { expect, test } from 'bun:test'
import { summaryFromPerson } from '#project/agents/roster-meta'
import { SOFTWARE_ENGINEER_ID } from '#project/agents/roster-people'
import { createAgentDefinitionStore } from './agent-definition-store'
import { createAgentDefinitionsHttp } from './agent-definitions-http'
import { createSqliteScheduleStore } from '#/server/features/schedules/schedule-store'
import type { RoomUser } from '#/server/features/rooms/room-store'

const ada: RoomUser = { id: 'ada', name: 'Ada', role: 'user' }
const bob: RoomUser = { id: 'bob', name: 'Bob', role: 'user' }
const admin: RoomUser = { id: 'admin', name: 'Admin', role: 'admin' }

function harness() {
  const sqlite = migratedDatabase()
  seedAccounts(sqlite, [ada, bob, admin])
  const store = createAgentDefinitionStore(sqlite)
  store.ensureSeeded('admin', 1)
  const schedules = createSqliteScheduleStore(sqlite)
  const paused: string[] = []
  const handle = createAgentDefinitionsHttp({
    store,
    toSummary: (record) =>
      summaryFromPerson({
        id: record.id,
        name: record.name,
        description: record.description,
        kind: record.kind,
        githubAccess: record.githubAccess,
        visibility: record.visibility,
        creatorAccountId: record.creatorAccountId,
        creatingAgentId: record.creatingAgentId,
        archivedAt: record.archivedAt,
        instructions: record.instructions,
      }),
    pauseSchedules: (id) => {
      paused.push(id)
      schedules.pauseActiveForAgent(id, 99)
    },
    now: () => 10,
  })
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    user: RoomUser = ada,
  ) => {
    const url = new URL(`http://localhost${path}`)
    const request = new Request(url, {
      method,
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json' },
          }),
    })
    const response = await handle(request, url, user)
    if (!response) throw new Error(`unrouted: ${method} ${path}`)
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    }
  }
  return { call, store, schedules, paused, sqlite }
}

test('any Account can create an Agent definition and only its creator can archive it', async () => {
  const { call } = harness()
  const created = await call('POST', '/api/agent-definitions', {
    name: 'Researcher',
    description: 'Looks things up',
    instructions: 'Stay concise.',
    kind: 'openai-agents',
    visibility: 'private',
  })
  expect(created.status).toBe(201)
  expect(created.body.agent.id).toBe('researcher')
  expect(created.body.agent.visibility).toBe('private')
  expect(created.body.agent.creatorAccountId).toBe('ada')
  expect(created.body.agent.includeRepository).toBe(false)

  const listedForBob = await call('GET', '/api/agent-definitions', undefined, bob)
  expect(
    listedForBob.body.agents.map((agent: { id: string }) => agent.id),
  ).not.toContain('researcher')

  const forbidden = await call(
    'POST',
    '/api/agent-definitions/researcher/archive',
    undefined,
    bob,
  )
  expect(forbidden.status).toBe(403)
})

test('GitHub access is administrator-gated and archive pauses active Schedules', async () => {
  const { call, schedules, paused, sqlite } = harness()
  sqlite
    .prepare(
      `INSERT INTO schedule (id, name, agent_definition_id, task, cron_expression, timezone, state, created_by, created_at, updated_at, next_run_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'sched-1',
      'Nightly',
      SOFTWARE_ENGINEER_ID,
      'Check',
      '0 0 * * *',
      'UTC',
      'active',
      'admin',
      1,
      1,
      100,
    )

  const memberGithub = await call('POST', '/api/agent-definitions', {
    name: 'Coder',
    description: 'Writes code',
    instructions: 'Ship it.',
    kind: 'cursor',
    githubAccess: true,
  })
  expect(memberGithub.status).toBe(403)

  const adminGithub = await call(
    'PATCH',
    `/api/agent-definitions/${SOFTWARE_ENGINEER_ID}`,
    { githubAccess: false },
    admin,
  )
  expect(adminGithub.status).toBe(200)
  expect(adminGithub.body.agent.includeRepository).toBe(false)

  const archived = await call(
    'POST',
    `/api/agent-definitions/${SOFTWARE_ENGINEER_ID}/archive`,
    undefined,
    admin,
  )
  expect(archived.status).toBe(200)
  expect(paused).toEqual([SOFTWARE_ENGINEER_ID])
  expect(schedules.getSchedule('sched-1')?.state).toBe('paused')
})

test('duplicate records the responsible Account as creator', async () => {
  const { call } = harness()
  const copy = await call(
    'POST',
    `/api/agent-definitions/${SOFTWARE_ENGINEER_ID}/duplicate`,
    undefined,
    bob,
  )
  expect(copy.status).toBe(201)
  expect(copy.body.agent.creatorAccountId).toBe('bob')
  expect(copy.body.agent.id).not.toBe(SOFTWARE_ENGINEER_ID)
  expect(copy.body.agent.includeRepository).toBe(true)
})

test('GET lists instructions and optional skill summaries for the viewer', async () => {
  const sqlite = migratedDatabase()
  seedAccounts(sqlite, [ada, bob, admin])
  const store = createAgentDefinitionStore(sqlite)
  store.ensureSeeded('admin', 1)
  const handle = createAgentDefinitionsHttp({
    store,
    toSummary: (record) =>
      summaryFromPerson({
        id: record.id,
        name: record.name,
        description: record.description,
        kind: record.kind,
        githubAccess: record.githubAccess,
        visibility: record.visibility,
        creatorAccountId: record.creatorAccountId,
        creatingAgentId: record.creatingAgentId,
        archivedAt: record.archivedAt,
        instructions: record.instructions,
      }),
    list: (viewer) =>
      store.listVisible(viewer).map((record) => ({
        ...summaryFromPerson({
          id: record.id,
          name: record.name,
          description: record.description,
          kind: record.kind,
          githubAccess: record.githubAccess,
          visibility: record.visibility,
          creatorAccountId: record.creatorAccountId,
          instructions: record.instructions,
        }),
        skills: [{ id: 'pack', name: 'Pack', description: 'A skill' }],
      })),
  })
  const url = new URL('http://localhost/api/agent-definitions')
  const response = await handle(
    new Request(url, { method: 'GET' }),
    url,
    ada,
  )
  if (!response) throw new Error('unrouted GET')
  const body = (await response.json()) as {
    agents: {
      id: string
      instructions?: string
      skills: { id: string; name: string; description: string }[]
    }[]
  }
  const engineer = body.agents.find((agent) => agent.id === SOFTWARE_ENGINEER_ID)
  expect(engineer?.instructions?.length).toBeGreaterThan(0)
  expect(engineer?.skills).toEqual([
    { id: 'pack', name: 'Pack', description: 'A skill' },
  ])
  sqlite.close()
})
