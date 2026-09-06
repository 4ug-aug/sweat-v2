import { useEffect, useState } from 'react'
import { LogOut, UserPlus, Users, X } from 'lucide-react'
import { apiFetch } from '#/lib/api-transport'
import { AccountFace, Avatar } from '#/components/avatar'
import { Button } from '#/components/ui/button'
import { AgentThinking } from '#/components/ui/agent-thinking'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import type { Author, Room } from '#/features/rooms/types'

type MemberUser = Pick<
  Author,
  'id' | 'name' | 'image' | 'color' | 'email' | 'displayName'
>

export function MembersPanel({
  room,
  currentUserId,
  membersChangedAt,
}: {
  room: Room
  currentUserId: string
  membersChangedAt: Record<string, number>
}) {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<MemberUser[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [membersError, setMembersError] = useState<string>()
  const [workspaceUsers, setWorkspaceUsers] = useState<MemberUser[]>([])
  const [loadingWorkspace, setLoadingWorkspace] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string>()
  const [mutating, setMutating] = useState(false)
  const [mutateError, setMutateError] = useState<string>()

  const fetchMembers = async () => {
    setLoadingMembers(true)
    setMembersError(undefined)
    try {
      const res = await apiFetch(`/api/rooms/${room.id}/members`)
      if (!res.ok) throw new Error('Could not load members')
      const data = (await res.json()) as { members: MemberUser[] }
      setMembers(data.members)
    } catch (reason) {
      setMembersError(
        reason instanceof Error ? reason.message : 'Could not load members',
      )
    } finally {
      setLoadingMembers(false)
    }
  }

  const fetchWorkspaceUsers = async () => {
    setLoadingWorkspace(true)
    setWorkspaceError(undefined)
    try {
      const res = await apiFetch('/api/workspace/members')
      if (!res.ok) throw new Error('Could not load users')
      const data = (await res.json()) as { users: MemberUser[] }
      setWorkspaceUsers(data.users)
    } catch (reason) {
      setWorkspaceError(
        reason instanceof Error ? reason.message : 'Could not load users',
      )
    } finally {
      setLoadingWorkspace(false)
    }
  }

  // Fetch members when panel opens or when membersChangedAt bumps for this room
  useEffect(() => {
    if (!open) return
    void fetchMembers()
  }, [open, room.id, membersChangedAt[room.id]])

  // Fetch workspace users lazily when panel opens (once)
  useEffect(() => {
    if (!open) return
    void fetchWorkspaceUsers()
  }, [open])

  const handleRemove = async (userId: string) => {
    setMutating(true)
    setMutateError(undefined)
    try {
      const res = await apiFetch(`/api/rooms/${room.id}/members/${userId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Could not remove member')
      }
      await fetchMembers()
    } catch (reason) {
      setMutateError(
        reason instanceof Error ? reason.message : 'Could not remove member',
      )
    } finally {
      setMutating(false)
    }
  }

  const handleLeave = async () => {
    setMutating(true)
    setMutateError(undefined)
    try {
      const res = await apiFetch(
        `/api/rooms/${room.id}/members/${currentUserId}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Could not leave room')
      }
      setOpen(false)
    } catch (reason) {
      setMutateError(
        reason instanceof Error ? reason.message : 'Could not leave room',
      )
      setMutating(false)
    }
  }

  const handleAdd = async (userId: string) => {
    setMutating(true)
    setMutateError(undefined)
    try {
      const res = await apiFetch(`/api/rooms/${room.id}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Could not add member')
      }
      await Promise.all([fetchMembers(), fetchWorkspaceUsers()])
    } catch (reason) {
      setMutateError(
        reason instanceof Error ? reason.message : 'Could not add member',
      )
    } finally {
      setMutating(false)
    }
  }

  const isOwner = room.createdBy === currentUserId
  const memberIds = new Set(members.map((m) => m.id))
  const addable = workspaceUsers.filter((u) => !memberIds.has(u.id))

  // Avatar stack: up to 3 member avatars + count
  const stackAvatars = members.slice(0, 3)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-2 flex items-center gap-1 text-muted-foreground"
            aria-label="Members"
          />
        }
      >
        {stackAvatars.length > 0 ? (
          <span className="flex -space-x-1.5">
            {stackAvatars.map((m) => (
              <AccountFace
                key={m.id}
                name={m.name}
                image={m.image}
                color={m.color}
                className="size-5 border-2 border-background text-[9px]"
              />
            ))}
          </span>
        ) : (
          <Users className="size-3.5" />
        )}
        {members.length > 0 && (
          <span className="text-xs tabular-nums">{members.length}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <PopoverHeader className="px-4 pt-4 pb-2">
          <PopoverTitle>Members</PopoverTitle>
        </PopoverHeader>
        <div className="px-4 pb-4 space-y-1">
          {loadingMembers && (
            <p className="py-2 text-xs text-muted-foreground" role="status">
              <AgentThinking label="Loading members" />
            </p>
          )}
          {!loadingMembers && membersError && (
            <p className="py-2 text-xs text-destructive" role="alert">
              {membersError}
            </p>
          )}
          {!loadingMembers &&
            !membersError &&
            members.map((member) => {
              const isMe = member.id === currentUserId
              return (
                <div
                  key={member.id}
                  className="flex items-center gap-2 rounded-md px-1 py-1"
                >
                  <Avatar author={member} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {member.name}
                    {isMe && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </span>
                  {isMe ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Leave room"
                      disabled={mutating}
                      onClick={() => void handleLeave()}
                      title="Leave room"
                    >
                      <LogOut className="size-3.5" />
                    </Button>
                  ) : isOwner ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${member.name}`}
                      disabled={mutating}
                      onClick={() => void handleRemove(member.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <X className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              )
            })}
          {mutateError && (
            <p className="pt-1 text-xs text-destructive" role="alert">
              {mutateError}
            </p>
          )}
        </div>
        {/* Add people section */}
        <div className="border-t px-4 pb-4 pt-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <UserPlus className="size-3.5" />
            Add people
          </div>
          {loadingWorkspace && (
            <p className="text-xs text-muted-foreground" role="status">
              <AgentThinking label="Loading workspace members" />
            </p>
          )}
          {!loadingWorkspace && workspaceError && (
            <p className="text-xs text-destructive" role="alert">
              {workspaceError}
            </p>
          )}
          {!loadingWorkspace && !workspaceError && addable.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Everyone is already a member.
            </p>
          )}
          {!loadingWorkspace && !workspaceError && addable.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {addable.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  disabled={mutating}
                  onClick={() => void handleAdd(u.id)}
                  className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-accent disabled:opacity-50"
                >
                  <Avatar author={u} />
                  <span className="min-w-0 flex-1 truncate">{u.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
