import { AgentThinking } from '#/components/ui/agent-thinking'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import type { SubmitEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

export function CreateRoomPopover({
  group,
  onCreate,
  createError,
}: {
  group: 'public' | 'private'
  onCreate: (name: string, visibility: 'public' | 'private') => Promise<unknown>
  createError: string | undefined
}) {
  const [open, setOpen] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [visibility, setVisibility] = useState(group)
  const [pending, setPending] = useState(false)
  const roomNameInput = useRef<HTMLInputElement>(null)

  const close = () => {
    setRoomName('')
    setVisibility(group)
    setOpen(false)
  }

  const submitRoom = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!roomName.trim()) return
    setPending(true)
    const result = await onCreate(roomName.trim(), visibility)
    setPending(false)
    if (result) close()
  }

  useEffect(() => {
    if (open) roomNameInput.current?.focus()
  }, [open])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true)
        else close()
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="xs"
            aria-label={`Create ${group} room`}
          />
        }
      >
        +
      </PopoverTrigger>
      <PopoverContent side="right" align="start">
        <PopoverHeader>
          <PopoverTitle>Create room</PopoverTitle>
        </PopoverHeader>
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => void submitRoom(event)}
        >
          <Input
            ref={roomNameInput}
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
            className="h-8"
            aria-label="Room name"
            placeholder="Room name"
            disabled={pending}
            required
            pattern={'.*\\S.*'}
            title="Room name cannot be blank"
          />
          <div
            className="flex items-center gap-1"
            role="group"
            aria-label="Visibility"
          >
            <Button
              type="button"
              onClick={() => setVisibility('public')}
              disabled={pending}
              size="xs"
              variant={visibility === 'public' ? 'default' : 'outline'}
              className="flex-1"
            >
              Public
            </Button>
            <Button
              type="button"
              onClick={() => setVisibility('private')}
              disabled={pending}
              size="xs"
              variant={visibility === 'private' ? 'default' : 'outline'}
              className="flex-1"
            >
              Private
            </Button>
          </div>
          <div className="flex gap-1">
            <Button
              type="submit"
              size="xs"
              disabled={pending || !roomName.trim()}
            >
              {pending ? <AgentThinking label="Creating room" /> : 'Create'}
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
        {createError && (
          <p className="mt-1 text-xs text-destructive" role="alert">
            {createError}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
