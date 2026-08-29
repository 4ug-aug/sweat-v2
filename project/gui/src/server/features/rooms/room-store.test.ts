import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { migratedDatabase } from '#/server/test-db'
import {
  createSqliteRoomStore,
  GENERAL_ROOM_ID,
  type RoomRun,
  type StoredStep,
} from './room-store'

function database(): Database {
  const sqlite = migratedDatabase()
  sqlite.run(`
    INSERT INTO user (id, name, email, image, color, username) VALUES
      ('user-1', 'Ada Lovelace', 'ada@example.com', NULL, NULL, 'ada'),
      ('user-2', 'Bob Builder', 'bob@example.com', 'https://example.com/bob.png', '#1d4ed8', 'bob');
  `)
  return sqlite
}

function seedMessages(sqlite: Database, ...ids: readonly string[]): void {
  const insert = sqlite.prepare(
    "INSERT INTO room_message (id, room_id, author_id, author_name, text, created_at) VALUES (?, 'general', 'user-1', 'Ada', 'root', 0)",
  )
  for (const id of ids) insert.run(id)
}

function makeRun(overrides: Partial<RoomRun> = {}): RoomRun {
  return {
    id: 'run-1',
    roomId: GENERAL_ROOM_ID,
    triggerMessageId: 'msg-1',
    requestedBy: { id: 'user-1', name: 'Ada' },
    task: 'Help',
    agentId: 'software-engineer',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    state: 'running',
    createdAt: 1,
    stdout: '',
    stderr: '',
    ...overrides,
  }
}

function makeStep(overrides: Partial<StoredStep> = {}): StoredStep {
  return {
    id: 'step-1',
    runId: 'run-1',
    roomId: GENERAL_ROOM_ID,
    idx: 0,
    kind: 'message',
    text: 'hello',
    createdAt: 100,
    at: 100,
    ...overrides,
  }
}

test('room store retains history and fails stale runs', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage({
    id: 'message-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Please help',
    createdAt: 1,
  })
  const run: RoomRun = {
    id: 'run-1',
    roomId: GENERAL_ROOM_ID,
    triggerMessageId: 'message-1',
    requestedBy: { id: 'user-1', name: 'Ada' },
    task: 'Please help',
    agentId: 'software-engineer',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    state: 'running',
    createdAt: 2,
    stdout: '',
    stderr: '',
  }
  store.createRun(run)
  expect(store.listMessages(GENERAL_ROOM_ID)).toEqual([
    {
      id: 'message-1',
      roomId: GENERAL_ROOM_ID,
      author: {
        kind: 'user',
        id: 'user-1',
        name: 'Ada',
        displayName: 'Ada Lovelace',
        email: 'ada@example.com',
      },
      text: 'Please help',
      createdAt: 1,
      attachments: [],
    },
  ])
  expect(store.failStaleRuns()).toMatchObject([
    {
      id: 'run-1',
      state: 'failed',
      error: 'Server restarted before the run completed.',
    },
  ])
  expect(store.getRun('run-1')).toMatchObject({
    state: 'failed',
    completedAt: expect.any(Number),
  })
  // Only runs this sweep transitioned: a second sweep must not resurrect them,
  // or every restart re-raises Attention for runs that died restarts ago.
  expect(store.failStaleRuns()).toEqual([])
  sqlite.close()
})

test('account run analytics aggregate only the requested account', () => {
  const sqlite = database()
  sqlite.run(
    "INSERT INTO room (id, name, visibility) VALUES ('research', 'Research', 'public')",
  )
  sqlite.run(`
    INSERT INTO issue (id, number, title, status, priority, created_at, updated_at, owner_kind, owner_id, created_by_kind)
    VALUES
      ('agent-created-open', 1, 'Open', 'todo', 'none', 0, 0, 'agent', 'software-engineer', 'agent'),
      ('agent-completed', 2, 'Completed', 'done', 'none', 0, 0, 'agent', 'software-engineer', 'account'),
      ('agent-created-done-by-user', 3, 'Done by user', 'done', 'none', 0, 0, 'account', 'user-1', 'agent');
  `)
  seedMessages(sqlite, 'msg-1')
  const store = createSqliteRoomStore(sqlite)
  const day = 86_400_000
  const now = Date.UTC(2026, 7, 16, 12)
  store.createMessage({
    id: 'msg-root',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Start',
    createdAt: now - 1,
  })
  store.createMessage({
    id: 'msg-reply',
    roomId: GENERAL_ROOM_ID,
    rootId: 'msg-root',
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Follow up',
    createdAt: now,
  })
  const addRun = (overrides: Partial<RoomRun>) =>
    store.createRun(
      makeRun({
        id: crypto.randomUUID(),
        createdAt: now,
        state: 'succeeded',
        ...overrides,
      }),
    )

  addRun({
    triggerMessageId: 'msg-reply',
    startedAt: now - 8_000,
    completedAt: now - 3_000,
  })
  addRun({
    roomId: 'research',
    agentId: 'researcher',
    state: 'failed',
    createdAt: now - 2 * day,
    startedAt: now - 12_000,
    completedAt: now - 5_000,
  })
  addRun({
    roomId: 'research',
    agentId: 'researcher',
    state: 'cancelled',
    createdAt: now - 3 * day,
  })
  addRun({
    state: 'running',
    createdAt: now - 8 * day,
    startedAt: now - 1_000,
    completedAt: now,
  })
  addRun({
    requestedBy: { id: 'user-2', name: 'Bob' },
    agentId: 'other-agent',
    startedAt: now - 20_000,
    completedAt: now,
  })
  store.createOneshotUsage({
    id: 'oneshot-1',
    accountId: 'user-1',
    state: 'running',
    createdAt: now,
    startedAt: now - 4_000,
  })
  store.updateOneshotUsage({
    id: 'oneshot-1',
    accountId: 'user-1',
    state: 'succeeded',
    createdAt: now,
    startedAt: now - 4_000,
    completedAt: now,
  })
  store.createOneshotUsage({
    id: 'oneshot-other',
    accountId: 'user-2',
    state: 'succeeded',
    createdAt: now,
    startedAt: now - 10_000,
    completedAt: now,
  })

  const analytics = store.getAccountRunAnalytics('user-1', now)
  expect(analytics).toMatchObject({
    delegations: 4,
    oneshots: 1,
    agentCreatedIssues: 2,
    agentCompletedIssues: 1,
    runtimeMs: 16_000,
  })
  expect(analytics.rhythm).toHaveLength(7)
  expect(analytics.rhythm.map(({ delegations }) => delegations)).toEqual([
    0, 0, 0, 1, 1, 0, 1,
  ])
  expect(analytics.rhythm.at(-1)?.day).toBe('2026-08-16')
  sqlite.close()
})

test('room history pages newest messages and follows an opaque cursor', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  for (const [id, createdAt] of [
    ['msg-1', 1],
    ['msg-2', 2],
    ['msg-3', 3],
  ] as const)
    store.createMessage({
      id,
      roomId: GENERAL_ROOM_ID,
      author: { kind: 'user', id: 'user-1', name: 'Ada' },
      text: id,
      createdAt,
    })
  store.createRun(
    makeRun({ id: 'run-old', triggerMessageId: 'msg-1', state: 'succeeded' }),
  )
  store.createRun(makeRun({ id: 'run-current', triggerMessageId: 'msg-2' }))

  const newest = store.listRoomHistoryPage(GENERAL_ROOM_ID, { limit: 2 })
  expect(newest.messages.map(({ id }) => id)).toEqual(['msg-2', 'msg-3'])
  expect(newest.runs.map(({ id }) => id)).toEqual(['run-current'])
  expect(newest.nextCursor).toEqual(expect.any(String))

  const oldest = store.listRoomHistoryPage(GENERAL_ROOM_ID, {
    limit: 2,
    cursor: newest.nextCursor,
  })
  expect(oldest.messages.map(({ id }) => id)).toEqual(['msg-1'])
  expect(oldest.runs.map(({ id }) => id)).toEqual(['run-current', 'run-old'])
  expect(oldest.nextCursor).toBeUndefined()
  expect(() =>
    store.listRoomHistoryPage(GENERAL_ROOM_ID, { limit: 2, cursor: '' }),
  ).toThrow('Invalid room history cursor')

  sqlite.close()
})

test('room messages expose attachment metadata without storage details', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage(
    {
      id: 'message-with-file',
      roomId: GENERAL_ROOM_ID,
      author: { kind: 'user', id: 'user-1', name: 'Ada' },
      text: '',
      createdAt: 1,
      attachments: [],
    },
    [
      {
        id: 'attachment-1',
        filename: 'report.pdf',
        contentType: 'application/pdf',
        byteSize: 42,
        sha256: 'private-hash',
        storageKey: 'private-key',
        createdAt: 1,
      },
    ],
  )

  expect(store.listMessages(GENERAL_ROOM_ID)).toMatchObject([
    {
      id: 'message-with-file',
      attachments: [
        {
          id: 'attachment-1',
          filename: 'report.pdf',
          contentType: 'application/pdf',
          byteSize: 42,
        },
      ],
    },
  ])
  expect(JSON.stringify(store.listMessages(GENERAL_ROOM_ID))).not.toContain(
    'private-key',
  )
  expect(store.getAttachment('attachment-1')).toMatchObject({
    storageKey: 'private-key',
    sha256: 'private-hash',
  })
  expect(store.listAttachmentStorageKeys(GENERAL_ROOM_ID)).toEqual([
    'private-key',
  ])
  sqlite.close()
})

test('room store creates ordered, isolated rooms', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  expect(
    store.createRoom({ id: 'zebra', name: 'Zebra', visibility: 'public' }),
  ).toBe(true)
  expect(
    store.createRoom({ id: 'alpha', name: 'alpha', visibility: 'public' }),
  ).toBe(true)
  expect(
    store.createRoom({ id: 'duplicate', name: 'ALPHA', visibility: 'public' }),
  ).toBe(false)
  expect(store.listRooms()).toEqual([
    { id: 'general', name: 'General', visibility: 'public' },
    { id: 'alpha', name: 'alpha', visibility: 'public' },
    { id: 'zebra', name: 'Zebra', visibility: 'public' },
  ])
  store.createMessage({
    id: 'product-message',
    roomId: 'alpha',
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Product',
    createdAt: 1,
  })
  expect(store.getRoom('alpha')).toEqual({
    id: 'alpha',
    name: 'alpha',
    visibility: 'public',
  })
  expect(store.listMessages(GENERAL_ROOM_ID)).toEqual([])
  expect(store.listMessages('alpha')).toHaveLength(1)
  store.createMessage({
    id: 'general-message',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'General',
    createdAt: 2,
  })
  for (const [id, roomId, triggerMessageId] of [
    ['general-run', GENERAL_ROOM_ID, 'general-message'],
    ['alpha-run', 'alpha', 'product-message'],
  ] as const) {
    store.createRun({
      id,
      roomId,
      triggerMessageId,
      requestedBy: { id: 'user-1', name: 'Ada' },
      task: 'Help',
      agentId: 'software-engineer',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      state: 'preparing',
      createdAt: 3,
      stdout: '',
      stderr: '',
    })
  }
  expect(store.listRuns(GENERAL_ROOM_ID).map(({ id }) => id)).toEqual([
    'general-run',
  ])
  expect(store.listRuns('alpha').map(({ id }) => id)).toEqual(['alpha-run'])
  sqlite.close()
})

test('appendStep then listSteps returns steps ordered by idx', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage({
    id: 'msg-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'hi',
    createdAt: 1,
  })
  store.createRun(makeRun())

  store.appendStep(
    makeStep({ id: 'step-2', idx: 1, text: 'second', createdAt: 102 }),
  )
  store.appendStep(
    makeStep({ id: 'step-1', idx: 0, text: 'first', createdAt: 101 }),
  )
  store.appendStep(
    makeStep({
      id: 'step-3',
      idx: 2,
      kind: 'tool_call',
      tool: 'bash',
      callId: 'call-1',
      text: 'ls',
      createdAt: 103,
    }),
  )

  const steps = store.listSteps('run-1')
  expect(steps.map((s) => s.idx)).toEqual([0, 1, 2])
  expect(steps[0].text).toBe('first')
  expect(steps[1].text).toBe('second')
  expect(steps[2].kind).toBe('tool_call')
  expect(steps[2].tool).toBe('bash')
  expect(steps[2].callId).toBe('call-1')

  sqlite.close()
})

test('latestStepsForActiveRuns returns max-idx step per active run only', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage({
    id: 'msg-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'hi',
    createdAt: 1,
  })
  store.createMessage({
    id: 'msg-2',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'hi',
    createdAt: 2,
  })
  store.createMessage({
    id: 'msg-3',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'hi',
    createdAt: 3,
  })

  store.createRun(
    makeRun({ id: 'run-active', state: 'running', triggerMessageId: 'msg-1' }),
  )
  store.createRun(
    makeRun({
      id: 'run-preparing',
      state: 'preparing',
      triggerMessageId: 'msg-2',
    }),
  )
  store.createRun(
    makeRun({ id: 'run-done', state: 'succeeded', triggerMessageId: 'msg-3' }),
  )

  // Active run with two steps
  store.appendStep(
    makeStep({
      id: 's1',
      runId: 'run-active',
      idx: 0,
      text: 'early',
      createdAt: 10,
    }),
  )
  store.appendStep(
    makeStep({
      id: 's2',
      runId: 'run-active',
      idx: 1,
      text: 'latest',
      createdAt: 20,
    }),
  )

  // Preparing run with no steps yet
  // Succeeded run with a step (should be excluded)
  store.appendStep(
    makeStep({
      id: 's3',
      runId: 'run-done',
      idx: 0,
      text: 'done step',
      createdAt: 5,
    }),
  )

  const latest = store.latestStepsForActiveRuns(GENERAL_ROOM_ID)
  expect(latest.size).toBe(1)
  expect(latest.has('run-active')).toBe(true)
  expect(latest.get('run-active')?.text).toBe('latest')
  expect(latest.get('run-active')?.idx).toBe(1)
  expect(latest.has('run-done')).toBe(false)
  expect(latest.has('run-preparing')).toBe(false)

  sqlite.close()
})

test('listSteps is scoped to its run', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage({
    id: 'msg-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'hi',
    createdAt: 1,
  })
  store.createMessage({
    id: 'msg-2',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'hi',
    createdAt: 2,
  })

  store.createRun(makeRun({ id: 'run-A', triggerMessageId: 'msg-1' }))
  store.createRun(makeRun({ id: 'run-B', triggerMessageId: 'msg-2' }))

  store.appendStep(
    makeStep({ id: 'step-A', runId: 'run-A', idx: 0, text: 'A step' }),
  )
  store.appendStep(
    makeStep({ id: 'step-B', runId: 'run-B', idx: 0, text: 'B step' }),
  )

  expect(store.listSteps('run-A').map((s) => s.id)).toEqual(['step-A'])
  expect(store.listSteps('run-B').map((s) => s.id)).toEqual(['step-B'])
  expect(store.listSteps('run-missing')).toEqual([])

  sqlite.close()
})

test('creating a private room seeds the owner as a member', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)

  store.createRoom({
    id: 'secret',
    name: 'Secret',
    visibility: 'private',
    createdBy: 'user-1',
  })

  const members = store.listMembers('secret')
  expect(members).toHaveLength(1)
  expect(members[0].id).toBe('user-1')
  expect(members[0].name).toBe('ada')

  sqlite.close()
})

test('creating a public room does not seed any member', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)

  store.createRoom({
    id: 'open',
    name: 'Open',
    visibility: 'public',
    createdBy: 'user-1',
  })

  expect(store.listMembers('open')).toHaveLength(0)

  sqlite.close()
})

test('canAccessRoom — public room is accessible by any user', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)

  // general is public and seeded by the first migration
  expect(store.canAccessRoom(GENERAL_ROOM_ID, 'user-1')).toBe(true)
  expect(store.canAccessRoom(GENERAL_ROOM_ID, 'user-2')).toBe(true)
  expect(store.canAccessRoom(GENERAL_ROOM_ID, 'stranger')).toBe(true)

  sqlite.close()
})

test('canAccessRoom — private room only allows members', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)

  store.createRoom({
    id: 'priv',
    name: 'Private',
    visibility: 'private',
    createdBy: 'user-1',
  })

  expect(store.canAccessRoom('priv', 'user-1')).toBe(true) // owner was seeded as member
  expect(store.canAccessRoom('priv', 'user-2')).toBe(false) // not a member
  expect(store.canAccessRoom('priv', 'stranger')).toBe(false)

  sqlite.close()
})

test('canAccessRoom — missing room returns false', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)

  expect(store.canAccessRoom('no-such-room', 'user-1')).toBe(false)

  sqlite.close()
})

test('listRoomsForUser hides private rooms you are not in', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)

  store.createRoom({ id: 'pub', name: 'Public Room', visibility: 'public' })
  store.createRoom({
    id: 'priv1',
    name: 'Priv1',
    visibility: 'private',
    createdBy: 'user-1',
  })
  store.createRoom({
    id: 'priv2',
    name: 'Priv2',
    visibility: 'private',
    createdBy: 'user-2',
  })

  const forUser1 = store.listRoomsForUser('user-1')
  const ids1 = forUser1.map((r) => r.id)
  expect(ids1).toContain(GENERAL_ROOM_ID)
  expect(ids1).toContain('pub')
  expect(ids1).toContain('priv1') // owner → member
  expect(ids1).not.toContain('priv2')

  const forUser2 = store.listRoomsForUser('user-2')
  const ids2 = forUser2.map((r) => r.id)
  expect(ids2).toContain(GENERAL_ROOM_ID)
  expect(ids2).toContain('pub')
  expect(ids2).not.toContain('priv1')
  expect(ids2).toContain('priv2')

  sqlite.close()
})

test('listRoomsForUser keeps General first', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)

  store.createRoom({ id: 'aaa', name: 'AAA', visibility: 'public' })
  store.createRoom({ id: 'zzz', name: 'ZZZ', visibility: 'public' })

  const rooms = store.listRoomsForUser('user-1')
  expect(rooms[0].id).toBe(GENERAL_ROOM_ID)

  sqlite.close()
})

test('addMember is idempotent', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)

  store.createRoom({
    id: 'priv',
    name: 'Priv',
    visibility: 'private',
    createdBy: 'user-1',
  })
  // user-1 already a member (seeded); add again — should not throw
  expect(() => store.addMember('priv', 'user-1', 'user-1')).not.toThrow()
  expect(store.listMembers('priv')).toHaveLength(1)

  // add user-2
  store.addMember('priv', 'user-2', 'user-1')
  expect(store.listMembers('priv')).toHaveLength(2)
  // add user-2 again — idempotent
  store.addMember('priv', 'user-2', 'user-1')
  expect(store.listMembers('priv')).toHaveLength(2)

  sqlite.close()
})

test('removeMember removes the member', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)

  store.createRoom({
    id: 'priv',
    name: 'Priv',
    visibility: 'private',
    createdBy: 'user-1',
  })
  store.addMember('priv', 'user-2', 'user-1')
  expect(store.listMembers('priv')).toHaveLength(2)
  store.createAttention({
    id: 'attention-1',
    roomId: 'priv',
    recipientId: 'user-2',
    kind: 'mention',
    sourceId: 'message-1',
    createdAt: 1,
  })

  store.removeMember('priv', 'user-2')
  expect(store.listMembers('priv')).toHaveLength(1)
  expect(store.listMembers('priv')[0].id).toBe('user-1')
  expect(store.listAttentionCounts('user-2').size).toBe(0)

  sqlite.close()
})

test('isOwner returns true only for the creator', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)

  store.createRoom({
    id: 'priv',
    name: 'Priv',
    visibility: 'private',
    createdBy: 'user-1',
  })

  expect(store.isOwner('priv', 'user-1')).toBe(true)
  expect(store.isOwner('priv', 'user-2')).toBe(false)
  expect(store.isOwner('no-such-room', 'user-1')).toBe(false)

  sqlite.close()
})

test('deleteRoom removes the room and its records', () => {
  const sqlite = database()
  sqlite.run(
    "INSERT INTO room (id, name, visibility, created_by) VALUES ('room-1', 'Room', 'public', 'user-1')",
  )
  sqlite.run(
    "INSERT INTO room_message (id, room_id, author_id, author_name, text, created_at) VALUES ('message-1', 'room-1', 'user-1', 'Ada', 'hi', 0)",
  )
  const store = createSqliteRoomStore(sqlite)

  expect(store.deleteRoom('room-1')).toBe(true)
  expect(store.getRoom('room-1')).toBeUndefined()
  expect(
    sqlite.prepare('SELECT COUNT(*) AS count FROM room_message').get(),
  ).toEqual({ count: 0 })
  expect(store.deleteRoom('room-1')).toBe(false)

  sqlite.close()
})

test('member and message profiles use username with durable secondary details', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)

  store.createRoom({
    id: 'priv',
    name: 'Priv',
    visibility: 'private',
    createdBy: 'user-1',
  })
  store.addMember('priv', 'user-2', 'user-1')

  const members = store.listMembers('priv')
  const ada = members.find((m) => m.id === 'user-1')!
  const bob = members.find((m) => m.id === 'user-2')!
  expect(ada).toMatchObject({
    name: 'ada',
    displayName: 'Ada Lovelace',
    email: 'ada@example.com',
  })
  expect(ada.image).toBeUndefined()
  expect(ada.color).toBeUndefined()
  expect(bob.name).toBe('bob')
  expect(bob.image).toBe('https://example.com/bob.png')
  expect(bob.color).toBe('#1d4ed8')
  store.createMessage({
    id: 'message-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'ada' },
    text: 'Hello',
    createdAt: 1,
  })
  expect(store.listMessages(GENERAL_ROOM_ID)[0]?.author).toMatchObject({
    name: 'ada',
    displayName: 'Ada Lovelace',
    email: 'ada@example.com',
  })
  store.createMessage({
    id: 'message-2',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-2', name: 'bob' },
    text: 'Hi',
    createdAt: 2,
  })
  expect(store.listMessages(GENERAL_ROOM_ID)[1]?.author).toMatchObject({
    name: 'bob',
    color: '#1d4ed8',
  })

  sqlite.close()
})

test('listWorkspaceUsers returns all users ordered by name', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)

  const users = store.listWorkspaceUsers()
  expect(users).toHaveLength(2)
  expect(users[0].id).toBe('user-1') // Ada before Bob
  expect(users[1].id).toBe('user-2')
  expect(users[0].image).toBeUndefined()
  expect(users[1].image).toBe('https://example.com/bob.png')
  expect(users[1].color).toBe('#1d4ed8')

  sqlite.close()
})

test('mentionable accounts are active and scoped to the room', () => {
  const sqlite = database()
  sqlite.run(`
    INSERT INTO user (id, name, username, banned)
    VALUES ('user-3', 'Suspended', 'suspended', 1);
  `)
  const store = createSqliteRoomStore(sqlite)

  expect(
    store
      .listMentionableAccounts(GENERAL_ROOM_ID)
      .map(({ username }) => username),
  ).toEqual(['ada', 'bob'])

  store.createRoom({
    id: 'private',
    name: 'Private',
    visibility: 'private',
    createdBy: 'user-1',
  })
  expect(
    store.listMentionableAccounts('private').map(({ username }) => username),
  ).toEqual(['ada'])
  store.addMember('private', 'user-2', 'user-1')
  expect(
    store.listMentionableAccounts('private').map(({ username }) => username),
  ).toEqual(['ada', 'bob'])

  sqlite.close()
})

test('attention is idempotent, countable, and acknowledged per room', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage({
    id: 'message-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Hello',
    createdAt: 1,
  })
  store.createMessage({
    id: 'message-2',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-2', name: 'Bob' },
    text: 'Hi',
    createdAt: 2,
  })
  expect(store.latestMessageFromOther(GENERAL_ROOM_ID, 'user-2')).toEqual({
    id: 'message-1',
    createdAt: 1,
    authorId: 'user-1',
  })
  const attention = {
    id: 'attention-1',
    roomId: GENERAL_ROOM_ID,
    recipientId: 'user-2',
    kind: 'mention' as const,
    sourceId: 'message-1',
    createdAt: 1,
  }

  expect(store.createAttention(attention)).toBe(true)
  expect(
    store.createAttention({ ...attention, id: 'attention-duplicate' }),
  ).toBe(false)
  expect(store.listMentionRecipientIds('message-1')).toEqual(['user-2'])
  expect(store.listAttentionCounts('user-2').get(GENERAL_ROOM_ID)).toBe(1)
  expect(
    store.listAttentionCounts('user-2', 'mention').get(GENERAL_ROOM_ID),
  ).toBe(1)

  store.acknowledgeRoomAttention(GENERAL_ROOM_ID, 'user-2', 2)
  expect(store.listAttentionCounts('user-2').size).toBe(0)
  expect(store.listMentionRecipientIds('message-1')).toEqual(['user-2'])

  sqlite.close()
})

test('thread_reply attention is idempotent per (recipient, root, source) and does not pollute mention lookups', () => {
  const sqlite = database()
  seedMessages(sqlite, 'root-1')
  const store = createSqliteRoomStore(sqlite)
  const attention = {
    id: 'attention-thread-1',
    roomId: GENERAL_ROOM_ID,
    recipientId: 'user-1',
    kind: 'thread_reply' as const,
    sourceId: 'reply-1',
    rootId: 'root-1',
    createdAt: 1,
  }

  expect(store.createAttention(attention)).toBe(true)
  expect(
    store.createAttention({ ...attention, id: 'attention-thread-dup' }),
  ).toBe(false)
  expect(
    store.listAttentionCounts('user-1', 'thread_reply').get(GENERAL_ROOM_ID),
  ).toBe(1)
  expect(store.listMentionRecipientIds('reply-1')).toEqual([])

  sqlite.close()
})

test('acknowledgeRoomAttention leaves thread_reply attention untouched while clearing mention and run_terminal', () => {
  const sqlite = database()
  seedMessages(sqlite, 'root-1')
  const store = createSqliteRoomStore(sqlite)
  store.createAttention({
    id: 'attention-mention',
    roomId: GENERAL_ROOM_ID,
    recipientId: 'user-2',
    kind: 'mention',
    sourceId: 'message-1',
    createdAt: 1,
  })
  store.createAttention({
    id: 'attention-thread',
    roomId: GENERAL_ROOM_ID,
    recipientId: 'user-2',
    kind: 'thread_reply',
    sourceId: 'reply-1',
    rootId: 'root-1',
    createdAt: 2,
  })

  store.acknowledgeRoomAttention(GENERAL_ROOM_ID, 'user-2', 3)

  expect(store.listAttentionCounts('user-2', 'mention').size).toBe(0)
  expect(
    store.listAttentionCounts('user-2', 'thread_reply').get(GENERAL_ROOM_ID),
  ).toBe(1)
  expect(store.listAttentionCounts('user-2').get(GENERAL_ROOM_ID)).toBe(1)

  sqlite.close()
})

test('acknowledgeThreadAttention clears only the matching root, not other threads or room-level attention', () => {
  const sqlite = database()
  seedMessages(sqlite, 'root-a', 'root-b')
  const store = createSqliteRoomStore(sqlite)
  store.createAttention({
    id: 'attention-mention',
    roomId: GENERAL_ROOM_ID,
    recipientId: 'user-2',
    kind: 'mention',
    sourceId: 'message-1',
    createdAt: 1,
  })
  store.createAttention({
    id: 'attention-thread-a',
    roomId: GENERAL_ROOM_ID,
    recipientId: 'user-2',
    kind: 'thread_reply',
    sourceId: 'reply-a',
    rootId: 'root-a',
    createdAt: 2,
  })
  store.createAttention({
    id: 'attention-thread-b',
    roomId: GENERAL_ROOM_ID,
    recipientId: 'user-2',
    kind: 'thread_reply',
    sourceId: 'reply-b',
    rootId: 'root-b',
    createdAt: 3,
  })

  store.acknowledgeThreadAttention(GENERAL_ROOM_ID, 'root-a', 'user-2', 4)

  expect(
    store.listAttentionCounts('user-2', 'mention').get(GENERAL_ROOM_ID),
  ).toBe(1)
  expect(
    store.listAttentionCounts('user-2', 'thread_reply').get(GENERAL_ROOM_ID),
  ).toBe(1)
  expect(store.listAttentionCounts('user-2').get(GENERAL_ROOM_ID)).toBe(2)

  sqlite.close()
})

test('listOpenThreadAttentionRootIds returns distinct unacked thread roots and ignores room-level ack', () => {
  const sqlite = database()
  seedMessages(sqlite, 'root-a', 'root-b', 'root-c')
  const store = createSqliteRoomStore(sqlite)
  store.createAttention({
    id: 'attention-mention',
    roomId: GENERAL_ROOM_ID,
    recipientId: 'user-2',
    kind: 'mention',
    sourceId: 'message-1',
    createdAt: 1,
  })
  store.createAttention({
    id: 'attention-thread-a1',
    roomId: GENERAL_ROOM_ID,
    recipientId: 'user-2',
    kind: 'thread_reply',
    sourceId: 'reply-a1',
    rootId: 'root-a',
    createdAt: 2,
  })
  store.createAttention({
    id: 'attention-thread-a2',
    roomId: GENERAL_ROOM_ID,
    recipientId: 'user-2',
    kind: 'thread_reply',
    sourceId: 'reply-a2',
    rootId: 'root-a',
    createdAt: 3,
  })
  store.createAttention({
    id: 'attention-thread-b',
    roomId: GENERAL_ROOM_ID,
    recipientId: 'user-2',
    kind: 'thread_reply',
    sourceId: 'reply-b',
    rootId: 'root-b',
    createdAt: 4,
  })
  store.createAttention({
    id: 'attention-other-user',
    roomId: GENERAL_ROOM_ID,
    recipientId: 'user-1',
    kind: 'thread_reply',
    sourceId: 'reply-c',
    rootId: 'root-c',
    createdAt: 5,
  })

  expect(
    store.listOpenThreadAttentionRootIds('user-2', GENERAL_ROOM_ID),
  ).toEqual(['root-a', 'root-b'])

  store.acknowledgeRoomAttention(GENERAL_ROOM_ID, 'user-2', 6)
  expect(
    store.listOpenThreadAttentionRootIds('user-2', GENERAL_ROOM_ID),
  ).toEqual(['root-a', 'root-b'])

  store.acknowledgeThreadAttention(GENERAL_ROOM_ID, 'root-a', 'user-2', 7)
  expect(
    store.listOpenThreadAttentionRootIds('user-2', GENERAL_ROOM_ID),
  ).toEqual(['root-b'])

  sqlite.close()
})

test('room store updates message text and editedAt in place', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage({
    id: 'message-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Original',
    createdAt: 1,
  })
  const updated = store.updateMessageText({
    id: 'message-1',
    roomId: GENERAL_ROOM_ID,
    text: 'Edited',
    editedAt: 42,
  })
  expect(updated).toMatchObject({
    id: 'message-1',
    text: 'Edited',
    editedAt: 42,
    createdAt: 1,
  })
  expect(store.getMessage(GENERAL_ROOM_ID, 'message-1')).toEqual(updated)
  expect(
    store.updateMessageText({
      id: 'missing',
      roomId: GENERAL_ROOM_ID,
      text: 'Nope',
      editedAt: 43,
    }),
  ).toBeUndefined()
  sqlite.close()
})

test('searchMessages matches across accessible rooms only', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createRoom({
    id: 'private-1',
    name: 'Private',
    visibility: 'private',
    createdBy: 'user-1',
  })
  store.createMessage({
    id: 'msg-public',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Deploy the rocket boosters',
    createdAt: 1,
  })
  store.createMessage({
    id: 'msg-private',
    roomId: 'private-1',
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Secret rocket plans',
    createdAt: 2,
  })
  store.createMessage({
    id: 'msg-other',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-2', name: 'Bob' },
    text: 'Unrelated lunch plans',
    createdAt: 3,
  })

  const forUser2 = store.searchMessages({ userId: 'user-2', query: 'rocket' })
  expect(forUser2.map((hit) => hit.messageId)).toEqual(['msg-public'])
  expect(forUser2[0]).toMatchObject({
    roomId: GENERAL_ROOM_ID,
    roomName: 'General',
    text: 'Deploy the rocket boosters',
  })

  const forUser1 = store.searchMessages({ userId: 'user-1', query: 'rocket' })
  expect(forUser1.map((hit) => hit.messageId)).toEqual([
    'msg-private',
    'msg-public',
  ])

  expect(store.searchMessages({ userId: 'user-1', query: 'r' })).toEqual([])
  expect(store.searchMessages({ userId: 'user-1', query: '   ' })).toEqual([])
  expect(
    store.searchMessages({ userId: 'user-1', query: 'rocket " OR' }).length,
  ).toBeGreaterThanOrEqual(0)

  sqlite.close()
})

test('searchMessages tags thread-reply hits with their root id, flat hits without one', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage({
    id: 'root-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Deploy checklist',
    createdAt: 1,
  })
  store.createMessage({
    id: 'reply-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-2', name: 'Bob' },
    text: 'Rocket boosters are staged',
    createdAt: 2,
    rootId: 'root-1',
  })

  const flatHit = store.searchMessages({ userId: 'user-1', query: 'checklist' })
  expect(flatHit).toHaveLength(1)
  expect(flatHit[0]?.rootId).toBeUndefined()

  const threadHit = store.searchMessages({
    userId: 'user-1',
    query: 'boosters',
  })
  expect(threadHit).toHaveLength(1)
  expect(threadHit[0]).toMatchObject({ messageId: 'reply-1', rootId: 'root-1' })

  sqlite.close()
})

test('searchMessages stays in sync after edit and delete', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage({
    id: 'msg-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Original alpha text',
    createdAt: 1,
  })
  expect(
    store
      .searchMessages({ userId: 'user-1', query: 'alpha' })
      .map((h) => h.messageId),
  ).toEqual(['msg-1'])

  store.updateMessageText({
    id: 'msg-1',
    roomId: GENERAL_ROOM_ID,
    text: 'Updated beta text',
    editedAt: 2,
  })
  expect(store.searchMessages({ userId: 'user-1', query: 'alpha' })).toEqual([])
  expect(
    store
      .searchMessages({ userId: 'user-1', query: 'beta' })
      .map((h) => h.messageId),
  ).toEqual(['msg-1'])

  store.deleteRoom(GENERAL_ROOM_ID)
  expect(store.searchMessages({ userId: 'user-1', query: 'beta' })).toEqual([])
  sqlite.close()
})

test('searchMessages stays in sync after a reply is edited, keeping its root id', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage({
    id: 'root-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Root topic',
    createdAt: 1,
  })
  store.createMessage({
    id: 'reply-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-2', name: 'Bob' },
    text: 'Original reply alpha',
    createdAt: 2,
    rootId: 'root-1',
  })
  expect(
    store
      .searchMessages({ userId: 'user-1', query: 'alpha' })
      .map((h) => h.messageId),
  ).toEqual(['reply-1'])

  store.updateMessageText({
    id: 'reply-1',
    roomId: GENERAL_ROOM_ID,
    text: 'Edited reply beta',
    editedAt: 5,
  })

  expect(store.searchMessages({ userId: 'user-1', query: 'alpha' })).toEqual([])
  const updated = store.searchMessages({ userId: 'user-1', query: 'beta' })
  expect(updated).toHaveLength(1)
  expect(updated[0]).toMatchObject({ messageId: 'reply-1', rootId: 'root-1' })

  sqlite.close()
})

test('flat listMessages excludes replies while a reply is created against its root', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage({
    id: 'root-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Root question',
    createdAt: 1,
  })
  store.createMessage({
    id: 'reply-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-2', name: 'Bob' },
    text: 'Reply text',
    createdAt: 2,
    rootId: 'root-1',
  })

  expect(store.listMessages(GENERAL_ROOM_ID).map(({ id }) => id)).toEqual([
    'root-1',
  ])
  expect(store.getMessage(GENERAL_ROOM_ID, 'reply-1')).toMatchObject({
    id: 'reply-1',
    rootId: 'root-1',
  })

  sqlite.close()
})

test('getThread returns the complete root and chronological replies, excluded from flat history', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage({
    id: 'root-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Root question',
    createdAt: 1,
  })
  store.createMessage({
    id: 'reply-2',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-2', name: 'Bob' },
    text: 'Second reply',
    createdAt: 3,
    rootId: 'root-1',
  })
  store.createMessage({
    id: 'reply-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'First reply',
    createdAt: 2,
    rootId: 'root-1',
  })

  const thread = store.getThread(GENERAL_ROOM_ID, 'root-1')
  expect(thread?.root.id).toBe('root-1')
  expect(thread?.replies.map(({ id }) => id)).toEqual(['reply-1', 'reply-2'])

  const page = store.listRoomHistoryPage(GENERAL_ROOM_ID, { limit: 10 })
  expect(page.messages.map(({ id }) => id)).toEqual(['root-1'])

  expect(store.getThread(GENERAL_ROOM_ID, 'missing')).toBeUndefined()
  expect(store.getThread(GENERAL_ROOM_ID, 'reply-1')).toBeUndefined()

  sqlite.close()
})

test('getThread includes a succeeded run result as a chronological, non-message reply and excludes failed/cancelled runs and Run Activity', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage({
    id: 'root-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: '@software-engineer fix the bug',
    createdAt: 1,
  })
  store.createMessage({
    id: 'reply-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-2', name: 'Bob' },
    text: 'Any update?',
    createdAt: 2,
    rootId: 'root-1',
  })
  store.createRun(
    makeRun({
      id: 'run-succeeded',
      triggerMessageId: 'root-1',
      state: 'succeeded',
      completedAt: 5,
      stdout: 'Fixed it, tests pass.',
    }),
  )
  store.createRun(
    makeRun({ id: 'run-failed', triggerMessageId: 'root-1', state: 'failed' }),
  )
  store.createRun(
    makeRun({
      id: 'run-cancelled',
      triggerMessageId: 'root-1',
      state: 'cancelled',
    }),
  )
  store.createRun(
    makeRun({
      id: 'run-running',
      triggerMessageId: 'root-1',
      state: 'running',
    }),
  )

  const thread = store.getThread(GENERAL_ROOM_ID, 'root-1')
  expect(thread?.replies.map(({ id }) => id)).toEqual(['reply-1'])
  expect(thread?.results).toEqual([
    {
      id: 'run-succeeded',
      agentId: 'software-engineer',
      text: 'Fixed it, tests pass.',
      createdAt: 5,
    },
  ])

  sqlite.close()
})

test('listThreadParticipantIds returns the root author and distinct reply authors, excluding agents', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage({
    id: 'root-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Root question',
    createdAt: 1,
  })
  store.createMessage({
    id: 'reply-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-2', name: 'Bob' },
    text: 'First reply',
    createdAt: 2,
    rootId: 'root-1',
  })
  store.createMessage({
    id: 'reply-agent',
    roomId: GENERAL_ROOM_ID,
    author: {
      kind: 'agent',
      id: 'software-engineer',
      name: 'Software Engineer',
    },
    text: 'Agent reply',
    createdAt: 3,
    rootId: 'root-1',
  })
  store.createMessage({
    id: 'reply-2',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Second reply, same author as root',
    createdAt: 4,
    rootId: 'root-1',
  })

  expect(store.listThreadParticipantIds(GENERAL_ROOM_ID, 'root-1')).toEqual([
    'user-1',
    'user-2',
  ])
  expect(store.listThreadParticipantIds(GENERAL_ROOM_ID, 'missing')).toEqual([])

  sqlite.close()
})

test('canReplyTo accepts a same-room top-level message and rejects invalid, cross-room, and nested roots', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createRoom({ id: 'other', name: 'Other', visibility: 'public' })
  store.createMessage({
    id: 'root-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Root question',
    createdAt: 1,
  })
  store.createMessage({
    id: 'reply-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-2', name: 'Bob' },
    text: 'Reply text',
    createdAt: 2,
    rootId: 'root-1',
  })
  store.createMessage({
    id: 'other-root',
    roomId: 'other',
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Other room root',
    createdAt: 1,
  })

  expect(store.canReplyTo(GENERAL_ROOM_ID, 'root-1')).toBe(true)
  expect(store.canReplyTo(GENERAL_ROOM_ID, 'missing')).toBe(false)
  expect(store.canReplyTo(GENERAL_ROOM_ID, 'other-root')).toBe(false)
  expect(store.canReplyTo(GENERAL_ROOM_ID, 'reply-1')).toBe(false)

  sqlite.close()
})

test('root summary derives reply count, recent participants, and latest-reply time; excludes the root itself', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage({
    id: 'root-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Root question',
    createdAt: 1,
  })
  expect(store.listMessages(GENERAL_ROOM_ID)[0]?.replySummary).toBeUndefined()

  store.createMessage({
    id: 'reply-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-2', name: 'Bob' },
    text: 'First reply',
    createdAt: 2,
    rootId: 'root-1',
  })
  store.createMessage({
    id: 'reply-2',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Second reply',
    createdAt: 3,
    rootId: 'root-1',
  })

  const [root] = store.listMessages(GENERAL_ROOM_ID)
  expect(root?.replySummary).toEqual({
    replyCount: 2,
    participants: [
      { id: 'user-1', name: 'Ada' },
      { id: 'user-2', name: 'Bob' },
    ],
    latestReplyAt: 3,
  })

  sqlite.close()
})

test('root summary counts a succeeded run result as a reply and orders participants by recency; failed/cancelled/active runs are excluded', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage({
    id: 'root-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: '@software-engineer fix the bug',
    createdAt: 1,
  })
  store.createMessage({
    id: 'reply-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-2', name: 'Bob' },
    text: 'Any update?',
    createdAt: 2,
    rootId: 'root-1',
  })
  store.createRun(
    makeRun({
      id: 'run-succeeded',
      triggerMessageId: 'root-1',
      state: 'succeeded',
      completedAt: 5,
      stdout: 'Fixed it.',
    }),
  )
  store.createRun(
    makeRun({ id: 'run-failed', triggerMessageId: 'root-1', state: 'failed' }),
  )
  store.createRun(
    makeRun({
      id: 'run-cancelled',
      triggerMessageId: 'root-1',
      state: 'cancelled',
    }),
  )

  const [root] = store.listMessages(GENERAL_ROOM_ID)
  expect(root?.replySummary).toEqual({
    replyCount: 2,
    participants: [
      { id: 'software-engineer', name: 'software-engineer' },
      { id: 'user-2', name: 'Bob' },
    ],
    latestReplyAt: 5,
  })

  sqlite.close()
})

test('a run triggered by a reply (an in-thread invocation) is attributed to the thread root in getThread results and the root summary', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage({
    id: 'root-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Root question',
    createdAt: 1,
  })
  store.createMessage({
    id: 'reply-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-2', name: 'Bob' },
    text: '@software-engineer fix it in-thread',
    createdAt: 2,
    rootId: 'root-1',
  })
  store.createRun(
    makeRun({
      id: 'run-from-reply',
      triggerMessageId: 'reply-1',
      state: 'succeeded',
      completedAt: 5,
      stdout: 'Done, from the thread.',
    }),
  )

  const thread = store.getThread(GENERAL_ROOM_ID, 'root-1')
  expect(thread?.replies.map(({ id }) => id)).toEqual(['reply-1'])
  expect(thread?.results).toEqual([
    {
      id: 'run-from-reply',
      agentId: 'software-engineer',
      text: 'Done, from the thread.',
      createdAt: 5,
    },
  ])

  const [root] = store.listMessages(GENERAL_ROOM_ID)
  expect(root?.replySummary).toEqual({
    replyCount: 2,
    participants: [
      { id: 'software-engineer', name: 'software-engineer' },
      { id: 'user-2', name: 'Bob' },
    ],
    latestReplyAt: 5,
  })

  sqlite.close()
})

test('latestMessageFromOther excludes thread replies from the flat unread marker', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  store.createMessage({
    id: 'root-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-1', name: 'Ada' },
    text: 'Root question',
    createdAt: 1,
  })
  store.createMessage({
    id: 'reply-1',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-2', name: 'Bob' },
    text: 'Reply text',
    createdAt: 2,
    rootId: 'root-1',
  })

  // Only "other" message is the thread reply, which must not count as unread.
  expect(
    store.latestMessageFromOther(GENERAL_ROOM_ID, 'user-1'),
  ).toBeUndefined()

  store.createMessage({
    id: 'flat-2',
    roomId: GENERAL_ROOM_ID,
    author: { kind: 'user', id: 'user-2', name: 'Bob' },
    text: 'Flat follow-up',
    createdAt: 3,
  })
  expect(store.latestMessageFromOther(GENERAL_ROOM_ID, 'user-1')).toEqual({
    id: 'flat-2',
    createdAt: 3,
    authorId: 'user-2',
  })

  sqlite.close()
})

test('listRoomHistoryAround returns a window centered on the target', () => {
  const sqlite = database()
  const store = createSqliteRoomStore(sqlite)
  for (const [id, createdAt] of [
    ['msg-1', 1],
    ['msg-2', 2],
    ['msg-3', 3],
    ['msg-4', 4],
    ['msg-5', 5],
  ] as const)
    store.createMessage({
      id,
      roomId: GENERAL_ROOM_ID,
      author: { kind: 'user', id: 'user-1', name: 'Ada' },
      text: id,
      createdAt,
    })

  const page = store.listRoomHistoryAround(GENERAL_ROOM_ID, {
    messageId: 'msg-3',
    limit: 3,
  })
  expect(page.messages.map((message) => message.id)).toEqual([
    'msg-2',
    'msg-3',
    'msg-4',
  ])
  expect(page.nextCursor).toBeDefined()

  const oldest = store.listRoomHistoryAround(GENERAL_ROOM_ID, {
    messageId: 'msg-1',
    limit: 3,
  })
  expect(oldest.messages.map((message) => message.id)).toEqual([
    'msg-1',
    'msg-2',
    'msg-3',
  ])
  expect(oldest.nextCursor).toBeUndefined()

  expect(() =>
    store.listRoomHistoryAround(GENERAL_ROOM_ID, {
      messageId: 'missing',
      limit: 3,
    }),
  ).toThrow('Message not found')
  sqlite.close()
})
