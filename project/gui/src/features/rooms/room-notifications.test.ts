import { expect, test } from 'bun:test'
import {
  acknowledgeThreadAttentionRoot,
  applyThreadAttentionEvent,
  hasAnyRoomNotification,
  isActivelyViewingRoom,
  roomNotification,
} from './room-notifications'
import type { RoomMessageMarker } from './types'

const message = (id: string, createdAt: number): RoomMessageMarker => ({
  id,
  createdAt,
  authorId: 'other',
})

test('mentions take precedence over unread messages', () => {
  expect(roomNotification(1, 1, message('new', 2), message('old', 1))).toBe(
    'mention',
  )
})

test('unread messages are detected after the seen marker', () => {
  expect(roomNotification(0, 0, message('new', 2), message('old', 1))).toBe(
    'unread',
  )
  expect(roomNotification(0, 0, message('old', 1), message('old', 1))).toBe(
    undefined,
  )
})

test('non-mention attention (e.g. Thread Attention) surfaces the sidebar badge even without a flat unread message', () => {
  expect(roomNotification(0, 1, undefined, undefined)).toBe('unread')
  expect(roomNotification(0, 1, message('old', 1), message('old', 1))).toBe(
    'unread',
  )
  expect(roomNotification(0, 0, undefined, undefined)).toBeUndefined()
})

test('a selected room is not being viewed when the window is in the background', () => {
  expect(
    isActivelyViewingRoom({
      selectedRoomId: 'general',
      roomId: 'general',
      viewingRoom: true,
      windowActive: false,
    }),
  ).toBe(false)
})

test('a selected room is not being viewed when another dashboard surface is open', () => {
  expect(
    isActivelyViewingRoom({
      selectedRoomId: 'general',
      roomId: 'general',
      viewingRoom: false,
      windowActive: true,
    }),
  ).toBe(false)
})

test('a different room is not being viewed even when the window is focused on a room', () => {
  expect(
    isActivelyViewingRoom({
      selectedRoomId: 'docs',
      roomId: 'general',
      viewingRoom: true,
      windowActive: true,
    }),
  ).toBe(false)
})

test('the selected room is being viewed only in a focused room timeline', () => {
  expect(
    isActivelyViewingRoom({
      selectedRoomId: 'general',
      roomId: 'general',
      viewingRoom: true,
      windowActive: true,
    }),
  ).toBe(true)
})

test('hasAnyRoomNotification is true when any room has a notification', () => {
  expect(hasAnyRoomNotification({})).toBe(false)
  expect(hasAnyRoomNotification({ a: undefined })).toBe(false)
  expect(hasAnyRoomNotification({ a: 'unread' })).toBe(true)
  expect(hasAnyRoomNotification({ a: 'mention', b: 'unread' })).toBe(true)
})

test('a thread_reply attention event adds its root, mentions do not', () => {
  const empty = {}
  expect(
    applyThreadAttentionEvent(empty, {
      roomId: 'general',
      kind: 'mention',
      rootId: 'root-1',
    }),
  ).toBe(empty)
  expect(
    applyThreadAttentionEvent(empty, {
      roomId: 'general',
      kind: 'thread_reply',
      rootId: 'root-1',
    }),
  ).toEqual({ general: ['root-1'] })
})

test('thread_reply attention is idempotent per root and acknowledge removes only that root', () => {
  const withTwo = { general: ['root-a', 'root-b'] }
  expect(
    applyThreadAttentionEvent(withTwo, {
      roomId: 'general',
      kind: 'thread_reply',
      rootId: 'root-a',
    }),
  ).toBe(withTwo)
  expect(acknowledgeThreadAttentionRoot(withTwo, 'general', 'root-a')).toEqual({
    general: ['root-b'],
  })
  expect(acknowledgeThreadAttentionRoot(withTwo, 'docs', 'root-a')).toBe(withTwo)
})
