import { expect, test } from 'bun:test'
import { createScheduleRunner, ScheduleActiveRunError } from './schedule-runner'
import type { RunControl, RunSummary } from '#/server/features/runs/run-control'
import type { Schedule, ScheduleRun, ScheduleStore } from './schedule-store'

const schedule: Schedule = {
  id: 'schedule-1',
  name: 'Repo check',
  agentDefinitionId: 'software-engineer',
  task: 'Check the repo',
  cronExpression: '* * * * *',
  timezone: 'Europe/Copenhagen',
  state: 'active',
  createdBy: { id: 'ada', name: 'Ada' },
  createdAt: 1,
  updatedAt: 1,
  nextRunAt: 10,
}

function makeStore(): ScheduleStore {
  let current = { ...schedule }
  const runs = new Map<string, ScheduleRun>()
  const steps = new Map<string, never[]>()
  return {
    listSchedules: () => [current],
    getSchedule: (id) => (id === current.id ? current : undefined),
    createSchedule: () => current,
    updateSchedule: () => current,
    listDueSchedules: (now) =>
      current.nextRunAt !== undefined && current.nextRunAt <= now
        ? [current]
        : [],
    pauseActiveForAgent: () => undefined,
    createRun: (run, now) => {
      if (
        [...runs.values()].some(
          (item) =>
            item.scheduleId === run.scheduleId &&
            ['preparing', 'running'].includes(item.state),
        )
      )
        return undefined
      const created = {
        ...run,
        ...(run.startedBy
          ? { startedBy: { id: run.startedBy, name: run.startedBy } }
          : {}),
      } as ScheduleRun
      runs.set(created.id, created)
      if (run.source === 'automatic')
        current = { ...current, nextRunAt: now + 60_000 }
      return created
    },
    recordStartFailure: () => {
      throw new Error('unused')
    },
    getRun: (id) => runs.get(id),
    updateRun: (run) => {
      runs.set(run.id, run)
    },
    listRuns: () => ({ runs: [...runs.values()] }),
    appendStep: () => undefined,
    listSteps: (id) => steps.get(id) ?? [],
    failStaleRuns: () => [],
  }
}

function fakeControl() {
  const listeners = new Set<(run: RunSummary) => void>()
  let nextId = 0
  const control: RunControl = {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    subscribeSteps: () => () => undefined,
    getRun: () => undefined,
    start: (task, context) => {
      const run = {
        id: `run-${++nextId}`,
        task,
        agentId: 'software-engineer',
        provider: 'openai' as const,
        model: 'gpt-4.1-mini',
        state: 'preparing' as const,
        createdAt: 10,
        stdout: '',
        stderr: '',
      }
      const created = context.onCreate(run)
      for (const listener of listeners) listener(run)
      return created
    },
    cancel: async () => undefined,
    followUp: async () => undefined,
    stop: async () => undefined,
  }
  return {
    control,
    finish(id: string) {
      for (const listener of listeners)
        listener({
          id,
          task: 'Check the repo',
          agentId: 'software-engineer',
          provider: 'openai',
          model: 'gpt-4.1-mini',
          state: 'succeeded',
          createdAt: 10,
          completedAt: 20,
          stdout: '',
          stderr: '',
        })
    },
  }
}

test('runner starts due work, coalesces behind an active run, and supports manual conflicts', () => {
  const store = makeStore()
  const fake = fakeControl()
  const runner = createScheduleRunner({
    store,
    control: fake.control,
    now: () => 20,
  })
  runner.tick()
  expect(store.getRun('run-1')).toMatchObject({
    source: 'automatic',
    scheduledFor: 10,
  })
  expect(() => runner.runNow(schedule.id, 'ada')).toThrow(
    ScheduleActiveRunError,
  )
  fake.finish('run-1')
  expect(runner.runNow(schedule.id, 'ada')).toMatchObject({
    source: 'manual',
    startedBy: { id: 'ada' },
  })
  runner.stop()
})
