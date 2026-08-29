import { AgentMark } from '#/features/agents/agent-mark'
import {
  agentDefinitionsQueryKey,
  useAgentDefinitions,
} from '#/features/agents/use-agent-definitions'
import { SettingsCard } from '#/features/workspace/settings-card'
import { apiJsonBody } from '#/lib/api-transport'
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
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Textarea } from '#/components/ui/textarea'
import type { AgentDefinition } from '#/features/schedules/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { Author } from '#/features/rooms/types'

type AgentForm = {
  name: string
  description: string
  instructions: string
  kind: 'cursor' | 'openai-agents'
  visibility: 'private' | 'workspace'
  githubAccess: boolean
}

const emptyForm = (): AgentForm => ({
  name: '',
  description: '',
  instructions: '',
  kind: 'openai-agents',
  visibility: 'workspace',
  githubAccess: false,
})

export function AgentsPage({ user }: { user: Author }) {
  const queryClient = useQueryClient()
  const { data: agents = [] } = useAgentDefinitions()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<AgentDefinition | undefined>()
  const [form, setForm] = useState<AgentForm>(emptyForm)
  const [error, setError] = useState<string>()
  const isAdmin = user.role === 'admin'

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: agentDefinitionsQueryKey })

  const save = useMutation({
    mutationFn: async () => {
      if (editing)
        return apiJsonBody<{ agent: AgentDefinition }>(
          `/api/agent-definitions/${encodeURIComponent(editing.id)}`,
          'PATCH',
          {
            name: form.name,
            description: form.description,
            instructions: form.instructions,
            visibility: form.visibility,
            ...(isAdmin ? { githubAccess: form.githubAccess } : {}),
          },
          'Unable to update agent definition',
        )
      return apiJsonBody<{ agent: AgentDefinition }>(
        '/api/agent-definitions',
        'POST',
        {
          ...form,
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
    setError(undefined)
    setOpen(true)
  }

  const openEdit = (agent: AgentDefinition) => {
    setEditing(agent)
    setForm({
      name: agent.name,
      description: agent.description,
      instructions: agent.instructions ?? '',
      kind: agent.kind ?? 'openai-agents',
      visibility: agent.visibility ?? 'workspace',
      githubAccess: agent.includeRepository,
    })
    setError(undefined)
    setOpen(true)
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-4 sm:p-6 lg:p-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Agents</p>
            <p className="text-xs text-muted-foreground">
              Create or duplicate Agent definitions. Only you can edit or archive
              ones you created.
            </p>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            New agent
          </Button>
        </div>
        <div className="grid gap-3">
          {agents.map((agent) => {
            const canEdit = agent.creatorAccountId === user.id
            return (
              <SettingsCard
                key={agent.id}
                title={agent.name}
                description={
                  <span className="flex items-center gap-2">
                    <AgentMark agentId={agent.id} className="size-4" />
                    @{agent.id}
                    {agent.visibility === 'private' ? ' · Private' : ''}
                    {agent.includeRepository ? ' · GitHub' : ''}
                  </span>
                }
              >
                <p className="text-sm text-muted-foreground">
                  {agent.description}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => duplicate.mutate(agent.id)}
                  >
                    Duplicate
                  </Button>
                  {canEdit && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(agent)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => archive.mutate(agent.id)}
                      >
                        Archive
                      </Button>
                    </>
                  )}
                </div>
              </SettingsCard>
            )
          })}
        </div>
      </main>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Edit agent' : 'New agent'}
            </DialogTitle>
            <DialogDescription>
              Colony assigns the image and execution limits. GitHub access is
              administrator-gated.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Input
              placeholder="Name"
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
            />
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
              value={form.instructions}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  instructions: event.target.value,
                }))
              }
            />
            {!editing && (
              <Select
                value={form.kind}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    kind: value as AgentForm['kind'],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai-agents">openai-agents</SelectItem>
                  <SelectItem value="cursor">cursor</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select
              value={form.visibility}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  visibility: value as AgentForm['visibility'],
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workspace">Workspace</SelectItem>
                <SelectItem value="private">Private</SelectItem>
              </SelectContent>
            </Select>
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
                GitHub access
              </label>
            )}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending}
            >
              {editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
