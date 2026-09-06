import { AgentMentionChip } from '#/features/agents/agent-mark'
import {
  agentNameFrom,
  useAgentDefinitions,
} from '#/features/agents/use-agent-definitions'
import { AgentThinking } from '#/components/ui/agent-thinking'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { SettingsCard } from '#/features/workspace/settings-card'
import { apiJson, apiJsonBody } from '#/lib/api-transport'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState } from 'react'

type CursorRuntimeConfig = {
  configured: boolean
  model?: string
}

type CursorModel = {
  id: string
  displayName: string
}

const cursorRuntimeQueryKey = ['workspace-settings', 'cursor-runtime'] as const

const cursorModelsQueryKey = [
  'workspace-settings',
  'cursor-runtime',
  'models',
] as const

function useCursorRuntime() {
  return useQuery({
    queryKey: cursorRuntimeQueryKey,
    queryFn: () =>
      apiJson<CursorRuntimeConfig>(
        '/api/workspace/settings/cursor-runtime',
        undefined,
        'Could not load Cursor runtime settings',
      ),
  })
}

function useCursorModels(enabled: boolean) {
  return useQuery({
    queryKey: cursorModelsQueryKey,
    queryFn: async () => {
      const body = await apiJson<{ models: CursorModel[] }>(
        '/api/workspace/settings/cursor-runtime/models',
        undefined,
        'Could not load Cursor models',
      )
      return body.models
    },
    enabled,
  })
}

export function CursorRuntimeSettings() {
  const queryClient = useQueryClient()
  const { data, isPending, error, isFetching } = useCursorRuntime()
  const models = useCursorModels(Boolean(data?.configured))

  if (isPending) {
    return (
      <SettingsCard title="Cursor agent runtime">
        <p className="text-sm text-muted-foreground" role="status">
          <AgentThinking label="Loading Cursor runtime settings" />
        </p>
      </SettingsCard>
    )
  }

  if (error || !data) {
    return (
      <SettingsCard title="Cursor agent runtime">
        <p className="text-sm text-destructive" role="alert">
          {error instanceof Error
            ? error.message
            : 'Could not load Cursor runtime settings'}
        </p>
      </SettingsCard>
    )
  }

  return (
    <CursorRuntimeForm
      config={data}
      models={models.data ?? []}
      refreshing={isFetching || models.isFetching}
      onSaved={(next) => {
        queryClient.setQueryData(cursorRuntimeQueryKey, next)
        void queryClient.invalidateQueries({ queryKey: cursorModelsQueryKey })
      }}
    />
  )
}

function CursorRuntimeForm({
  config,
  models,
  refreshing,
  onSaved,
}: {
  config: CursorRuntimeConfig
  models: CursorModel[]
  refreshing: boolean
  onSaved: (config: CursorRuntimeConfig) => void
}) {
  const [cursorModel, setCursorModel] = useState(config.model ?? '')
  const [cursorApiKey, setCursorApiKey] = useState('')
  const [formError, setFormError] = useState<string>()
  const { data: agents = [] } = useAgentDefinitions()

  const save = useMutation({
    mutationFn: () =>
      apiJsonBody<CursorRuntimeConfig>(
        '/api/workspace/settings/cursor-runtime',
        'POST',
        { model: cursorModel, apiKey: cursorApiKey },
        'Could not save Cursor runtime',
      ),
    onSuccess: (result) => {
      setCursorModel(result.model ?? '')
      setCursorApiKey('')
      setFormError(undefined)
      onSaved(result)
    },
    onError: (reason) => {
      setFormError(
        reason instanceof Error
          ? reason.message
          : 'Could not save Cursor runtime',
      )
    },
  })

  const busy = save.isPending || refreshing

  return (
    <SettingsCard
      title="Cursor agent runtime"
      description={
        <>
          Optional Cursor local SDK runtime for{' '}
          <AgentMentionChip
            agentId="software-engineer"
            label={agentNameFrom(agents, 'software-engineer')}
          />{' '}
          runs. This is separate from the OpenAI-compatible LLM provider used by{' '}
          <AgentMentionChip
            agentId="antboy"
            label={agentNameFrom(agents, 'antboy')}
          />
          .
        </>
      }
    >
      {formError && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {formError}
        </p>
      )}
      <div className="grid gap-3">
        <Input
          aria-label="Cursor API key"
          disabled={busy}
          onChange={(event) => setCursorApiKey(event.target.value)}
          placeholder={
            config.configured
              ? 'Leave blank to keep current key'
              : 'Cursor API key'
          }
          type="password"
          value={cursorApiKey}
        />
        {models.length > 0 ? (
          <Select
            value={cursorModel}
            disabled={busy}
            onValueChange={(value) => setCursorModel(value ?? '')}
          >
            <SelectTrigger className="w-full" aria-label="Cursor model">
              <SelectValue placeholder="Select a Cursor model" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {models.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.displayName}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : (
          <Input
            aria-label="Cursor model"
            disabled={busy}
            onChange={(event) => setCursorModel(event.target.value)}
            placeholder="composer-2.5"
            value={cursorModel}
          />
        )}
        <div className="flex items-center gap-3">
          <Button disabled={busy} onClick={() => save.mutate()}>
            {save.isPending ? (
              <AgentThinking label="Saving" />
            ) : (
              'Save Cursor runtime'
            )}
          </Button>
          <span className="text-sm text-muted-foreground">
            {config.configured ? (
              <span className="inline-flex items-center gap-1 text-green-500">
                <Check className="size-3.5" />
                Configured
              </span>
            ) : (
              'Not configured'
            )}
          </span>
        </div>
      </div>
    </SettingsCard>
  )
}
