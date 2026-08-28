import { afterEach, beforeAll, beforeEach, expect, test } from 'bun:test'
import { connectWorkspaceStream } from './api-transport'
import { setServerBase } from './server-config'
import { monitorSession } from '../App'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  static CONNECTING = 0
  static CLOSING = 2
  static CLOSED = 3
  readyState = FakeWebSocket.CONNECTING
  url: string
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(_data: string) {}

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
  }
}

const nativeWebSocket = globalThis.WebSocket
const nativeSetTimeout = globalThis.setTimeout
const pendingTimeouts: Array<() => void> = []
const openHandles: Array<{ close: () => void }> = []

function subscribe() {
  const messages: string[] = []
  const handle = connectWorkspaceStream({
    onMessage(data) {
      messages.push(data)
    },
  })
  openHandles.push(handle)
  return { handle, messages }
}

beforeAll(async () => {
  await setServerBase('http://workspace.test')
})

beforeEach(() => {
  FakeWebSocket.instances = []
  pendingTimeouts.length = 0
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  globalThis.setTimeout = ((
    fn: TimerHandler,
    ms?: number,
    ...args: unknown[]
  ) => {
    if (typeof fn === 'function' && typeof ms === 'number' && ms >= 1000) {
      pendingTimeouts.push(fn as () => void)
      return 0
    }
    return nativeSetTimeout(fn, ms, ...args)
  }) as typeof setTimeout
})

afterEach(() => {
  while (openHandles.length) openHandles.pop()?.close()
  globalThis.WebSocket = nativeWebSocket
  globalThis.setTimeout = nativeSetTimeout
})

test('workspace subscribers share one socket and all receive messages', () => {
  const a = subscribe()
  const b = subscribe()
  expect(FakeWebSocket.instances).toHaveLength(1)
  expect(FakeWebSocket.instances[0]?.url).toContain('/api/workspace/stream')

  FakeWebSocket.instances[0]?.onmessage?.({ data: 'hello' })
  expect(a.messages).toEqual(['hello'])
  expect(b.messages).toEqual(['hello'])

  a.handle.close()
  expect(FakeWebSocket.instances).toHaveLength(1)
  expect(FakeWebSocket.instances[0]?.readyState).not.toBe(FakeWebSocket.CLOSED)

  FakeWebSocket.instances[0]?.onmessage?.({ data: 'still-open' })
  expect(a.messages).toEqual(['hello'])
  expect(b.messages).toEqual(['hello', 'still-open'])

  b.handle.close()
  expect(FakeWebSocket.instances[0]?.readyState).toBe(FakeWebSocket.CLOSED)
})

test('workspace stream reconnects for remaining subscribers', () => {
  const a = subscribe()
  const b = subscribe()
  const first = FakeWebSocket.instances[0]
  first?.onclose?.()

  expect(pendingTimeouts).toHaveLength(1)
  pendingTimeouts.shift()?.()
  expect(FakeWebSocket.instances).toHaveLength(2)

  FakeWebSocket.instances[1]?.onmessage?.({ data: 'after-reconnect' })
  expect(a.messages).toEqual(['after-reconnect'])
  expect(b.messages).toEqual(['after-reconnect'])

  a.handle.close()
  b.handle.close()
})

test('workspace disconnect refreshes the cached account session', () => {
  let refetches = 0
  const handle = monitorSession(async () => {
    refetches++
  })
  openHandles.push(handle)

  FakeWebSocket.instances[0]?.onclose?.()

  expect(refetches).toBe(1)
})

test('closing the last subscriber does not start a reconnect', () => {
  const a = subscribe()
  const socket = FakeWebSocket.instances[0]
  a.handle.close()
  socket?.onclose?.()
  expect(socket?.readyState).toBe(FakeWebSocket.CLOSED)
  expect(pendingTimeouts).toHaveLength(0)
})

test('old socket close does not drop a replacement connection', () => {
  const a = subscribe()
  const first = FakeWebSocket.instances[0]
  a.handle.close()
  const b = subscribe()
  first?.onclose?.()
  expect(FakeWebSocket.instances).toHaveLength(2)
  expect(pendingTimeouts).toHaveLength(0)
  FakeWebSocket.instances[1]?.onmessage?.({ data: 'ok' })
  expect(b.messages).toEqual(['ok'])
})
