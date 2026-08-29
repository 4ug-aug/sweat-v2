import { previewCron } from '#/features/schedules/cron'
import type { RunState } from '#project/runs'
import type { Sqlite } from '#/server/sqlite'
import {
  createRunStepStore,
  failStaleRuns,
  type RunStep,
} from '#/server/features/runs/run-storage'

export type ScheduleState = 'active' | 'paused' | 'archived'
export type ScheduleSource = 'automatic' | 'manual'
export type ScheduleActor = { id: string; name: string; image?: string }
export type Schedule = {
  id: string
  name: string
  agentDefinitionId: string
  task: string
  cronExpression: string
  timezone: string
  state: ScheduleState
  createdBy: ScheduleActor
  createdAt: number
  updatedAt: number
  nextRunAt?: number
}
export type ScheduleRun = {
  id: string
  scheduleId: string
  source: ScheduleSource
  scheduledFor?: number
  startedBy?: ScheduleActor
  task: string
  agentId: string
  provider: 'openai' | 'custom' | 'cursor'
  model: string
  state: RunState
  createdAt: number
  startedAt?: number
  completedAt?: number
  exitCode?: number
  error?: string
  stdout: string
  stderr: string
}
export type { RunStep as ScheduleRunStep } from '#/server/features/runs/run-storage'

export type NewSchedule = Omit<
  Schedule,
  'createdBy' | 'createdAt' | 'updatedAt' | 'nextRunAt'
> & { createdBy: string; createdAt: number; nextRunAt: number }

export type NewScheduleRun = Omit<ScheduleRun, 'startedBy'> & {
  startedBy?: string
}

export interface ScheduleStore {
  listSchedules(includeArchived?: boolean): Schedule[]
  getSchedule(id: string): Schedule | undefined
  createSchedule(schedule: NewSchedule): Schedule
  updateSchedule(
    id: string,
    patch: Partial<
      Pick<
        Schedule,
        | 'name'
        | 'task'
        | 'agentDefinitionId'
        | 'cronExpression'
        | 'timezone'
        | 'state'
      >
    > & { nextRunAt?: number },
    now: number,
  ): Schedule
  listDueSchedules(now: number): Schedule[]
  pauseActiveForAgent(agentDefinitionId: string, now: number): void
  createRun(run: NewScheduleRun, now: number): ScheduleRun | undefined
  recordStartFailure(input: {
    scheduleId: string
    source: ScheduleSource
    startedBy?: string
    scheduledFor?: number
    task: string
    agentId: string
    error: string
    now: number
  }): ScheduleRun
  getRun(id: string): ScheduleRun | undefined
  updateRun(run: ScheduleRun): void
  listRuns(
    scheduleId: string,
    options: { limit: number; cursor?: string },
  ): { runs: ScheduleRun[]; nextCursor?: string }
  appendStep(step: RunStep): void
  listSteps(runId: string): RunStep[]
  failStaleRuns(now: number): ScheduleRun[]
}

type ScheduleRow = {
  id: string
  name: string
  agent_definition_id: string
  task: string
  cron_expression: string
  timezone: string
  state: ScheduleState
  created_by: string
  created_name: string
  created_image: string | null
  created_at: number
  updated_at: number
  next_run_at: number | null
}
type ScheduleRunRow = {
  id: string
  schedule_id: string
  source: ScheduleSource
  scheduled_for: number | null
  started_by: string | null
  started_name: string | null
  started_image: string | null
  task: string
  agent_id: string
  provider: 'openai' | 'custom' | 'cursor'
  model: string
  state: RunState
  created_at: number
  started_at: number | null
  completed_at: number | null
  exit_code: number | null
  error: string | null
  stdout: string
  stderr: string
}
const transaction = <T>(sqlite: Sqlite, work: () => T): T => {
  sqlite.prepare('BEGIN').run()
  try {
    const result = work()
    sqlite.prepare('COMMIT').run()
    return result
  } catch (error) {
    sqlite.prepare('ROLLBACK').run()
    throw error
  }
}

const actor = (
  id: string,
  name: string,
  image: string | null,
): ScheduleActor => (image ? { id, name, image } : { id, name })

const scheduleFrom = (row: ScheduleRow): Schedule => ({
  id: row.id,
  name: row.name,
  agentDefinitionId: row.agent_definition_id,
  task: row.task,
  cronExpression: row.cron_expression,
  timezone: row.timezone,
  state: row.state,
  createdBy: actor(row.created_by, row.created_name, row.created_image),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.next_run_at === null ? {} : { nextRunAt: row.next_run_at }),
})

const runFrom = (row: ScheduleRunRow): ScheduleRun => ({
  id: row.id,
  scheduleId: row.schedule_id,
  source: row.source,
  ...(row.scheduled_for === null ? {} : { scheduledFor: row.scheduled_for }),
  ...(row.started_by && row.started_name
    ? { startedBy: actor(row.started_by, row.started_name, row.started_image) }
    : {}),
  task: row.task,
  agentId: row.agent_id,
  provider: row.provider,
  model: row.model,
  state: row.state,
  createdAt: row.created_at,
  ...(row.started_at === null ? {} : { startedAt: row.started_at }),
  ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
  ...(row.exit_code === null ? {} : { exitCode: row.exit_code }),
  ...(row.error === null ? {} : { error: row.error }),
  stdout: row.stdout,
  stderr: row.stderr,
})

const selectSchedule = (sqlite: Sqlite, where = '', ...values: unknown[]) =>
  (
    sqlite
      .prepare(
        `SELECT s.*, c.name AS created_name, c.image AS created_image
         FROM schedule s JOIN user c ON c.id = s.created_by ${where}
         ORDER BY s.created_at, s.id`,
      )
      .all(...values) as ScheduleRow[]
  ).map(scheduleFrom)

const selectRun = (sqlite: Sqlite, where = '', ...values: unknown[]) =>
  (
    sqlite
      .prepare(
        `SELECT r.*, u.name AS started_name, u.image AS started_image
         FROM schedule_run r LEFT JOIN user u ON u.id = r.started_by ${where}
         ORDER BY r.created_at, r.id`,
      )
      .all(...values) as ScheduleRunRow[]
  ).map(runFrom)

function nextRun(schedule: Schedule, from: number): number {
  const next = previewCron(schedule.cronExpression, schedule.timezone, from)
    .nextRuns[0]
  if (next === undefined) throw new Error('Schedule has no future occurrence')
  return next
}

export function createSqliteScheduleStore(sqlite: Sqlite): ScheduleStore {
  const activeWhere = "WHERE s.state != 'archived'"
  return {
    ...createRunStepStore(sqlite, 'schedule_run_step'),
    listSchedules: (includeArchived = false) =>
      selectSchedule(sqlite, includeArchived ? '' : activeWhere),
    getSchedule: (id) => selectSchedule(sqlite, 'WHERE s.id = ?', id)[0],
    createSchedule: (schedule) => {
      sqlite
        .prepare(
          `INSERT INTO schedule (id, name, agent_definition_id, task, cron_expression, timezone, state, created_by, created_at, updated_at, next_run_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          schedule.id,
          schedule.name,
          schedule.agentDefinitionId,
          schedule.task,
          schedule.cronExpression,
          schedule.timezone,
          schedule.state,
          schedule.createdBy,
          schedule.createdAt,
          schedule.createdAt,
          schedule.nextRunAt,
        )
      const created = selectSchedule(sqlite, 'WHERE s.id = ?', schedule.id)[0]
      if (!created) throw new Error('Schedule was not created')
      return created
    },
    updateSchedule: (id, patch, now) => {
      const current = selectSchedule(sqlite, 'WHERE s.id = ?', id)[0]
      if (!current) throw new Error('Schedule not found')
      const nextState = patch.state ?? current.state
      if (current.state === 'archived' && nextState === 'active')
        throw new Error('Archived schedules must be restored paused')
      if (current.state === 'active' && nextState === 'archived') {
        // Archiving prevents future automatic claims but never changes a run.
      }
      const expression = patch.cronExpression ?? current.cronExpression
      const timezone = patch.timezone ?? current.timezone
      const changedSchedule =
        patch.cronExpression !== undefined || patch.timezone !== undefined
      const nextRunAt =
        patch.nextRunAt ??
        (changedSchedule ||
        (current.state !== 'active' && nextState === 'active')
          ? nextRun({ ...current, cronExpression: expression, timezone }, now)
          : (current.nextRunAt ?? null))
      sqlite
        .prepare(
          `UPDATE schedule SET name = ?, task = ?, agent_definition_id = ?, cron_expression = ?, timezone = ?, state = ?, updated_at = ?, next_run_at = ? WHERE id = ?`,
        )
        .run(
          patch.name ?? current.name,
          patch.task ?? current.task,
          patch.agentDefinitionId ?? current.agentDefinitionId,
          expression,
          timezone,
          nextState,
          now,
          nextState === 'active' ? nextRunAt : nextRunAt,
          id,
        )
      const updated = selectSchedule(sqlite, 'WHERE s.id = ?', id)[0]
      if (!updated) throw new Error('Schedule was not updated')
      return updated
    },
    listDueSchedules: (now) =>
      selectSchedule(
        sqlite,
        "WHERE s.state = 'active' AND s.next_run_at IS NOT NULL AND s.next_run_at <= ?",
        now,
      ),
    pauseActiveForAgent: (agentDefinitionId, now) => {
      sqlite
        .prepare(
          `UPDATE schedule SET state = 'paused', updated_at = ? WHERE agent_definition_id = ? AND state = 'active'`,
        )
        .run(now, agentDefinitionId)
    },
    createRun: (run, now) => {
      try {
        return transaction(sqlite, () => {
          const schedule = selectSchedule(
            sqlite,
            'WHERE s.id = ?',
            run.scheduleId,
          )[0]
          if (!schedule) return undefined
          if (run.source === 'automatic') {
            if (
              schedule.state !== 'active' ||
              schedule.nextRunAt === undefined ||
              schedule.nextRunAt > now
            )
              return undefined
          } else if (schedule.state === 'archived') return undefined
          const result = sqlite
            .prepare(
              `INSERT INTO schedule_run (id, schedule_id, source, scheduled_for, started_by, task, agent_id, provider, model, state, created_at, started_at, completed_at, exit_code, error, stdout, stderr)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              run.id,
              run.scheduleId,
              run.source,
              run.scheduledFor ?? null,
              run.startedBy ?? null,
              run.task,
              run.agentId,
              run.provider,
              run.model,
              run.state,
              run.createdAt,
              run.startedAt ?? null,
              run.completedAt ?? null,
              run.exitCode ?? null,
              run.error ?? null,
              run.stdout,
              run.stderr,
            ) as { changes?: number }
          if (result.changes !== 1) return undefined
          if (run.source === 'automatic')
            sqlite
              .prepare(
                'UPDATE schedule SET next_run_at = ?, updated_at = ? WHERE id = ?',
              )
              .run(nextRun(schedule, now), now, schedule.id)
          return selectRun(sqlite, 'WHERE r.id = ?', run.id)[0]
        })
      } catch (error) {
        if (
          String(error).includes('schedule_one_active_run_idx') ||
          String(error).includes('schedule_run.schedule_id')
        )
          return undefined
        throw error
      }
    },
    recordStartFailure: (input) => {
      const schedule = selectSchedule(
        sqlite,
        'WHERE s.id = ?',
        input.scheduleId,
      )[0]
      if (!schedule) throw new Error('Schedule not found')
      const run: NewScheduleRun = {
        id: crypto.randomUUID(),
        scheduleId: input.scheduleId,
        source: input.source,
        ...(input.scheduledFor === undefined
          ? {}
          : { scheduledFor: input.scheduledFor }),
        ...(input.startedBy === undefined
          ? {}
          : { startedBy: input.startedBy }),
        task: input.task,
        agentId: input.agentId,
        provider: 'openai',
        model: '',
        state: 'failed',
        createdAt: input.now,
        completedAt: input.now,
        error: input.error,
        stdout: '',
        stderr: '',
      }
      const created = transaction(sqlite, () => {
        sqlite
          .prepare(
            `INSERT INTO schedule_run (id, schedule_id, source, scheduled_for, started_by, task, agent_id, provider, state, created_at, completed_at, error, stdout, stderr)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?, ?, '', '')`,
          )
          .run(
            run.id,
            run.scheduleId,
            run.source,
            run.scheduledFor ?? null,
            run.startedBy ?? null,
            run.task,
            run.agentId,
            run.provider,
            run.createdAt,
            run.completedAt,
            run.error,
          )
        if (input.source === 'automatic')
          sqlite
            .prepare(
              'UPDATE schedule SET next_run_at = ?, updated_at = ? WHERE id = ?',
            )
            .run(nextRun(schedule, input.now), input.now, input.scheduleId)
        return selectRun(sqlite, 'WHERE r.id = ?', run.id)[0]!
      })
      return created
    },
    getRun: (id) => selectRun(sqlite, 'WHERE r.id = ?', id)[0],
    updateRun: (run) => {
      sqlite
        .prepare(
          `UPDATE schedule_run SET state = ?, started_at = ?, completed_at = ?, exit_code = ?, error = ?, stdout = ?, stderr = ? WHERE id = ?`,
        )
        .run(
          run.state,
          run.startedAt ?? null,
          run.completedAt ?? null,
          run.exitCode ?? null,
          run.error ?? null,
          run.stdout,
          run.stderr,
          run.id,
        )
    },
    listRuns: (scheduleId, options) => {
      const limit = Math.max(1, Math.min(100, Math.floor(options.limit)))
      let cursor: { createdAt: number; id: string } | undefined
      if (options.cursor) {
        try {
          cursor = JSON.parse(
            Buffer.from(options.cursor, 'base64url').toString(),
          ) as typeof cursor
        } catch {
          throw new Error('Invalid schedule history cursor')
        }
      }
      const where = cursor
        ? 'WHERE r.schedule_id = ? AND (r.created_at < ? OR (r.created_at = ? AND r.id < ?))'
        : 'WHERE r.schedule_id = ?'
      const values = cursor
        ? [scheduleId, cursor.createdAt, cursor.createdAt, cursor.id]
        : [scheduleId]
      const runs = (
        sqlite
          .prepare(
            `SELECT r.*, u.name AS started_name, u.image AS started_image
             FROM schedule_run r LEFT JOIN user u ON u.id = r.started_by
             ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ${limit + 1}`,
          )
          .all(...values) as ScheduleRunRow[]
      ).map(runFrom)
      const page = runs.slice(0, limit).reverse()
      return {
        runs: page,
        ...(runs.length > limit && page[0]
          ? {
              nextCursor: Buffer.from(
                JSON.stringify({
                  createdAt: page[0].createdAt,
                  id: page[0].id,
                }),
              ).toString('base64url'),
            }
          : {}),
      }
    },
    failStaleRuns: (now) =>
      failStaleRuns(sqlite, 'schedule_run', now).flatMap((id) => {
        const run = selectRun(sqlite, 'WHERE r.id = ?', id)[0]
        return run ? [run] : []
      }),
  }
}
