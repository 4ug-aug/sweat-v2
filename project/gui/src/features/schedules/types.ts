import type { LiveRunFacts } from '#/server/features/runs/run-control'
import type { ScheduleRun as StoredScheduleRun } from '#/server/features/schedules/schedule-store'

export type { Schedule } from '#/server/features/schedules/schedule-store'

export type AgentDefinition = {
  id: string
  name: string
  description: string
  kind?: 'cursor' | 'openai-agents'
  includeRepository: boolean
  visibility?: 'private' | 'workspace'
  creatorAccountId?: string
  creatingAgentId?: string
  updaterAccountId?: string
  updatedAt?: number
  archivedAt?: number
  instructions?: string
  capabilities: { id: string; name: string; tools: string[] }[]
  skills: { id: string; name: string; description: string }[]
  color?: string
}

/** As served: the stored run plus whatever the executor is live-overlaying. */
export type ScheduleRun = StoredScheduleRun & Partial<LiveRunFacts>
