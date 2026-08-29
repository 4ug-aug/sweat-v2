import { ColonyMark } from '#/components/colony-mark'
import { useAgentDefinitions } from '#/features/agents/use-agent-definitions'
import { cn } from '#/lib/utils'
import { agentInk, agentMarkClass } from './agent-color'

export { ColonyMark as AgentMarkGlyph } from '#/components/colony-mark'

export function AgentMark({
  agentId,
  color,
  className,
}: {
  agentId: string
  color?: string | null
  className?: string
}) {
  const { data: agents = [] } = useAgentDefinitions()
  const resolved = color ?? agents.find((agent) => agent.id === agentId)?.color
  const ink = agentInk(resolved)
  return (
    <ColonyMark
      className={cn('size-6', agentMarkClass(agentId, resolved), className)}
      style={ink ? { color: ink } : undefined}
    />
  )
}

/** Inline mention: colored glyph + semibold label. */
export function AgentMentionChip({
  agentId,
  label,
  color,
  className,
}: {
  agentId: string
  label: string
  color?: string | null
  className?: string
}) {
  const { data: agents = [] } = useAgentDefinitions()
  const resolved = color ?? agents.find((agent) => agent.id === agentId)?.color
  const ink = agentInk(resolved)
  return (
    <span
      data-slot="agent-mention-chip"
      className={cn(
        'inline-flex items-center gap-1 align-middle font-semibold',
        agentMarkClass(agentId, resolved),
        className,
      )}
      style={ink ? { color: ink } : undefined}
    >
      <AgentMark agentId={agentId} color={resolved} className="size-5" />
      <span>{label}</span>
    </span>
  )
}
