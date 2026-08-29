import { migratedDatabase, seedAccounts } from '#/server/test-db'
import { expect, test } from 'bun:test'
import { ANTBOY_ID, SOFTWARE_ENGINEER_ID } from '#project/agents/roster-people'
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
  store.archive(SOFTWARE_ENGINEER_ID, 'ada', 3)

  const adaSees = store.listVisible('ada').map((agent) => agent.id)
  const bobSees = store.listVisible('bob').map((agent) => agent.id)
  expect(adaSees).toContain(privateAgent.id)
  expect(adaSees).toContain(ANTBOY_ID)
  expect(adaSees).not.toContain(SOFTWARE_ENGINEER_ID)
  expect(bobSees).toContain(ANTBOY_ID)
  expect(bobSees).not.toContain(privateAgent.id)
  expect(bobSees).not.toContain(SOFTWARE_ENGINEER_ID)
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

test('only the Agent creator can edit or archive a definition', () => {
  const sqlite = migratedDatabase()
  seedAccounts(sqlite, [
    { id: 'ada', name: 'Ada' },
    { id: 'bob', name: 'Bob' },
  ])
  const store = createAgentDefinitionStore(sqlite)
  store.ensureSeeded('ada', 1)
  expect(() =>
    store.update(ANTBOY_ID, 'bob', { name: 'Hijacked' }, 2),
  ).toThrow(AgentDefinitionError)
  expect(() => store.archive(ANTBOY_ID, 'bob', 3)).toThrow(
    AgentDefinitionError,
  )
  const updated = store.update(ANTBOY_ID, 'ada', { name: 'Antboy Prime' }, 4)
  expect(updated.name).toBe('Antboy Prime')
  expect(updated.id).toBe(ANTBOY_ID)
  const archived = store.archive(ANTBOY_ID, 'ada', 5)
  expect(archived.archivedAt).toBe(5)
  sqlite.close()
})

test('mentionPattern omits archived slugs while mentionHandles keeps them reserved', () => {
  const sqlite = migratedDatabase()
  seedAccounts(sqlite, [{ id: 'ada', name: 'Ada' }])
  const store = createAgentDefinitionStore(sqlite)
  store.ensureSeeded('ada', 1)
  store.archive(SOFTWARE_ENGINEER_ID, 'ada', 2)
  expect(store.mentionHandles().has(SOFTWARE_ENGINEER_ID)).toBe(true)
  expect(store.mentionPattern().test(' @software-engineer do this')).toBe(false)
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
