import { expect, test } from 'bun:test'
import { createRunControl, overlayLivePreparation } from './run-control'
import type {
  WorkspaceAgentExecutor,
  WorkspaceAgentStartRunRequest,
} from '#project/agents/roster'

function captureExecutor(
  capture: (request: WorkspaceAgentStartRunRequest) => void,
): WorkspaceAgentExecutor {
  return {
    startRun: (request) => {
      capture(request)
      request.onCreate?.({
        id: 'run-1',
        task: request.task,
        definition: {
          id: 'software-engineer',
          instructions: '',
          requestedCapabilities: [],
          runtime: {
            kind: 'cursor',
            image: 'cursor:latest',
            cursor: { apiKey: 'k', model: 'm' },
          },
          executionPolicy: {
            maxDurationMs: 1,
            maxOutputBytes: 1,
            maxSteps: 1,
          },
        },
        state: 'preparing',
        createdAt: 0,
        stdout: '',
        stderr: '',
        inputs: [],
        effectiveLimits: {
          maxDurationMs: 1,
          maxOutputBytes: 1,
          maxSteps: 1,
        },
      })
      return 'run-1'
    },
    getRun: () => undefined,
    listRuns: () => [],
    subscribe: () => () => {},
    subscribeSteps: () => () => {},
    followUp: async () => undefined,
    cancelRun: async () => undefined,
    stop: async () => undefined,
  }
}

test('passes room context and attachment descriptors without assembling inputs', () => {
  let request: WorkspaceAgentStartRunRequest | undefined
  const control = createRunControl(
    captureExecutor((value) => {
      request = value
    }),
  )

  const attachments = [
    {
      type: 'attachment' as const,
      id: 'attachment-1',
      roomId: 'room-1',
      filename: 'brief.txt',
      byteSize: 6,
      sha256: 'a'.repeat(64),
    },
  ]
  control.start('summarize ORI-198', {
    roomId: 'room-1',
    attachments,
    onCreate: () => true,
  })

  expect(request?.task).toBe('summarize ORI-198')
  expect(request?.agentDefinitionId).toBe('software-engineer')
  expect(request?.grantContext).toEqual({
    roomId: 'room-1',
    agentDefinitionId: 'software-engineer',
  })
  expect(request?.attachments).toEqual(attachments)
})

test('passes the invocation rootId for a top-level Room-linked run into the grant context', () => {
  let request: WorkspaceAgentStartRunRequest | undefined
  const control = createRunControl(
    captureExecutor((value) => {
      request = value
    }),
  )

  control.start('fix the flaky test', {
    roomId: 'room-1',
    rootId: 'trigger-message-1',
    onCreate: () => true,
  })

  expect(request?.grantContext).toEqual({
    roomId: 'room-1',
    rootId: 'trigger-message-1',
    agentDefinitionId: 'software-engineer',
  })
})

test('passes threadReadRootId for an in-thread Room-linked run into the grant context', () => {
  let request: WorkspaceAgentStartRunRequest | undefined
  const control = createRunControl(
    captureExecutor((value) => {
      request = value
    }),
  )

  control.start('fix it in-thread', {
    roomId: 'room-1',
    rootId: 'thread-root-1',
    threadReadRootId: 'thread-root-1',
    onCreate: () => true,
  })

  expect(request?.grantContext).toEqual({
    roomId: 'room-1',
    rootId: 'thread-root-1',
    threadReadRootId: 'thread-root-1',
    agentDefinitionId: 'software-engineer',
  })
})

test('omits rootId from the grant context when the room-linked run has none', () => {
  let request: WorkspaceAgentStartRunRequest | undefined
  const control = createRunControl(
    captureExecutor((value) => {
      request = value
    }),
  )

  control.start('summarize the room', {
    roomId: 'room-1',
    responsibleAccountId: 'ada',
    onCreate: () => true,
  })

  expect(request?.grantContext).toEqual({
    roomId: 'room-1',
    agentDefinitionId: 'software-engineer',
    responsibleAccountId: 'ada',
  })
})

test('passes oneshot context and optional repositoryBase', () => {
  let request: WorkspaceAgentStartRunRequest | undefined
  const control = createRunControl(
    captureExecutor((value) => {
      request = value
    }),
  )

  control.start('create an Issue for the login bug', {
    oneshotId: 'oneshot-1',
    agentDefinitionId: 'antboy',
    repositoryBase: 'feat/login',
    onCreate: () => true,
  })

  expect(request?.grantContext).toEqual({
    oneshotId: 'oneshot-1',
    agentDefinitionId: 'antboy',
    repositoryBase: 'feat/login',
  })
})

test('passes chat context and starts the run warm', () => {
  let request: WorkspaceAgentStartRunRequest | undefined
  const control = createRunControl(
    captureExecutor((value) => {
      request = value
    }),
  )

  control.start('what is on call?', {
    chatId: 'chat-1',
    agentDefinitionId: 'antboy',
    idleTtlMs: 60_000,
    onCreate: () => true,
  })

  expect(request?.grantContext).toEqual({
    chatId: 'chat-1',
    agentDefinitionId: 'antboy',
  })
  expect(request?.warm).toBe(true)
  expect(request?.idleTtlMs).toBe(60_000)
})

test('passes Issue mergeRevisions on grantContext', () => {
  let request: WorkspaceAgentStartRunRequest | undefined
  const control = createRunControl(
    captureExecutor((value) => {
      request = value
    }),
  )

  control.start('integrate children', {
    issueId: 'issue-1',
    repositoryBase: 'sweat/issue/COL-1',
    mergeRevisions: ['sweat/run-ui', 'sweat/run-api'],
    onCreate: () => true,
  })

  expect(request?.grantContext).toEqual({
    issueId: 'issue-1',
    agentDefinitionId: 'software-engineer',
    repositoryBase: 'sweat/issue/COL-1',
    mergeRevisions: ['sweat/run-ui', 'sweat/run-api'],
  })
})

test('overlayLivePreparation copies waiting on, preparation, and sandbox id from the live run', () => {
  expect(
    overlayLivePreparation(
      { id: 'run-1', state: 'preparing' },
      {
        waitingOn: 'Creating sandbox',
        preparation: ['Prepared workspace'],
        sandboxId: 'sandbox-1',
      },
    ),
  ).toEqual({
    id: 'run-1',
    state: 'preparing',
    waitingOn: 'Creating sandbox',
    preparation: ['Prepared workspace'],
    sandboxId: 'sandbox-1',
  })
  expect(
    overlayLivePreparation({ id: 'run-1', state: 'running' }, undefined),
  ).toEqual({ id: 'run-1', state: 'running' })
})
