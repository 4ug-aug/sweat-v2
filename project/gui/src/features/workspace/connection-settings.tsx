import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import { AgentThinking } from '#/components/ui/agent-thinking'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '#/components/ui/hover-card'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { AgentMark } from '#/features/agents/agent-mark'
import { agentDefinitionsQueryKey } from '#/features/agents/use-agent-definitions'
import { SettingsCard } from '#/features/workspace/settings-card'
import { apiFetch, apiJson, apiJsonBody } from '#/lib/api-transport'
import { cn } from '#/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState, type ReactNode } from 'react'

type ConnectionField = {
  key: string
  label: string
  kind: 'text' | 'url' | 'select'
  options?: readonly { value: string; label: string }[]
}

type PublicConnection = {
  id: string
  name: string
  icon: string
  capabilityId: string
  tools: readonly string[]
  secretLabel: string
  fieldSchema: ConnectionField[]
  configured: boolean
  values: Record<string, string>
  linkedAgentIds: string[]
}

type ConnectionAgent = {
  id: string
  name: string
}

type ConnectionsCatalog = {
  connections: PublicConnection[]
  agents: ConnectionAgent[]
}

const workspaceConnectionsQueryKey = [
  'workspace-settings',
  'connections',
] as const

function connectionSummary(connection: PublicConnection): string | undefined {
  const host = connection.values.host?.trim()
  const database = connection.values.database?.trim()
  if (host && database) {
    return `${host}:${connection.values.port?.trim() || '5432'}/${database}`
  }
  const shown = Object.values(connection.values).filter((value) => value.trim())
  return shown.length ? shown.join(' · ') : undefined
}

function useWorkspaceConnections() {
  return useQuery({
    queryKey: workspaceConnectionsQueryKey,
    queryFn: () =>
      apiJson<ConnectionsCatalog>(
        '/api/workspace/settings/connections',
        undefined,
        'Could not load connections',
      ),
  })
}

export function ConnectionSettings() {
  const queryClient = useQueryClient()
  const { data, isPending, error, isFetching } = useWorkspaceConnections()
  const [actionError, setActionError] = useState<string>()

  const refreshAgentDefinitions = () =>
    void queryClient.refetchQueries({ queryKey: agentDefinitionsQueryKey })

  const refreshConnections = () =>
    queryClient.invalidateQueries({ queryKey: workspaceConnectionsQueryKey })

  if (isPending) {
    return (
      <SettingsCard title="Connections">
        <p className="text-sm text-muted-foreground" role="status">
          <AgentThinking label="Loading connections" />
        </p>
      </SettingsCard>
    )
  }

  if (error || !data) {
    return (
      <SettingsCard title="Connections">
        <p className="text-sm text-destructive" role="alert">
          {error instanceof Error
            ? error.message
            : 'Could not load connections'}
        </p>
      </SettingsCard>
    )
  }

  return (
    <SettingsCard
      title="Connections"
      description="Configure external providers and link them to agents. Clear removes credentials and all links for that connection."
    >
      {actionError && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {actionError}
        </p>
      )}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {data.connections.map((connection) => (
          <li key={connection.id} className="h-full">
            <ConnectionCard
              agents={data.agents}
              connection={connection}
              refreshing={isFetching}
              onError={setActionError}
              onUpdated={(next) => {
                setActionError(undefined)
                queryClient.setQueryData<ConnectionsCatalog>(
                  workspaceConnectionsQueryKey,
                  (current) =>
                    current
                      ? {
                          ...current,
                          connections: current.connections.map((item) =>
                            item.id === next.id ? next : item,
                          ),
                        }
                      : current,
                )
                refreshAgentDefinitions()
                void refreshConnections()
              }}
            />
          </li>
        ))}
      </ul>
    </SettingsCard>
  )
}

function ConnectionCard({
  connection,
  agents,
  refreshing,
  onUpdated,
  onError,
}: {
  connection: PublicConnection
  agents: ConnectionAgent[]
  refreshing: boolean
  onUpdated: (connection: PublicConnection) => void
  onError: (message: string | undefined) => void
}) {
  const extraConfig = (connection.fieldSchema ?? []).length > 1
  const summary = extraConfig ? connectionSummary(connection) : undefined
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState<Record<string, string>>(
    () => connection.values,
  )
  const [apiKey, setApiKey] = useState('')
  const [formError, setFormError] = useState<string>()

  const save = useMutation({
    mutationFn: () =>
      apiJsonBody<{ connection: PublicConnection }>(
        '/api/workspace/settings/connections',
        'PUT',
        { kind: connection.id, fields: values, apiKey },
        'Could not save connection',
      ),
    onSuccess: (result) => {
      setApiKey('')
      setValues(result.connection.values)
      setFormError(undefined)
      setEditing(false)
      onError(undefined)
      onUpdated(result.connection)
    },
    onError: (reason) => {
      const message =
        reason instanceof Error ? reason.message : 'Could not save connection'
      setFormError(message)
      onError(message)
    },
  })

  const clear = useMutation({
    mutationFn: async () => {
      const response = await apiFetch(
        `/api/workspace/settings/connections/${encodeURIComponent(connection.id)}/clear`,
        { method: 'POST' },
      )
      const result = (await response.json()) as {
        connection?: PublicConnection
        error?: string
      }
      if (!response.ok)
        throw new Error(result.error ?? 'Could not clear connection')
      return result.connection!
    },
    onSuccess: (next) => {
      setApiKey('')
      setValues(next.values)
      setFormError(undefined)
      onError(undefined)
      onUpdated(next)
    },
    onError: (reason) => {
      const message =
        reason instanceof Error ? reason.message : 'Could not clear connection'
      setFormError(message)
      onError(message)
    },
  })

  const setLinks = useMutation({
    mutationFn: async (agentDefinitionIds: string[]) => {
      const response = await apiFetch(
        `/api/workspace/settings/connections/${encodeURIComponent(connection.id)}/links`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ agentDefinitionIds }),
        },
      )
      const result = (await response.json()) as {
        linkedAgentIds?: string[]
        error?: string
      }
      if (!response.ok)
        throw new Error(result.error ?? 'Could not update connection links')
      return result.linkedAgentIds ?? agentDefinitionIds
    },
    onSuccess: (linkedAgentIds) => {
      setFormError(undefined)
      onError(undefined)
      onUpdated({ ...connection, linkedAgentIds })
    },
    onError: (reason) => {
      const message =
        reason instanceof Error
          ? reason.message
          : 'Could not update connection links'
      setFormError(message)
      onError(message)
    },
  })

  const busy =
    save.isPending || clear.isPending || setLinks.isPending || refreshing

  return (
    <div className="flex h-full flex-col rounded-lg bg-background/80 p-3 shadow-sm ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <img
            alt=""
            className={cn(
              'size-8 shrink-0 object-contain',
              connection.id === 'outline' && 'dark:invert',
            )}
            src={connection.icon}
          />
          <div className="min-w-0">
            <h3 className="font-medium">{connection.name}</h3>
            <p className="text-sm text-muted-foreground">
              {connection.configured ? (
                <span className="inline-flex items-center gap-1 text-green-500">
                  <Check className="size-3.5" />
                  Configured
                </span>
              ) : (
                'Not configured'
              )}
            </p>
            {(connection.tools?.length ?? 0) > 0 && (
              <HoverCard>
                <HoverCardTrigger
                  delay={0}
                  closeDelay={100}
                  render={
                    <button
                      type="button"
                      className="mt-1 text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
                    />
                  }
                >
                  {connection.tools.length} tools
                </HoverCardTrigger>
                <HoverCardContent align="start" className="w-72" side="bottom">
                  <p className="text-xs font-medium">{connection.name} tools</p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {connection.tools.map((tool) => (
                      <li key={tool} className="text-xs text-muted-foreground">
                        {tool}
                      </li>
                    ))}
                  </ul>
                </HoverCardContent>
              </HoverCard>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {connection.configured && (
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                  />
                }
              >
                Clear
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear {connection.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes stored credentials and unlinks every agent from
                    this connection. Non-secret fields stay until you save
                    again.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={clear.isPending}
                    onClick={() => clear.mutate()}
                  >
                    {clear.isPending ? (
                      <AgentThinking label="Clearing" />
                    ) : (
                      'Clear'
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {extraConfig ? (
            <Button
              disabled={busy}
              onClick={() => setEditing(true)}
              size="sm"
              type="button"
              variant={connection.configured ? 'outline' : 'default'}
            >
              Configure
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => save.mutate()} size="sm">
              {save.isPending ? <AgentThinking label="Saving" /> : 'Save'}
            </Button>
          )}
        </div>
      </div>

      {formError && !editing && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {formError}
        </p>
      )}

      {extraConfig && connection.configured && summary && (
        <p className="mt-3 truncate font-mono text-xs text-muted-foreground">
          {summary}
        </p>
      )}

      {!extraConfig && (
        <ConnectionFields
          apiKey={apiKey}
          busy={busy}
          className="mt-4"
          connection={connection}
          onApiKeyChange={setApiKey}
          onFieldChange={(key, value) =>
            setValues((current) => ({ ...current, [key]: value }))
          }
          values={values}
        />
      )}

      {extraConfig && (
        <Dialog open={editing} onOpenChange={setEditing}>
          <DialogContent className="sm:max-w-lg" showCloseButton>
            <DialogHeader>
              <DialogTitle>Configure {connection.name}</DialogTitle>
              <DialogDescription>
                {`${(connection.fieldSchema ?? []).map((field) => field.label).join(', ')}.`}
              </DialogDescription>
            </DialogHeader>
            {formError && (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            )}
            <ConnectionFields
              apiKey={apiKey}
              busy={busy}
              compact
              connection={connection}
              labeled
              onApiKeyChange={setApiKey}
              onFieldChange={(key, value) =>
                setValues((current) => ({ ...current, [key]: value }))
              }
              values={values}
            />
            <DialogFooter>
              <Button
                onClick={() => setEditing(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => save.mutate()}>
                {save.isPending ? <AgentThinking label="Saving" /> : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <div className="mt-auto space-y-2 pt-3">
        <p className="text-sm font-medium">Link to agents</p>
        {agents.map((agent) => {
          const linked = (connection.linkedAgentIds ?? []).includes(agent.id)
          const canLink = connection.configured && !busy
          const row = (
            <label
              className={cn(
                'flex items-center gap-2 text-sm',
                !canLink && 'cursor-not-allowed opacity-60',
              )}
            >
              <Checkbox
                checked={linked}
                disabled={!canLink}
                onCheckedChange={(checked) => {
                  const next = new Set(connection.linkedAgentIds ?? [])
                  if (checked) next.add(agent.id)
                  else next.delete(agent.id)
                  setLinks.mutate([...next])
                }}
              />
              <AgentMark agentId={agent.id} />
              Link to {agent.name}
            </label>
          )
          if (connection.configured) {
            return <div key={agent.id}>{row}</div>
          }
          return (
            <Tooltip key={agent.id}>
              <TooltipTrigger render={<span className="block w-full" />}>
                {row}
              </TooltipTrigger>
              <TooltipContent side="top">
                Configure this connection before linking agents
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}

function ConnectionFields({
  connection,
  values,
  onFieldChange,
  apiKey,
  onApiKeyChange,
  busy,
  labeled,
  compact,
  className,
}: {
  connection: PublicConnection
  values: Record<string, string>
  onFieldChange: (key: string, value: string) => void
  apiKey: string
  onApiKeyChange: (value: string) => void
  busy: boolean
  labeled?: boolean
  compact?: boolean
  className?: string
}) {
  return (
    <div className={cn('grid gap-3', compact && 'sm:grid-cols-2', className)}>
      {(connection.fieldSchema ?? []).map((field) => {
        const control =
          field.kind === 'select' && field.options?.length ? (
            <Select
              disabled={busy}
              onValueChange={(value) => onFieldChange(field.key, value ?? '')}
              value={values[field.key] || field.options[0]!.value}
            >
              <SelectTrigger
                aria-label={`${connection.name} ${field.label}`}
                className="w-full"
              >
                <SelectValue placeholder={field.label} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {field.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <Input
              aria-label={`${connection.name} ${field.label}`}
              disabled={busy}
              onChange={(event) =>
                onFieldChange(field.key, event.target.value)
              }
              placeholder={field.label}
              type={field.kind === 'url' ? 'url' : 'text'}
              value={values[field.key] ?? ''}
            />
          )
        return (
          <Field key={field.key} label={field.label} labeled={labeled}>
            {control}
          </Field>
        )
      })}
      <Field
        className={compact ? 'sm:col-span-2' : undefined}
        label={connection.secretLabel}
        labeled={labeled}
      >
        <Input
          aria-label={`${connection.name} ${connection.secretLabel}`}
          disabled={busy}
          onChange={(event) => onApiKeyChange(event.target.value)}
          placeholder={
            connection.configured
              ? `Leave blank to keep current ${connection.secretLabel.toLowerCase()}`
              : connection.secretLabel
          }
          type="password"
          value={apiKey}
        />
      </Field>
    </div>
  )
}

function Field({
  label,
  labeled,
  className,
  children,
}: {
  label: string
  labeled?: boolean
  className?: string
  children: ReactNode
}) {
  if (!labeled) {
    return className ? <div className={className}>{children}</div> : children
  }
  return (
    <div className={cn('grid gap-1', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}
