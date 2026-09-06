import { Badge } from '#/components/ui/badge'
import { AgentThinking } from '#/components/ui/agent-thinking'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { apiJson, apiJsonBody } from '#/lib/api-transport'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import {
  filterMachineLog,
  formatLogTime,
  parseMachineLog,
  type MachineLogLine,
} from '../machine-log'

type MachineLogs = {
  channels: { name: string; text: string }[]
}

const channelOrder = ['init', 'preview', 'docker'] as const
const channelLabel: Record<string, string> = {
  init: 'Init',
  preview: 'Preview',
  docker: 'Container',
}

type ShellEntry = {
  command: string
  exitCode: number
  stdout: string
  stderr: string
}

function dockerRunning(text: string) {
  return text.includes('API listen on /var/run/docker.sock')
}

function logLevelClass(level: string) {
  const name = level.toLowerCase()
  if (name === 'error' || name === 'fatal' || name === 'panic')
    return 'text-destructive'
  if (name === 'warning' || name === 'warn')
    return 'text-amber-600 dark:text-amber-400'
  return 'text-muted-foreground'
}

function LogLines({ lines }: { lines: MachineLogLine[] }) {
  return (
    <ol className="space-y-1 font-mono text-xs leading-5">
      {lines.map((line, index) => (
        <li key={index} className="flex gap-2">
          {line.time && (
            <time
              className="shrink-0 text-muted-foreground tabular-nums"
              dateTime={line.time}
            >
              {formatLogTime(line.time)}
            </time>
          )}
          {line.level && (
            <span className={`w-12 shrink-0 ${logLevelClass(line.level)}`}>
              {line.level}
            </span>
          )}
          <span className="min-w-0 break-all">{line.message}</span>
        </li>
      ))}
    </ol>
  )
}

function Prompt({ children }: { children?: string }) {
  return (
    <p>
      <span className="text-muted-foreground">/work $</span>
      {children ? ` ${children}` : null}
    </p>
  )
}

function MachineShell({ id }: { id: string }) {
  const [command, setCommand] = useState('')
  const [entries, setEntries] = useState<ShellEntry[]>([])
  const exec = useMutation({
    mutationFn: (next: string) =>
      apiJsonBody<Omit<ShellEntry, 'command'>>(
        `/api/vms/${encodeURIComponent(id)}/exec`,
        'POST',
        { command: next },
        'Could not exec',
      ),
    onSuccess: (result, next) => {
      setEntries((current) => [...current, { command: next, ...result }])
    },
  })
  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/50 m-2 border border-foreground/10 rounded-md">
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-3 py-3">
        <div className="font-mono text-xs leading-5">
          <ol className="space-y-3">
            {entries.map((entry, index) => (
              <li key={index}>
                <Prompt>{entry.command}</Prompt>
                {entry.stdout ? (
                  <pre className="mt-1 whitespace-pre-wrap break-all">
                    {entry.stdout}
                  </pre>
                ) : null}
                {entry.stderr ? (
                  <pre className="mt-1 whitespace-pre-wrap break-all text-destructive">
                    {entry.stderr}
                  </pre>
                ) : null}
                {entry.exitCode !== 0 && (
                  <p className="mt-1 text-destructive">exit {entry.exitCode}</p>
                )}
              </li>
            ))}
          </ol>
          {exec.isPending && exec.variables && (
            <div className="mt-3">
              <Prompt>{exec.variables}</Prompt>
              <p className="mt-1 text-muted-foreground" role="status">
                <AgentThinking label="Running" />
              </p>
            </div>
          )}
          {exec.error && (
            <p className="mt-3 break-all text-destructive" role="alert">
              {exec.error instanceof Error
                ? exec.error.message
                : 'Could not exec'}
            </p>
          )}
          <form
            className="mt-3 flex items-baseline gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              const next = command.trim()
              if (!next || exec.isPending) return
              setCommand('')
              exec.mutate(next)
            }}
          >
            <span className="shrink-0 text-muted-foreground">/work $</span>
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              className="min-w-0 flex-1 bg-transparent caret-foreground outline-none disabled:opacity-50"
              disabled={exec.isPending}
              aria-label="Command in /work"
              autoComplete="off"
              spellCheck={false}
            />
          </form>
        </div>
      </div>
    </div>
  )
}

export function MachineConsole({ id }: { id: string }) {
  const [tab, setTab] = useState('init')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const { data, error, isPending } = useQuery({
    queryKey: ['vms', id, 'logs'],
    queryFn: () =>
      apiJson<MachineLogs>(
        `/api/vms/${encodeURIComponent(id)}/logs`,
        undefined,
        'Could not load machine logs',
      ),
    refetchInterval: 2_000,
  })
  const channels = data?.channels
    .map((channel) => ({
      ...channel,
      lines: filterMachineLog(parseMachineLog(channel.text), deferredSearch),
    }))
    .sort(
      (a, b) =>
        channelOrder.indexOf(a.name as (typeof channelOrder)[number]) -
        channelOrder.indexOf(b.name as (typeof channelOrder)[number]),
    )
  const searching = deferredSearch.trim().length > 0
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b px-4 py-3">
        <h3 className="text-xs font-semibold">
          Machine console
        </h3>
        {tab !== 'shell' && (
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search console…"
              className="h-8 pr-8 pl-8 text-sm"
              aria-label="Search Machine console"
            />
            {search && (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="absolute top-1/2 right-1 -translate-y-1/2"
                aria-label="Clear search"
                onClick={() => setSearch('')}
              >
                <X />
              </Button>
            )}
          </div>
        )}
      </div>
      {isPending && !data && (
        <p className="px-4 py-3 text-sm text-muted-foreground" role="status">
          <AgentThinking label="Loading logs" />
        </p>
      )}
      {error && (
        <p
          className="px-4 py-3 text-sm break-all text-destructive"
          role="alert"
        >
          {error instanceof Error
            ? error.message
            : 'Could not load machine logs'}
        </p>
      )}
      {channels && (
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="min-h-0 flex-1 gap-0 overflow-hidden"
        >
          <div className="shrink-0 px-4 pt-3">
            <TabsList className="w-full">
              {channels.map((channel) => (
                <TabsTrigger key={channel.name} value={channel.name}>
                  {channelLabel[channel.name] ?? channel.name}
                  {channel.name === 'docker' && dockerRunning(channel.text) && (
                    <Badge variant="success">running</Badge>
                  )}
                </TabsTrigger>
              ))}
              <TabsTrigger value="shell">Shell</TabsTrigger>
            </TabsList>
          </div>
          {channels.map((channel) => (
            <TabsContent
              key={channel.name}
              value={channel.name}
              className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
            >
              {channel.lines.length ? (
                <LogLines lines={channel.lines} />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {searching ? 'No matching lines.' : 'No output yet.'}
                </p>
              )}
            </TabsContent>
          ))}
          <TabsContent
            value="shell"
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <MachineShell id={id} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
