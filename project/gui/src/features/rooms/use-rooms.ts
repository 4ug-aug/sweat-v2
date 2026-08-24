import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  apiFetch,
  connectRoomStream,
  connectWorkspaceStream,
} from '#/lib/api-transport'
import type { RealtimeStreamHandle } from '#/lib/api-transport'
import type {
  MentionableAccount,
  Room,
  RoomHistoryPage,
  RoomMessage,
  RoomRun,
  RoomStreamMessage,
  WorkspaceStreamMessage,
} from './types'
import type { Step } from '#/features/runs/step-label'
import { mergeLatestSteps, mergeLiveSteps } from './room-step-batch'
import type { StepArrival } from './room-step-batch'
import { toast } from '#/components/ui/toast'
import {
  acknowledgeThreadAttentionRoot,
  applyThreadAttentionEvent,
  compareMessageMarkers,
  hasAnyRoomNotification,
  isActivelyViewingRoom,
  roomNotification,
  threadAttentionRootsFromRooms,
} from './room-notifications'
import type { RoomNotification } from './room-notifications'
import { setAppDockBadge } from '#/lib/dock-badge'
import { useWindowActive, windowIsActiveNow } from '#/lib/window-active'
import {
  runResultAsLiveReply,
  threadRootIdForTrigger,
  withLiveThreadSummaries,
} from './thread-helpers'

function upsert<T extends { id: string }>(items: T[], item: T) {
  const index = items.findIndex(({ id }) => id === item.id)
  return index < 0
    ? [...items, item]
    : items.map((value) => (value.id === item.id ? item : value))
}

function mergeMessages(messages: RoomMessage[], incoming: RoomMessage[]) {
  const byId = new Map(messages.map((message) => [message.id, message]))
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  )
}

function mergeRuns(runs: RoomRun[], incoming: RoomRun[]) {
  const byId = new Map(runs.map((run) => [run.id, run]))
  for (const run of incoming) byId.set(run.id, run)
  return [...byId.values()].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  )
}

function orderedRooms(rooms: Room[]) {
  return [...rooms].sort(
    (a, b) =>
      (a.id === 'general' ? -1 : b.id === 'general' ? 1 : 0) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  )
}

const selectedRoomKey = 'sweat.selected-room'
const seenRoomMessagesKey = 'sweat.seen-room-messages'

function readSeenRoomMessages() {
  try {
    const value = JSON.parse(
      localStorage.getItem(seenRoomMessagesKey) ?? '{}',
    ) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, marker]) =>
          marker &&
          typeof marker === 'object' &&
          typeof (marker as { id?: unknown }).id === 'string' &&
          typeof (marker as { createdAt?: unknown }).createdAt === 'number',
      ),
    ) as Partial<
      Record<string, { id: string; createdAt: number; authorId: string }>
    >
  } catch {
    return {}
  }
}

function playMentionSound() {
  const context = new AudioContext()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.frequency.value = 880
  gain.gain.setValueAtTime(0.06, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18)
  oscillator.connect(gain).connect(context.destination)
  oscillator.addEventListener('ended', () => void context.close())
  oscillator.start()
  oscillator.stop(context.currentTime + 0.18)
}

export function useRooms(userId: string, viewingRoom: boolean) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [threadAttentionByRoom, setThreadAttentionByRoom] = useState<
    Record<string, string[]>
  >({})
  const [selectedRoomId, setSelectedRoomId] = useState<string>()
  const [messages, setMessages] = useState<RoomMessage[]>([])
  const [threadReplies, setThreadReplies] = useState<
    Record<string, RoomMessage[]>
  >({})
  const [liveThreadResults, setLiveThreadResults] = useState<
    Record<string, RoomMessage[]>
  >({})
  const [runs, setRuns] = useState<RoomRun[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [focusMessageId, setFocusMessageId] = useState<string>()
  const runsRef = useRef<RoomRun[]>([])
  const messagesRef = useRef<RoomMessage[]>([])
  const threadRepliesRef = useRef(threadReplies)
  const replyRootByIdRef = useRef<Record<string, string>>({})
  const serverSummariesRef = useRef<
    Record<string, RoomMessage['replySummary']>
  >({})
  const pendingFocusRef = useRef<string | undefined>(undefined)
  const [latestStepByRun, setLatestStepByRun] = useState<Map<string, Step>>(
    new Map(),
  )
  const [liveStepsByRun, setLiveStepsByRun] = useState<Map<string, Step[]>>(
    new Map(),
  )
  const [loading, setLoading] = useState(true)
  const [connection, setConnection] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  >('connecting')
  const [error, setError] = useState<string>()
  const [createError, setCreateError] = useState<string>()
  const [membersChangedAt, setMembersChangedAt] = useState<
    Record<string, number>
  >({})
  const [mentionableAccounts, setMentionableAccounts] = useState<
    MentionableAccount[]
  >([])
  const roomSocket = useRef<RealtimeStreamHandle | undefined>(undefined)
  const workspaceSocket = useRef<RealtimeStreamHandle | undefined>(undefined)
  const selectedRoomRef = useRef<string | undefined>(undefined)
  const viewingRoomRef = useRef(viewingRoom)
  const nextCursorRef = useRef<string | undefined>(undefined)
  const loadingOlderRef = useRef(false)
  const historyReadyRef = useRef(false)
  const drafts = useRef<Record<string, string>>({})
  const seenRoomMessagesRef = useRef(readSeenRoomMessages())
  const [seenVersion, setSeenVersion] = useState(0)
  const lastDockBadgeRef = useRef<boolean | null>(null)
  const roomsRef = useRef(rooms)

  const windowActive = useWindowActive()
  messagesRef.current = messages
  threadRepliesRef.current = threadReplies
  selectedRoomRef.current = selectedRoomId
  viewingRoomRef.current = viewingRoom
  roomsRef.current = rooms

  const captureServerSummaries = useCallback((list: readonly RoomMessage[]) => {
    for (const message of list) {
      if (message.rootId != null) continue
      serverSummariesRef.current[message.id] = message.replySummary
    }
  }, [])

  const clearLiveThreadActivity = useCallback((rootIds?: ReadonlySet<string>) => {
    if (!rootIds) {
      setThreadReplies({})
      setLiveThreadResults({})
      threadRepliesRef.current = {}
      replyRootByIdRef.current = {}
      return
    }
    if (rootIds.size === 0) return
    setThreadReplies((current) => {
      let changed = false
      const next = { ...current }
      for (const rootId of rootIds) {
        if (!(rootId in next)) continue
        delete next[rootId]
        changed = true
      }
      if (!changed) return current
      threadRepliesRef.current = next
      return next
    })
    setLiveThreadResults((current) => {
      let changed = false
      const next = { ...current }
      for (const rootId of rootIds) {
        if (!(rootId in next)) continue
        delete next[rootId]
        changed = true
      }
      return changed ? next : current
    })
  }, [])

  const acceptServerMessages = useCallback(
    (list: RoomMessage[], options?: { replaceLive?: 'all' }) => {
      captureServerSummaries(list)
      if (options?.replaceLive === 'all') {
        clearLiveThreadActivity()
        return
      }
      // Fresh server summaries are authoritative for these roots — drop any
      // live overlays that would otherwise double-count against them.
      clearLiveThreadActivity(
        new Set(
          list
            .filter((message) => message.rootId == null)
            .map((message) => message.id),
        ),
      )
    },
    [captureServerSummaries, clearLiveThreadActivity],
  )

  const recordThreadReply = useCallback((reply: RoomMessage) => {
    const rootId = reply.rootId
    if (!rootId) return
    replyRootByIdRef.current[reply.id] = rootId
    setThreadReplies((current) => {
      const next = {
        ...current,
        [rootId]: mergeMessages(current[rootId] ?? [], [reply]),
      }
      threadRepliesRef.current = next
      return next
    })
  }, [])

  const recordThreadReplyEdit = useCallback((reply: RoomMessage) => {
    const rootId = reply.rootId
    if (!rootId) return
    replyRootByIdRef.current[reply.id] = rootId
    setThreadReplies((current) => {
      const list = current[rootId]
      if (!list) return current
      const next = { ...current, [rootId]: mergeMessages(list, [reply]) }
      threadRepliesRef.current = next
      return next
    })
  }, [])

  const recordLiveThreadResult = useCallback((run: RoomRun) => {
    if (run.state !== 'succeeded') return
    const rootId =
      threadRootIdForTrigger(
        run.triggerMessageId,
        messagesRef.current,
        threadRepliesRef.current,
      ) ?? replyRootByIdRef.current[run.triggerMessageId]
    if (!rootId) return
    const live = runResultAsLiveReply(run, rootId)
    setLiveThreadResults((current) => ({
      ...current,
      [rootId]: mergeMessages(current[rootId] ?? [], [live]),
    }))
  }, [])

  const applyHistoryPage = useCallback(
    (page: RoomHistoryPage) => {
      acceptServerMessages(page.messages, { replaceLive: 'all' })
      setMessages(page.messages)
      messagesRef.current = page.messages
      runsRef.current = mergeRuns([], page.runs)
      setRuns(runsRef.current)
      nextCursorRef.current = page.nextCursor
      setNextCursor(page.nextCursor)
    },
    [acceptServerMessages],
  )

  const messagesForTimeline = useMemo(
    () =>
      withLiveThreadSummaries(
        messages.map((message) => {
          if (message.rootId != null) return message
          if (
            !Object.prototype.hasOwnProperty.call(
              serverSummariesRef.current,
              message.id,
            )
          )
            return message
          return {
            ...message,
            replySummary: serverSummariesRef.current[message.id],
          }
        }),
        threadReplies,
        liveThreadResults,
      ),
    [messages, threadReplies, liveThreadResults],
  )

  const loadAroundFocus = useCallback(
    async (roomId: string, messageId: string) => {
      try {
        const response = await apiFetch(
          `/api/rooms/${roomId}/messages?around=${encodeURIComponent(messageId)}`,
        )
        const page = (await response.json()) as RoomHistoryPage & {
          error?: string
        }
        if (!response.ok)
          throw new Error(page.error ?? 'Unable to load message')
        if (selectedRoomRef.current !== roomId) return
        if (pendingFocusRef.current !== messageId) return
        applyHistoryPage(page)
        historyReadyRef.current = true
        setFocusMessageId(messageId)
        pendingFocusRef.current = undefined
        setLoading(false)
        setError(undefined)
      } catch (reason) {
        if (selectedRoomRef.current === roomId) {
          setError(
            reason instanceof Error ? reason.message : 'Unable to load message',
          )
          setLoading(false)
        }
        pendingFocusRef.current = undefined
      }
    },
    [applyHistoryPage],
  )

  const markRoomSeen = useCallback(
    (
      roomId: string,
      marker: { id: string; createdAt: number; authorId: string },
    ) => {
      const previous = seenRoomMessagesRef.current[roomId]
      if (previous && compareMessageMarkers(marker, previous) <= 0) return
      const next = { ...seenRoomMessagesRef.current, [roomId]: marker }
      seenRoomMessagesRef.current = next
      localStorage.setItem(seenRoomMessagesKey, JSON.stringify(next))
      setSeenVersion((version) => version + 1)
    },
    [],
  )

  const recordMessageActivity = useCallback(
    (activity: {
      roomId: string
      messageId: string
      createdAt: number
      authorId: string
    }) => {
      if (activity.authorId === userId) return
      const marker = {
        id: activity.messageId,
        createdAt: activity.createdAt,
        authorId: activity.authorId,
      }
      setRooms((current) =>
        current.map((room) => {
          if (
            room.id !== activity.roomId ||
            (room.latestOtherMessage &&
              compareMessageMarkers(marker, room.latestOtherMessage) <= 0)
          )
            return room
          return { ...room, latestOtherMessage: marker }
        }),
      )
      if (
        isActivelyViewingRoom({
          selectedRoomId: selectedRoomRef.current,
          roomId: activity.roomId,
          viewingRoom: viewingRoomRef.current,
          windowActive: windowIsActiveNow(),
        })
      )
        markRoomSeen(activity.roomId, marker)
    },
    [markRoomSeen, userId],
  )

  const forgetRoom = useCallback((roomId: string) => {
    if (seenRoomMessagesRef.current[roomId]) {
      const next = { ...seenRoomMessagesRef.current }
      delete next[roomId]
      seenRoomMessagesRef.current = next
      localStorage.setItem(seenRoomMessagesKey, JSON.stringify(next))
      setSeenVersion((version) => version + 1)
    }
    setRooms((current) => {
      const next = current.filter(({ id }) => id !== roomId)
      setSelectedRoomId((currentId) => {
        if (currentId !== roomId) return currentId
        const fallback = next.find(({ id }) => id === 'general') ?? next.at(0)
        const fallbackId = fallback?.id
        if (fallbackId) localStorage.setItem(selectedRoomKey, fallbackId)
        return fallbackId
      })
      return next
    })
  }, [])

  const acknowledge = useCallback(async (roomId: string) => {
    const response = await apiFetch(
      `/api/rooms/${roomId}/attention/acknowledge`,
      { method: 'POST' },
    )
    if (!response.ok) return
    const result = (await response.json()) as {
      attentionCount: number
      mentionCount: number
    }
    setRooms((current) =>
      current.map((room) =>
        room.id === roomId
          ? {
              ...room,
              attentionCount: result.attentionCount,
              mentionCount: result.mentionCount,
            }
          : room,
      ),
    )
  }, [])

  useEffect(() => {
    if (!viewingRoom || !windowActive || !selectedRoomId) return
    const room = roomsRef.current.find(({ id }) => id === selectedRoomId)
    if (!room) return
    if (room.latestOtherMessage) markRoomSeen(room.id, room.latestOtherMessage)
    if (room.attentionCount > 0) void acknowledge(selectedRoomId)
  }, [acknowledge, markRoomSeen, selectedRoomId, viewingRoom, windowActive])

  useEffect(() => {
    let stopped = false
    const selectFrom = (nextRooms: Room[]) => {
      setSelectedRoomId((current) => {
        if (current && nextRooms.some(({ id }) => id === current))
          return current
        const saved = localStorage.getItem(selectedRoomKey)
        return nextRooms.some(({ id }) => id === saved)
          ? saved!
          : (nextRooms.find(({ id }) => id === 'general') ?? nextRooms.at(0))
              ?.id
      })
    }
    const connect = () => {
      if (stopped) return
      workspaceSocket.current = connectWorkspaceStream({
        onMessage(data) {
          const event = JSON.parse(data) as WorkspaceStreamMessage
          if (stopped) return
          if (event.type === 'workspace.snapshot') {
            const next = orderedRooms(event.rooms)
            setRooms(next)
            setThreadAttentionByRoom(threadAttentionRootsFromRooms(next))
            selectFrom(next)
          }
          if (event.type === 'room.created')
            setRooms((current) => orderedRooms(upsert(current, event.room)))
          if (event.type === 'room.removed') forgetRoom(event.roomId)
          if (event.type === 'attention.changed') {
            const alreadyViewing = isActivelyViewingRoom({
              selectedRoomId: selectedRoomRef.current,
              roomId: event.roomId,
              viewingRoom: viewingRoomRef.current,
              windowActive: windowIsActiveNow(),
            })
            setRooms((current) =>
              current.map((room) =>
                room.id === event.roomId
                  ? {
                      ...room,
                      attentionCount: event.attentionCount,
                      mentionCount: event.mentionCount,
                    }
                  : room,
              ),
            )
            if (
              event.kind === 'mention' &&
              event.attentionCount > 0 &&
              !alreadyViewing
            ) {
              toast.add({
                type: 'info',
                title: 'You were mentioned',
                description: `New mention in ${event.roomName}`,
              })
              playMentionSound()
            }
            setThreadAttentionByRoom((current) =>
              applyThreadAttentionEvent(current, event),
            )
            if (event.attentionCount > 0 && alreadyViewing)
              void acknowledge(event.roomId)
          }
          if (event.type === 'message.created') recordMessageActivity(event)
        },
      })
    }

    void apiFetch('/api/rooms')
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load rooms')
        const result = (await response.json()) as { rooms: Room[] }
        if (stopped) return
        const next = orderedRooms(result.rooms)
        setRooms(next)
        setThreadAttentionByRoom(threadAttentionRootsFromRooms(next))
        selectFrom(next)
      })
      .catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : 'Unable to load rooms',
        ),
      )
      .finally(connect)

    return () => {
      stopped = true
      workspaceSocket.current?.close()
    }
  }, [acknowledge, forgetRoom, recordMessageActivity])

  useEffect(() => {
    if (!selectedRoomId) return
    historyReadyRef.current = false
    nextCursorRef.current = undefined
    let stopped = false
    let attempts = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    let pendingSteps: StepArrival[] = []
    let frame: number | undefined

    // A working agent emits many steps per frame, and this state sits at the top
    // of the tree, so a commit per step re-renders the whole Dashboard. Coalesce
    // a burst into one commit per frame. The buffer lives in the effect scope so
    // switching rooms discards it instead of leaking steps into the next room.
    const discardPendingSteps = () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame)
        frame = undefined
      }
      pendingSteps = []
    }

    const flushSteps = () => {
      frame = undefined
      if (!pendingSteps.length) return
      const batch = pendingSteps
      pendingSteps = []
      setLatestStepByRun((current) => mergeLatestSteps(current, batch))
      setLiveStepsByRun((current) => mergeLiveSteps(current, batch))
    }

    const connect = () => {
      if (stopped) return
      const handle = connectRoomStream(selectedRoomId, {
        onOpen() {
          attempts = 0
          setConnection('connected')
        },
        onMessage(data) {
          const event = JSON.parse(data) as RoomStreamMessage
          if (stopped) return
          if (event.type === 'room.snapshot') {
            if (event.room.id !== selectedRoomId) return
            discardPendingSteps()
            setRooms((current) =>
              current.map((room) =>
                room.id === event.room.id
                  ? {
                      ...room,
                      ...event.room,
                    }
                  : room,
              ),
            )
            setThreadAttentionByRoom((current) => {
              const next = { ...current }
              if (event.room.threadAttentionRootIds?.length)
                next[event.room.id] = [...event.room.threadAttentionRootIds]
              else delete next[event.room.id]
              return next
            })
            if (!historyReadyRef.current) {
              const focusId = pendingFocusRef.current
              if (
                focusId &&
                !event.messages.some((message) => message.id === focusId)
              ) {
                void loadAroundFocus(selectedRoomId, focusId)
              } else {
                acceptServerMessages(event.messages, { replaceLive: 'all' })
                setMessages(mergeMessages([], event.messages))
                runsRef.current = mergeRuns([], event.runs)
                setRuns(runsRef.current)
                nextCursorRef.current = event.nextCursor
                setNextCursor(event.nextCursor)
                historyReadyRef.current = true
                if (focusId) {
                  setFocusMessageId(focusId)
                  pendingFocusRef.current = undefined
                }
                setLoading(false)
              }
            } else {
              // Partial reconnect window: baselines refresh for roots in the
              // snapshot; live overlays for other loaded roots stay put.
              acceptServerMessages(event.messages)
              setMessages((current) => mergeMessages(current, event.messages))
              runsRef.current = mergeRuns(runsRef.current, event.runs)
              setRuns(runsRef.current)
              setLoading(false)
            }
            setLatestStepByRun(
              new Map(event.latestSteps.map((s) => [s.runId, s])),
            )
            setLiveStepsByRun(
              new Map(event.latestSteps.map((step) => [step.runId, [step]])),
            )
            if (
              isActivelyViewingRoom({
                selectedRoomId: selectedRoomRef.current,
                roomId: event.room.id,
                viewingRoom: viewingRoomRef.current,
                windowActive: windowIsActiveNow(),
              })
            ) {
              if (event.room.latestOtherMessage)
                markRoomSeen(event.room.id, event.room.latestOtherMessage)
              if (event.room.attentionCount > 0)
                void acknowledge(selectedRoomId)
            }
          }
          if (
            (event.type === 'message.created' ||
              event.type === 'message.updated') &&
            event.message.roomId === selectedRoomId
          ) {
            if (event.message.rootId) {
              if (event.type === 'message.created')
                recordThreadReply(event.message)
              else recordThreadReplyEdit(event.message)
            } else {
              acceptServerMessages([event.message])
              setMessages((current) => mergeMessages(current, [event.message]))
            }
            if (event.type === 'message.created')
              recordMessageActivity({
                roomId: event.message.roomId,
                messageId: event.message.id,
                createdAt: event.message.createdAt,
                authorId: event.message.author.id,
              })
          }
          if (
            event.type === 'run.changed' &&
            event.run.roomId === selectedRoomId
          ) {
            runsRef.current = mergeRuns(runsRef.current, [event.run])
            setRuns((current) => mergeRuns(current, [event.run]))
            recordLiveThreadResult(event.run)
          }
          if (
            event.type === 'run.step' &&
            runsRef.current.some((r) => r.id === event.runId)
          ) {
            pendingSteps.push({ runId: event.runId, step: event.step })
            if (frame === undefined) frame = requestAnimationFrame(flushSteps)
          }
          if (event.type === 'room.members.changed') {
            setMembersChangedAt((current) => ({
              ...current,
              [event.roomId]: Date.now(),
            }))
          }
        },
        onClose() {
          if (stopped) return
          discardPendingSteps()
          if (attempts++ >= 5) {
            setConnection('disconnected')
            setError('Coordinator unavailable')
            return
          }
          setConnection('reconnecting')
          retry = setTimeout(connect, Math.min(1_000 * 2 ** attempts, 10_000))
        },
        onError() {
          roomSocket.current?.close()
        },
      })
      roomSocket.current = handle
    }

    connect()
    return () => {
      stopped = true
      if (retry) clearTimeout(retry)
      if (frame !== undefined) cancelAnimationFrame(frame)
      roomSocket.current?.close()
    }
  }, [
    acceptServerMessages,
    acknowledge,
    loadAroundFocus,
    markRoomSeen,
    recordLiveThreadResult,
    recordMessageActivity,
    recordThreadReply,
    recordThreadReplyEdit,
    selectedRoomId,
  ])

  const notificationByRoom = useMemo<Record<string, RoomNotification>>(
    () =>
      Object.fromEntries(
        rooms.flatMap((room) => {
          const notification = roomNotification(
            room.mentionCount,
            room.attentionCount,
            room.latestOtherMessage,
            seenRoomMessagesRef.current[room.id],
          )
          return notification ? [[room.id, notification]] : []
        }),
      ),
    [rooms, seenVersion],
  )

  const dockBadgeVisible = hasAnyRoomNotification(notificationByRoom)
  if (lastDockBadgeRef.current !== dockBadgeVisible) {
    lastDockBadgeRef.current = dockBadgeVisible
    void setAppDockBadge(dockBadgeVisible)
  }

  const loadOlder = useCallback(async () => {
    const roomId = selectedRoomId
    const cursor = nextCursorRef.current
    if (!roomId || !cursor || loadingOlderRef.current) return
    loadingOlderRef.current = true
    setLoadingOlder(true)
    try {
      const response = await apiFetch(
        `/api/rooms/${roomId}/messages?cursor=${encodeURIComponent(cursor)}`,
      )
      const page = (await response.json()) as RoomHistoryPage & {
        error?: string
      }
      if (!response.ok) throw new Error(page.error ?? 'Unable to load history')
      if (selectedRoomRef.current !== roomId) return
      acceptServerMessages(page.messages)
      setMessages((current) => mergeMessages(current, page.messages))
      runsRef.current = mergeRuns(runsRef.current, page.runs)
      setRuns((current) => mergeRuns(current, page.runs))
      nextCursorRef.current = page.nextCursor
      setNextCursor(page.nextCursor)
      setError(undefined)
    } catch (reason) {
      if (selectedRoomRef.current === roomId)
        setError(
          reason instanceof Error ? reason.message : 'Unable to load history',
        )
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }, [acceptServerMessages, selectedRoomId])

  useEffect(() => {
    if (!selectedRoomId) return
    let stopped = false
    void apiFetch(`/api/rooms/${selectedRoomId}/mentionable-accounts`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load mentions')
        const result = (await response.json()) as {
          accounts: MentionableAccount[]
        }
        if (!stopped) setMentionableAccounts(result.accounts)
      })
      .catch(() => {
        if (!stopped) setMentionableAccounts([])
      })
    return () => {
      stopped = true
    }
  }, [membersChangedAt, selectedRoomId])

  const request = async <T>(
    path: string,
    body?: unknown,
    method = 'POST',
  ): Promise<T | undefined> => {
    try {
      const response = await apiFetch(path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const result = (await response.json()) as T & { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Request failed')
      setError(undefined)
      return result
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Request failed')
    }
  }

  return {
    rooms,
    room: rooms.find(({ id }) => id === selectedRoomId),
    messages: messagesForTimeline,
    runs,
    latestStepByRun,
    liveStepsByRun,
    loading,
    connection,
    error,
    membersChangedAt,
    mentionableAccounts,
    notificationByRoom,
    threadAttentionRootIds: selectedRoomId
      ? (threadAttentionByRoom[selectedRoomId] ?? [])
      : [],
    clearThreadAttention: (rootId: string) => {
      const roomId = selectedRoomRef.current
      if (!roomId) return
      setThreadAttentionByRoom((current) =>
        acknowledgeThreadAttentionRoot(current, roomId, rootId),
      )
    },
    select: (roomId: string) => {
      if (roomId === selectedRoomId) return
      pendingFocusRef.current = undefined
      setFocusMessageId(undefined)
      setSelectedRoomId(roomId)
      localStorage.setItem(selectedRoomKey, roomId)
      historyReadyRef.current = false
      nextCursorRef.current = undefined
      loadingOlderRef.current = false
      setMessages([])
      clearLiveThreadActivity()
      serverSummariesRef.current = {}
      setRuns([])
      setNextCursor(undefined)
      setLoadingOlder(false)
      setLatestStepByRun(new Map())
      setLiveStepsByRun(new Map())
      setMentionableAccounts([])
      setLoading(true)
      setConnection('connecting')
    },
    openMessage: (roomId: string, messageId: string) => {
      pendingFocusRef.current = messageId
      if (roomId === selectedRoomRef.current) {
        if (messagesRef.current.some((message) => message.id === messageId)) {
          setFocusMessageId(messageId)
          pendingFocusRef.current = undefined
          return
        }
        void loadAroundFocus(roomId, messageId)
        return
      }
      setFocusMessageId(undefined)
      setSelectedRoomId(roomId)
      localStorage.setItem(selectedRoomKey, roomId)
      historyReadyRef.current = false
      nextCursorRef.current = undefined
      loadingOlderRef.current = false
      setMessages([])
      clearLiveThreadActivity()
      serverSummariesRef.current = {}
      setRuns([])
      setNextCursor(undefined)
      setLoadingOlder(false)
      setLatestStepByRun(new Map())
      setLiveStepsByRun(new Map())
      setMentionableAccounts([])
      setLoading(true)
      setConnection('connecting')
    },
    focusMessageId,
    clearFocusMessage: () => setFocusMessageId(undefined),
    draft: selectedRoomId ? (drafts.current[selectedRoomId] ?? '') : '',
    setDraft: (text: string) => {
      if (selectedRoomId) drafts.current[selectedRoomId] = text
    },
    create: async (
      name: string,
      visibility: 'public' | 'private' = 'public',
    ) => {
      try {
        const response = await apiFetch('/api/rooms', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, visibility }),
        })
        const result = (await response.json()) as {
          room?: Room
          error?: string
        }
        if (!response.ok || !result.room)
          throw new Error(result.error ?? 'Unable to create room')
        setCreateError(undefined)
        setError(undefined)
        setRooms((current) => orderedRooms(upsert(current, result.room!)))
        setSelectedRoomId(result.room.id)
        localStorage.setItem(selectedRoomKey, result.room.id)
        historyReadyRef.current = false
        nextCursorRef.current = undefined
        loadingOlderRef.current = false
        setMessages([])
        clearLiveThreadActivity()
        serverSummariesRef.current = {}
        setRuns([])
        setNextCursor(undefined)
        setLoadingOlder(false)
        setLatestStepByRun(new Map())
        setLiveStepsByRun(new Map())
        setLoading(true)
        setConnection('connecting')
        return result
      } catch (reason) {
        setCreateError(
          reason instanceof Error ? reason.message : 'Unable to create room',
        )
      }
    },
    remove: async (roomId: string) => {
      const result = await request<{ ok: true }>(
        `/api/rooms/${roomId}`,
        undefined,
        'DELETE',
      )
      if (result) forgetRoom(roomId)
      return result
    },
    createError,
    threadReplies,
    sendReply: async (rootId: string, text: string, files: File[] = []) => {
      if (!selectedRoomId) return
      let result: RoomMessage | undefined
      try {
        const body = files.length
          ? (() => {
              const form = new FormData()
              form.set('text', text)
              form.set('rootId', rootId)
              files.forEach((file) => form.append('attachments', file))
              return form
            })()
          : JSON.stringify({ text, rootId })
        const response = await apiFetch(
          `/api/rooms/${selectedRoomId}/messages`,
          {
            method: 'POST',
            headers: files.length
              ? undefined
              : { 'content-type': 'application/json' },
            body,
          },
        )
        const responseBody = (await response.json()) as {
          message?: RoomMessage
          error?: string
        }
        if (!response.ok || !responseBody.message)
          throw new Error(responseBody.error ?? 'Request failed')
        result = responseBody.message
        setError(undefined)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Request failed')
      }
      if (result) recordThreadReply(result)
      return result
    },
    send: async (text: string, files: File[] = []) => {
      if (!selectedRoomId) return
      let result: { message: RoomMessage; run?: RoomRun } | undefined
      try {
        const body = files.length
          ? (() => {
              const form = new FormData()
              form.set('text', text)
              files.forEach((file) => form.append('attachments', file))
              return form
            })()
          : JSON.stringify({ text })
        const response = await apiFetch(
          `/api/rooms/${selectedRoomId}/messages`,
          {
            method: 'POST',
            headers: files.length
              ? undefined
              : { 'content-type': 'application/json' },
            body,
          },
        )
        const responseBody = (await response.json()) as {
          message?: RoomMessage
          run?: RoomRun
          error?: string
        }
        if (!response.ok || !responseBody.message)
          throw new Error(responseBody.error ?? 'Request failed')
        result = { message: responseBody.message, run: responseBody.run }
        setError(undefined)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Request failed')
      }
      if (result) {
        acceptServerMessages([result.message])
        setMessages((current) => mergeMessages(current, [result.message]))
        if (result.run) {
          runsRef.current = mergeRuns(runsRef.current, [result.run])
          setRuns((current) => mergeRuns(current, [result.run!]))
        }
      }
      return result
    },
    edit: async (messageId: string, text: string) => {
      if (!selectedRoomId) return
      let result: RoomMessage | undefined
      try {
        const response = await apiFetch(
          `/api/rooms/${selectedRoomId}/messages/${messageId}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
          },
        )
        const responseBody = (await response.json()) as {
          message?: RoomMessage
          error?: string
        }
        if (!response.ok || !responseBody.message)
          throw new Error(responseBody.error ?? 'Request failed')
        result = responseBody.message
        setError(undefined)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Request failed')
      }
      if (result) {
        if (result.rootId) recordThreadReplyEdit(result)
        else setMessages((current) => mergeMessages(current, [result]))
      }
      return result
    },
    loadOlder,
    loadingOlder,
    hasOlderMessages: Boolean(nextCursor),
    cancel: (runId: string) =>
      selectedRoomId
        ? request(`/api/rooms/${selectedRoomId}/runs/${runId}/cancel`)
        : undefined,
  }
}
