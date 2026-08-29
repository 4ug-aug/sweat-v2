import { StaticDither } from '#/components/static-dither'
import type { IssueStatus } from '#/features/issues/types'
import type { Author } from '#/features/rooms/types'
import { lazy, Suspense } from 'react'
import type { DashboardView } from './dashboard-navigation'

// One chunk per view. Only the room view ships in the Dashboard chunk itself,
// so recharts (account, issues), cronstrue (schedules) and dnd-kit (bulletins)
// stay out of the bundle until someone opens that view.
const AccountSettingsPage = lazy(() =>
  import('#/features/account/account-settings').then((module) => ({
    default: module.AccountSettingsPage,
  })),
)
const BulletinsPage = lazy(() =>
  import('#/features/bulletins/bulletins-page').then((module) => ({
    default: module.BulletinsPage,
  })),
)
const ChatsPage = lazy(() =>
  import('#/features/chats/chats-page').then((module) => ({
    default: module.ChatsPage,
  })),
)
const IssuesPage = lazy(() =>
  import('#/features/issues/issues-page').then((module) => ({
    default: module.IssuesPage,
  })),
)
const SchedulesPage = lazy(() =>
  import('#/features/schedules/schedules-page').then((module) => ({
    default: module.SchedulesPage,
  })),
)
const AgentsPage = lazy(() =>
  import('#/features/agents/agents-page').then((module) => ({
    default: module.AgentsPage,
  })),
)
const VmsPage = lazy(() =>
  import('#/features/vms/vms-page').then((module) => ({
    default: module.VmsPage,
  })),
)
const WorkspaceSettingsPage = lazy(() =>
  import('#/features/workspace/workspace-settings').then((module) => ({
    default: module.WorkspaceSettingsPage,
  })),
)

export function DashboardPages({
  view,
  user,
  onChangeServer,
  issueCreate,
  onIssueCreateChange,
  selectedIssueId,
  onSelectedIssueIdChange,
  selectedMachineId,
  onSelectedMachineIdChange,
  onOpenMachine,
  selectedChatId,
  onSelectedChatIdChange,
}: {
  view: DashboardView
  user: Author
  onChangeServer: () => void
  issueCreate: { open: boolean; status?: IssueStatus }
  onIssueCreateChange: (open: boolean, status?: IssueStatus) => void
  selectedIssueId: string | undefined
  onSelectedIssueIdChange: (id: string | undefined) => void
  selectedMachineId: string | undefined
  onSelectedMachineIdChange: (id: string | undefined) => void
  onOpenMachine?: (sandboxId: string) => void
  selectedChatId: string | undefined
  onSelectedChatIdChange: (id: string | undefined) => void
}) {
  return (
    <Suspense fallback={null}>
      {view === 'chat' && (
        <ChatsPage
          selectedId={selectedChatId}
          onSelectedIdChange={onSelectedChatIdChange}
        />
      )}
      {view === 'account' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AccountSettingsPage user={user} onChangeServer={onChangeServer} />
        </div>
      )}
      {view === 'workspace' && user.role === 'admin' && (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/30">
          <StaticDither />
          <WorkspaceSettingsPage currentUserId={user.id} />
        </div>
      )}
      {view === 'schedules' && <SchedulesPage onOpenMachine={onOpenMachine} />}
      {view === 'agents' && <AgentsPage user={user} />}
      {view === 'issues' && (
        <IssuesPage
          createOpen={issueCreate.open}
          createStatus={issueCreate.status}
          onCreateOpenChange={onIssueCreateChange}
          selectedId={selectedIssueId}
          onSelectedIdChange={onSelectedIssueIdChange}
          onOpenMachine={onOpenMachine}
        />
      )}
      {view === 'bulletins' && <BulletinsPage currentUserId={user.id} />}
      {view === 'vms' && user.role === 'admin' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <VmsPage
            selectedId={selectedMachineId}
            onSelectedIdChange={onSelectedMachineIdChange}
          />
        </div>
      )}
    </Suspense>
  )
}
