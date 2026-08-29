import type { QueryClient } from '@tanstack/react-query'
import { connectWorkspaceStream } from '#/lib/api-transport'
import type { Schedule, ScheduleRun } from './types'
import {
  upsertScheduleInCache,
  upsertScheduleRunInCache,
} from './use-schedules'

let detachScheduleWorkspaceSync: (() => void) | undefined

export function attachScheduleWorkspaceSync(queryClient: QueryClient) {
  detachScheduleWorkspaceSync?.()
  const handle = connectWorkspaceStream({
    onMessage(data) {
      const event = JSON.parse(data) as {
        type: string
        schedule?: Schedule
        run?: ScheduleRun
      }
      if (
        (event.type === 'schedule.created' ||
          event.type === 'schedule.changed') &&
        event.schedule
      )
        upsertScheduleInCache(queryClient, event.schedule)
      if (
        (event.type === 'schedule_run.created' ||
          event.type === 'schedule_run.changed') &&
        event.run
      )
        upsertScheduleRunInCache(queryClient, event.run)
    },
  })
  detachScheduleWorkspaceSync = () => handle.close()
}
