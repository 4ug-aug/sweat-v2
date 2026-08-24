import type { RoomMessageMarker } from './types'

export type RoomNotification = 'mention' | 'unread'

export function compareMessageMarkers(
  left: RoomMessageMarker,
  right: RoomMessageMarker,
): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id)
}

export function roomNotification(
  mentionCount: number,
  /** Total open Attention for the room, aggregating mentions, terminal runs, and Thread Attention. */
  attentionCount: number,
  latestOtherMessage: RoomMessageMarker | undefined,
  seenMessage: RoomMessageMarker | undefined,
): RoomNotification | undefined {
  if (mentionCount > 0) return 'mention'
  if (attentionCount > 0) return 'unread'
  if (
    latestOtherMessage &&
    (!seenMessage || compareMessageMarkers(latestOtherMessage, seenMessage) > 0)
  )
    return 'unread'
  return undefined
}

export function hasAnyRoomNotification(
  notificationByRoom: Partial<Record<string, RoomNotification>>,
): boolean {
  return Object.values(notificationByRoom).some(Boolean)
}

/** True only when the account is looking at this room's timeline in a focused window. */
export function isActivelyViewingRoom(input: {
  selectedRoomId: string | undefined
  roomId: string
  viewingRoom: boolean
  windowActive: boolean
}): boolean {
  return (
    input.viewingRoom &&
    input.windowActive &&
    input.selectedRoomId === input.roomId
  )
}

export type ThreadAttentionByRoom = Record<string, string[]>

export function applyThreadAttentionEvent(
  byRoom: ThreadAttentionByRoom,
  event: {
    roomId: string
    kind?: 'mention' | 'run_terminal' | 'thread_reply'
    rootId?: string
  },
): ThreadAttentionByRoom {
  if (event.kind !== 'thread_reply' || !event.rootId) return byRoom
  const current = byRoom[event.roomId] ?? []
  if (current.includes(event.rootId)) return byRoom
  return { ...byRoom, [event.roomId]: [...current, event.rootId] }
}

export function acknowledgeThreadAttentionRoot(
  byRoom: ThreadAttentionByRoom,
  roomId: string,
  rootId: string,
): ThreadAttentionByRoom {
  const current = byRoom[roomId]
  if (!current?.includes(rootId)) return byRoom
  const nextRoots = current.filter((id) => id !== rootId)
  if (!nextRoots.length) {
    const next = { ...byRoom }
    delete next[roomId]
    return next
  }
  return { ...byRoom, [roomId]: nextRoots }
}

export function threadAttentionRootsFromRooms(
  rooms: { id: string; threadAttentionRootIds?: string[] }[],
): ThreadAttentionByRoom {
  const next: ThreadAttentionByRoom = {}
  for (const room of rooms) {
    if (room.threadAttentionRootIds?.length)
      next[room.id] = [...room.threadAttentionRootIds]
  }
  return next
}
