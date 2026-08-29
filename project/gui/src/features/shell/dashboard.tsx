import { SidebarInset, SidebarProvider } from '#/components/ui/sidebar'
import type { IssueStatus } from '#/features/issues/types'
import { MembersPanel } from '#/features/members/members-panel'
import { OneshotPanel } from '#/features/oneshot/oneshot-panel'
import type { MessageComposerHandle } from '#/features/rooms/message-composer'
import { MessageSearchCommand } from '#/features/rooms/message-search-command'
import { navigationForSearchHit } from '#/features/rooms/message-search-navigation'
import type { Author } from '#/features/rooms/types'
import { useRooms } from '#/features/rooms/use-rooms'
import { MachineSessionHeader } from '#/features/vms/components/machine-session'
import { useStoredBoolean } from '#/hooks/use-stored-boolean'
import { useWindowKeydown } from '#/hooks/use-window-keydown'
import {
  Box,
  CalendarClock,
  Hash,
  Lock,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DashboardLocation, DashboardView } from './dashboard-navigation'
import {
  closeSurface,
  historyDirection,
  openActivitySurface,
  openThreadSurface,
  readDashboardLocation,
  writeDashboardLocation,
} from './dashboard-navigation'
import { DashboardPages } from './dashboard-pages'
import { RoomSidebar } from './room-sidebar'
import { RoomView } from './room-view'
import { WindowToolbar, titleBarVars } from './window-toolbar'

export function Dashboard({
  user,
  onChangeServer,
}: {
  user: Author
  onChangeServer: () => void
}) {
  const [sidebarOpen, setSidebarOpen] = useStoredBoolean('sidebar.open', true)
  const [location, setLocation] = useState<DashboardLocation>(() => {
    const pathIssue = window.location.pathname.match(/^\/issues\/([^/]+)$/)
    if (pathIssue)
      return { view: 'issues', id: decodeURIComponent(pathIssue[1]!) }
    return (
      readDashboardLocation(window.history.state, user.id) ?? { view: 'room' }
    )
  })
  const view = location.view
  const {
    rooms,
    room,
    messages,
    runs,
    latestStepByRun,
    liveStepsByRun,
    loading,
    connection,
    error,
    createError,
    select,
    openMessage,
    focusMessageId,
    clearFocusMessage,
    create,
    remove,
    send,
    sendReply,
    edit,
    threadReplies,
    cancel,
    draft,
    setDraft,
    membersChangedAt,
    mentionableAccounts,
    loadOlder,
    loadingOlder,
    hasOlderMessages,
    notificationByRoom,
    threadAttentionRootIds,
    clearThreadAttention,
  } = useRooms(user.id, view === 'room')
  const selectedIssueId = view === 'issues' ? location.id : undefined
  const selectedMachineId = view === 'vms' ? location.id : undefined
  const selectedChatId = view === 'chat' ? location.id : undefined
  const selectRef = useRef(select)
  selectRef.current = select

  const applyLocation = (next: DashboardLocation) => {
    setLocation(next)
    if (next.view === 'room' && next.id) select(next.id)
  }
  const navigate = (next: DashboardLocation) => {
    if (next.view === location.view && next.id === location.id) return
    writeDashboardLocation(user.id, next)
    applyLocation(next)
  }
  const openThread = (rootId: string, threadFocusReplyId?: string) => {
    clearThreadAttention(rootId)
    if (
      location.surface?.kind === 'thread' &&
      location.surface.rootId === rootId &&
      location.surface.focusReplyId === threadFocusReplyId
    )
      return
    const next = openThreadSurface(location, rootId, threadFocusReplyId)
    writeDashboardLocation(user.id, next)
    applyLocation(next)
  }
  const openActivity = (runId: string) => {
    if (
      location.surface?.kind === 'activity' &&
      location.surface.runId === runId
    )
      return
    const next = openActivitySurface(location, runId)
    writeDashboardLocation(user.id, next)
    applyLocation(next)
  }
  const closeSideSurface = () => {
    const next = closeSurface(location)
    writeDashboardLocation(user.id, next)
    applyLocation(next)
  }
  const clearThreadFocus = () => {
    if (location.surface?.kind !== 'thread' || !location.surface.focusReplyId)
      return
    const next: DashboardLocation = {
      ...location,
      surface: { kind: 'thread', rootId: location.surface.rootId },
    }
    writeDashboardLocation(user.id, next, true)
    applyLocation(next)
  }
  const [issueCreate, setIssueCreate] = useState<{
    open: boolean
    status?: IssueStatus
  }>({ open: false })
  const openView = (next: DashboardView) => {
    navigate({
      view: next,
      ...(next === 'room' && room ? { id: room.id } : {}),
    })
  }
  const openMachine =
    user.role === 'admin'
      ? (sandboxId: string) => navigate({ view: 'vms', id: sandboxId })
      : undefined
  const [searchOpen, setSearchOpen] = useState(false)
  const [oneshotOpen, setOneshotOpen] = useState(false)
  const pendingThreadFocusRef = useRef<
    { rootId: string; focusReplyId: string } | undefined
  >(undefined)
  const composer = useRef<MessageComposerHandle>(null)

  useEffect(() => {
    writeDashboardLocation(user.id, location, true)
    if (location.view === 'room' && location.id) selectRef.current(location.id)
    const onPopState = (event: PopStateEvent) => {
      const next = readDashboardLocation(event.state, user.id)
      if (!next) return
      setLocation(next)
      if (next.view === 'room' && next.id) selectRef.current(next.id)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [user.id])

  useWindowKeydown((event) => {
    const direction = historyDirection(event)
    if (!direction) return
    event.preventDefault()
    if (direction < 0) window.history.back()
    else window.history.forward()
  })

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      style={titleBarVars()}
    >
      <WindowToolbar
        accountId={user.id}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenOneshot={() => setOneshotOpen(true)}
      />
      <MessageSearchCommand
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onSelectIssue={(issue) => navigate({ view: 'issues', id: issue.id })}
        onSelectHit={(hit) => {
          const target = navigationForSearchHit(hit)
          navigate({ view: 'room', id: target.roomId })
          if (target.kind === 'thread') {
            pendingThreadFocusRef.current = {
              rootId: target.rootId,
              focusReplyId: target.focusReplyId,
            }
            openMessage(target.roomId, target.rootId)
          } else {
            openMessage(target.roomId, target.messageId)
          }
        }}
      />
      <OneshotPanel
        open={oneshotOpen}
        onOpenChange={setOneshotOpen}
        onOpenIssue={(id) => navigate({ view: 'issues', id })}
      />
      <RoomSidebar
        rooms={rooms}
        selectedRoomId={room?.id}
        onSelect={(roomId) => {
          navigate({ view: 'room', id: roomId })
        }}
        onCreate={async (name, visibility) => {
          const result = await create(name, visibility)
          if (result?.room) navigate({ view: 'room', id: result.room.id })
          return result
        }}
        onDelete={remove}
        createError={createError}
        notificationByRoom={notificationByRoom}
        onMentionAgent={(agentId) => {
          openView('room')
          requestAnimationFrame(() => composer.current?.mention(agentId))
        }}
        view={view}
        onOpenAccount={() => openView('account')}
        onOpenWorkspace={() => {
          if (user.role === 'admin') openView('workspace')
        }}
        onOpenSchedules={() => openView('schedules')}
        onOpenIssues={() => openView('issues')}
        onOpenBulletins={() => openView('bulletins')}
        onOpenChat={() => openView('chat')}
        onOpenVms={() => {
          if (user.role === 'admin') openView('vms')
        }}
        user={user}
      />
      <SidebarInset className="h-[calc(100svh-1rem-var(--titlebar,0px))] overflow-hidden border border-border/70 bg-background">
        {view !== 'account' &&
          view !== 'workspace' &&
          view !== 'chat' &&
          view !== 'issues' &&
          view !== 'bulletins' && (
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
              {view === 'vms' && selectedMachineId ? (
                <MachineSessionHeader
                  machineId={selectedMachineId}
                  onBack={() => navigate({ view: 'vms' })}
                />
              ) : (
                <>
                  {view === 'schedules' ? (
                    <CalendarClock className="size-4 text-muted-foreground" />
                  ) : view === 'vms' ? (
                    <Box className="size-4 text-muted-foreground" />
                  ) : room?.visibility === 'private' ? (
                    <Lock className="size-4 text-muted-foreground" />
                  ) : (
                    <Hash className="size-4 text-muted-foreground" />
                  )}
                  <p className="font-semibold">
                    {view === 'schedules'
                      ? 'Schedules'
                      : view === 'vms'
                        ? 'Machines'
                        : (room?.name ?? 'Rooms')}
                  </p>
                  {view === 'room' && room?.visibility === 'private' && (
                    <MembersPanel
                      room={room}
                      currentUserId={user.id}
                      membersChangedAt={membersChangedAt}
                    />
                  )}
                  {view === 'room' && (
                    <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      {connection === 'connected' ? (
                        <Wifi className="size-3.5" />
                      ) : (
                        <WifiOff className="size-3.5" />
                      )}
                      {connection}
                    </span>
                  )}
                </>
              )}
            </header>
          )}
        {view === 'room' ? (
          <RoomView
            user={user}
            room={room}
            messages={messages}
            runs={runs}
            latestStepByRun={latestStepByRun}
            liveStepsByRun={liveStepsByRun}
            loading={loading}
            error={error}
            draft={draft}
            setDraft={setDraft}
            send={send}
            sendReply={sendReply}
            edit={edit}
            cancel={cancel}
            threadReplies={threadReplies}
            mentionableAccounts={mentionableAccounts}
            loadOlder={loadOlder}
            loadingOlder={loadingOlder}
            hasOlderMessages={hasOlderMessages}
            threadAttentionRootIds={threadAttentionRootIds}
            focusMessageId={focusMessageId}
            clearFocusMessage={clearFocusMessage}
            composer={composer}
            surface={location.surface}
            openThread={openThread}
            openActivity={openActivity}
            closeSideSurface={closeSideSurface}
            clearThreadFocus={clearThreadFocus}
            pendingThreadFocusRef={pendingThreadFocusRef}
            openMachine={openMachine}
          />
        ) : (
          <DashboardPages
            view={view}
            user={user}
            onChangeServer={onChangeServer}
            issueCreate={issueCreate}
            onIssueCreateChange={(open, status) =>
              setIssueCreate(open ? { open: true, status } : { open: false })
            }
            selectedIssueId={selectedIssueId}
            onSelectedIssueIdChange={(id) =>
              navigate({ view: 'issues', ...(id ? { id } : {}) })
            }
            selectedMachineId={selectedMachineId}
            onSelectedMachineIdChange={(id) =>
              navigate({ view: 'vms', ...(id ? { id } : {}) })
            }
            selectedChatId={selectedChatId}
            onSelectedChatIdChange={(id) =>
              navigate({ view: 'chat', ...(id ? { id } : {}) })
            }
            onOpenMachine={openMachine}
          />
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}
