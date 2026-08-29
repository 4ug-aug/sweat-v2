export type DashboardView =
  | 'room'
  | 'chat'
  | 'account'
  | 'workspace'
  | 'schedules'
  | 'issues'
  | 'bulletins'
  | 'vms'

/**
 * The single side surface a Room can show at once (thread rail or Run
 * Activity). `fromRootId` lets closing an Activity opened over a thread
 * restore that thread instead of closing outright.
 */
export type ThreadSideSurface = {
  kind: 'thread'
  rootId: string
  focusReplyId?: string
}
export type ActivitySideSurface = {
  kind: 'activity'
  runId: string
  fromRootId?: string
}
export type DashboardSideSurface = ThreadSideSurface | ActivitySideSurface

export type DashboardLocation = {
  view: DashboardView
  id?: string
  surface?: DashboardSideSurface
}

const views: DashboardView[] = [
  'room',
  'chat',
  'account',
  'workspace',
  'schedules',
  'issues',
  'bulletins',
  'vms',
]

function parseSurface(value: unknown): DashboardSideSurface | undefined {
  if (!value || typeof value !== 'object') return
  const { kind, rootId, runId, fromRootId, focusReplyId } = value as {
    kind?: unknown
    rootId?: unknown
    runId?: unknown
    fromRootId?: unknown
    focusReplyId?: unknown
  }
  if (kind === 'thread' && typeof rootId === 'string')
    return {
      kind,
      rootId,
      ...(typeof focusReplyId === 'string' ? { focusReplyId } : {}),
    }
  if (kind === 'activity' && typeof runId === 'string')
    return {
      kind,
      runId,
      ...(typeof fromRootId === 'string' ? { fromRootId } : {}),
    }
  return undefined
}

export function readDashboardLocation(
  state: unknown,
  accountId: string,
): DashboardLocation | undefined {
  if (!state || typeof state !== 'object') return
  const entry = (state as { sweatDashboard?: unknown }).sweatDashboard
  if (!entry || typeof entry !== 'object') return
  const { accountId: owner, location } = entry as {
    accountId?: unknown
    location?: unknown
  }
  if (owner !== accountId || !location || typeof location !== 'object') return
  const { view, id, surface } = location as {
    view?: unknown
    id?: unknown
    surface?: unknown
  }
  if (!views.includes(view as DashboardView)) return
  if (id !== undefined && typeof id !== 'string') return
  const parsedSurface = parseSurface(surface)
  return {
    view: view as DashboardView,
    ...(id ? { id } : {}),
    ...(parsedSurface ? { surface: parsedSurface } : {}),
  }
}

/** Opens (or switches to) a thread rooted at `rootId` in the same surface. */
export function openThreadSurface(
  location: DashboardLocation,
  rootId: string,
  focusReplyId?: string,
): DashboardLocation {
  return {
    ...location,
    surface: {
      kind: 'thread',
      rootId,
      ...(focusReplyId ? { focusReplyId } : {}),
    },
  }
}

/**
 * Opens Run Activity in the same surface, replacing any open thread. If a
 * thread was open, its root is remembered so `closeSurface` can restore it.
 */
export function openActivitySurface(
  location: DashboardLocation,
  runId: string,
): DashboardLocation {
  const fromRootId =
    location.surface?.kind === 'thread' ? location.surface.rootId : undefined
  return {
    ...location,
    surface: {
      kind: 'activity',
      runId,
      ...(fromRootId ? { fromRootId } : {}),
    },
  }
}

/**
 * Closes the current side surface. Closing a Run Activity that replaced a
 * thread restores that thread instead of leaving the surface empty.
 */
export function closeSurface(location: DashboardLocation): DashboardLocation {
  const surface = location.surface
  if (surface?.kind === 'activity' && surface.fromRootId)
    return {
      ...location,
      surface: { kind: 'thread', rootId: surface.fromRootId },
    }
  const { surface: _current, ...rest } = location
  return rest
}

export function writeDashboardLocation(
  accountId: string,
  location: DashboardLocation,
  replace = false,
) {
  const current =
    window.history.state && typeof window.history.state === 'object'
      ? window.history.state
      : {}
  window.history[replace ? 'replaceState' : 'pushState'](
    { ...current, sweatDashboard: { accountId, location } },
    '',
  )
}

export function historyDirection(
  event: Pick<
    KeyboardEvent,
    'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'target'
  >,
): -1 | 0 | 1 {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
    return 0
  if (
    typeof HTMLElement !== 'undefined' &&
    event.target instanceof HTMLElement &&
    event.target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    )
  )
    return 0
  return event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
}
