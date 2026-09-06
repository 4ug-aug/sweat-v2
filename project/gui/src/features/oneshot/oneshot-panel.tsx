import { AgentMark } from '#/features/agents/agent-mark'
import { Markdown } from '#/components/markdown'
import { Badge } from '#/components/ui/badge'
import { AgentThinking } from '#/components/ui/agent-thinking'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Kbd, KbdGroup } from '#/components/ui/kbd'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Textarea } from '#/components/ui/textarea'
import { toast } from '#/components/ui/toast'
import { useAgentDefinitions } from '#/features/agents/use-agent-definitions'
import { pairSteps } from '#/features/runs/run-activity'
import { terminal } from '#/features/runs/run-helpers'
import { ToolIcon } from '#/features/runs/run-tool-icon'
import { stepLabel } from '#/features/runs/step-label'
import { ToolCallDetailsList } from '#/features/runs/tool-call-details-list'
import { useWindowKeydown } from '#/hooks/use-window-keydown'
import { cn } from '#/lib/utils'
import { Check, Copy, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { oneshotPeeks, type OneshotToolPeek } from './oneshot-tool-peeks'
import type { OneshotRun, OneshotRunStep } from './types'
import {
  useActiveOneshot,
  useDiscardOneshot,
  useLastOneshotAgent,
  useOneshot,
  useStartOneshot,
} from './use-oneshot'

const DEFAULT_AGENT_ID = 'software-engineer'

const isApplePlatform = (): boolean =>
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)

function workingLabel(run: OneshotRun, steps: OneshotRunStep[]): string {
  const latest = steps.at(-1)
  if (latest) return stepLabel(latest)
  if (run.waitingOn)
    return `is ${run.waitingOn.charAt(0).toLowerCase()}${run.waitingOn.slice(1)}`
  return run.state === 'preparing' ? 'is preparing' : 'is working'
}

function OneshotStream({
  run,
  steps,
  error,
}: {
  run: OneshotRun
  steps: OneshotRunStep[]
  error?: string
}) {
  const done = terminal(run.state)
  const finalOutput = run.stdout.trim() || run.error?.trim()
  const toolItems = pairSteps(steps).filter(
    (item) => item.step.kind === 'tool_call',
  )

  return (
    <div
      ref={(node) => {
        if (node) node.scrollTop = node.scrollHeight
      }}
      className="min-h-0 flex-1 space-y-2 overflow-y-auto text-sm border rounded-md p-2 dark:bg-background"
    >
      {error ? <p className="text-destructive">{error}</p> : null}
      <ToolCallDetailsList items={toolItems} compact resultMaxLength={800} />
      {done && finalOutput ? (
        <div
          className={cn(
            'text-sm leading-5',
            run.state === 'failed' || run.state === 'cancelled'
              ? 'rounded-md border border-destructive/40 px-2 py-1.5 text-destructive'
              : null,
          )}
        >
          {run.state === 'succeeded' ? (
            <div className="[&_p]:mb-1 [&_p:last-child]:mb-0">
              <Markdown>{finalOutput}</Markdown>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">{finalOutput}</p>
          )}
        </div>
      ) : null}
      {!done && toolItems.length === 0 && !error ? (
        <p className="text-xs text-muted-foreground">Starting…</p>
      ) : null}
    </div>
  )
}

function OneshotPeek({
  peek,
  onOpenIssue,
}: {
  peek: OneshotToolPeek
  onOpenIssue?: (id: string) => void
}) {
  const className =
    'flex w-full min-w-0 items-center justify-start gap-1 px-1 hover:bg-accent'
  const inner = (
    <>
      <ToolIcon tool={peek.tool} className="size-3" />
      <span className="min-w-0 truncate">{peek.label}</span>
    </>
  )
  const issueId = peek.issueId
  if (issueId && onOpenIssue) {
    return (
      <Button
        type="button"
        variant="link"
        size="xs"
        className={className}
        aria-label={`Open ${peek.label}`}
        onClick={() => onOpenIssue(issueId)}
      >
        {inner}
      </Button>
    )
  }
  if (peek.href) {
    return (
      <Button
        variant="link"
        size="xs"
        className={className}
        render={<a href={peek.href} />}
      >
        {inner}
      </Button>
    )
  }
  return <span className={cn(className, 'text-xs font-medium')}>{inner}</span>
}

export function OneshotPanel({
  open,
  onOpenChange,
  onOpenIssue,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenIssue?: (id: string) => void
}) {
  const { data: agents = [] } = useAgentDefinitions()
  const [agentId, setAgentId] = useLastOneshotAgent(
    agents[0]?.id ?? DEFAULT_AGENT_ID,
  )
  const [task, setTask] = useState('')
  const [revision, setRevision] = useState('')
  const [runId, setRunId] = useState<string>()
  const [copied, setCopied] = useState(false)
  const taskRef = useRef<HTMLTextAreaElement>(null)
  const runIdRef = useRef<string | undefined>(undefined)
  const submittingRef = useRef(false)
  const start = useStartOneshot()
  const discard = useDiscardOneshot()
  const { data: activeRun } = useActiveOneshot(open && !runId)
  if (open && !runId && activeRun?.id) setRunId(activeRun.id)
  runIdRef.current = runId
  const { data, isError, error } = useOneshot(runId)

  const selectedAgent =
    agents.find((agent) => agent.id === agentId) ?? agents[0]
  const showRevision = Boolean(selectedAgent?.includeRepository)
  const run = data?.run
  const steps = data?.steps ?? []
  const peeks = oneshotPeeks(steps)
  const active = Boolean(runId)
  const working = Boolean(run && !terminal(run.state)) || start.isPending
  const agentName = selectedAgent?.name ?? run?.agentId ?? 'Agent'
  const finalOutput = run?.stdout.trim() || ''
  const canCopyFinal = Boolean(
    run && terminal(run.state) && run.state === 'succeeded' && finalOutput,
  )

  const copyFinal = async () => {
    if (!finalOutput) return
    try {
      await navigator.clipboard.writeText(finalOutput)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.add({ title: 'Copy failed', type: 'error' })
    }
  }

  const close = async () => {
    const id = runIdRef.current
    if (id) {
      try {
        await discard.mutateAsync(id)
        runIdRef.current = undefined
      } catch (reason) {
        toast.add({
          type: 'error',
          title: 'Could not close Oneshot',
          description:
            reason instanceof Error ? reason.message : 'Please try again.',
        })
        return
      }
    }
    onOpenChange(false)
  }

  const submit = async () => {
    const trimmed = task.trim()
    if (
      !trimmed ||
      !selectedAgent ||
      active ||
      start.isPending ||
      submittingRef.current
    ) {
      return
    }
    submittingRef.current = true
    try {
      setAgentId(selectedAgent.id)
      setCopied(false)
      const created = await start.mutateAsync({
        task: trimmed,
        agentDefinitionId: selectedAgent.id,
        ...(showRevision && revision.trim()
          ? { repositoryBase: revision.trim() }
          : {}),
      })
      runIdRef.current = created.id
      setRunId(created.id)
    } catch (reason) {
      toast.add({
        type: 'error',
        title: 'Could not start Oneshot',
        description:
          reason instanceof Error ? reason.message : 'Please try again.',
      })
    } finally {
      submittingRef.current = false
    }
  }

  useWindowKeydown((event) => {
    if (event.key === 'Escape' && open) {
      if (event.defaultPrevented) return
      event.preventDefault()
      void close()
      return
    }
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey)
      return
    const key = event.key.toLowerCase()
    if (key === 'o') {
      event.preventDefault()
      if (open) {
        if (!active) taskRef.current?.focus()
        return
      }
      onOpenChange(true)
      return
    }
    if (key === 'enter' && open && !active) {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')
      ) {
        return
      }
      event.preventDefault()
      void submit()
    }
  })

  const [present, setPresent] = useState(open)
  const [shown, setShown] = useState(false)
  const enterArmedRef = useRef(false)
  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches

  if (open && !present) {
    setPresent(true)
    setShown(false)
    enterArmedRef.current = false
  }
  if (present && !open && shown) setShown(false)
  if (present && open && !shown && reducedMotion) setShown(true)
  if (present && !open && !shown && reducedMotion) {
    setPresent(false)
    runIdRef.current = undefined
    setRunId(undefined)
    setTask('')
    setCopied(false)
  }

  if (!present) return null

  return (
    <div
      className="oneshot-panel-shell fixed right-3 bottom-3 z-50 flex w-[min(100vw-1.5rem,24rem)] flex-col"
      data-open={shown ? 'true' : 'false'}
      ref={(node) => {
        if (!node || !open || shown || enterArmedRef.current || reducedMotion)
          return
        enterArmedRef.current = true
        // WKWebView skips transform transitions applied on the mount frame.
        requestAnimationFrame(() => {
          void node.getBoundingClientRect()
          requestAnimationFrame(() => {
            setShown(true)
          })
        })
      }}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.propertyName !== 'transform') return
        if (open || shown) return
        setPresent(false)
        runIdRef.current = undefined
        setRunId(undefined)
        setTask('')
        setCopied(false)
      }}
    >
      {peeks.length > 0 ? (
        <div className="-mb-px flex w-fit max-w-[80%] flex-col items-stretch gap-0.5 self-end rounded-t-xl border border-b-0 bg-background px-2 py-1 dark:bg-muted animate-in fade-in-0 slide-in-from-bottom-2 duration-200 fill-mode-both motion-reduce:animate-none">
          {peeks.map((peek) => (
            <OneshotPeek key={peek.key} peek={peek} onOpenIssue={onOpenIssue} />
          ))}
        </div>
      ) : null}
      <div
        role="dialog"
        aria-label="Oneshot"
        className={cn(
          'dark:bg-muted flex w-full flex-col overflow-hidden rounded-xl border bg-background shadow-lg transition-[height] duration-150 ease-out motion-reduce:transition-none',
          peeks.length > 0 && 'rounded-tr-none',
          active ? 'h-[min(70vh,28rem)]' : 'h-[min(50vh,20rem)]',
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-2.5">
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="size-7 shrink-0"
              aria-label="Close Oneshot"
              onClick={() => void close()}
            >
              <X className="size-3.5" />
            </Button>
            {active ? (
              <AgentMark
                agentId={run?.agentId ?? selectedAgent?.id ?? DEFAULT_AGENT_ID}
                className="shrink-0"
              />
            ) : null}
            {working && run ? (
              <AgentThinking
                className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                label={`${agentName} ${workingLabel(run, steps)}`}
              />
            ) : working ? (
              <AgentThinking
                className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                label={`${agentName} is starting`}
              />
            ) : active && run ? (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground flex items-center gap-2">
                <span className="font-medium text-foreground/80">
                  {agentName}
                </span>
                <Badge
                  className="capitalize"
                  variant={
                    run.state === 'succeeded'
                      ? 'default'
                      : run.state === 'failed'
                        ? 'destructive'
                        : 'outline'
                  }
                >
                  {run.state === 'succeeded' ? 'Done' : run.state}
                </Badge>
              </span>
            ) : (
              <>
                <Select
                  value={selectedAgent?.id}
                  onValueChange={(value) => {
                    if (typeof value === 'string') setAgentId(value)
                  }}
                >
                  <SelectTrigger
                    id="oneshot-agent"
                    size="sm"
                    className="min-w-0 flex-1"
                    aria-label="Agent"
                  >
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
                {showRevision ? (
                  <Input
                    id="oneshot-ref"
                    value={revision}
                    onChange={(event) => setRevision(event.target.value)}
                    placeholder="Ref"
                    aria-label="Repository ref"
                    className="h-8 w-24 shrink-0"
                  />
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  disabled={!task.trim() || start.isPending || !selectedAgent}
                  onClick={() => void submit()}
                  title={`${isApplePlatform() ? '⌘' : 'Ctrl'}+Enter`}
                >
                  Run
                  <KbdGroup className="pointer-events-none hidden sm:inline-flex opacity-80">
                    <Kbd className="bg-primary-foreground/15 text-primary-foreground">
                      {isApplePlatform() ? '⌘' : 'Ctrl'}
                    </Kbd>
                    <Kbd className="bg-primary-foreground/15 text-primary-foreground">
                      ↵
                    </Kbd>
                  </KbdGroup>
                </Button>
              </>
            )}
            {canCopyFinal ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="size-7 shrink-0"
                aria-label="Copy final output"
                title="Copy final output"
                onClick={() => void copyFinal()}
              >
                {copied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
            ) : null}
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {active ? (
              <div className="absolute inset-0 flex flex-col">
                {run ? (
                  <OneshotStream
                    run={run}
                    steps={steps}
                    error={
                      isError
                        ? error instanceof Error
                          ? error.message
                          : 'Could not load Oneshot'
                        : undefined
                    }
                  />
                ) : null}
              </div>
            ) : (
              <div className="absolute inset-0">
                <Textarea
                  ref={taskRef}
                  value={task}
                  onChange={(event) => setTask(event.target.value)}
                  placeholder="What should the agent do?"
                  className="h-full min-h-0 resize-none [field-sizing:fixed]"
                  autoFocus
                  onKeyDown={(event) => {
                    if (!(event.metaKey || event.ctrlKey)) return
                    if (event.key !== 'Enter' && event.code !== 'Enter') return
                    event.preventDefault()
                    event.stopPropagation()
                    void submit()
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
