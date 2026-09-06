import { QueryClient } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import {
  appendScheduleRunStepInCache,
  scheduleRunStepsQueryKey,
  type ScheduleRunStep,
} from './use-schedules'

const step = (id: string, idx: number): ScheduleRunStep => ({
  id,
  runId: 'run-1',
  idx,
  kind: 'message',
  text: id,
  createdAt: idx,
  at: idx,
})

test('appendScheduleRunStepInCache ignores uncached runs and duplicates', () => {
  const queryClient = new QueryClient()
  appendScheduleRunStepInCache(queryClient, 'run-1', step('a', 0))
  expect(
    queryClient.getQueryData(scheduleRunStepsQueryKey('run-1')),
  ).toBeUndefined()

  queryClient.setQueryData(scheduleRunStepsQueryKey('run-1'), [step('a', 0)])
  appendScheduleRunStepInCache(queryClient, 'run-1', step('a', 0))
  appendScheduleRunStepInCache(queryClient, 'run-1', step('b', 1))
  expect(
    queryClient.getQueryData<ScheduleRunStep[]>(
      scheduleRunStepsQueryKey('run-1'),
    ),
  ).toEqual([step('a', 0), step('b', 1)])
})
