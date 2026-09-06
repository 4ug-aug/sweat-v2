import { X } from 'lucide-react'
import { AgentThinking } from '#/components/ui/agent-thinking'
import { Button } from '#/components/ui/button'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '#/components/ui/hover-card'
import { AvatarGroup, AvatarGroupCount } from '#/components/ui/avatar'
import {
  agentNameFrom,
  useAgentDefinitions,
} from '#/features/agents/use-agent-definitions'
import { RunAvatar } from './run-avatar'
import { terminal, runStatus } from './run-helpers'
import type { RoomRun } from '#/features/rooms/types'
import type { Step } from './step-label'

export function ActiveAgents({
  runs,
  latestStepByRun,
  cancel,
  openRun,
}: {
  runs: RoomRun[]
  latestStepByRun: Map<string, Step>
  cancel: (runId: string) => void
  openRun: (runId: string) => void
}) {
  const { data: agents = [] } = useAgentDefinitions()
  const activeRuns = runs.filter((run) => !terminal(run.state))
  if (!activeRuns.length) return null
  const name = (agentId: string) => agentNameFrom(agents, agentId)

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={150}
        closeDelay={100}
        render={
          <button
            type="button"
            className="mt-2 flex items-center gap-2 rounded-md px-1 py-1 text-sm font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${activeRuns.length} ${activeRuns.length === 1 ? 'agent' : 'agents'} working. View status.`}
          />
        }
      >
        <AvatarGroup>
          {activeRuns.slice(0, 3).map((run) => (
            <RunAvatar key={run.id} run={run} />
          ))}
          {activeRuns.length > 3 && (
            <AvatarGroupCount className="size-6 text-xs">
              +{activeRuns.length - 3}
            </AvatarGroupCount>
          )}
        </AvatarGroup>
        <AgentThinking
          variant="spin"
          label={`${name(activeRuns[0].agentId)}${activeRuns.length > 1 ? ` +${activeRuns.length - 1}` : ''}`}
        />
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-96 p-3"
      >
        <h2 className="px-1 pb-1 text-sm font-semibold">Agents working</h2>
        <div>
          {activeRuns.map((run) => (
            <div
              key={run.id}
              className="flex items-center gap-3 rounded-md px-1 py-2"
            >
              <RunAvatar run={run} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {name(run.agentId)}
                </p>
                <p
                  key={runStatus(run, latestStepByRun.get(run.id))}
                  className="truncate text-xs text-muted-foreground"
                >
                  {runStatus(run, latestStepByRun.get(run.id))}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => openRun(run.id)}
              >
                View activity
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Cancel ${name(run.agentId)}`}
                onClick={() => cancel(run.id)}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
