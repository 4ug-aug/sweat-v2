import { BrailleLoader } from '#/components/ui/braille-loader'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { SettingsCard } from '#/features/workspace/settings-card'
import { apiFetch, apiJson, apiJsonBody } from '#/lib/api-transport'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

type Member = {
  id: string
  email: string
  name: string
  banned?: boolean | null
  username?: string
  role?: string
}

const workspaceSettingsMembersQueryKey = [
  'workspace-settings',
  'members',
] as const

function useSettingsMembers() {
  return useQuery({
    queryKey: workspaceSettingsMembersQueryKey,
    queryFn: async () => {
      const body = await apiJson<{ users: Member[] }>(
        '/api/workspace/settings/members',
        undefined,
        'Could not load members',
      )
      return body.users
    },
  })
}

export function MembersSettings({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient()
  const {
    data: members = [],
    isPending,
    error,
    isFetching,
  } = useSettingsMembers()
  const [actionError, setActionError] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [resetMember, setResetMember] = useState<Member>()
  const [newPassword, setNewPassword] = useState('')

  const changeMember = useMutation({
    mutationFn: async (member: Member) => {
      const action = member.banned ? 'restore' : 'suspend'
      const response = await apiFetch(
        `/api/workspace/settings/members/${member.id}/${action}`,
        { method: 'POST' },
      )
      if (!response.ok) throw new Error(`Could not ${action} member`)
    },
    onSuccess: () => {
      setActionError(undefined)
      void queryClient.invalidateQueries({
        queryKey: workspaceSettingsMembersQueryKey,
      })
    },
    onError: (reason) => {
      setActionError(
        reason instanceof Error ? reason.message : 'Could not update member',
      )
    },
  })

  const requestMemberChange = (member: Member) => {
    const action = member.banned ? 'restore' : 'suspend'
    if (
      action === 'suspend' &&
      !window.confirm(
        `Suspend ${member.username ?? member.name} and sign them out?`,
      )
    )
      return
    changeMember.mutate(member)
  }

  const resetPassword = useMutation({
    mutationFn: ({ member, password }: { member: Member; password: string }) =>
      apiJsonBody(
        `/api/workspace/settings/members/${member.id}/password`,
        'POST',
        { newPassword: password },
        'Could not reset password',
      ),
    onSuccess: (_result, { member }) => {
      setResetMember(undefined)
      setNewPassword('')
      setActionError(undefined)
      setMessage(
        `Password reset for ${member.username ?? member.name}; existing sessions were signed out.`,
      )
    },
    onError: (reason) =>
      setActionError(
        reason instanceof Error ? reason.message : 'Could not reset password',
      ),
  })

  const busy = changeMember.isPending || resetPassword.isPending || isFetching

  return (
    <SettingsCard
      title="Members"
      description="Reset passwords, suspend, or restore workspace access."
    >
      {(error || actionError) && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {actionError ??
            (error instanceof Error ? error.message : 'Could not load members')}
        </p>
      )}
      {message && (
        <p className="mb-3 text-sm text-muted-foreground" role="status">
          {message}
        </p>
      )}
      {isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          <BrailleLoader text="Loading members" />
        </p>
      ) : (
        <div className="divide-y divide-border/40">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {member.username ?? member.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {member.name !== (member.username ?? member.name)
                    ? `${member.name} · `
                    : ''}
                  {member.email}
                </span>
              </span>
              {member.id !== currentUserId && (
                <span className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setResetMember(member)
                      setNewPassword('')
                      setActionError(undefined)
                      setMessage(undefined)
                    }}
                  >
                    Reset password
                  </Button>
                  {member.role !== 'admin' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => requestMemberChange(member)}
                    >
                      {member.banned ? 'Restore' : 'Suspend'}
                    </Button>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={Boolean(resetMember)}
        onOpenChange={(open) => {
          if (!open && !resetPassword.isPending) setResetMember(undefined)
        }}
      >
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (resetMember)
                resetPassword.mutate({
                  member: resetMember,
                  password: newPassword,
                })
            }}
          >
            <DialogHeader>
              <DialogTitle>
                Reset password for {resetMember?.username ?? resetMember?.name}
              </DialogTitle>
              <DialogDescription>
                Their existing sessions will be signed out.
              </DialogDescription>
            </DialogHeader>
            {actionError && (
              <p className="mt-4 text-sm text-destructive" role="alert">
                {actionError}
              </p>
            )}
            <Input
              autoComplete="new-password"
              autoFocus
              className="my-4"
              minLength={8}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="New password"
              required
              type="password"
              value={newPassword}
            />
            <DialogFooter>
              <Button
                disabled={resetPassword.isPending}
                onClick={() => setResetMember(undefined)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={resetPassword.isPending} type="submit">
                {resetPassword.isPending ? (
                  <BrailleLoader text="Resetting" />
                ) : (
                  'Reset password'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  )
}
