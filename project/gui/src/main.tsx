import { ErrorBoundary } from '#/components/error-boundary'
import { ThemeProvider } from '#/components/theme-provider'
import { Toaster } from '#/components/ui/toast'
import { TooltipProvider } from '#/components/ui/tooltip'
import { SignIn } from '#/features/auth/sign-in'
import { attachBulletinWorkspaceSync } from '#/features/bulletins/bulletin-workspace-sync'
import { attachIssueWorkspaceSync } from '#/features/issues/issue-workspace-sync'
import { attachScheduleWorkspaceSync } from '#/features/schedules/schedule-workspace-sync'
import { EntryShell } from '#/features/setup/entry-shell'
import { ServerSelection } from '#/features/setup/server-selection'
import { WindowDragRegion } from '#/features/shell/window-toolbar'
import { initAuthClient } from '#/lib/auth-client'
import { initInviteDeepLinks } from '#/lib/invite-deep-link'
import { createAppQueryClient } from '#/lib/query-client'
import {
  currentServerBase,
  initServerConfig,
  isTauriRuntime,
} from '#/lib/server-config'
import { QueryClientProvider } from '@tanstack/react-query'
import { lazy, StrictMode, Suspense, useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import type { DashboardUser } from './App'
import './styles.css'

const rootEl = document.getElementById('root')!
const root = createRoot(rootEl)
const queryClient = createAppQueryClient()

function connectConfiguredServer() {
  initAuthClient()
  attachIssueWorkspaceSync(queryClient)
  attachBulletinWorkspaceSync(queryClient)
  attachScheduleWorkspaceSync(queryClient)
}

type EntryPhase = 'entry' | 'exiting' | 'dashboard'

// The sign-in screen needs none of the Dashboard, and the Dashboard carries the
// room view, the tiptap composer and every feature page with it. Loading it on
// demand keeps all of that out of first paint; `preloadDashboard` then warms the
// chunk during the entry exit animation so Suspense rarely has to show anything.
const Dashboard = lazy(() =>
  import('#/features/shell/dashboard').then((module) => ({
    default: module.Dashboard,
  })),
)
const preloadDashboard = () => {
  void import('#/features/shell/dashboard')
}

function EntryFlow({ needsServer }: { needsServer: boolean }) {
  const [selectingServer, setSelectingServer] = useState(needsServer)
  const [authReady, setAuthReady] = useState(!needsServer)
  const [user, setUser] = useState<DashboardUser>()
  const [phase, setPhase] = useState<EntryPhase>('entry')
  const onChangeServer = useCallback(() => {
    setUser(undefined)
    setPhase('entry')
    setAuthReady(false)
    setSelectingServer(true)
  }, [])
  const onConnected = useCallback(() => {
    connectConfiguredServer()
    setAuthReady(true)
    setSelectingServer(false)
  }, [])
  const onSession = useCallback((nextUser?: DashboardUser) => {
    if (nextUser) preloadDashboard()
    setUser(nextUser)
    setPhase((current) => {
      if (!nextUser) return 'entry'
      if (current === 'dashboard') return current
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'dashboard'
        : 'exiting'
    })
  }, [])

  return (
    <>
      {authReady && <App onSession={onSession} />}
      {phase === 'dashboard' && user ? (
        <Suspense fallback={null}>
          <Dashboard user={user} onChangeServer={onChangeServer} />
        </Suspense>
      ) : (
        <EntryShell
          exiting={phase === 'exiting'}
          onExitComplete={() => setPhase(user ? 'dashboard' : 'entry')}
        >
          {selectingServer ? (
            <ServerSelection onConnected={onConnected} />
          ) : (
            <SignIn onChangeServer={onChangeServer} />
          )}
        </EntryShell>
      )}
    </>
  )
}

initServerConfig()
  .then(initInviteDeepLinks)
  .then(() => {
    const needsServer = isTauriRuntime() && !currentServerBase()
    if (!needsServer) connectConfiguredServer()
    root.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <ErrorBoundary fatal>
            <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
              <TooltipProvider>
                <WindowDragRegion />
                <EntryFlow needsServer={needsServer} />
                <Toaster />
              </TooltipProvider>
            </ThemeProvider>
          </ErrorBoundary>
        </QueryClientProvider>
      </StrictMode>,
    )
  })
  .catch((err: unknown) => {
    root.render(
      <StrictMode>
        <WindowDragRegion />
        <main className="grid min-h-svh place-items-center p-6">
          <p className="text-sm text-destructive">
            Failed to initialize:{' '}
            {err instanceof Error ? err.message : String(err)}
          </p>
        </main>
      </StrictMode>,
    )
  })
