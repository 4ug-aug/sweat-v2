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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

type Invitation = {
  id: string
  createdAt: number
  expiresAt: number
  state: 'pending' | 'expired' | 'revoked' | 'redeemed'
}

const invitationsQueryKey = [
  'workspace-settings',
  'invitations',
] as const

function useInvitations() {
  return useQuery({
    queryKey: invitationsQueryKey,
    queryFn: async () => {
      const body = await apiJson<{ invitations: Invitation[] }>(
        '/api/workspace/invitations',
        undefined,
        'Could not load invitations',
      )
      return body.invitations
    },
  })
}

export function InvitationSettings() {
  const queryClient = useQueryClient()
  const { data: invitations = [], isPending, error, isFetching } =
    useInvitations()
  const [days, setDays] = useState<1 | 3 | 7>(3)
  const [newLink, setNewLink] = useState<string>()
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState<string>()

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: invitationsQueryKey })

  const createInvitation = useMutation({
    mutationFn: async () => {
      const invitation = await apiJsonBody<{ url: string }>(
        '/api/workspace/invitations',
        'POST',
        { days },
        'Could not create invitation',
      )
      return invitation.url
    },
    onSuccess: (url) => {
      setNewLink(url)
      setCopied(false)
      setActionError(undefined)
      void refresh()
    },
    onError: (reason) => {
      setActionError(
        reason instanceof Error
          ? reason.message
          : 'Could not create invitation',
      )
    },
  })

  const revoke = useMutation({
    mutationFn: (id: string) =>
      apiJsonBody(
        `/api/workspace/invitations/${id}`,
        'DELETE',
        undefined,
        'Could not revoke invitation',
      ),
    onSuccess: () => {
      setActionError(undefined)
      void refresh()
    },
    onError: (reason) => {
      setActionError(
        reason instanceof Error
          ? reason.message
          : 'Could not revoke invitation',
      )
    },
  })

  const revokeInvitation = (id: string) => {
    if (!window.confirm('Revoke this invitation link?')) return
    revoke.mutate(id)
  }

  const copyInvitation = async () => {
    if (!newLink) return
    try {
      await navigator.clipboard.writeText(newLink)
      setCopied(true)
      setActionError(undefined)
    } catch {
      setActionError('Could not copy the invitation link')
    }
  }

  const busy =
    createInvitation.isPending || revoke.isPending || isFetching

  return (
    <SettingsCard
      title="Invitation links"
      description="Create a single-use link to invite someone to this workspace."
    >
      {(error || actionError) && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {actionError ??
            (error instanceof Error
              ? error.message
              : 'Could not load invitations')}
        </p>
      )}
      {isPending && (
        <p className="mb-3 text-sm text-muted-foreground" role="status">
          <AgentThinking label="Loading invitations" />
        </p>
      )}
      <div className="flex gap-2">
        <Select
          value={String(days)}
          disabled={busy}
          onValueChange={(value) => setDays(Number(value) as 1 | 3 | 7)}
        >
          <SelectTrigger className="flex-1" aria-label="Invitation lifetime">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="1">1 day</SelectItem>
              <SelectItem value="3">3 days</SelectItem>
              <SelectItem value="7">7 days</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          disabled={busy}
          onClick={() => createInvitation.mutate()}
        >
          {createInvitation.isPending ? (
            <AgentThinking label="Creating" />
          ) : (
            'Create link'
          )}
        </Button>
      </div>
      {newLink && (
        <div className="mt-3 flex items-center gap-2">
          <Input
            aria-label="Invitation link"
            className="min-w-0 font-mono text-xs"
            value={newLink}
            readOnly
          />
          <Button variant="outline" onClick={() => void copyInvitation()}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      )}
      <div className="mt-5">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">
          Recent invitations
        </h3>
        {!isPending && invitations.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No invitations created yet.
          </p>
        )}
        {invitations.map((invitation) => (
          <div
            key={invitation.id}
            className="flex items-center gap-3 border-b border-border/40 py-2 text-sm last:border-b-0"
          >
            <span className="min-w-0 flex-1">
              <span className="block capitalize">{invitation.state}</span>
              <span className="block truncate text-xs text-muted-foreground">
                Expires {new Date(invitation.expiresAt).toLocaleString()}
              </span>
            </span>
            {invitation.state === 'pending' && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => revokeInvitation(invitation.id)}
              >
                Revoke
              </Button>
            )}
          </div>
        ))}
      </div>
    </SettingsCard>
  )
}
