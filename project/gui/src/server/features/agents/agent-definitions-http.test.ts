import { migratedDatabase, seedAccounts } from '#/server/test-db'
import { expect, test } from 'bun:test'
import { summaryFromPerson } from '#project/agents/roster-meta'
import { SOFTWARE_ENGINEER_ID, WORKSPACE_PEOPLE } from '#project/agents/roster-people'
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
        updaterAccountId: record.updaterAccountId,
        updatedAt: record.updatedAt,
        archivedAt: record.archivedAt,
        instructions: record.instructions,
        color: record.color,
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
  expect(created.body.agent.updaterAccountId).toBe('ada')
  expect(created.body.agent.updatedAt).toBe(10)
  expect(created.body.agent.includeRepository).toBe(false)
  expect(created.body.agent.color).toBeUndefined()

  const painted = await call('POST', '/api/agent-definitions', {
    name: 'Painter',
    description: 'Picks colors',
    instructions: 'Stay vivid.',
    kind: 'openai-agents',
    visibility: 'workspace',
    color: '#1D4ED8',
  })
  expect(painted.status).toBe(201)
  expect(painted.body.agent.color).toBe('#1d4ed8')

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

  const created = await call(
    'POST',
    '/api/agent-definitions',
    {
      name: 'Coder',
      description: 'Writes code',
      instructions: 'Ship it.',
      kind: 'cursor',
    },
    admin,
  )
  expect(created.status).toBe(201)
  sqlite
    .prepare(`UPDATE schedule SET agent_definition_id = ? WHERE id = 'sched-1'`)
    .run(created.body.agent.id)

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
    `/api/agent-definitions/${created.body.agent.id}/archive`,
    undefined,
    admin,
  )
  expect(archived.status).toBe(200)
  expect(paused).toEqual([created.body.agent.id])
  expect(schedules.getSchedule('sched-1')?.state).toBe('paused')
})

test('system Agent definitions cannot be archived', async () => {
  const { call } = harness()
  for (const id of Object.keys(WORKSPACE_PEOPLE)) {
    const archived = await call(
      'POST',
      `/api/agent-definitions/${id}/archive`,
      undefined,
      admin,
    )
    expect(archived.status).toBe(403)
    expect(archived.body.error).toBe('System agents cannot be archived')
  }
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
  expect(copy.body.agent.updaterAccountId).toBe('bob')
  expect(copy.body.agent.updatedAt).toBe(10)
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
        updaterAccountId: record.updaterAccountId,
        updatedAt: record.updatedAt,
        archivedAt: record.archivedAt,
        instructions: record.instructions,
        color: record.color,
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
          updaterAccountId: record.updaterAccountId,
          updatedAt: record.updatedAt,
          instructions: record.instructions,
          color: record.color,
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
