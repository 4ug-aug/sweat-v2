import { expect, test } from 'bun:test'
import {
  createOneshotSession,
  OneshotActiveRunError,
} from './oneshot-session'
import { createOneshotsHttp } from './oneshots-http'
import type { RunControl, RunSummary } from '#/server/features/runs/run-control'
import type { WorkspaceAgentStartRunRequest } from '#project/agents/roster'

const baseSummary = (overrides: Partial<RunSummary> = {}): RunSummary => ({
  id: 'run-1',
  task: 'do the thing',
  state: 'preparing',
  createdAt: 1,
  stdout: '',
  stderr: '',
  agentId: 'antboy',
  provider: 'openai',
  model: 'm',
  ...overrides,
})

function fakeControl(
  capture?: (request: WorkspaceAgentStartRunRequest) => void,
): RunControl {
  const listeners = new Set<(run: RunSummary) => void>()
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    subscribeSteps: () => () => {},
    getRun: () => undefined,
    start: (task, context) => {
      capture?.({
        task,
        agentDefinitionId: context.agentDefinitionId ?? 'software-engineer',
        grantContext:
          'oneshotId' in context
            ? {
                oneshotId: context.oneshotId,
                agentDefinitionId: context.agentDefinitionId,
                ...('repositoryBase' in context && context.repositoryBase
                  ? { repositoryBase: context.repositoryBase }
                  : {}),
              }
            : {},
      } as WorkspaceAgentStartRunRequest)
      return context.onCreate(
        baseSummary({
          task,
          agentId: context.agentDefinitionId ?? 'software-engineer',
        }),
      )
    },
    followUp: async () => undefined,
    cancel: async (runId) =>
      baseSummary({ id: runId, state: 'cancelled', completedAt: 2 }),
    stop: async () => {},
  }
}

test('oneshot session starts with oneshot grant context', () => {
  let request: WorkspaceAgentStartRunRequest | undefined
  const session = createOneshotSession({
    control: fakeControl((value) => {
      request = value
    }),
  })
  const run = session.start({
    accountId: 'user-1',
    task: 'create an Issue',
    agentDefinitionId: 'antboy',
    repositoryBase: 'main',
  })
  expect(run.accountId).toBe('user-1')
  expect(run.oneshotId).toBeTruthy()
  expect(request?.grantContext).toMatchObject({
    oneshotId: run.oneshotId,
    agentDefinitionId: 'antboy',
    repositoryBase: 'main',
  })
})

test('oneshot session rejects second active run', () => {
  const session = createOneshotSession({ control: fakeControl() })
  session.start({
    accountId: 'user-1',
    task: 'first',
    agentDefinitionId: 'antboy',
  })
  expect(() =>
    session.start({
      accountId: 'user-1',
      task: 'second',
      agentDefinitionId: 'antboy',
    }),
  ).toThrow(OneshotActiveRunError)
})

test('oneshot session activeForAccount and discard clear the slot', async () => {
  const session = createOneshotSession({ control: fakeControl() })
  const run = session.start({
    accountId: 'user-1',
    task: 'first',
    agentDefinitionId: 'antboy',
  })
  expect(session.activeForAccount('user-1')?.id).toBe(run.id)
  expect(session.activeForAccount('user-2')).toBeUndefined()
  await session.discard(run.id, 'user-1')
  expect(session.activeForAccount('user-1')).toBeUndefined()
  expect(session.get(run.id, 'user-1')).toBeUndefined()
})

test('oneshots HTTP starts, reads privately, exposes active, and discards', async () => {
  const session = createOneshotSession({ control: fakeControl() })
  const http = createOneshotsHttp({
    oneshotSession: session,
    agentDefinitions: () => [
      {
        id: 'antboy',
        name: 'Antboy',
        description: '',
        icon: 'bot',
        includeRepository: false,
        capabilities: [],
        skills: [],
      },
      {
        id: 'software-engineer',
        name: 'Software engineer',
        description: '',
        icon: 'bot',
        includeRepository: true,
        capabilities: [],
        skills: [],
      },
    ],
  })
  const user = { id: 'user-1', name: 'Ada' }
  const other = { id: 'user-2', name: 'Bob' }

  const started = await http(
    new Request('http://localhost/api/oneshots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        task: 'find the on-call',
        agentDefinitionId: 'antboy',
      }),
    }),
    new URL('http://localhost/api/oneshots'),
    user,
  )
  expect(started?.status).toBe(202)
  const body = (await started!.json()) as { run: { id: string } }
  const runId = body.run.id

  const active = await http(
    new Request('http://localhost/api/oneshots/active'),
    new URL('http://localhost/api/oneshots/active'),
    user,
  )
  expect(active?.status).toBe(200)
  expect(((await active!.json()) as { run: { id: string } }).run.id).toBe(
    runId,
  )

  const denied = await http(
    new Request(`http://localhost/api/oneshots/${runId}`),
    new URL(`http://localhost/api/oneshots/${runId}`),
    other,
  )
  expect(denied?.status).toBe(404)

  const got = await http(
    new Request(`http://localhost/api/oneshots/${runId}`),
    new URL(`http://localhost/api/oneshots/${runId}`),
    user,
  )
  expect(got?.status).toBe(200)

  const discarded = await http(
    new Request(`http://localhost/api/oneshots/${runId}`, {
      method: 'DELETE',
    }),
    new URL(`http://localhost/api/oneshots/${runId}`),
    user,
  )
  expect(discarded?.status).toBe(200)
  const discardedAgain = await http(
    new Request(`http://localhost/api/oneshots/${runId}`, {
      method: 'DELETE',
    }),
    new URL(`http://localhost/api/oneshots/${runId}`),
    user,
  )
  expect(discardedAgain?.status).toBe(200)
  expect(session.get(runId, user.id)).toBeUndefined()
  expect(session.activeForAccount(user.id)).toBeUndefined()
})

test('oneshots HTTP rejects revision for non-repository agents', async () => {
  const session = createOneshotSession({ control: fakeControl() })
  const http = createOneshotsHttp({
    oneshotSession: session,
    agentDefinitions: () => [
      {
        id: 'antboy',
        name: 'Antboy',
        description: '',
        icon: 'bot',
        includeRepository: false,
        capabilities: [],
        skills: [],
      },
    ],
  })
  const response = await http(
    new Request('http://localhost/api/oneshots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        task: 'look something up',
        agentDefinitionId: 'antboy',
        repositoryBase: 'main',
      }),
    }),
    new URL('http://localhost/api/oneshots'),
    { id: 'user-1', name: 'Ada' },
  )
  expect(response?.status).toBe(400)
})

test('oneshots HTTP returns 409 while an active run exists', async () => {
  const session = createOneshotSession({ control: fakeControl() })
  const http = createOneshotsHttp({
    oneshotSession: session,
    agentDefinitions: () => [
      {
        id: 'antboy',
        name: 'Antboy',
        description: '',
        icon: 'bot',
        includeRepository: false,
        capabilities: [],
        skills: [],
      },
    ],
  })
  const user = { id: 'user-1', name: 'Ada' }
  const first = await http(
    new Request('http://localhost/api/oneshots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        task: 'first',
        agentDefinitionId: 'antboy',
      }),
    }),
    new URL('http://localhost/api/oneshots'),
    user,
  )
  expect(first?.status).toBe(202)
  const second = await http(
    new Request('http://localhost/api/oneshots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        task: 'second',
        agentDefinitionId: 'antboy',
      }),
    }),
    new URL('http://localhost/api/oneshots'),
    user,
  )
  expect(second?.status).toBe(409)
})
