import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { cn } from '#/lib/utils'
import {
  CircleCheck,
  CircleDashed,
  CirclePause,
  type LucideIcon,
} from 'lucide-react'
import type { Schedule } from '../types'

export const SCHEDULE_STATE_LABEL: Record<Schedule['state'], string> = {
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
}

const statusIcon: Record<
  Schedule['state'],
  { icon: LucideIcon; className: string }
> = {
  active: { icon: CircleCheck, className: 'text-green-500' },
  paused: { icon: CirclePause, className: 'text-yellow-500' },
  archived: { icon: CircleDashed, className: 'text-muted-foreground' },
}

export function ScheduleStatusIcon({
  state,
  className,
}: {
  state: Schedule['state']
  className?: string
}) {
  const { icon: Icon, className: color } = statusIcon[state]
  return (
    <Icon
      width={14}
      height={14}
      className={cn('size-3.5 shrink-0', color, className)}
    />
  )
}

export function ScheduleStatusMark({ state }: { state: Schedule['state'] }) {
  const label = SCHEDULE_STATE_LABEL[state]
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex size-6 shrink-0 items-center justify-center"
            aria-label={label}
          />
        }
      >
        <ScheduleStatusIcon state={state} />
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}
