import { Markdown } from '#/components/markdown'
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
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { AgentMark } from '#/features/agents/agent-mark'
import { agentDefinitionsQueryKey } from '#/features/agents/use-agent-definitions'
import { SettingsCard } from '#/features/workspace/settings-card'
import { apiFetch, apiJson } from '#/lib/api-transport'
import { cn } from '#/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { useRef, useState } from 'react'

type WorkspaceSkill = {
  id: string
  name: string
  description: string
}

type SkillAgent = {
  id: string
  name: string
}

type SkillsCatalog = {
  skills: WorkspaceSkill[]
  attachments: Record<string, string[]>
  agents: SkillAgent[]
}

type SkillPackageDetail = {
  skill: WorkspaceSkill
  files: { path: string; content: string }[]
}

const workspaceSkillsQueryKey = ['workspace-settings', 'skills'] as const

function skillMarkdownBody(content: string): string {
  if (!content.startsWith('---')) return content
  const end = content.indexOf('\n---', 3)
  if (end === -1) return content
  return content.slice(end + 4).replace(/^\r?\n/, '')
}

function useWorkspaceSkills() {
  return useQuery({
    queryKey: workspaceSkillsQueryKey,
    queryFn: () =>
      apiJson<SkillsCatalog>(
        '/api/workspace/settings/skills',
        undefined,
        'Could not load skills',
      ),
  })
}

function isSkillPackageFile(file: File) {
  const name = file.name.toLowerCase()
  return (
    name.endsWith('.md') ||
    name.endsWith('.zip') ||
    file.type === 'text/markdown' ||
    file.type === 'text/x-markdown' ||
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed'
  )
}

export function AgentSkillsSettings() {
  const queryClient = useQueryClient()
  const { data, isPending, error, isFetching } = useWorkspaceSkills()
  const [skillFile, setSkillFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [pendingSkillId, setPendingSkillId] = useState<string>()
  const [viewingSkillId, setViewingSkillId] = useState<string>()
  const [actionError, setActionError] = useState<string>()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const acceptSkillFile = (file: File | undefined) => {
    if (!file) {
      setSkillFile(null)
      return
    }
    if (!isSkillPackageFile(file)) {
      setActionError('Choose a SKILL.md or skill package zip')
      return
    }
    setActionError(undefined)
    setSkillFile(file)
  }

  const skillDetail = useQuery({
    queryKey: [...workspaceSkillsQueryKey, 'detail', viewingSkillId] as const,
    queryFn: () =>
      apiJson<SkillPackageDetail>(
        `/api/workspace/settings/skills/${encodeURIComponent(viewingSkillId!)}`,
        undefined,
        'Could not load skill',
      ),
    enabled: viewingSkillId !== undefined,
  })

  const refreshAgentDefinitions = () =>
    void queryClient.refetchQueries({ queryKey: agentDefinitionsQueryKey })

  const refreshSkills = () =>
    queryClient.invalidateQueries({ queryKey: workspaceSkillsQueryKey })

  const importSkill = useMutation({
    mutationFn: async () => {
      if (!skillFile) throw new Error('Choose a SKILL.md or skill package zip')
      const body = new FormData()
      body.set('package', skillFile)
      const response = await apiFetch('/api/workspace/settings/skills', {
        method: 'POST',
        body,
      })
      const result = (await response.json()) as { error?: string }
      if (!response.ok)
        throw new Error(result.error ?? 'Could not import skill package')
    },
    onSuccess: () => {
      setSkillFile(null)
      setActionError(undefined)
      void refreshSkills()
      refreshAgentDefinitions()
    },
    onError: (reason) => {
      setActionError(
        reason instanceof Error
          ? reason.message
          : 'Could not import skill package',
      )
    },
  })

  const deleteSkill = useMutation({
    mutationFn: async (skill: WorkspaceSkill) => {
      setPendingSkillId(skill.id)
      const response = await apiFetch(
        `/api/workspace/settings/skills/${encodeURIComponent(skill.id)}`,
        { method: 'DELETE' },
      )
      if (!response.ok) throw new Error('Could not delete skill')
      return skill.id
    },
    onMutate: async (skill) => {
      await queryClient.cancelQueries({ queryKey: workspaceSkillsQueryKey })
      const previous = queryClient.getQueryData<SkillsCatalog>(
        workspaceSkillsQueryKey,
      )
      if (previous) {
        const attachments: Record<string, string[]> = {}
        for (const [agentId, skillIds] of Object.entries(
          previous.attachments,
        )) {
          attachments[agentId] = skillIds.filter((id) => id !== skill.id)
        }
        queryClient.setQueryData<SkillsCatalog>(workspaceSkillsQueryKey, {
          ...previous,
          skills: previous.skills.filter((entry) => entry.id !== skill.id),
          attachments,
        })
      }
      return { previous }
    },
    onError: (reason, _skill, context) => {
      if (context?.previous) {
        queryClient.setQueryData(workspaceSkillsQueryKey, context.previous)
      }
      setActionError(
        reason instanceof Error ? reason.message : 'Could not delete skill',
      )
    },
    onSuccess: () => {
      setActionError(undefined)
      refreshAgentDefinitions()
    },
    onSettled: () => {
      setPendingSkillId(undefined)
      void refreshSkills()
    },
  })

  const toggleAttachment = useMutation({
    mutationFn: async (input: {
      agentDefinitionId: string
      skillId: string
      skillIds: string[]
    }) => {
      setPendingSkillId(input.skillId)
      const response = await apiFetch(
        `/api/workspace/settings/skills/attachments/${encodeURIComponent(input.agentDefinitionId)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ skillIds: input.skillIds }),
        },
      )
      const result = (await response.json()) as {
        skillIds?: string[]
        error?: string
      }
      if (!response.ok)
        throw new Error(result.error ?? 'Could not update skill attachments')
      return {
        agentDefinitionId: input.agentDefinitionId,
        skillIds: result.skillIds ?? input.skillIds,
      }
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: workspaceSkillsQueryKey })
      const previous = queryClient.getQueryData<SkillsCatalog>(
        workspaceSkillsQueryKey,
      )
      if (previous) {
        queryClient.setQueryData<SkillsCatalog>(workspaceSkillsQueryKey, {
          ...previous,
          attachments: {
            ...previous.attachments,
            [input.agentDefinitionId]: input.skillIds,
          },
        })
      }
      return { previous }
    },
    onError: (reason, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(workspaceSkillsQueryKey, context.previous)
      }
      setActionError(
        reason instanceof Error
          ? reason.message
          : 'Could not update skill attachments',
      )
    },
    onSuccess: (result) => {
      setActionError(undefined)
      queryClient.setQueryData<SkillsCatalog>(
        workspaceSkillsQueryKey,
        (current) =>
          current
            ? {
                ...current,
                attachments: {
                  ...current.attachments,
                  [result.agentDefinitionId]: result.skillIds,
                },
              }
            : current,
      )
      refreshAgentDefinitions()
    },
    onSettled: () => {
      setPendingSkillId(undefined)
    },
  })

  const skills = data?.skills ?? []
  const attachments = data?.attachments ?? {}
  const agents = data?.agents ?? []
  const busy = importSkill.isPending || isFetching
  const detailError =
    skillDetail.error instanceof Error ? skillDetail.error.message : undefined

  return (
    <SettingsCard
      title="Agent skills"
      description={
        <>
          Import a <code className="text-[0.85em]">SKILL.md</code> file or a zip
          of a markdown Agent Skills package, then attach it to agent
          definitions. Skills are staged into each runtime&apos;s expected
          layout at run start.
        </>
      }
    >
      {(error || actionError || detailError) && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {actionError ??
            detailError ??
            (error instanceof Error ? error.message : 'Could not load skills')}
        </p>
      )}
      <div className="grid gap-3">
        <div className="grid gap-3">
          <button
            type="button"
            disabled={busy}
            aria-label="Skill markdown or package zip"
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault()
              if (!busy) setDragActive(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              if (!busy) setDragActive(true)
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              setDragActive(false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              setDragActive(false)
              if (busy) return
              acceptSkillFile(event.dataTransfer.files?.[0])
            }}
            className={cn(
              'flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-center transition-colors',
              'outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
              'disabled:pointer-events-none disabled:opacity-50',
              dragActive
                ? 'border-ring bg-muted/60'
                : 'border-input bg-transparent hover:bg-muted/40',
            )}
          >
            <Upload className="size-5 text-muted-foreground" aria-hidden />
            <span className="text-sm">
              {skillFile
                ? skillFile.name
                : 'Drop a SKILL.md or skill package zip here'}
            </span>
            <span className="text-xs text-muted-foreground">
              or click to browse
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.zip,text/markdown,application/zip"
            className="sr-only"
            tabIndex={-1}
            disabled={busy}
            onChange={(event) => {
              acceptSkillFile(event.target.files?.[0])
              event.target.value = ''
            }}
          />
          <div className="flex items-center gap-3">
            <Button
              disabled={busy || !skillFile}
              onClick={() => importSkill.mutate()}
            >
              {importSkill.isPending ? (
                <AgentThinking label="Importing" />
              ) : (
                'Import skill'
              )}
            </Button>
            {skillFile && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setSkillFile(null)}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
        {isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            <AgentThinking label="Loading skills" />
          </p>
        ) : skills.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No skills imported yet.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {skills.map((skill) => {
              const skillBusy = pendingSkillId === skill.id
              return (
                <li
                  key={skill.id}
                  className="flex h-full flex-col rounded-lg bg-background/80 p-3 shadow-sm ring-1 ring-foreground/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-sm text-left outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setViewingSkillId(skill.id)}
                    >
                      <p className="font-medium">{skill.name}</p>
                      <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
                        {skill.description}
                      </p>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy || skillBusy}
                        onClick={() => setViewingSkillId(skill.id)}
                      >
                        View
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={busy || skillBusy}
                            />
                          }
                        >
                          Delete
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Delete {skill.name}?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              This removes the skill from the workspace catalog
                              and detaches it from every agent definition.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              disabled={skillBusy}
                              onClick={() => deleteSkill.mutate(skill)}
                            >
                              {skillBusy ? (
                                <AgentThinking label="Deleting" />
                              ) : (
                                'Delete'
                              )}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                  <div className="mt-auto space-y-2 border-t pt-3">
                    {skillBusy && (
                      <p
                        className="text-sm text-muted-foreground"
                        role="status"
                      >
                        <AgentThinking label="Updating attachments" />
                      </p>
                    )}
                    {agents.map((agent) => {
                      const attached = (attachments[agent.id] ?? []).includes(
                        skill.id,
                      )
                      return (
                        <label
                          key={`${agent.id}-${skill.id}`}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Checkbox
                            checked={attached}
                            disabled={busy || skillBusy}
                            onCheckedChange={() => {
                              const current = attachments[agent.id] ?? []
                              const skillIds = attached
                                ? current.filter((id) => id !== skill.id)
                                : [...current, skill.id]
                              toggleAttachment.mutate({
                                agentDefinitionId: agent.id,
                                skillId: skill.id,
                                skillIds,
                              })
                            }}
                          />
                          <AgentMark agentId={agent.id} />
                          Attach to {agent.name}
                        </label>
                      )
                    })}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <Dialog
        open={viewingSkillId !== undefined}
        onOpenChange={(open) => {
          if (!open) setViewingSkillId(undefined)
        }}
      >
        <DialogContent
          className="flex max-h-[min(85vh,44rem)] flex-col gap-3 sm:max-w-2xl"
          showCloseButton
        >
          <DialogHeader>
            <DialogTitle>
              {skillDetail.data?.skill.name ??
                skills.find((skill) => skill.id === viewingSkillId)?.name ??
                'Skill'}
            </DialogTitle>
            <DialogDescription>
              {skillDetail.data?.skill.description ??
                skills.find((skill) => skill.id === viewingSkillId)
                  ?.description ??
                'Full skill package contents.'}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {skillDetail.isPending && (
              <p className="text-sm text-muted-foreground" role="status">
                <AgentThinking label="Loading skill" />
              </p>
            )}
            {!skillDetail.isPending &&
              skillDetail.data?.files.map((file) => (
                <section key={file.path} className="mb-6 last:mb-0">
                  {file.path !== 'SKILL.md' && (
                    <h3 className="mb-2 font-mono text-xs font-medium text-muted-foreground">
                      {file.path}
                    </h3>
                  )}
                  <div className="text-sm leading-6">
                    <Markdown>
                      {file.path === 'SKILL.md'
                        ? skillMarkdownBody(file.content)
                        : file.content}
                    </Markdown>
                  </div>
                </section>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  )
}
