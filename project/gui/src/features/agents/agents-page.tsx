import { ColonyMark } from '#/components/colony-mark'
import { AgentMark, AgentMarkGlyph } from '#/features/agents/agent-mark'
import { agentInk, agentMarkClass } from '#/features/agents/agent-color'
import { formatRelativeTime } from '#/features/agents/format'
import {
  agentDefinitionsQueryKey,
  useAgentDefinitions,
} from '#/features/agents/use-agent-definitions'
import { isSeededAgentId } from '#project/agents/roster-people'
import { useWorkspaceMembers } from '#/features/issues/use-workspace-members'
import { SettingsCard } from '#/features/workspace/settings-card'
import { apiJsonBody } from '#/lib/api-transport'
import { ACCOUNT_COLORS, parseAccountColor } from '#/lib/account-color'
import { cn } from '#/lib/utils'
import { GitHubIcon } from '#/components/github-icon'
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
import { BrailleLoader } from '#/components/ui/braille-loader'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '#/components/ui/sheet'
import { Textarea } from '#/components/ui/textarea'
import { Toggle } from '#/components/ui/toggle'
import type { AgentDefinition } from '#/features/schedules/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Archive, CopyPlus, Lock, Plus, SquarePen, Users } from 'lucide-react'
import { useState } from 'react'
import type { Author } from '#/features/rooms/types'

type AgentForm = {
  name: string
  description: string
  instructions: string
  kind: 'cursor' | 'openai-agents'
  visibility: 'private' | 'workspace'
  githubAccess: boolean
  color: string
}

const emptyForm = (): AgentForm => ({
  name: '',
  description: '',
  instructions: '',
  kind: 'openai-agents',
  visibility: 'workspace',
  githubAccess: false,
  color: ACCOUNT_COLORS[0]!,
})

export function AgentsPage({ user }: { user: Author }) {
  const queryClient = useQueryClient()
  const { data: agents = [] } = useAgentDefinitions()
  const { data: members = [] } = useWorkspaceMembers()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<AgentDefinition | undefined>()
  const [form, setForm] = useState<AgentForm>(emptyForm)
  const [hexInput, setHexInput] = useState<string>(ACCOUNT_COLORS[0]!)
  const [error, setError] = useState<string>()
  const isAdmin = user.role === 'admin'
  const previewInk = agentInk(form.color)
  const previewId = editing?.id ?? (form.name.trim() || 'agent')
  const parsedHex = hexInput.trim() ? parseAccountColor(hexInput) : undefined
  const hexInvalid = Boolean(hexInput.trim()) && !parsedHex

  const setColor = (hex: string) => {
    setHexInput(hex)
    setForm((current) => ({ ...current, color: hex }))
  }

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: agentDefinitionsQueryKey })

  const save = useMutation({
    mutationFn: async () => {
      const color = hexInput.trim() ? parseAccountColor(hexInput) : undefined
      if (hexInput.trim() && !color)
        throw new Error('Enter a hex color like #1d4ed8')
      if (editing)
        return apiJsonBody<{ agent: AgentDefinition }>(
          `/api/agent-definitions/${encodeURIComponent(editing.id)}`,
          'PATCH',
          {
            name: form.name,
            description: form.description,
            instructions: form.instructions,
            visibility: form.visibility,
            color: color ?? '',
            ...(isAdmin ? { githubAccess: form.githubAccess } : {}),
          },
          'Unable to update agent definition',
        )
      return apiJsonBody<{ agent: AgentDefinition }>(
        '/api/agent-definitions',
        'POST',
        {
          ...form,
          color: color ?? '',
          githubAccess: isAdmin ? form.githubAccess : false,
        },
        'Unable to create agent definition',
      )
    },
    onSuccess: async () => {
      setOpen(false)
      setEditing(undefined)
      setError(undefined)
      await refresh()
    },
    onError: (reason) =>
      setError(reason instanceof Error ? reason.message : 'Unable to save'),
  })

  const duplicate = useMutation({
    mutationFn: (id: string) =>
      apiJsonBody<{ agent: AgentDefinition }>(
        `/api/agent-definitions/${encodeURIComponent(id)}/duplicate`,
        'POST',
        undefined,
        'Unable to duplicate agent definition',
      ),
    onSuccess: refresh,
  })

  const archive = useMutation({
    mutationFn: (id: string) =>
      apiJsonBody<{ agent: AgentDefinition }>(
        `/api/agent-definitions/${encodeURIComponent(id)}/archive`,
        'POST',
        undefined,
        'Unable to archive agent definition',
      ),
    onSuccess: refresh,
  })

  const openCreate = () => {
    setEditing(undefined)
    setForm(emptyForm())
    setHexInput(ACCOUNT_COLORS[0]!)
    setError(undefined)
    setOpen(true)
  }

  const openEdit = (agent: AgentDefinition) => {
    const color = agentInk(agent.color) ?? ''
    setEditing(agent)
    setForm({
      name: agent.name,
      description: agent.description,
      instructions: agent.instructions ?? '',
      kind: agent.kind ?? 'openai-agents',
      visibility: agent.visibility ?? 'workspace',
      githubAccess: agent.includeRepository,
      color,
    })
    setHexInput(color)
    setError(undefined)
    setOpen(true)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <ColonyMark className="size-4 text-muted-foreground" />
        <p className="font-semibold">Agents</p>
        <p className="hidden min-w-0 truncate text-sm text-muted-foreground sm:block">
          Create or duplicate Agent definitions. Only you can edit or archive
          ones you created.
        </p>
        <Button size="sm" className="ml-auto" onClick={openCreate}>
          <Plus data-icon="inline-start" />
          New agent
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-3 p-4 sm:p-6 lg:p-8">
          <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => {
            const canEdit = agent.creatorAccountId === user.id
            const canArchive = canEdit && !isSeededAgentId(agent.id)
            return (
              <SettingsCard
                key={agent.id}
                className="h-full"
                title={agent.name}
                leading={
                  <AgentMark
                    agentId={agent.id}
                    color={agent.color}
                    className="size-6"
                  />
                }
                description={
                  <>
                    @{agent.id}
                    {agent.visibility === 'private' ? ' · Private' : ''}
                    {agent.includeRepository ? ' · GitHub' : ''}
                  </>
                }
              >
                <p className="text-sm text-muted-foreground">
                  {agent.description}
                </p>
                <AgentAttribution
                  creatorName={accountName(members, agent.creatorAccountId)}
                  updaterName={accountName(
                    members,
                    agent.updaterAccountId ?? agent.creatorAccountId,
                  )}
                  updatedAt={agent.updatedAt}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={duplicate.isPending}
                        />
                      }
                    >
                      <CopyPlus data-icon="inline-start" />
                      Duplicate
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Duplicate {agent.name}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Creates a copy named “{agent.name} copy” that you
                          own. You can edit it afterward.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={duplicate.isPending}>
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          disabled={duplicate.isPending}
                          onClick={() => duplicate.mutate(agent.id)}
                        >
                          {duplicate.isPending ? (
                            <BrailleLoader text="Duplicating" />
                          ) : (
                            'Duplicate'
                          )}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEdit(agent)}
                    >
                      <SquarePen data-icon="inline-start" />
                      Edit
                    </Button>
                  )}
                  {canArchive && (
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={archive.isPending}
                          />
                        }
                      >
                        <Archive data-icon="inline-start" />
                        Archive
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Archive {agent.name}?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This hides the agent from the workspace and
                            pauses its active schedules. The slug stays
                            reserved.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={archive.isPending}>
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            disabled={archive.isPending}
                            onClick={() => archive.mutate(agent.id)}
                          >
                            {archive.isPending ? (
                              <BrailleLoader text="Archiving" />
                            ) : (
                              'Archive'
                            )}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </SettingsCard>
            )
          })}
          </div>
        </main>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="gap-0 p-0 sm:max-w-md"
        >
          <SheetHeader className="border-b">
            <SheetTitle>{editing ? 'Edit agent' : 'New agent'}</SheetTitle>
            <SheetDescription>
              Colony assigns the image and execution limits. GitHub access is
              administrator-gated.
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div className="flex items-center gap-3">
              <AgentMarkGlyph
                className={cn(
                  'size-10',
                  previewInk ? undefined : agentMarkClass(previewId),
                )}
                style={previewInk ? { color: previewInk } : undefined}
              />
              <Input
                placeholder="Name"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {ACCOUNT_COLORS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Use color ${hex}`}
                    aria-pressed={form.color === hex}
                    className={cn(
                      'size-7 rounded-full border border-border/70 transition-shadow',
                      form.color === hex &&
                        'ring-2 ring-ring ring-offset-2 ring-offset-background',
                    )}
                    style={{ backgroundColor: hex }}
                    onClick={() => setColor(hex)}
                  />
                ))}
                <input
                  type="color"
                  aria-label="Agent color picker"
                  value={previewInk ?? ACCOUNT_COLORS[0]!}
                  className="size-7 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
                  onChange={(event) => setColor(event.target.value)}
                />
                <Input
                  value={hexInput}
                  onChange={(event) => {
                    const value = event.target.value
                    setHexInput(value)
                    if (!value.trim())
                      return setForm((current) => ({ ...current, color: '' }))
                    const parsed = parseAccountColor(value)
                    if (parsed)
                      setForm((current) => ({ ...current, color: parsed }))
                  }}
                  placeholder="#1d4ed8"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  maxLength={7}
                  aria-label="Agent color hex"
                  aria-invalid={hexInvalid}
                  className="w-[7.25rem] font-mono"
                />
              </div>
              {hexInvalid ? (
                <p className="text-xs text-destructive" role="alert">
                  Enter a hex color like #1d4ed8
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Leave blank for an automatic color.
                </p>
              )}
            </div>
            <Input
              placeholder="Description"
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
            <Textarea
              placeholder="System instructions"
              className="min-h-32"
              value={form.instructions}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  instructions: event.target.value,
                }))
              }
            />
            <div className="flex items-center gap-2">
              {!editing && (
                <div className="min-w-0 flex-1">
                  <Select
                    value={form.kind}
                    onValueChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        kind: value as AgentForm['kind'],
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai-agents">
                        openai-agents
                      </SelectItem>
                      <SelectItem value="cursor">cursor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div
                role="group"
                aria-label="Visibility"
                className={cn(
                  'inline-flex h-9 shrink-0 items-center rounded-md bg-muted p-0.5',
                  editing && 'flex-1',
                )}
              >
                <Toggle
                  size="lg"
                  className="h-8 flex-1 px-2.5 text-muted-foreground hover:bg-transparent hover:text-foreground data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-sm data-pressed:hover:bg-background"
                  pressed={form.visibility === 'workspace'}
                  onPressedChange={(pressed) => {
                    if (pressed)
                      setForm((current) => ({
                        ...current,
                        visibility: 'workspace',
                      }))
                  }}
                >
                  <Users data-icon="inline-start" />
                  Workspace
                </Toggle>
                <Toggle
                  size="lg"
                  className="h-8 flex-1 px-2.5 text-muted-foreground hover:bg-transparent hover:text-foreground data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-sm data-pressed:hover:bg-background"
                  pressed={form.visibility === 'private'}
                  onPressedChange={(pressed) => {
                    if (pressed)
                      setForm((current) => ({
                        ...current,
                        visibility: 'private',
                      }))
                  }}
                >
                  <Lock data-icon="inline-start" />
                  Private
                </Toggle>
              </div>
            </div>
            {isAdmin && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.githubAccess}
                  onCheckedChange={(checked) =>
                    setForm((current) => ({
                      ...current,
                      githubAccess: checked === true,
                    }))
                  }
                />
                <GitHubIcon className="size-3.5" />
                GitHub access
              </label>
            )}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <div className="border-t p-4">
            <Button
              className="w-full"
              onClick={() => save.mutate()}
              disabled={save.isPending || hexInvalid}
            >
              {editing ? (
                <SquarePen data-icon="inline-start" />
              ) : (
                <Plus data-icon="inline-start" />
              )}
              {editing ? 'Save' : 'Create'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function accountName(
  members: { id: string; name: string; displayName?: string }[],
  id?: string,
) {
  if (!id) return undefined
  const member = members.find((account) => account.id === id)
  return member?.displayName || member?.name || id
}

function AgentAttribution({
  creatorName,
  updaterName,
  updatedAt,
}: {
  creatorName?: string
  updaterName?: string
  updatedAt?: number
}) {
  if (!creatorName && updatedAt === undefined) return null
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      {creatorName ? <span>Created by {creatorName}</span> : null}
      {updatedAt !== undefined ? (
        <time
          dateTime={new Date(updatedAt).toISOString()}
          title={new Date(updatedAt).toLocaleString()}
        >
          {`Updated by ${updaterName ?? creatorName} ${formatRelativeTime(updatedAt)}`}
        </time>
      ) : null}
    </p>
  )
}
