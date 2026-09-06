import { Markdown } from '#/components/markdown'
import { Badge } from '#/components/ui/badge'
import { AgentThinking } from '#/components/ui/agent-thinking'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '#/components/ui/breadcrumb'
import { Button } from '#/components/ui/button'
import { toast } from '#/components/ui/toast'
import { asRunStep, RunTranscript } from '#/features/runs/run-transcript'
import { terminal } from '#/features/runs/run-helpers'
import { cn } from '#/lib/utils'
import { Ban, Box, X } from 'lucide-react'
import { formatScheduleWhen } from '../format'
import type { Schedule, ScheduleRun } from '../types'
import {
  useCancelScheduleRun,
  useScheduleRuns,
  useScheduleRunSteps,
} from '../use-schedules'

const runBadgeVariant = (state: ScheduleRun['state']) => {
  if (state === 'failed') return 'destructive' as const
  if (state === 'succeeded') return 'success' as const
  return 'secondary' as const
}

function ScheduleRunTranscript({
  run,
  onClose,
  onCancel,
  onOpenMachine,
}: {
  run: ScheduleRun
  onClose: () => void
  onCancel: () => void
  onOpenMachine?: (sandboxId: string) => void
}) {
  const {
    data: steps = [],
    isPending,
    isError,
    error,
  } = useScheduleRunSteps(run.id)
  const working = !terminal(run.state)
  const sandboxId = run.sandboxId

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col animate-in fade-in-0 slide-in-from-right-2 duration-200 fill-mode-backwards motion-reduce:animate-none"
      aria-label="Run transcript"
    >
      <div className="flex shrink-0 items-center justify-end gap-1 px-3 py-2">
        {onOpenMachine && sandboxId ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onOpenMachine(sandboxId)}
          >
            <Box data-icon="inline-start" />
            Open machine
          </Button>
        ) : null}
        {working ? (
          <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
            <Ban data-icon="inline-start" />
            Stop
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Close transcript"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm leading-6">
              <Markdown>{run.task}</Markdown>
            </div>
          </div>
          {isPending && !steps.length ? (
            <p className="text-sm text-muted-foreground" role="status">
              <AgentThinking label="Loading run" />
            </p>
          ) : null}
          {isError && !steps.length ? (
            <p className="text-sm text-destructive" role="alert">
              {error instanceof Error
                ? error.message
                : 'Unable to load run activity'}
            </p>
          ) : null}
          <RunTranscript
            agentId={run.agentId}
            text={run.state === 'succeeded' ? run.stdout : ''}
            steps={steps.map((step) => asRunStep(step, run.id))}
            working={working}
            error={
              run.state === 'failed'
                ? run.error ?? 'The run failed.'
                : undefined
            }
            showReasoningWhenComplete
          />
          {run.state === 'cancelled' ? (
            <p className="text-sm text-muted-foreground">
              The run was cancelled.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export function ScheduleHistoryPage({
  schedule,
  selectedRunId,
  onSelectedRunIdChange,
  onBack,
  onOpenMachine,
}: {
  schedule: Schedule
  selectedRunId?: string
  onSelectedRunIdChange: (id: string | undefined) => void
  onBack: () => void
  onOpenMachine?: (sandboxId: string) => void
}) {
  const { data: runs = [], isPending, isError, error } = useScheduleRuns(
    schedule.id,
  )
  const cancel = useCancelScheduleRun()
  const selectedRun = runs.find((run) => run.id === selectedRunId)
  const split = selectedRun !== undefined

  const cancelRun = (run: ScheduleRun) => {
    void cancel
      .mutateAsync(run.id)
      .then(() =>
        toast.add({
          type: 'success',
          title: 'Run cancelled',
          description: schedule.name,
        }),
      )
      .catch((reason) =>
        toast.add({
          type: 'error',
          title: 'Schedule action failed',
          description:
            reason instanceof Error ? reason.message : 'Please try again.',
        }),
      )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2 animate-in fade-in-0 slide-in-from-top-1 duration-150 ease-out fill-mode-backwards motion-reduce:animate-none">
        <Breadcrumb className="min-w-0 flex-1">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink
                render={<button type="button" onClick={onBack} />}
              >
                Schedules
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="min-w-0 truncate">
                {schedule.name}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            'min-h-0 overflow-y-auto',
            split ? 'w-72 shrink-0 border-r border-border/60' : 'min-w-0 flex-1',
          )}
        >
          {isPending ? (
            <div
              className="flex justify-center py-12 text-sm text-muted-foreground"
              role="status"
            >
              <AgentThinking label="Loading history" />
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
            <div className={split ? '' : 'px-4 py-4'}>
              <div
                className={
                  split
                    ? ''
                    : 'overflow-hidden rounded-md border border-border/50 bg-background'
                }
              >
                {runs.map((run) => (
                  <button
                    type="button"
                    key={run.id}
                    onClick={() => onSelectedRunIdChange(run.id)}
                    className={cn(
                      'flex h-9 w-full min-w-0 items-center gap-2 overflow-hidden border-b border-border/40 px-3 text-left text-sm last:border-b-0 hover:bg-muted/40',
                      run.id === selectedRunId && 'bg-muted/60 font-medium',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {run.source === 'automatic' ? 'Automatic' : 'Run now'}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatScheduleWhen(run.createdAt, schedule.timezone)}
                    </span>
                    <Badge variant={runBadgeVariant(run.state)}>
                      {run.state}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {selectedRun ? (
          <ScheduleRunTranscript
            key={selectedRun.id}
            run={selectedRun}
            onClose={() => onSelectedRunIdChange(undefined)}
            onCancel={() => cancelRun(selectedRun)}
            onOpenMachine={onOpenMachine}
          />
        ) : null}
      </div>
    </div>
  )
}
