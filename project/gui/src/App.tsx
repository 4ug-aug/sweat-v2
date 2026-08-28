import { useEffect } from 'react'
import { authClient } from '#/lib/auth-client'
import { connectWorkspaceStream } from '#/lib/api-transport'
import type { Dashboard } from '#/features/shell/dashboard'

export type DashboardUser = Parameters<typeof Dashboard>[0]['user']

export const monitorSession = (refetch: () => Promise<void>) =>
  connectWorkspaceStream({
    onMessage: () => {},
    onClose: () => void refetch(),
  })

export function App({
  onSession,
}: {
  onSession: (user?: DashboardUser) => void
}) {
  const { data: session, isPending, refetch } = authClient.useSession()

  useEffect(() => {
    if (!session?.user) return
    const stream = monitorSession(refetch)
    return () => stream.close()
  }, [refetch, session?.user])

  useEffect(() => {
    if (isPending) return
    onSession(
      session?.user
        ? {
            id: session.user.id,
            name:
              (session.user as typeof session.user & { username?: string })
                .username ?? session.user.name,
            displayName: session.user.name,
            email: session.user.email,
            role: (session.user as typeof session.user & { role?: string })
              .role,
            image: session.user.image ?? undefined,
            color:
              (session.user as typeof session.user & { color?: string | null })
                .color ?? undefined,
          }
        : undefined,
    )
  }, [isPending, onSession, session?.user])

  return null
}
