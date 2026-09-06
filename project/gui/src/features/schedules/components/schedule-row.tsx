import { Button } from '#/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { AgentMark } from '#/features/agents/agent-mark'
import {
  agentNameFrom,
  useAgentDefinitions,
} from '#/features/agents/use-agent-definitions'
import { formatRelativeTime } from '#/features/agents/format'
import {
  Archive,
  History,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Zap,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { previewCron } from '../cron'
import { formatScheduleWhen } from '../format'
import type { Schedule } from '../types'
import { ScheduleStatusMark } from './schedule-status-icon'

function cronDescription(expression: string, timezone: string) {
  try {
    return previewCron(expression, timezone).description
  } catch {
    return expression
  }
}

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-7 text-muted-foreground"
            aria-label={label}
            onClick={(event) => {
              event.stopPropagation()
              onClick()
            }}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

export function ScheduleRow({
  schedule,
  onRunNow,
  onEdit,
  onHistory,
  onPause,
  onResume,
  onRestore,
  onArchive,
}: {
  schedule: Schedule
  onRunNow: () => void
  onEdit: () => void
  onHistory: () => void
  onPause: () => void
  onResume: () => void
  onRestore: () => void
  onArchive: () => void
}) {
  const { data: agents = [] } = useAgentDefinitions()
  const agentName = agentNameFrom(agents, schedule.agentDefinitionId)
  const cronHint = cronDescription(
    schedule.cronExpression,
    schedule.timezone,
  )
  const nextLabel = formatScheduleWhen(
    schedule.nextRunAt,
    schedule.timezone,
  )

  return (
    <div
      data-schedule-row={schedule.id}
      className="group flex h-11 min-w-0 cursor-pointer items-center gap-2 overflow-hidden border-b border-border/40 px-3 text-sm last:border-b-0 hover:bg-muted/40"
      onClick={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('button, a, input, textarea, [role="combobox"]'))
          return
        onHistory()
      }}
    >
      <ScheduleStatusMark state={schedule.state} />
      <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <span className="max-w-[min(40%,16rem)] shrink-0 truncate font-medium">
          {schedule.name}
        </span>
        <span className="min-w-0 truncate text-muted-foreground">
          {schedule.task}
        </span>
      </span>
      <span className="hidden min-w-0 shrink-0 items-center gap-1.5 @md:inline-flex">
        <AgentMark
          agentId={schedule.agentDefinitionId}
          className="size-4"
        />
        <span className="hidden max-w-28 truncate text-xs text-muted-foreground @xl:inline">
          {agentName}
        </span>
      </span>
      <span
        className="hidden max-w-28 shrink-0 truncate font-mono text-xs text-muted-foreground @lg:inline"
        title={cronHint}
      >
        {schedule.cronExpression}
      </span>
      <span
        className="hidden w-[6.5rem] shrink-0 truncate text-right text-xs text-muted-foreground @md:inline"
        title={nextLabel}
      >
        {schedule.nextRunAt
          ? schedule.nextRunAt > Date.now()
            ? formatRelativeTime(schedule.nextRunAt)
            : nextLabel
          : 'Not scheduled'}
      </span>
      <div className="flex shrink-0 items-center gap-0.5 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
        {schedule.state !== 'archived' && (
          <RowAction label="Run now" onClick={onRunNow}>
            <Play className="size-3.5" />
          </RowAction>
        )}
        <RowAction label="View history" onClick={onHistory}>
          <History className="size-3.5" />
        </RowAction>
        {schedule.state === 'active' ? (
          <RowAction label="Pause" onClick={onPause}>
            <Pause className="size-3.5" />
          </RowAction>
        ) : schedule.state === 'paused' ? (
          <RowAction label="Resume" onClick={onResume}>
            <Zap className="size-3.5" />
          </RowAction>
        ) : (
          <RowAction label="Restore" onClick={onRestore}>
            <RotateCcw className="size-3.5" />
          </RowAction>
        )}
        <RowAction label="Edit" onClick={onEdit}>
          <Pencil className="size-3.5" />
        </RowAction>
        {schedule.state !== 'archived' && (
          <RowAction label="Archive" onClick={onArchive}>
            <Archive className="size-3.5" />
          </RowAction>
        )}
      </div>
    </div>
  )
}
