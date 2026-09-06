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
import { Skull } from 'lucide-react'
import type { Machine } from '../types'
import { useNukeMachine } from '../use-machines'

export function NukeMachineButton({
  machine,
  onNuked,
  stopPropagation,
}: {
  machine: Machine
  onNuked?: () => void
  stopPropagation?: boolean
}) {
  const nuke = useNukeMachine(() => onNuked?.())
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            aria-label={`Nuke ${machine.id}`}
            onClick={
              stopPropagation ? (event) => event.stopPropagation() : undefined
            }
          />
        }
      >
        <Skull />
      </AlertDialogTrigger>
      <AlertDialogContent
        onClick={
          stopPropagation ? (event) => event.stopPropagation() : undefined
        }
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Nuke this machine?</AlertDialogTitle>
          <AlertDialogDescription>
            This immediately stops {machine.id} and deletes its VM storage. The
            active run will fail.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {nuke.error && (
          <p className="text-xs break-all text-destructive" role="alert">
            {nuke.error instanceof Error
              ? nuke.error.message
              : 'Could not nuke machine'}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={nuke.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={nuke.isPending}
            onClick={() => nuke.mutate(machine.id)}
          >
            {nuke.isPending ? <AgentThinking label="Nuking" /> : 'Nuke machine'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
