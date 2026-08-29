import { Badge } from '#/components/ui/badge'
import { BrailleLoader } from '#/components/ui/braille-loader'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '#/components/ui/sheet'
import { formatScheduleWhen } from '../format'
import type { Schedule, ScheduleRun } from '../types'
import { useScheduleRuns } from '../use-schedules'

const runBadgeVariant = (state: string) =>
  state === 'failed' ? 'destructive' : 'success'

export function ScheduleHistorySheet({
  schedule,
  onOpenChange,
  onSelectRun,
}: {
  schedule: Schedule | undefined
  onOpenChange: (open: boolean) => void
  onSelectRun: (run: ScheduleRun) => void
}) {
  const { data: runs = [], isPending, isError, error } = useScheduleRuns(
    schedule?.id,
  )

  return (
    <Sheet
      open={schedule !== undefined}
      onOpenChange={onOpenChange}
    >
      <SheetContent side="right" className="gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>History</SheetTitle>
          <SheetDescription>
            {schedule
              ? `Runs for ${schedule.name}`
              : 'Schedule run history'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {isPending ? (
            <div
              className="flex justify-center py-12 text-sm text-muted-foreground"
              role="status"
            >
              <BrailleLoader text="Loading history" />
            </div>
          ) : isError ? (
            <p className="px-4 py-8 text-sm text-destructive" role="alert">
              {error instanceof Error
                ? error.message
                : 'Unable to load history'}
            </p>
          ) : runs.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No runs yet.
            </p>
          ) : (
            <div className="overflow-hidden">
              {runs.map((run) => (
                <button
                  type="button"
                  key={run.id}
                  onClick={() => onSelectRun(run)}
                  className="flex h-9 w-full min-w-0 items-center gap-2 overflow-hidden border-b border-border/40 px-3 text-left text-sm last:border-b-0 hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {run.source === 'automatic' ? 'Automatic' : 'Run now'}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatScheduleWhen(run.createdAt, schedule?.timezone)}
                  </span>
                  <Badge variant={runBadgeVariant(run.state)}>
                    {run.state}
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
