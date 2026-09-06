import { Badge } from '#/components/ui/badge'
import { AgentThinking } from '#/components/ui/agent-thinking'
import { HardDrive } from 'lucide-react'
import { MachineCard } from './components/machine-card'
import { MachineDetail } from './components/machine-session'
import { useMachines } from './use-machines'

export function VmsPage({
  selectedId,
  onSelectedIdChange,
}: {
  selectedId?: string
  onSelectedIdChange: (id: string | undefined) => void
}) {
  const { data, isPending, error } = useMachines()
  const machines = data?.machines ?? []

  if (selectedId) {
    const machine = machines.find((item) => item.id === selectedId)
    if (isPending && !data)
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          <AgentThinking label="Loading machine" />
        </div>
      )
    if (!machine)
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
          <HardDrive className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">
            This machine is no longer running
          </p>
          <p className="text-xs text-muted-foreground">{selectedId}</p>
        </div>
      )
    return <MachineDetail machine={machine} />
  }

  if (isPending)
    return (
      <div className="p-8 text-sm text-muted-foreground" role="status">
        <AgentThinking label="Loading machines" />
      </div>
    )

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-5 sm:p-8">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Machines</h1>
            <Badge variant="secondary">{machines.length} live</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Live VM sandboxes on this Colony server.
          </p>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error instanceof Error ? error.message : 'Could not load machines'}
          </p>
        )}

        {!machines.length && !error && (
          <div className="rounded-lg border border-dashed p-12 text-center">
            <HardDrive className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No machines running</p>
            <p className="mt-1 text-xs text-muted-foreground">
              A machine will appear here when an agent run starts.
            </p>
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-3 md:grid-cols-2 sm:grid-cols-1">
          {machines.map((machine, index) => (
            <MachineCard
              key={machine.id}
              machine={machine}
              enterDelayMs={Math.min(index, 5) * 40}
              onOpen={() => onSelectedIdChange(machine.id)}
            />
          ))}
        </div>
      </div>
    </main>
  )
}
