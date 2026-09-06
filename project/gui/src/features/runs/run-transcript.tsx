import { Markdown } from '#/components/markdown'
import { AgentThinking } from '#/components/ui/agent-thinking'
import { AgentMark } from '#/features/agents/agent-mark'
import { groupActivity, pairSteps } from './run-activity'
import { stepLabel, type Step } from './step-label'
import { ToolCallDetailsList } from './tool-call-details-list'

export function asRunStep(
  step: {
    id: string
    idx: number
    kind: Step['kind']
    tool?: string
    callId?: string
    text: string
    createdAt: number
  },
  runId: string,
): Step {
  return {
    id: step.id,
    runId,
    idx: step.idx,
    kind: step.kind,
    ...(step.tool ? { tool: step.tool } : {}),
    ...(step.callId ? { callId: step.callId } : {}),
    text: step.text,
    createdAt: step.createdAt,
  }
}

export function RunTranscript({
  agentId,
  text,
  steps,
  working,
  error,
  showReasoningWhenComplete,
}: {
  agentId: string
  text: string
  steps: Step[]
  working?: boolean
  error?: string
  showReasoningWhenComplete?: boolean
}) {
  const items = pairSteps(steps)
  const groups = groupActivity(items)
  const latest = items.at(-1)?.step
  const showReasoning = working || showReasoningWhenComplete
  return (
    <div className="flex gap-3">
      <AgentMark agentId={agentId} className="mt-0.5 size-8" />
      <div className="min-w-0 flex-1 space-y-2">
        {groups
          .filter((group) => showReasoning || group.kind === 'tools')
          .map((group, index) =>
            group.kind === 'reasoning' ? (
              <p
                key={group.item.step.id}
                className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground animate-in fade-in-0 slide-in-from-bottom-1 duration-300 fill-mode-both motion-reduce:animate-none"
              >
                {group.item.step.text}
              </p>
            ) : (
              <ToolCallDetailsList key={`tools-${index}`} items={group.items} />
            ),
          )}
        {text ? (
          <div className="text-sm leading-6">
            <Markdown>{text}</Markdown>
          </div>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {working ? (
          <p className="text-sm text-muted-foreground" role="status">
            <AgentThinking
              label={latest ? stepLabel(latest) : 'Working'}
              showTimer
            />
          </p>
        ) : null}
      </div>
    </div>
  )
}
