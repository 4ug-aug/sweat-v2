import { expect, test } from 'bun:test'
import {
  closeSurface,
  historyDirection,
  openActivitySurface,
  openThreadSurface,
  readDashboardLocation,
  writeDashboardLocation,
} from './dashboard-navigation'

test('dashboard navigation uses native history and restores its location', () => {
  const originalWindow = globalThis.window
  const calls: unknown[] = []
  let state: unknown = { preserved: true }
  const history = {
    get state() {
      return state
    },
    pushState(next: unknown) {
      calls.push(next)
      state = next
    },
    replaceState(next: unknown) {
      state = next
    },
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { history },
  })

  try {
    writeDashboardLocation('account-1', { view: 'issues', id: 'issue-1' })
    expect(calls).toHaveLength(1)
    expect(readDashboardLocation(history.state, 'account-1')).toEqual({
      view: 'issues',
      id: 'issue-1',
    })
    expect(readDashboardLocation(history.state, 'account-2')).toBeUndefined()
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
  }
})

test('command-arrow maps to history outside editors', () => {
  const event = {
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
  }
  expect(historyDirection({ ...event, key: 'ArrowLeft' })).toBe(-1)
  expect(historyDirection({ ...event, key: 'ArrowRight' })).toBe(1)
  expect(historyDirection({ ...event, key: 'x' })).toBe(0)
})

test('opening a thread adds a side surface without losing the room location', () => {
  const location = { view: 'room' as const, id: 'general' }
  const next = openThreadSurface(location, 'root-1')
  expect(next).toEqual({
    view: 'room',
    id: 'general',
    surface: { kind: 'thread', rootId: 'root-1' },
  })
})

test('opening Run Activity over an open thread remembers it for restoration', () => {
  const withThread = openThreadSurface(
    { view: 'room' as const, id: 'general' },
    'root-1',
  )
  const withActivity = openActivitySurface(withThread, 'run-1')
  expect(withActivity.surface).toEqual({
    kind: 'activity',
    runId: 'run-1',
    fromRootId: 'root-1',
  })
})

test('opening Run Activity with no prior thread has nothing to restore', () => {
  const location = { view: 'room' as const, id: 'general' }
  const withActivity = openActivitySurface(location, 'run-1')
  expect(withActivity.surface).toEqual({ kind: 'activity', runId: 'run-1' })
})

test('closing Run Activity restores the thread it replaced', () => {
  const withThread = openThreadSurface(
    { view: 'room' as const, id: 'general' },
    'root-1',
  )
  const withActivity = openActivitySurface(withThread, 'run-1')
  expect(closeSurface(withActivity)).toEqual({
    view: 'room',
    id: 'general',
    surface: { kind: 'thread', rootId: 'root-1' },
  })
})

test('closing a thread with nothing behind it clears the side surface', () => {
  const withThread = openThreadSurface(
    { view: 'room' as const, id: 'general' },
    'root-1',
  )
  expect(closeSurface(withThread)).toEqual({ view: 'room', id: 'general' })
})

test('dashboard location round-trips a thread side surface through history', () => {
  const originalWindow = globalThis.window
  let state: unknown
  const history = {
    get state() {
      return state
    },
    pushState(next: unknown) {
      state = next
    },
    replaceState(next: unknown) {
      state = next
    },
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { history },
  })

  try {
    const location = openThreadSurface(
      { view: 'room' as const, id: 'general' },
      'root-1',
    )
    writeDashboardLocation('account-1', location)
    expect(readDashboardLocation(history.state, 'account-1')).toEqual(location)
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
  }
})

test('a malformed side surface is dropped but the rest of the location survives', () => {
  const state = {
    sweatDashboard: {
      accountId: 'account-1',
      location: { view: 'room', id: 'general', surface: { kind: 'bogus' } },
    },
  }
  expect(readDashboardLocation(state, 'account-1')).toEqual({
    view: 'room',
    id: 'general',
  })
})

test('removed dashboard views fall back to the default Room location', () => {
  for (const view of ['docs', 'grills']) {
    expect(
      readDashboardLocation(
        { sweatDashboard: { accountId: 'account-1', location: { view } } },
        'account-1',
      ) ?? { view: 'room' },
    ).toEqual({ view: 'room' })
  }
})
