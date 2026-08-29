import { previewCron } from '#/features/schedules/cron'
import type {
  AgentDefinitionSummary,
  WorkspaceServerMessage,
} from '#/server/protocol'
import type { RoomUser } from '#/server/features/rooms/room-store'
import {
  type Schedule,
  type ScheduleStore,
} from './schedule-store'
import {
  ScheduleActiveRunError,
  type ScheduleRunner,
} from './schedule-runner'
import {
  overlayLivePreparation,
  type RunSummary,
} from '#/server/features/runs/run-control'
import { json, readBody } from '#/server/http/respond'

export function createSchedulesHttp(deps: {
  scheduleStore: ScheduleStore
  scheduleRunner?: ScheduleRunner
  agentDefinitions: (viewerAccountId: string) => AgentDefinitionSummary[]
  broadcastWorkspace: (message: WorkspaceServerMessage) => void
  liveRun?: (id: string) => RunSummary | undefined
}): (
  request: Request,
  url: URL,
  user: RoomUser,
) => Promise<Response | undefined> {
  const knownAgent = (id: unknown, viewerAccountId: string): id is string =>
    typeof id === 'string' &&
    deps.agentDefinitions(viewerAccountId).some((agent) => agent.id === id)
  const scheduleInput = (
    body: Record<string, unknown>,
    now: number,
    viewerAccountId: string,
  ) => {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const task = typeof body.task === 'string' ? body.task.trim() : ''
    const agentDefinitionId = body.agentDefinitionId
    const cronExpression =
      typeof body.cronExpression === 'string'
        ? body.cronExpression.trim()
        : ''
    const timezone =
      typeof body.timezone === 'string' ? body.timezone.trim() : ''
    if (!name || name.length > 50 || !task || task.length > 10_000)
      throw new Error('Invalid schedule name or task')
    if (!knownAgent(agentDefinitionId, viewerAccountId))
      throw new Error('Unknown agent definition')
    const preview = previewCron(cronExpression, timezone, now)
    return {
      name,
      task,
      agentDefinitionId,
      cronExpression,
      timezone,
      nextRunAt: preview.nextRuns[0]!,
    }
  }

  return async (
    request: Request,
    url: URL,
    user: RoomUser,
  ): Promise<Response | undefined> => {
    if (url.pathname === '/api/schedules' && request.method === 'GET')
      return json({
        schedules: deps.scheduleStore.listSchedules(
          url.searchParams.get('archived') !== 'true',
        ),
      })
    if (url.pathname === '/api/schedules' && request.method === 'POST') {
      const body = await readBody(request)
      if (!body) return json({ error: 'Invalid schedule' }, 400)
      try {
        const input = scheduleInput(body, Date.now(), user.id)
        const schedule = deps.scheduleStore.createSchedule({
          id: crypto.randomUUID(),
          ...input,
          state: 'active',
          createdBy: user.id,
          createdAt: Date.now(),
        })
        deps.broadcastWorkspace({ type: 'schedule.created', schedule })
        return json({ schedule }, 201)
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error ? error.message : 'Invalid schedule',
          },
          400,
        )
      }
    }
    const scheduleRoute = url.pathname.match(/^\/api\/schedules\/([^/]+)$/)
    if (scheduleRoute && request.method === 'PATCH') {
      const schedule = deps.scheduleStore.getSchedule(scheduleRoute[1]!)
      if (!schedule) return json({ error: 'Schedule not found' }, 404)
      const body = await readBody(request)
      if (!body) return json({ error: 'Invalid schedule' }, 400)
      try {
        const input = {
          ...(body.name === undefined
            ? {}
            : {
                name: typeof body.name === 'string' ? body.name.trim() : '',
              }),
          ...(body.task === undefined
            ? {}
            : {
                task: typeof body.task === 'string' ? body.task.trim() : '',
              }),
          ...(body.agentDefinitionId === undefined
            ? {}
            : { agentDefinitionId: body.agentDefinitionId as string }),
          ...(body.cronExpression === undefined
            ? {}
            : {
                cronExpression:
                  typeof body.cronExpression === 'string'
                    ? body.cronExpression.trim()
                    : '',
              }),
          ...(body.timezone === undefined
            ? {}
            : {
                timezone:
                  typeof body.timezone === 'string'
                    ? body.timezone.trim()
                    : '',
              }),
          ...(body.state === undefined
            ? {}
            : { state: body.state as Schedule['state'] }),
        }
        if (
          input.name !== undefined &&
          (!input.name || input.name.length > 50)
        )
          throw new Error('Invalid schedule name')
        if (
          input.task !== undefined &&
          (!input.task || input.task.length > 10_000)
        )
          throw new Error('Invalid schedule task')
        if (
          body.agentDefinitionId !== undefined &&
          !knownAgent(body.agentDefinitionId, user.id)
        )
          throw new Error('Unknown agent definition')
        if (
          input.cronExpression !== undefined ||
          input.timezone !== undefined
        )
          previewCron(
            input.cronExpression ?? schedule.cronExpression,
            input.timezone ?? schedule.timezone,
            Date.now(),
          )
        if (
          input.state !== undefined &&
          !['active', 'paused', 'archived'].includes(input.state)
        )
          throw new Error('Invalid schedule state')
        const updated = deps.scheduleStore.updateSchedule(
          schedule.id,
          input,
          Date.now(),
        )
        deps.broadcastWorkspace({ type: 'schedule.changed', schedule: updated })
        return json({ schedule: updated })
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error ? error.message : 'Invalid schedule',
          },
          400,
        )
      }
    }
    const runsRoute = url.pathname.match(/^\/api\/schedules\/([^/]+)\/runs$/)
    if (runsRoute && request.method === 'GET') {
      if (!deps.scheduleStore.getSchedule(runsRoute[1]!))
        return json({ error: 'Schedule not found' }, 404)
      try {
        const page = deps.scheduleStore.listRuns(runsRoute[1]!, {
          limit: Number(url.searchParams.get('limit') ?? 50),
          cursor: url.searchParams.get('cursor') ?? undefined,
        })
        return json({
          ...page,
          runs: page.runs.map((run) =>
            overlayLivePreparation(run, deps.liveRun?.(run.id)),
          ),
        })
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error ? error.message : 'Invalid cursor',
          },
          400,
        )
      }
    }
    if (runsRoute && request.method === 'POST') {
      if (!deps.scheduleRunner)
        return json({ error: 'Scheduler unavailable' }, 503)
      try {
        const run = deps.scheduleRunner.runNow(runsRoute[1]!, user.id)
        return json({ run }, 202)
      } catch (error) {
        if (error instanceof ScheduleActiveRunError)
          return json({ error: error.message }, 409)
        if (error instanceof Error && error.message === 'Schedule not found')
          return json({ error: error.message }, 404)
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Unable to start schedule',
          },
          502,
        )
      }
    }
    const scheduleRunRoute = url.pathname.match(
      /^\/api\/schedule-runs\/([^/]+)$/,
    )
    if (scheduleRunRoute && request.method === 'GET') {
      const run = deps.scheduleStore.getRun(scheduleRunRoute[1]!)
      return run
        ? json({
            run: overlayLivePreparation(run, deps.liveRun?.(run.id)),
          })
        : json({ error: 'Run not found' }, 404)
    }
    const scheduleRunCancel = url.pathname.match(
      /^\/api\/schedule-runs\/([^/]+)\/cancel$/,
    )
    if (scheduleRunCancel && request.method === 'POST') {
      const run = deps.scheduleStore.getRun(scheduleRunCancel[1]!)
      if (!run) return json({ error: 'Run not found' }, 404)
      const changed = await deps.scheduleRunner?.cancel(run.id)
      return json({ run: changed ?? run })
    }
    const scheduleRunSteps = url.pathname.match(
      /^\/api\/schedule-runs\/([^/]+)\/steps$/,
    )
    if (scheduleRunSteps && request.method === 'GET') {
      if (!deps.scheduleStore.getRun(scheduleRunSteps[1]!))
        return json({ error: 'Run not found' }, 404)
      return json({
        steps: deps.scheduleStore.listSteps(scheduleRunSteps[1]!),
      })
    }
    return undefined
  }
}
