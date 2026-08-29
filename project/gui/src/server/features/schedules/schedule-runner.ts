import type { RunControl, RunSummary } from '#/server/features/runs/run-control'
import { runStep } from '#/server/features/runs/run-storage'
import {
  type NewScheduleRun,
  type Schedule,
  type ScheduleRun,
  type ScheduleRunStep,
  type ScheduleStore,
} from './schedule-store'

export class ScheduleActiveRunError extends Error {
  constructor() {
    super('A schedule run is already active')
    this.name = 'ScheduleActiveRunError'
  }
}

export type ScheduleRunner = {
  runNow(scheduleId: string, accountId: string): ScheduleRun
  tick(): void
  cancel(runId: string): Promise<ScheduleRun | undefined>
  failStaleRuns(): ScheduleRun[]
  stop(): void
}

export function createScheduleRunner(options: {
  store: ScheduleStore
  control: RunControl
  now?: () => number
  onScheduleChange?: (schedule: Schedule) => void
  onRunCreated?: (run: ScheduleRun) => void
  onRunChange?: (run: ScheduleRun) => void
  onStep?: (step: ScheduleRunStep) => void
}): ScheduleRunner {
  const now = options.now ?? Date.now
  const project = (summary: RunSummary): void => {
    const existing = options.store.getRun(summary.id)
    if (!existing) return
    const changed = { ...existing, ...summary }
    options.store.updateRun(changed)
    options.onRunChange?.(changed)
    if (
      changed.state === 'succeeded' ||
      changed.state === 'failed' ||
      changed.state === 'cancelled'
    )
      tick()
  }
  const unsubscribe = options.control.subscribe(project)
  const unsubscribeSteps = options.control.subscribeSteps((runId, step) => {
    const run = options.store.getRun(runId)
    if (!run) return
    const stored = runStep(runId, options.store.listSteps(runId).length, step)
    options.store.appendStep(stored)
    options.onStep?.(stored)
  })

  const start = (
    schedule: Schedule,
    source: 'automatic' | 'manual',
    accountId?: string,
  ): ScheduleRun | undefined => {
    const scheduledFor = source === 'automatic' ? schedule.nextRunAt : undefined
    try {
      return options.control.start(schedule.task, {
        scheduleId: schedule.id,
        agentDefinitionId: schedule.agentDefinitionId,
        responsibleAccountId: accountId ?? schedule.createdBy.id,
        onCreate: (summary) => {
          const input: NewScheduleRun = {
            ...summary,
            scheduleId: schedule.id,
            source,
            ...(scheduledFor === undefined ? {} : { scheduledFor }),
            ...(accountId === undefined ? {} : { startedBy: accountId }),
          }
          const created = options.store.createRun(input, now())
          if (!created) throw new ScheduleActiveRunError()
          options.onRunCreated?.(created)
          if (source === 'automatic') {
            const changed = options.store.getSchedule(schedule.id)
            if (changed) options.onScheduleChange?.(changed)
          }
          return created
        },
      })
    } catch (error) {
      if (error instanceof ScheduleActiveRunError) return undefined
      const failed = options.store.recordStartFailure({
        scheduleId: schedule.id,
        source,
        ...(accountId === undefined ? {} : { startedBy: accountId }),
        ...(scheduledFor === undefined ? {} : { scheduledFor }),
        task: schedule.task,
        agentId: schedule.agentDefinitionId,
        error: error instanceof Error ? error.message : 'Unable to start agent',
        now: now(),
      })
      options.onRunChange?.(failed)
      if (source === 'automatic') {
        const changed = options.store.getSchedule(schedule.id)
        if (changed) options.onScheduleChange?.(changed)
      }
      return failed
    }
  }

  const runNow = (scheduleId: string, accountId: string): ScheduleRun => {
    const schedule = options.store.getSchedule(scheduleId)
    if (!schedule) throw new Error('Schedule not found')
    const run = start(schedule, 'manual', accountId)
    if (!run) throw new ScheduleActiveRunError()
    return run
  }
  const tick = (): void => {
    const current = now()
    for (const schedule of options.store.listDueSchedules(current))
      start(schedule, 'automatic')
  }

  return {
    runNow,
    tick,
    cancel: async (runId) => {
      const run = await options.control.cancel(runId)
      return run ? options.store.getRun(run.id) : undefined
    },
    failStaleRuns: () => {
      const runs = options.store.failStaleRuns(now())
      for (const run of runs) options.onRunChange?.(run)
      return runs
    },
    stop: () => {
      unsubscribe()
      unsubscribeSteps()
    },
  }
}
