import type { QueryClient } from '@tanstack/react-query'
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { apiJson, apiJsonBody } from '#/lib/api-transport'
import type { Schedule, ScheduleRun } from './types'
import type { ScheduleRunStep } from '#/server/features/schedules/schedule-store'

export type { ScheduleRunStep }

export const schedulesQueryKey = ['schedules'] as const

export function scheduleRunsQueryKey(scheduleId: string) {
  return ['schedule-runs', scheduleId] as const
}

export function scheduleRunStepsQueryKey(runId: string) {
  return ['schedule-run-steps', runId] as const
}

function upsertSchedule(
  schedules: Schedule[],
  schedule: Schedule,
): Schedule[] {
  const index = schedules.findIndex(({ id }) => id === schedule.id)
  if (index < 0)
    return [...schedules, schedule].sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    )
  return schedules.map((current) =>
    current.id === schedule.id ? schedule : current,
  )
}

export function upsertScheduleInCache(
  queryClient: QueryClient,
  schedule: Schedule,
) {
  queryClient.setQueryData(
    schedulesQueryKey,
    (current: Schedule[] | undefined) =>
      upsertSchedule(current ?? [], schedule),
  )
}

export function upsertScheduleRunInCache(
  queryClient: QueryClient,
  run: ScheduleRun,
) {
  queryClient.setQueryData(
    scheduleRunsQueryKey(run.scheduleId),
    (current: ScheduleRun[] | undefined) => {
      const runs = current ?? []
      const index = runs.findIndex(({ id }) => id === run.id)
      if (index < 0)
        return [run, ...runs].sort((a, b) => b.createdAt - a.createdAt)
      return runs
        .map((existing) => (existing.id === run.id ? run : existing))
        .sort((a, b) => b.createdAt - a.createdAt)
    },
  )
}

export function appendScheduleRunStepInCache(
  queryClient: QueryClient,
  runId: string,
  step: ScheduleRunStep,
) {
  queryClient.setQueryData(
    scheduleRunStepsQueryKey(runId),
    (current: ScheduleRunStep[] | undefined) => {
      if (!current) return current
      if (current.some((existing) => existing.id === step.id)) return current
      return [...current, step].sort((a, b) => a.idx - b.idx)
    },
  )
}

async function fetchSchedules(): Promise<Schedule[]> {
  const data = await apiJson<{ schedules: Schedule[] }>(
    '/api/schedules',
    undefined,
    'Unable to load schedules',
  )
  return data.schedules
}

async function fetchScheduleRuns(scheduleId: string): Promise<ScheduleRun[]> {
  const data = await apiJson<{ runs: ScheduleRun[] }>(
    `/api/schedules/${encodeURIComponent(scheduleId)}/runs?limit=50`,
    undefined,
    'Unable to load schedule history',
  )
  return (data.runs ?? []).slice().sort((a, b) => b.createdAt - a.createdAt)
}

export function useSchedules(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: schedulesQueryKey,
    queryFn: fetchSchedules,
    enabled: options?.enabled ?? true,
  })
}

export function useScheduleRuns(scheduleId: string | undefined) {
  return useQuery({
    queryKey: scheduleId
      ? scheduleRunsQueryKey(scheduleId)
      : ['schedule-runs', 'none'],
    queryFn: () => fetchScheduleRuns(scheduleId!),
    enabled: Boolean(scheduleId),
  })
}

async function fetchScheduleRunSteps(runId: string): Promise<ScheduleRunStep[]> {
  const data = await apiJson<{ steps?: ScheduleRunStep[] }>(
    `/api/schedule-runs/${encodeURIComponent(runId)}/steps`,
    undefined,
    'Unable to load run activity',
  )
  return data.steps ?? []
}

export function useScheduleRunSteps(runId: string | undefined) {
  return useQuery({
    queryKey: runId
      ? scheduleRunStepsQueryKey(runId)
      : ['schedule-run-steps', 'none'],
    queryFn: () => fetchScheduleRunSteps(runId!),
    enabled: Boolean(runId),
  })
}

export type CreateScheduleInput = Omit<
  Schedule,
  'id' | 'state' | 'createdBy' | 'createdAt' | 'updatedAt' | 'nextRunAt'
>

export type UpdateScheduleInput = {
  id: string
  name?: string
  task?: string
  cronExpression?: string
  timezone?: string
  agentDefinitionId?: string
  state?: Schedule['state']
}

export function useCreateSchedule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateScheduleInput): Promise<Schedule> => {
      const data = await apiJsonBody<{ schedule?: Schedule }>(
        '/api/schedules',
        'POST',
        input,
        'Unable to create schedule',
      )
      if (!data.schedule) throw new Error('Unable to create schedule')
      return data.schedule
    },
    onSuccess: (schedule) => {
      upsertScheduleInCache(queryClient, schedule)
    },
  })
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateScheduleInput): Promise<Schedule> => {
      const { id, ...patch } = input
      const data = await apiJsonBody<{ schedule?: Schedule }>(
        `/api/schedules/${encodeURIComponent(id)}`,
        'PATCH',
        patch,
        'Unable to update schedule',
      )
      if (!data.schedule) throw new Error('Unable to update schedule')
      return data.schedule
    },
    onSuccess: (schedule) => {
      upsertScheduleInCache(queryClient, schedule)
    },
  })
}

export function useRunScheduleNow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<ScheduleRun> => {
      const data = await apiJsonBody<{ run?: ScheduleRun }>(
        `/api/schedules/${encodeURIComponent(id)}/runs`,
        'POST',
        {},
        'Unable to start schedule',
      )
      if (!data.run) throw new Error('Unable to start schedule')
      return data.run
    },
    onSuccess: (run) => {
      upsertScheduleRunInCache(queryClient, run)
    },
  })
}

export function useCancelScheduleRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (runId: string): Promise<ScheduleRun> => {
      const data = await apiJsonBody<{ run?: ScheduleRun }>(
        `/api/schedule-runs/${encodeURIComponent(runId)}/cancel`,
        'POST',
        {},
        'Unable to cancel run',
      )
      if (!data.run) throw new Error('Unable to cancel run')
      return data.run
    },
    onSuccess: (run) => {
      upsertScheduleRunInCache(queryClient, run)
    },
  })
}
