import { AgentThinking } from '#/components/ui/agent-thinking'
import { Button } from '#/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Textarea } from '#/components/ui/textarea'
import { SettingsCard } from '#/features/workspace/settings-card'
import { apiJson, apiJsonBody } from '#/lib/api-transport'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

type GrantMode = 'all' | 'allowlist' | 'model'

type GrantToolsConfig = {
  mode: GrantMode
  tools: string[]
  bundles: Record<string, string[]>
}

const grantToolsQueryKey = ['workspace-settings', 'grant-tools'] as const

const modeLabel: Record<GrantMode, string> = {
  all: 'All eligible tools',
  allowlist: 'Allowlist',
  model: 'Model picker',
}

function bundleLines(bundles: Record<string, string[]>): string {
  return Object.entries(bundles)
    .map(([name, tools]) => `${name}: ${tools.join(', ')}`)
    .join('\n')
}

function useGrantToolsConfig() {
  return useQuery({
    queryKey: grantToolsQueryKey,
    queryFn: () =>
      apiJson<GrantToolsConfig>(
        '/api/workspace/settings/grant-tools',
        undefined,
        'Could not load run tool settings',
      ),
  })
}

export function GrantToolsSettings() {
  const queryClient = useQueryClient()
  const { data, isPending, error, isFetching } = useGrantToolsConfig()

  if (isPending) {
    return (
      <SettingsCard title="Run tools">
        <p className="text-sm text-muted-foreground" role="status">
          <AgentThinking label="Loading run tool settings" />
        </p>
      </SettingsCard>
    )
  }

  if (error || !data) {
    return (
      <SettingsCard title="Run tools">
        <p className="text-sm text-destructive" role="alert">
          {error instanceof Error
            ? error.message
            : 'Could not load run tool settings'}
        </p>
      </SettingsCard>
    )
  }

  return (
    <GrantToolsForm
      config={data}
      refreshing={isFetching}
      onSaved={(next) => queryClient.setQueryData(grantToolsQueryKey, next)}
    />
  )
}

function GrantToolsForm({
  config,
  refreshing,
  onSaved,
}: {
  config: GrantToolsConfig
  refreshing: boolean
  onSaved: (config: GrantToolsConfig) => void
}) {
  const [mode, setMode] = useState<GrantMode>(config.mode)
  const [tools, setTools] = useState(config.tools.join('\n'))
  const [bundles, setBundles] = useState(bundleLines(config.bundles))
  const [formError, setFormError] = useState<string>()

  const save = useMutation({
    mutationFn: () =>
      apiJsonBody<GrantToolsConfig>(
        '/api/workspace/settings/grant-tools',
        'POST',
        { mode, tools, bundles },
        'Could not save run tools',
      ),
    onSuccess: (result) => {
      setMode(result.mode)
      setTools(result.tools.join('\n'))
      setBundles(bundleLines(result.bundles))
      setFormError(undefined)
      onSaved(result)
    },
    onError: (reason) => {
      setFormError(
        reason instanceof Error ? reason.message : 'Could not save run tools',
      )
    },
  })

  const busy = save.isPending || refreshing

  return (
    <SettingsCard
      title="Run tools"
      description="Each run already receives only eligible capabilities. Narrow further so the agent is not given every tool schema. The model picker uses the workspace LLM provider, has no tools, and does not start a sandbox."
    >
      {formError && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {formError}
        </p>
      )}
      <div className="grid gap-3">
        <Select
          value={mode}
          disabled={busy}
          onValueChange={(value) => setMode(value as GrantMode)}
        >
          <SelectTrigger className="w-full" aria-label="Run tool assignment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {(Object.keys(modeLabel) as GrantMode[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {modeLabel[value]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <label className="grid gap-1">
          <span className="text-sm font-medium">Allowlist</span>
          <span className="text-xs text-muted-foreground">
            Tool or bundle names, one per line. Used for allowlist mode and as
            the model fallback.
          </span>
          <Textarea
            aria-label="Allowlist"
            disabled={busy}
            onChange={(event) => setTools(event.target.value)}
            placeholder="workspace.get_issue"
            value={tools}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">Bundles</span>
          <span className="text-xs text-muted-foreground">
            One bundle per line: name: tool, tool. Capability ids are already
            bundles. Allowlist and fallback names may be bundle ids.
          </span>
          <Textarea
            aria-label="Bundles"
            disabled={busy}
            onChange={(event) => setBundles(event.target.value)}
            placeholder="issues: workspace.list_issues, workspace.get_issue"
            value={bundles}
          />
        </label>
        <div className="flex items-center gap-3">
          <Button disabled={busy} onClick={() => save.mutate()}>
            {save.isPending ? <AgentThinking label="Saving" /> : 'Save run tools'}
          </Button>
        </div>
      </div>
    </SettingsCard>
  )
}
