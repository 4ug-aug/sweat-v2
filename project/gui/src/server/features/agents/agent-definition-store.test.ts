import { migratedDatabase, seedAccounts } from '#/server/test-db'
import { expect, test } from 'bun:test'
import { ANTBOY_ID, SOFTWARE_ENGINEER_ID, WORKSPACE_PEOPLE } from '#project/agents/roster-people'
import {
  AgentDefinitionError,
  createAgentDefinitionStore,
  slugFromName,
} from './agent-definition-store'

test('slugFromName generates an immutable-style handle from the initial name', () => {
  expect(slugFromName('Software engineer')).toBe('software-engineer')
  expect(slugFromName('  Ant Boy!  ')).toBe('ant-boy')
})

test('ensureSeeded inserts software-engineer and antboy for the first administrator', () => {
  const sqlite = migratedDatabase()
  seedAccounts(sqlite, [{ id: 'admin', name: 'Admin', role: 'admin' }])
  const store = createAgentDefinitionStore(sqlite)
  store.ensureSeeded('admin', 1_000)

  const engineer = store.get(SOFTWARE_ENGINEER_ID)
  expect(engineer).toMatchObject({
    id: SOFTWARE_ENGINEER_ID,
    name: 'Software engineer',
    kind: 'cursor',
    visibility: 'workspace',
    creatorAccountId: 'admin',
    githubAccess: true,
  })
  expect(engineer?.creatingAgentId).toBeUndefined()
  expect(engineer?.instructions.length).toBeGreaterThan(0)

  const antboy = store.get(ANTBOY_ID)
  expect(antboy).toMatchObject({
    id: ANTBOY_ID,
    name: 'Antboy',
    kind: 'openai-agents',
    visibility: 'workspace',
    creatorAccountId: 'admin',
    githubAccess: false,
  })

  store.ensureSeeded('admin', 2_000)
  expect(store.get(SOFTWARE_ENGINEER_ID)?.createdAt).toBe(1_000)
  sqlite.close()
})

test('listVisible hides Private definitions from other Accounts and omits archived ones', () => {
  const sqlite = migratedDatabase()
  seedAccounts(sqlite, [
    { id: 'ada', name: 'Ada' },
    { id: 'bob', name: 'Bob' },
  ])
  const store = createAgentDefinitionStore(sqlite)
  store.ensureSeeded('ada', 1)
  const privateAgent = store.create(
    {
      name: 'Ada private',
      description: 'Only Ada',
      instructions: 'Be private.',
      kind: 'openai-agents',
      visibility: 'private',
      creatorAccountId: 'ada',
    },
    2,
  )
  const extra = store.create(
    {
      name: 'Temp',
      description: 'Goes away',
      instructions: 'Be brief.',
      kind: 'openai-agents',
      visibility: 'workspace',
      creatorAccountId: 'ada',
    },
    3,
  )
  store.archive(extra.id, 'ada', 4)

  const adaSees = store.listVisible('ada').map((agent) => agent.id)
  const bobSees = store.listVisible('bob').map((agent) => agent.id)
  expect(adaSees).toContain(privateAgent.id)
  expect(adaSees).toContain(ANTBOY_ID)
  expect(adaSees).toContain(SOFTWARE_ENGINEER_ID)
  expect(adaSees).not.toContain(extra.id)
  expect(bobSees).toContain(ANTBOY_ID)
  expect(bobSees).not.toContain(privateAgent.id)
  expect(bobSees).not.toContain(extra.id)
  sqlite.close()
})

test('duplicate copies configuration with a new slug and the responsible Account as creator', () => {
  const sqlite = migratedDatabase()
  seedAccounts(sqlite, [
    { id: 'ada', name: 'Ada' },
    { id: 'bob', name: 'Bob' },
  ])
  const store = createAgentDefinitionStore(sqlite)
  store.ensureSeeded('ada', 1)
  const copy = store.duplicate(
    SOFTWARE_ENGINEER_ID,
    {
      creatorAccountId: 'bob',
      creatingAgentId: ANTBOY_ID,
    },
    10,
  )
  expect(copy.id).not.toBe(SOFTWARE_ENGINEER_ID)
  expect(copy.name).toBe('Software engineer copy')
  expect(copy.kind).toBe('cursor')
  expect(copy.githubAccess).toBe(true)
  expect(copy.creatorAccountId).toBe('bob')
  expect(copy.creatingAgentId).toBe(ANTBOY_ID)
  expect(copy.instructions).toBe(
    store.get(SOFTWARE_ENGINEER_ID)!.instructions,
  )
  sqlite.close()
})

test('seeded Agent definitions cannot be archived', () => {
  const sqlite = migratedDatabase()
  seedAccounts(sqlite, [{ id: 'ada', name: 'Ada' }])
  const store = createAgentDefinitionStore(sqlite)
  store.ensureSeeded('ada', 1)
  for (const id of Object.keys(WORKSPACE_PEOPLE)) {
    expect(() => store.archive(id, 'ada', 2)).toThrow(AgentDefinitionError)
    expect(store.get(id)?.archivedAt).toBeUndefined()
  }
  sqlite.close()
})

test('only the Agent creator can edit or archive a definition', () => {
  const sqlite = migratedDatabase()
  seedAccounts(sqlite, [
    { id: 'ada', name: 'Ada' },
    { id: 'bob', name: 'Bob' },
  ])
  const store = createAgentDefinitionStore(sqlite)
  store.ensureSeeded('ada', 1)
  const custom = store.create(
    {
      name: 'Researcher',
      description: 'Looks things up',
      instructions: 'Stay concise.',
      kind: 'openai-agents',
      visibility: 'workspace',
      creatorAccountId: 'ada',
    },
    2,
  )
  expect(() =>
    store.update(ANTBOY_ID, 'bob', { name: 'Hijacked' }, 3),
  ).toThrow(AgentDefinitionError)
  expect(() => store.archive(custom.id, 'bob', 4)).toThrow(
    AgentDefinitionError,
  )
  const updated = store.update(ANTBOY_ID, 'ada', { name: 'Antboy Prime' }, 5)
  expect(updated.name).toBe('Antboy Prime')
  expect(updated.id).toBe(ANTBOY_ID)
  expect(updated.updaterAccountId).toBe('ada')
  expect(updated.updatedAt).toBe(5)
  const archived = store.archive(custom.id, 'ada', 6)
  expect(archived.archivedAt).toBe(6)
  expect(archived.updaterAccountId).toBe('ada')
  expect(archived.updatedAt).toBe(6)
  sqlite.close()
})

test('create and seed stamp the responsible Account as creator and updater', () => {
  const sqlite = migratedDatabase()
  seedAccounts(sqlite, [{ id: 'ada', name: 'Ada' }])
  const store = createAgentDefinitionStore(sqlite)
  store.ensureSeeded('ada', 1)
  const antboy = store.get(ANTBOY_ID)
  expect(antboy).toMatchObject({
    creatorAccountId: 'ada',
    updaterAccountId: 'ada',
    createdAt: 1,
    updatedAt: 1,
  })
  const created = store.create(
    {
      name: 'Researcher',
      description: 'Looks things up',
      instructions: 'Stay concise.',
      kind: 'openai-agents',
      visibility: 'workspace',
      creatorAccountId: 'ada',
    },
    2,
  )
  expect(created.creatorAccountId).toBe('ada')
  expect(created.updaterAccountId).toBe('ada')
  expect(created.createdAt).toBe(2)
  expect(created.updatedAt).toBe(2)
  sqlite.close()
})

test('mentionPattern omits archived slugs while mentionHandles keeps them reserved', () => {
  const sqlite = migratedDatabase()
  seedAccounts(sqlite, [{ id: 'ada', name: 'Ada' }])
  const store = createAgentDefinitionStore(sqlite)
  store.ensureSeeded('ada', 1)
  const extra = store.create(
    {
      name: 'Temp',
      description: 'Goes away',
      instructions: 'Be brief.',
      kind: 'openai-agents',
      visibility: 'workspace',
      creatorAccountId: 'ada',
    },
    2,
  )
  store.archive(extra.id, 'ada', 3)
  expect(store.mentionHandles().has(extra.id)).toBe(true)
  expect(store.mentionPattern().test(` @${extra.id} do this`)).toBe(false)
  expect(store.mentionPattern().test(' @antboy do this')).toBe(true)
  sqlite.close()
})

test('create, update, and duplicate persist an Agent color', () => {
  const sqlite = migratedDatabase()
  seedAccounts(sqlite, [{ id: 'ada', name: 'Ada' }])
  const store = createAgentDefinitionStore(sqlite)
  const created = store.create(
    {
      name: 'Painter',
      description: 'Picks colors',
      instructions: 'Stay vivid.',
      kind: 'openai-agents',
      visibility: 'workspace',
      creatorAccountId: 'ada',
      color: '#1D4ED8',
    },
    1,
  )
  expect(created.color).toBe('#1d4ed8')
  const updated = store.update('painter', 'ada', { color: '#be123c' }, 2)
  expect(updated.color).toBe('#be123c')
  const copy = store.duplicate('painter', { creatorAccountId: 'ada' }, 3)
  expect(copy.color).toBe('#be123c')
  expect(copy.id).not.toBe('painter')
  sqlite.close()
})
