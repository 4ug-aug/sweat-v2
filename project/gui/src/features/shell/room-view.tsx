import { AgentThinking } from '#/components/ui/agent-thinking'
import { Button } from '#/components/ui/button'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '#/components/ui/resizable'
import type { MessageComposerHandle } from '#/features/rooms/message-composer'
import { MessageComposer } from '#/features/rooms/message-composer'
import { RoomThreadRail } from '#/features/rooms/room-thread-rail'
import { Timeline } from '#/features/rooms/room-timeline'
import type { ThreadDrafts } from '#/features/rooms/thread-drafts'
import {
  emptyThreadDrafts,
  threadDraft,
  withThreadDraft,
  withoutThreadDraft,
} from '#/features/rooms/thread-drafts'
import type {
  ThreadTransitionState,
  ThreadTransitionSurface,
} from '#/features/rooms/thread-transition'
import {
  finishThreadExit,
  requestThreadSurface,
  sameThreadSurface,
} from '#/features/rooms/thread-transition'
import type {
  Author,
  MentionableAccount,
  Room,
  RoomMessage,
  RoomRun,
} from '#/features/rooms/types'
import { ActiveAgents } from '#/features/runs/active-agents'
import { RunActivityRail } from '#/features/runs/run-activity-rail'
import type { Step } from '#/features/runs/step-label'
import { useMediaQuery } from '#/hooks/use-media-query'
import { ArrowDown } from 'lucide-react'
import type { RefObject } from 'react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DashboardSideSurface } from './dashboard-navigation'

const bottomScrollThreshold = 150
const historyTopThreshold = 80

export function RoomView({
  user,
  room,
  messages,
  runs,
  latestStepByRun,
  liveStepsByRun,
  loading,
  error,
  draft,
  setDraft,
  send,
  sendReply,
  edit,
  cancel,
  threadReplies,
  mentionableAccounts,
  loadOlder,
  loadingOlder,
  hasOlderMessages,
  threadAttentionRootIds,
  focusMessageId,
  clearFocusMessage,
  composer,
  surface,
  openThread,
  openActivity,
  closeSideSurface,
  clearThreadFocus,
  pendingThreadFocusRef,
  openMachine,
}: {
  user: Author
  room: Room | undefined
  messages: RoomMessage[]
  runs: RoomRun[]
  latestStepByRun: Map<string, Step>
  liveStepsByRun: Map<string, Step[]>
  loading: boolean
  error: string | undefined
  draft: string
  setDraft: (text: string) => void
  send: (text: string, files: File[]) => Promise<unknown>
  sendReply: (
    rootId: string,
    text: string,
    files: File[],
  ) => Promise<RoomMessage | undefined>
  edit: (messageId: string, text: string) => Promise<RoomMessage | undefined>
  cancel: (runId: string) => unknown
  threadReplies: Record<string, RoomMessage[]>
  mentionableAccounts: MentionableAccount[]
  loadOlder: () => unknown
  loadingOlder: boolean
  hasOlderMessages: boolean
  threadAttentionRootIds: string[]
  focusMessageId: string | undefined
  clearFocusMessage: () => void
  composer: RefObject<MessageComposerHandle | null>
  surface: DashboardSideSurface | undefined
  openThread: (rootId: string, threadFocusReplyId?: string) => void
  openActivity: (runId: string) => void
  closeSideSurface: () => void
  clearThreadFocus: () => void
  pendingThreadFocusRef: RefObject<
    { rootId: string; focusReplyId: string } | undefined
  >
  openMachine?: (sandboxId: string) => void
}) {
  const inlineRail = useMediaQuery('(min-width: 1024px)')
  // Markdown is memo()'d, so this has to keep its identity between renders or
  // every message re-parses on every commit.
  const mentionHandles = useMemo(
    () => [
      user.name,
      ...mentionableAccounts.map((account) => account.username ?? account.name),
    ],
    [user.name, mentionableAccounts],
  )
  const threadWidthRef = useRef(localStorage.getItem('thread.width') ?? '26rem')
  const threadDraftsRef = useRef<ThreadDrafts>(emptyThreadDrafts)
  const [transition, setTransition] = useState<ThreadTransitionState>({
    phase: 'closed',
  })
  const [lastSurfaceTarget, setLastSurfaceTarget] = useState<
    ThreadTransitionSurface | undefined
  >(undefined)
  const [editingMessage, setEditingMessage] = useState<RoomMessage>()
  const scrollRef = useRef<HTMLElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const followRoomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  const submit = async (text: string, files: File[]) => {
    if (editingMessage) {
      if (!text.trim()) return false
      const result = await edit(editingMessage.id, text)
      if (result) {
        setEditingMessage(undefined)
        setDraft('')
      }
      return Boolean(result)
    }
    if (!text.trim() && !files.length) return false
    const result = await send(text, files)
    if (result) setDraft('')
    return Boolean(result)
  }

  const cancelEdit = () => {
    setEditingMessage(undefined)
    setDraft('')
  }

  useLayoutEffect(() => {
    followRoomRef.current = true
    setEditingMessage(undefined)
  }, [room?.id])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || loading || (!followRoomRef.current && !atBottomRef.current))
      return
    el.scrollTop = 0
    atBottomRef.current = true
    setAtBottom(true)
  }, [loading, messages, room?.id, runs])

  useLayoutEffect(() => {
    const el = scrollRef.current
    const timeline = timelineRef.current
    if (!el || !timeline) return
    const observer = new ResizeObserver(() => {
      if (followRoomRef.current || atBottomRef.current) el.scrollTop = 0
    })
    observer.observe(timeline)
    return () => observer.disconnect()
  }, [room?.id])

  useLayoutEffect(() => {
    const pending = pendingThreadFocusRef.current
    if (!pending || focusMessageId !== pending.rootId) return
    pendingThreadFocusRef.current = undefined
    openThread(pending.rootId, pending.focusReplyId)
  }, [focusMessageId])

  useLayoutEffect(() => {
    if (!focusMessageId || loading) return
    followRoomRef.current = false
    atBottomRef.current = false
    setAtBottom(false)
    const el = scrollRef.current?.querySelector(
      `[data-message-id="${CSS.escape(focusMessageId)}"]`,
    )
    el?.scrollIntoView({ block: 'center', behavior: 'instant' })
  }, [focusMessageId, loading, messages])

  // The thread rail and Run Activity rail are one side surface: opening one
  // always exits the other first (see thread-transition.ts), and the target
  // it should show comes from history-backed `location.surface` so app-level
  // Back/Forward restores or closes it without ever stacking both rails.
  const surfaceTarget: ThreadTransitionSurface | undefined =
    surface?.kind === 'thread'
      ? { kind: 'thread', rootId: surface.rootId }
      : surface?.kind === 'activity'
        ? { kind: 'activity', runId: surface.runId }
        : undefined
  if (!sameThreadSurface(lastSurfaceTarget, surfaceTarget)) {
    setLastSurfaceTarget(surfaceTarget)
    setTransition((current) => requestThreadSurface(current, surfaceTarget))
  }
  const activeSurface =
    transition.phase === 'closed' ? undefined : transition.surface
  const surfaceExiting = transition.phase === 'exiting'
  const activeRun =
    activeSurface?.kind === 'activity'
      ? runs.find(({ id }) => id === activeSurface.runId)
      : undefined
  const activeRootId =
    activeSurface?.kind === 'thread' ? activeSurface.rootId : undefined
  const activityTriggerMessage = activeRun
    ? messages.find(({ id }) => id === activeRun.triggerMessageId)
    : undefined
  const threadRail =
    activeRootId && room ? (
      <RoomThreadRail
        key={activeRootId}
        roomId={room.id}
        roomName={`${room.name} thread`}
        rootId={activeRootId}
        liveReplies={threadReplies[activeRootId] ?? []}
        runs={runs}
        openRun={openActivity}
        mentionHandles={mentionHandles}
        mentionableAccounts={mentionableAccounts}
        currentUserId={user.id}
        onClose={closeSideSurface}
        sendReply={sendReply}
        editMessage={edit}
        focusReplyId={
          surface?.kind === 'thread' ? surface.focusReplyId : undefined
        }
        onFocusReplyHandled={clearThreadFocus}
        draftText={threadDraft(threadDraftsRef.current, activeRootId)}
        onDraftChange={(text) => {
          threadDraftsRef.current = withThreadDraft(
            threadDraftsRef.current,
            activeRootId,
            text,
          )
        }}
        onDraftSubmitted={() => {
          threadDraftsRef.current = withoutThreadDraft(
            threadDraftsRef.current,
            activeRootId,
          )
        }}
        exiting={surfaceExiting}
        onExited={() => setTransition(finishThreadExit)}
      />
    ) : null

  return (
    <div className="flex min-h-0 flex-1">
      <ResizablePanelGroup className="min-h-0 min-w-0 flex-1">
        <ResizablePanel className="min-h-0" id="room" minSize="20rem">
          <div
            className="relative flex h-full min-h-0 min-w-0 flex-col"
            onPointerDown={() => {
              if (activeRootId || activeSurface?.kind === 'activity')
                closeSideSurface()
            }}
          >
            <div className="relative min-h-0 flex-1">
              <section
                key={room?.id}
                ref={scrollRef}
                className="no-scrollbar flex h-full flex-col-reverse overflow-y-auto px-5 py-8 sm:px-8"
                aria-busy={loading}
                onPointerDown={() => {
                  followRoomRef.current = false
                }}
                onTouchMove={() => {
                  followRoomRef.current = false
                }}
                onWheel={() => {
                  followRoomRef.current = false
                }}
                onScroll={() => {
                  const el = scrollRef.current
                  if (!el) return
                  if (
                    el.scrollHeight -
                      el.clientHeight -
                      Math.abs(el.scrollTop) <=
                      historyTopThreshold &&
                    hasOlderMessages &&
                    !loadingOlder
                  )
                    void loadOlder()
                  const nextAtBottom =
                    Math.abs(el.scrollTop) < bottomScrollThreshold
                  atBottomRef.current = nextAtBottom
                  setAtBottom(nextAtBottom)
                }}
              >
                <div
                  ref={timelineRef}
                  className="mx-auto w-full max-w-7xl shrink-0"
                >
                  {loadingOlder && (
                    <div
                      className="flex justify-center pb-4 text-sm text-muted-foreground"
                      role="status"
                    >
                      <AgentThinking label="Loading older messages…" />
                    </div>
                  )}
                  {loading ? (
                    <div
                      className="flex justify-center py-12 text-sm text-muted-foreground"
                      role="status"
                    >
                      <AgentThinking label="Loading room…" />
                    </div>
                  ) : (
                    <div className="room-fade-in">
                      <Timeline
                        messages={messages}
                        runs={runs}
                        openRun={openActivity}
                        currentUserId={user.id}
                        focusMessageId={focusMessageId}
                        onFocusHandled={clearFocusMessage}
                        unreadThreadRootIds={threadAttentionRootIds}
                        onEdit={(message) => {
                          setEditingMessage(message)
                          setDraft(message.text)
                        }}
                        onOpenThread={(nextRootId) => openThread(nextRootId)}
                        mentionHandles={mentionHandles}
                      />
                    </div>
                  )}
                </div>
              </section>
              <Button
                type="button"
                size="sm"
                aria-hidden={atBottom}
                tabIndex={atBottom ? -1 : 0}
                data-visible={!atBottom}
                className="scroll-to-bottom-button absolute right-5 bottom-4 rounded-sm shadow-md sm:right-8"
                onClick={() => {
                  const el = scrollRef.current
                  el?.scrollTo({
                    top: 0,
                    behavior: 'smooth',
                  })
                }}
              >
                To the bottom
                <ArrowDown data-icon="inline-end" />
              </Button>
            </div>
            <div className="shrink-0 px-4 pb-4 sm:px-6">
              <div className="mx-auto max-w-7xl rounded-xl border bg-background p-2.5 shadow-sm">
                <MessageComposer
                  key={room?.id}
                  ref={composer}
                  value={draft}
                  onChange={setDraft}
                  onSubmit={submit}
                  disabled={loading || !room}
                  roomName={room?.name ?? 'room'}
                  mentionableAccounts={mentionableAccounts}
                  editing={Boolean(editingMessage)}
                  onCancelEdit={cancelEdit}
                />
              </div>
              <div className="mx-auto max-w-7xl">
                <ActiveAgents
                  runs={runs}
                  latestStepByRun={latestStepByRun}
                  cancel={(runId) => void cancel(runId)}
                  openRun={openActivity}
                />
              </div>
              {error && (
                <p
                  className="mx-auto mt-2 max-w-5xl text-sm text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              )}
            </div>
          </div>
        </ResizablePanel>
        {inlineRail && threadRail ? (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              className="min-h-0"
              defaultSize={threadWidthRef.current}
              groupResizeBehavior="preserve-pixel-size"
              id="thread"
              maxSize="40rem"
              minSize="20rem"
              onResize={(size, _id, prev) => {
                if (prev == null) return
                const next = `${Math.round(size.inPixels)}px`
                threadWidthRef.current = next
                localStorage.setItem('thread.width', next)
              }}
            >
              {threadRail}
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
      {activeSurface?.kind === 'activity' && activeRun && (
        <RunActivityRail
          key={activeRun.id}
          run={activeRun}
          triggerMessage={activityTriggerMessage}
          liveSteps={liveStepsByRun.get(activeRun.id) ?? []}
          onClose={closeSideSurface}
          onCancel={() => void cancel(activeRun.id)}
          onOpenMachine={openMachine}
          exiting={surfaceExiting}
          onExited={() => setTransition(finishThreadExit)}
        />
      )}
      {!inlineRail && threadRail}
    </div>
  )
}
