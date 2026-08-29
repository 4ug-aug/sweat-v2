import { AgentMark } from '#/features/agents/agent-mark'
import { useAgentDefinitions } from '#/features/agents/use-agent-definitions'
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { previewCron } from './cron'
import { ScheduleHistorySheet } from './components/schedule-history-sheet'
import { ScheduleRow } from './components/schedule-row'
import {
  useCancelScheduleRun,
  useCreateSchedule,
  useRunScheduleNow,
  useScheduleRuns,
  useSchedules,
  useUpdateSchedule,
} from './use-schedules'
import type { Schedule, ScheduleRun } from './types'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from '#/components/ui/pagination'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { BrailleLoader } from '#/components/ui/braille-loader'
import { toast } from '#/components/ui/toast'
import { RunActivityRail } from '#/features/runs/run-activity-rail'
import { formatScheduleWhen } from './format'

const PAGE_SIZE = 25
const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

const errorMessage = (reason: unknown) =>
  reason instanceof Error ? reason.message : 'Please try again.'

export function SchedulesPage({
  onOpenMachine,
}: {
  onOpenMachine?: (sandboxId: string) => void
}) {
  const {
    data: schedules = [],
    isPending,
    isError,
    error,
  } = useSchedules()
  const { data: agents = [] } = useAgentDefinitions()
  const create = useCreateSchedule()
  const update = useUpdateSchedule()
  const runNow = useRunScheduleNow()
  const cancel = useCancelScheduleRun()
  const [archived, setArchived] = useState(false)
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string>()
  const [name, setName] = useState('')
  const [task, setTask] = useState('')
  const [cronExpression, setCronExpression] = useState('0 9 * * 5')
  const [timezone, setTimezone] = useState(defaultTimezone)
  const [agentDefinitionId, setAgentDefinitionId] =
    useState('software-engineer')
  const [formError, setFormError] = useState<string>()
  const [historyScheduleId, setHistoryScheduleId] = useState<string>()
  const [selectedRun, setSelectedRun] = useState<ScheduleRun>()
  const preview = useMemo(() => {
    try {
      return previewCron(cronExpression, timezone)
    } catch {
      return undefined
    }
  }, [cronExpression, timezone])
  const visible = schedules.filter((schedule) =>
    archived ? schedule.state === 'archived' : schedule.state !== 'archived',
  )
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const paged = visible.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )
  const historySchedule = schedules.find(
    (schedule) => schedule.id === historyScheduleId,
  )
  const { data: selectedRunHistory } = useScheduleRuns(selectedRun?.scheduleId)
  const liveSelectedRun =
    selectedRunHistory?.find((run) => run.id === selectedRun?.id) ??
    selectedRun
  const selectedSchedule = liveSelectedRun
    ? schedules.find((schedule) => schedule.id === liveSelectedRun.scheduleId)
    : undefined
  const startCreate = () => {
    setEditingId(undefined)
    setName('')
    setTask('')
    setCronExpression('0 9 * * 5')
    setTimezone(defaultTimezone)
    setAgentDefinitionId(agents[0]?.id ?? 'software-engineer')
    setCreating(true)
  }
  const startEdit = (schedule: Schedule) => {
    setEditingId(schedule.id)
    setName(schedule.name)
    setTask(schedule.task)
    setCronExpression(schedule.cronExpression)
    setTimezone(schedule.timezone)
    setAgentDefinitionId(schedule.agentDefinitionId)
    setCreating(true)
  }
  const runScheduleAction = (
    action: () => Promise<unknown>,
    title: string,
    description: string,
  ) => {
    void action()
      .then(() => toast.add({ type: 'success', title, description }))
      .catch((reason) =>
        toast.add({
          type: 'error',
          title: 'Schedule action failed',
          description: errorMessage(reason),
        }),
      )
  }

  if (isPending)
    return (
      <div className="p-8 text-sm text-muted-foreground">
        <BrailleLoader text="Loading schedules" />
      </div>
    )
  return (
    <div className="flex min-h-0 flex-1">
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-full flex-col gap-3 px-4 py-4">
          <div className="flex items-center gap-2">
            <Tabs
              value={archived ? 'archived' : 'active'}
              onValueChange={(value) => {
                setArchived(value === 'archived')
                setPage(1)
              }}
            >
              <TabsList>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="archived">Archived</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              type="button"
              size="sm"
              className="ml-auto h-7 gap-1.5"
              onClick={startCreate}
            >
              <Plus data-icon="inline-start" />
              New schedule
            </Button>
          </div>
          <Dialog open={creating} onOpenChange={setCreating}>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {editingId ? 'Edit schedule' : 'New schedule'}
                </DialogTitle>
                <DialogDescription>
                  Choose what should run and when it should run.
                </DialogDescription>
              </DialogHeader>
              <form
                className="grid gap-3"
                onSubmit={async (event) => {
                  event.preventDefault()
                  setFormError(undefined)
                  try {
                    if (editingId)
                      await update.mutateAsync({
                        id: editingId,
                        name,
                        task,
                        cronExpression,
                        timezone,
                        agentDefinitionId,
                      })
                    else
                      await create.mutateAsync({
                        name,
                        task,
                        cronExpression,
                        timezone,
                        agentDefinitionId,
                      })
                    setCreating(false)
                    setEditingId(undefined)
                    setName('')
                    setTask('')
                    toast.add({
                      type: 'success',
                      title: editingId
                        ? 'Schedule updated'
                        : 'Schedule created',
                      description: name,
                    })
                  } catch (reason) {
                    const message = errorMessage(reason)
                    setFormError(message)
                    toast.add({
                      type: 'error',
                      title: 'Unable to save schedule',
                      description: message,
                    })
                  }
                }}
              >
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Schedule name"
                  maxLength={50}
                  required
                />
                <Select
                  value={agentDefinitionId}
                  onValueChange={(value) => setAgentDefinitionId(value ?? '')}
                >
                  <SelectTrigger className="w-full" aria-label="Agent">
                    <SelectValue placeholder="Agent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          <AgentMark agentId={agent.id} />
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <textarea
                  className="min-h-24 rounded-md border bg-background p-3 text-sm"
                  value={task}
                  onChange={(event) => setTask(event.target.value)}
                  placeholder="Task"
                  maxLength={10000}
                  required
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    value={cronExpression}
                    onChange={(event) =>
                      setCronExpression(event.target.value)
                    }
                    aria-label="Cron expression"
                  />
                  <Input
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                    aria-label="Timezone"
                  />
                </div>
                {preview ? (
                  <p className="text-sm text-muted-foreground">
                    {preview.description} ·{' '}
                    {preview.nextRuns
                      .map((date) => formatScheduleWhen(date, timezone))
                      .join(' · ')}
                  </p>
                ) : (
                  <p className="text-sm text-destructive">
                    Enter a valid five-field cron and IANA timezone.
                  </p>
                )}
                {formError && (
                  <p className="text-sm text-destructive">{formError}</p>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCreating(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!preview}>
                    {editingId ? 'Save changes' : 'Save schedule'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          {isError && (
            <p className="text-sm text-destructive" role="alert">
              {error instanceof Error
                ? error.message
                : 'Unable to load schedules'}
            </p>
          )}
          {!visible.length ? (
            <p className="rounded-md border border-border/50 p-8 text-center text-sm text-muted-foreground">
              No schedules here yet.
            </p>
          ) : (
            <>
              <div className="@container overflow-hidden rounded-md border border-border/50 bg-background">
                {paged.map((schedule) => (
                  <ScheduleRow
                    key={schedule.id}
                    schedule={schedule}
                    onRunNow={() =>
                      runScheduleAction(
                        () => runNow.mutateAsync(schedule.id),
                        'Run started',
                        schedule.name,
                      )
                    }
                    onEdit={() => startEdit(schedule)}
                    onHistory={() => setHistoryScheduleId(schedule.id)}
                    onPause={() =>
                      runScheduleAction(
                        () =>
                          update.mutateAsync({
                            id: schedule.id,
                            state: 'paused',
                          }),
                        'Schedule paused',
                        schedule.name,
                      )
                    }
                    onResume={() =>
                      runScheduleAction(
                        () =>
                          update.mutateAsync({
                            id: schedule.id,
                            state: 'active',
                          }),
                        'Schedule resumed',
                        schedule.name,
                      )
                    }
                    onRestore={() =>
                      runScheduleAction(
                        () =>
                          update.mutateAsync({
                            id: schedule.id,
                            state: 'paused',
                          }),
                        'Schedule restored',
                        schedule.name,
                      )
                    }
                    onArchive={() =>
                      runScheduleAction(
                        () =>
                          update.mutateAsync({
                            id: schedule.id,
                            state: 'archived',
                          }),
                        'Schedule archived',
                        schedule.name,
                      )
                    }
                  />
                ))}
              </div>
              {pageCount > 1 && (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {(safePage - 1) * PAGE_SIZE + 1}–
                    {Math.min(safePage * PAGE_SIZE, visible.length)} of{' '}
                    {visible.length}
                  </p>
                  <Pagination className="mx-0 w-auto justify-end">
                    <PaginationContent>
                      <PaginationItem>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7"
                          disabled={safePage <= 1}
                          onClick={() => setPage(safePage - 1)}
                        >
                          <ChevronLeft data-icon="inline-start" />
                          Previous
                        </Button>
                      </PaginationItem>
                      <PaginationItem>
                        <span className="px-2 text-xs text-muted-foreground">
                          {safePage} / {pageCount}
                        </span>
                      </PaginationItem>
                      <PaginationItem>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7"
                          disabled={safePage >= pageCount}
                          onClick={() => setPage(safePage + 1)}
                        >
                          Next
                          <ChevronRight data-icon="inline-end" />
                        </Button>
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      <ScheduleHistorySheet
        schedule={historySchedule}
        onOpenChange={(open) => {
          if (!open) setHistoryScheduleId(undefined)
        }}
        onSelectRun={(run) => {
          setSelectedRun(run)
          setHistoryScheduleId(undefined)
        }}
      />
      {liveSelectedRun && selectedSchedule && (
        <RunActivityRail
          run={{
            ...liveSelectedRun,
            roomId: '',
            requestedBy: liveSelectedRun.startedBy ?? {
              id: 'workspace',
              name: 'Workspace',
            },
            stdout: '',
            attribution:
              liveSelectedRun.source === 'automatic'
                ? `Automatic · scheduled for ${formatScheduleWhen(liveSelectedRun.scheduledFor, selectedSchedule.timezone)}`
                : `Run now by @${liveSelectedRun.startedBy?.name ?? 'member'}`,
          }}
          stepsPath={`/api/schedule-runs/${liveSelectedRun.id}/steps`}
          liveSteps={[]}
          onClose={() => setSelectedRun(undefined)}
          onCancel={() =>
            runScheduleAction(
              () => cancel.mutateAsync(liveSelectedRun.id),
              'Run cancelled',
              selectedSchedule.name,
            )
          }
          onOpenMachine={onOpenMachine}
        />
      )}
    </div>
  )
}
