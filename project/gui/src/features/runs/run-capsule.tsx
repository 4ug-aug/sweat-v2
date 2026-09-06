import { ProviderIcon } from '#/components/provider-icon'
import { AvatarGroup } from '#/components/ui/avatar'
import { AgentThinking } from '#/components/ui/agent-thinking'
import { useAgentName } from '#/features/agents/use-agent-definitions'
import type { RoomRun } from '#/features/rooms/types'
import { llmProviderName } from '#/lib/llm-provider'
import { cn } from '#/lib/utils'
import { Check, CircleX, X } from 'lucide-react'
import { RunAvatar } from './run-avatar'

export function RunCapsule({
  run,
  openRun,
  className,
}: {
  run: RoomRun
  openRun: (runId: string) => void
  className?: string
}) {
  const name = useAgentName(run.agentId)
  const state =
    run.state === 'succeeded'
      ? 'completed'
      : run.state === 'failed'
        ? 'failed'
        : run.state === 'cancelled'
          ? 'cancelled'
          : 'working'
  return (
    <button
      type="button"
      className={cn(
        'mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border bg-muted/30 py-1 pl-1 pr-2 text-xs text-muted-foreground hover:bg-muted cursor-pointer',
        className,
      )}
      aria-label={`View ${name} activity using ${llmProviderName(run.provider)}, ${state}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => openRun(run.id)}
    >
      <AvatarGroup>
        <RunAvatar run={run} />
      </AvatarGroup>
      <ProviderIcon provider={run.provider} className="size-3.5" />
      {run.state === 'succeeded' ? (
        <Check className="size-3.5 text-primary" />
      ) : run.state === 'failed' ? (
        <CircleX className="size-3.5 text-destructive" />
      ) : run.state === 'cancelled' ? (
        <X className="size-3.5" />
      ) : (
        <AgentThinking label="Working" />
      )}
      <span>1</span>
    </button>
  )
}
