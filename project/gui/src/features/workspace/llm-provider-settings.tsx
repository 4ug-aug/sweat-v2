import { ProviderIcon } from '#/components/provider-icon'
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
import {
  defaultLlmBaseUrl,
  llmProviderName,
  type LlmProvider,
} from '#/lib/llm-provider'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState } from 'react'

type LlmConfig = {
  configured: boolean
  provider?: LlmProvider
  baseUrl?: string
  model?: string
}

const llmConfigQueryKey = ['workspace-settings', 'llm'] as const

function useLlmConfig() {
  return useQuery({
    queryKey: llmConfigQueryKey,
    queryFn: () =>
      apiJson<LlmConfig>(
        '/api/workspace/settings/llm',
        undefined,
        'Could not load LLM settings',
      ),
  })
}

export function LlmProviderSettings() {
  const queryClient = useQueryClient()
  const { data, isPending, error, isFetching } = useLlmConfig()

  if (isPending) {
    return (
      <SettingsCard title="LLM provider">
        <p className="text-sm text-muted-foreground" role="status">
          <AgentThinking label="Loading LLM settings" />
        </p>
      </SettingsCard>
    )
  }

  if (error || !data) {
    return (
      <SettingsCard title="LLM provider">
        <p className="text-sm text-destructive" role="alert">
          {error instanceof Error ? error.message : 'Could not load LLM settings'}
        </p>
      </SettingsCard>
    )
  }

  return (
    <LlmProviderForm
      config={data}
      refreshing={isFetching}
      onSaved={(next) => queryClient.setQueryData(llmConfigQueryKey, next)}
    />
  )
}

function LlmProviderForm({
  config,
  refreshing,
  onSaved,
}: {
  config: LlmConfig
  refreshing: boolean
  onSaved: (config: LlmConfig) => void
}) {
  const [provider, setProvider] = useState<LlmProvider>(
    config.provider ?? 'openai',
  )
  const [baseUrl, setBaseUrl] = useState(
    config.baseUrl ?? defaultLlmBaseUrl(config.provider ?? 'openai'),
  )
  const [model, setModel] = useState(config.model ?? '')
  const [apiKey, setApiKey] = useState('')
  const [formError, setFormError] = useState<string>()

  const save = useMutation({
    mutationFn: () =>
      apiJsonBody<LlmConfig>(
        '/api/workspace/settings/llm',
        'POST',
        { provider, baseUrl, model, apiKey },
        'Could not save provider',
      ),
    onSuccess: (result) => {
      setProvider(result.provider ?? 'openai')
      setBaseUrl(result.baseUrl ?? '')
      setModel(result.model ?? '')
      setApiKey('')
      setFormError(undefined)
      onSaved(result)
    },
    onError: (reason) => {
      setFormError(
        reason instanceof Error ? reason.message : 'Could not save provider',
      )
    },
  })

  const busy = save.isPending || refreshing

  return (
    <SettingsCard
      title="LLM provider"
      description="Configure the OpenAI-compatible provider used for new agent runs."
    >
      {formError && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {formError}
        </p>
      )}
      <div className="grid gap-3">
        <Select
          value={provider}
          disabled={busy}
          onValueChange={(value) => {
            const next = value as LlmProvider
            setProvider(next)
            setBaseUrl(defaultLlmBaseUrl(next))
          }}
        >
          <SelectTrigger className="w-full" aria-label="LLM provider">
            <SelectValue>
              {(value) => {
                const selected = value as LlmProvider
                return (
                  <>
                    <ProviderIcon provider={selected} />
                    {llmProviderName(selected)}
                  </>
                )
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {(['openai', 'custom'] as const).map((value) => (
                <SelectItem key={value} value={value}>
                  <ProviderIcon provider={value} />
                  {llmProviderName(value)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Input
          aria-label="LLM base URL"
          disabled={busy}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://api.openai.com/v1"
          value={baseUrl}
        />
        <Input
          aria-label="LLM model"
          disabled={busy}
          onChange={(event) => setModel(event.target.value)}
          placeholder="gpt-4.1-mini"
          value={model}
        />
        <Input
          aria-label="LLM API key"
          disabled={busy}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={
            config.configured ? 'Leave blank to keep current key' : 'API key'
          }
          type="password"
          value={apiKey}
        />
        <div className="flex items-center gap-3">
          <Button disabled={busy} onClick={() => save.mutate()}>
            {save.isPending ? <AgentThinking label="Saving" /> : 'Save provider'}
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
