import { migratedDatabase } from '#/server/test-db'
import { expect, test } from 'bun:test'
import {
  buildIssueRunTask,
  createSqliteIssueStore,
  formatIssueId,
  parseIssueRef,
  resolveIssue
  
} from './issue-store'
import type {Issue} from './issue-store';

const ada = { kind: 'account' as const, id: 'ada' }

test('issue store allocates COL numbers and accepts legacy SWE references', () => {
  const sqlite = migratedDatabase()
  const store = createSqliteIssueStore(sqlite)

  const parent = store.createIssue({
    id: 'parent',
    title: 'Ship dock badge',
    description: 'Parent feature',
    createdBy: ada,
    createdAt: 1,
  })
  expect(parent).toMatchObject({ number: 1, status: 'backlog', priority: 'none' })
  expect(formatIssueId(parent.number)).toBe('COL-1')

  const childA = store.createIssue({
    id: 'child-a',
    title: 'UI badge',
    parentId: parent.id,
    createdBy: ada,
    createdAt: 2,
  })
  const childB = store.createIssue({
    id: 'child-b',
    title: 'Wire notifications',
    parentId: parent.id,
    status: 'done',
    createdBy: ada,
    createdAt: 3,
  })
  expect(childA.number).toBe(2)
  expect(childB.number).toBe(3)

  const listedParent = store.getIssue(parent.id)
  expect(listedParent?.childProgress).toEqual({ done: 1, total: 2 })

  store.assignIssue(childA.id, { kind: 'agent', id: 'software-engineer' }, 4)
  expect(store.getIssue(childA.id)?.owner).toEqual({
    kind: 'agent',
    id: 'software-engineer',
  })

  store.updateIssue(childA.id, { status: 'in_progress', tags: ['gui'] }, 5)
  expect(store.getIssue(childA.id)).toMatchObject({
    status: 'in_progress',
    tags: ['gui'],
  })

  expect(resolveIssue(store, 'COL-2')?.id).toBe(childA.id)
  expect(parseIssueRef('col-2')).toEqual({ kind: 'number', number: 2 })

  const task = buildIssueRunTask(store.getIssue(childA.id)!, parent)
  expect(task).toContain('COL-2')
  expect(task).toContain('<<<issue')
  expect(task).toContain('untrusted user/agent-authored data')
  expect(task).toContain('COL-1')
  expect(task).toContain('Parent feature')

  const parentTask = buildIssueRunTask(
    store.getIssue(parent.id)!,
    undefined,
    store.listChildIssues(parent.id),
  )
  expect(parentTask).toContain('<<<children')
  expect(parentTask).toContain('COL-2')
  expect(parentTask).toContain('COL-3')

  store.setDeliverable(parent.id, 'Shipped the badge.', 8)
  expect(store.getIssue(parent.id)?.deliverable).toBe('Shipped the badge.')
  expect(store.hasActiveRun(childA.id)).toBe(false)
  expect(
    store.createRun({
      id: 'run-1',
      issueId: childA.id,
      task,
      agentId: 'software-engineer',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      state: 'preparing',
      createdAt: 6,
      stdout: '',
      stderr: '',
    })?.id,
  ).toBe('run-1')
  expect(
    store.createRun({
      id: 'run-2',
      issueId: childA.id,
      task,
      agentId: 'software-engineer',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      state: 'preparing',
      createdAt: 7,
      stdout: '',
      stderr: '',
    }),
  ).toBeUndefined()
  expect(store.listRuns(childA.id)).toHaveLength(1)
  store.appendStep({
    id: 'step-1',
    runId: 'run-1',
    idx: 0,
    kind: 'message',
    text: 'Looking at the badge',
    createdAt: 8,
    at: 8,
  })
  store.appendStep({
    id: 'step-2',
    runId: 'run-1',
    idx: 1,
    kind: 'tool_call',
    tool: 'shell',
    callId: 'call-1',
    text: '{"command":"ls"}',
    createdAt: 9,
    at: 9,
  })
  expect(store.listSteps('run-1').map((step) => step.id)).toEqual([
    'step-1',
    'step-2',
  ])
  expect(store.listSteps('missing')).toEqual([])
  sqlite.close()
})

test('getIssue includes direct children with live related work; list omits children', () => {
  const sqlite = migratedDatabase()
  const store = createSqliteIssueStore(sqlite)
  const parent = store.createIssue({
    id: 'parent',
    title: 'Add auth',
    createdBy: ada,
    createdAt: 1,
  })
  const childUi = store.createIssue({
    id: 'child-ui',
    title: 'Login UI',
    parentId: parent.id,
    owner: { kind: 'agent', id: 'antboy' },
    createdBy: ada,
    createdAt: 2,
  })
  const childApi = store.createIssue({
    id: 'child-api',
    title: 'Session API',
    parentId: parent.id,
    owner: { kind: 'agent', id: 'software-engineer' },
    createdBy: ada,
    createdAt: 3,
  })
  store.createRun({
    id: 'parent-run',
    issueId: parent.id,
    task: 'parent',
    agentId: 'antboy',
    provider: 'openai',
    model: '',
    state: 'running',
    createdAt: 4,
    stdout: '',
    stderr: '',
  })
  store.createRun({
    id: 'ui-run',
    issueId: childUi.id,
    task: 'ui',
    agentId: 'antboy',
    provider: 'openai',
    model: '',
    state: 'running',
    createdAt: 5,
    stdout: '',
    stderr: '',
  })
  store.setDeliverable(childApi.id, 'Session API shipped.', 6)

  const got = store.getIssue(parent.id)
  expect(got?.hasActiveRun).toBe(true)
  expect(got?.deliverable).toBe('')
  expect(got?.children).toEqual([
    {
      id: childUi.id,
      number: 2,
      status: 'backlog',
      deliverable: '',
      owner: { kind: 'agent', id: 'antboy' },
      hasActiveRun: true,
    },
    {
      id: childApi.id,
      number: 3,
      status: 'backlog',
      deliverable: 'Session API shipped.',
      owner: { kind: 'agent', id: 'software-engineer' },
    },
  ])

  const nested = store.getIssue(childUi.id)
  expect(nested).toMatchObject({
    parentId: parent.id,
    hasActiveRun: true,
    children: [],
  })

  const listed = store.listIssues()
  expect(listed.find((issue) => issue.id === parent.id)).toMatchObject({
    deliverable: '',
    hasActiveRun: true,
  })
  expect(listed.find((issue) => issue.id === parent.id)?.children).toBeUndefined()
  expect(listed.find((issue) => issue.id === childApi.id)?.deliverable).toBe(
    'Session API shipped.',
  )
  sqlite.close()
})

test('deleteIssue removes the issue, cascades runs, and orphans children', () => {
  const sqlite = migratedDatabase()
  const store = createSqliteIssueStore(sqlite)
  const parent = store.createIssue({
    id: 'parent',
    title: 'Parent',
    createdBy: ada,
    createdAt: 1,
  })
  const child = store.createIssue({
    id: 'child',
    title: 'Child',
    parentId: parent.id,
    createdBy: ada,
    createdAt: 2,
  })
  store.createRun({
    id: 'run-1',
    issueId: parent.id,
    task: 'task',
    agentId: 'software-engineer',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    state: 'succeeded',
    createdAt: 3,
    stdout: '',
    stderr: '',
  })

  expect(store.deleteIssue(parent.id)).toBe(true)
  expect(store.getIssue(parent.id)).toBeUndefined()
  expect(store.listRuns(parent.id)).toHaveLength(0)
  expect(store.getIssue(child.id)?.id).toBe(child.id)
  expect(store.getIssue(child.id)?.parentId).toBeUndefined()
  expect(store.deleteIssue(parent.id)).toBe(false)
  sqlite.close()
})

test('issue store rejects parent cycles and oversized descriptions', () => {
  const sqlite = migratedDatabase()
  const store = createSqliteIssueStore(sqlite)
  const a = store.createIssue({
    id: 'a',
    title: 'A',
    createdBy: ada,
    createdAt: 1,
  })
  const b = store.createIssue({
    id: 'b',
    title: 'B',
    parentId: a.id,
    createdBy: ada,
    createdAt: 2,
  })
  expect(() =>
    store.updateIssue(a.id, { parentId: b.id }, 3),
  ).toThrow('Issue parent cycle')
  expect(() =>
    store.createIssue({
      id: 'huge',
      title: 'Huge',
      description: 'x'.repeat(10_001),
      createdBy: ada,
      createdAt: 4,
    }),
  ).toThrow('Invalid Issue description')
  sqlite.close()
})

test('issue branch binding resolves own and inherited effectiveBranch', () => {
  const sqlite = migratedDatabase()
  const store = createSqliteIssueStore(sqlite, 'acme/widgets')

  const parent = store.createIssue({
    id: 'parent',
    title: 'Parent',
    createdBy: ada,
    createdAt: 1,
  })
  store.updateIssue(parent.id, { branch: 'feat/parent' }, 2)
  expect(store.getIssue(parent.id)).toMatchObject({
    branch: 'feat/parent',
    effectiveBranch: 'feat/parent',
    branchUrl: 'https://github.com/acme/widgets/tree/feat/parent',
  })

  const child = store.createIssue({
    id: 'child',
    title: 'Child',
    parentId: parent.id,
    createdBy: ada,
    createdAt: 3,
  })
  expect(store.getIssue(child.id)).toMatchObject({
    effectiveBranch: 'feat/parent',
  })
  expect(store.getIssue(child.id)?.branch).toBeUndefined()

  store.updateIssue(child.id, { branch: 'feat/child' }, 4)
  expect(store.getIssue(child.id)).toMatchObject({
    branch: 'feat/child',
    effectiveBranch: 'feat/child',
  })

  const middle = store.createIssue({
    id: 'middle',
    title: 'Middle',
    parentId: parent.id,
    createdBy: ada,
    createdAt: 5,
  })
  const grandchild = store.createIssue({
    id: 'grandchild',
    title: 'Grandchild',
    parentId: middle.id,
    createdBy: ada,
    createdAt: 6,
  })
  expect(store.getIssue(grandchild.id)?.effectiveBranch).toBe('feat/parent')

  store.updateIssue(child.id, { branch: null }, 7)
  expect(store.getIssue(child.id)?.branch).toBeUndefined()
  expect(store.getIssue(child.id)?.effectiveBranch).toBe('feat/parent')

  store.updateIssue(middle.id, { branch: 'feat/x' }, 8)
  expect(store.getIssue(middle.id)).toMatchObject({
    branch: 'feat/x',
    effectiveBranch: 'feat/x',
  })

  const childTask = buildIssueRunTask(
    store.getIssue(child.id)!,
    store.getIssue(parent.id),
  )
  expect(childTask).toContain('Branch: feat/parent')

  const parentTask = buildIssueRunTask(
    store.getIssue(parent.id)!,
    undefined,
    [store.getIssue(child.id)!, store.getIssue(middle.id)!],
  )
  expect(parentTask).toContain('COL-2 [backlog] — Child — feat/parent')
  expect(parentTask).toContain('COL-3 [backlog] — Middle — feat/x')

  sqlite.close()
})

test('issue store retains createdBy for account and agent creators', () => {
  const sqlite = migratedDatabase()
  sqlite
    .prepare(
      `INSERT INTO issue (
        id, number, title, description, status, priority, tags, time_spent,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'legacy',
      1,
      'Legacy',
      '',
      'backlog',
      'none',
      '[]',
      '[]',
      1,
      1,
    )
  sqlite.prepare('UPDATE issue_counter SET next_number = 2 WHERE id = 1').run()
  const store = createSqliteIssueStore(sqlite)

  expect(store.getIssue('legacy')?.createdBy).toBeUndefined()

  const fromAccount = store.createIssue({
    id: 'from-account',
    title: 'From account',
    createdBy: { kind: 'account', id: 'ada' },
    createdAt: 2,
  })
  expect(store.getIssue(fromAccount.id)?.createdBy).toEqual({
    kind: 'account',
    id: 'ada',
  })

  const fromAgent = store.createIssue({
    id: 'from-agent',
    title: 'From agent',
    createdBy: { kind: 'agent', id: 'software-engineer' },
    createdAt: 3,
  })
  expect(store.getIssue(fromAgent.id)?.createdBy).toEqual({
    kind: 'agent',
    id: 'software-engineer',
  })
  expect(store.listIssues().map((issue) => issue.createdBy)).toEqual([
    undefined,
    { kind: 'account', id: 'ada' },
    { kind: 'agent', id: 'software-engineer' },
  ])
  sqlite.close()
})

const taskIssue = (overrides: Partial<Issue> = {}): Issue => ({
  id: 'issue-1',
  number: 1,
  title: 'Add auth',
  description: '',
  deliverable: '',
  status: 'in_progress',
  priority: 'none',
  tags: [],
  timeSpent: [],
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
})

test('updateIssue rejects In review and Done while a direct child is open', () => {
  const sqlite = migratedDatabase()
  const store = createSqliteIssueStore(sqlite)
  const parent = store.createIssue({
    id: 'parent',
    title: 'Add auth',
    createdBy: ada,
    createdAt: 1,
  })
  store.createIssue({
    id: 'child',
    title: 'Login UI',
    parentId: parent.id,
    status: 'in_progress',
    createdBy: ada,
    createdAt: 2,
  })

  expect(() =>
    store.updateIssue(parent.id, { status: 'in_review' }, 3),
  ).toThrow(
    'Cannot set In review or Done while a direct child is not In review or Done',
  )
  expect(() =>
    store.updateIssue(parent.id, { status: 'done' }, 4),
  ).toThrow(
    'Cannot set In review or Done while a direct child is not In review or Done',
  )
  expect(store.updateIssue(parent.id, { title: 'Auth' }, 5).title).toBe('Auth')
  expect(store.getIssue(parent.id)?.status).toBe('backlog')

  store.updateIssue('child', { status: 'in_review' }, 6)
  expect(store.updateIssue(parent.id, { status: 'in_review' }, 7).status).toBe(
    'in_review',
  )
  sqlite.close()
})

test('buildIssueRunTask tells the agent to set In review or Done', () => {
  const task = buildIssueRunTask(taskIssue())
  expect(task).toContain('set this Issue to In review or Done')
  expect(task).toContain('Colony does not change status when the run succeeds')
  expect(task).not.toContain('This run is to integrate direct children')
})

test('buildIssueRunTask tells a parent not to settle while a direct child is open', () => {
  const task = buildIssueRunTask(taskIssue(), undefined, [
    taskIssue({
      id: 'child-ui',
      number: 2,
      title: 'Login UI',
      status: 'in_progress',
    }),
  ])
  expect(task).toContain(
    'You cannot set this Issue to In review or Done until every direct child is In review or Done',
  )
  expect(task).toContain(
    'You may create further child Issues and assign them',
  )
  expect(task).not.toContain('This run is to integrate direct children')
  expect(task).not.toContain('When this work is ready, set this Issue to In review or Done')
})

test('buildIssueRunTask is an integrate run when direct children are settled', () => {
  const task = buildIssueRunTask(taskIssue(), undefined, [
    taskIssue({
      id: 'child-ui',
      number: 2,
      title: 'Login UI',
      status: 'in_review',
      deliverable: 'UI shipped.',
    }),
    taskIssue({
      id: 'child-api',
      number: 3,
      title: 'Session API',
      status: 'done',
      deliverable: 'API shipped.',
    }),
  ])
  expect(task).toContain('This run is to integrate direct children')
  expect(task).toContain('UI shipped.')
  expect(task).toContain('API shipped.')
  expect(task).toContain(
    'You may create further child Issues and assign them',
  )
  expect(task).toContain(
    'You cannot set this Issue to In review or Done until every direct child is In review or Done',
  )
  expect(task).toContain('Colony does not change status when the run succeeds')
})
