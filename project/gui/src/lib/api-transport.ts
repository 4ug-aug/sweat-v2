import { isTauriRuntime, sweatApiUrl } from '#/lib/server-config'

// In Tauri, HTTP goes through the plugin's native fetch, which carries a
// persistent cookie jar (the session) that the webview's own fetch cannot use
// cross-origin. In the browser, the native fetch with credentials is enough.

// ---- HTTP transport ----

async function detachTauriResponse(response: Response): Promise<Response> {
  const bytes = await response.arrayBuffer()
  const detached = new Response(bytes.byteLength ? bytes : null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
  Object.defineProperty(detached, 'url', { value: response.url })
  return detached
}

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = sweatApiUrl(path)

  if (isTauriRuntime()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    return detachTauriResponse(
      await tauriFetch(url, { credentials: 'include', ...init }),
    )
  }

  return window.fetch(url, { credentials: 'include', ...init })
}

export async function apiJson<T>(
  path: string,
  init?: RequestInit,
  fallback = 'Request failed',
): Promise<T> {
  const response = await apiFetch(path, init)
  // A 500 from an uncaught server throw has no body at all, and a proxy error
  // page is HTML. Either way `json()` rejects with a parse error that tells the
  // person nothing, so fall back to the caller's message.
  const data = (await response.json().catch(() => undefined)) as
    | (T & { error?: string })
    | undefined
  if (!response.ok) throw new Error(data?.error ?? fallback)
  if (!data) throw new Error(fallback)
  return data
}

export async function apiJsonBody<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown,
  fallback = 'Request failed',
): Promise<T> {
  return apiJson<T>(
    path,
    {
      method,
      ...(body !== undefined
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
    },
    fallback,
  )
}

// Shaped for Better Auth's customFetchImpl: accepts string | URL | Request, and
// routes its calls through the same transport so sign-in populates the cookie jar.
export async function betterAuthFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.toString()
        : input

  const merged: RequestInit =
    input instanceof Request
      ? {
          method: input.method,
          headers: input.headers,
          body: input.body,
          ...init,
        }
      : { ...init }

  if (isTauriRuntime()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    return detachTauriResponse(
      await tauriFetch(url, { credentials: 'include', ...merged }),
    )
  }

  return window.fetch(url, { credentials: 'include', ...merged })
}

// ---- WebSocket transport ----

export interface RealtimeStreamHandlers {
  onOpen?: () => void
  onMessage: (data: string) => void
  onClose?: () => void
  onError?: () => void
}

export interface RealtimeStreamHandle {
  send: (data: string) => void
  close: () => void
}

function connectRealtimeStream(
  path: string,
  handlers: RealtimeStreamHandlers,
): RealtimeStreamHandle {
  // Build ws/wss URL from the http/https sweatApiUrl
  const httpUrl = sweatApiUrl(path)
  const wsUrl = httpUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')

  if (!isTauriRuntime()) {
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => handlers.onOpen?.()
    ws.onmessage = (event) => handlers.onMessage(event.data as string)
    ws.onclose = () => handlers.onClose?.()
    ws.onerror = () => handlers.onError?.()
    return {
      send: (data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data)
      },
      close: () => ws.close(),
    }
  }

  // Tauri path: async connect, track early close
  let closed = false
  let tauriWs:
    | {
        disconnect: () => Promise<void>
        send: (message: string) => Promise<void>
      }
    | undefined

  const connectAsync = async () => {
    const TauriWebSocket = (await import('@tauri-apps/plugin-websocket'))
      .default
    // The Rust WebSocket client sends no Origin header, but the coordinator
    // gates every request on an allowed Origin before authenticating. Send the
    // webview's own origin, which is platform-specific (`#/lib/desktop-origins`).
    const headers: Record<string, string> = {
      Origin: window.location.origin,
    }
    // The WebSocket transport can't carry the HTTP session (cookie jar), so
    // authenticate the upgrade with a short-lived ticket fetched over HTTP.
    let connectUrl = wsUrl
    const ticketRes = await apiFetch('/api/realtime-ticket')
    if (ticketRes.ok) {
      const { ticket } = (await ticketRes.json()) as { ticket: string }
      connectUrl = `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}ticket=${encodeURIComponent(ticket)}`
    } else {
      console.error('realtime ticket request failed:', ticketRes.status)
    }
    const ws = await TauriWebSocket.connect(connectUrl, { headers })
    tauriWs = ws

    if (closed) {
      await ws.disconnect()
      return
    }

    ws.addListener((msg) => {
      if (msg.type === 'Text') {
        handlers.onMessage(msg.data)
      } else if (msg.type === 'Close') {
        handlers.onClose?.()
      }
    })
    await ws.send('snapshot')
    handlers.onOpen?.()
  }

  void connectAsync().catch((err: unknown) => {
    console.error('realtime stream connect failed:', err)
    handlers.onError?.()
  })

  return {
    send(data) {
      if (tauriWs) void tauriWs.send(data)
    },
    close() {
      closed = true
      if (tauriWs) void tauriWs.disconnect()
    },
  }
}

export const connectRoomStream = (
  roomId: string,
  handlers: RealtimeStreamHandlers,
) => connectRealtimeStream(`/api/rooms/${roomId}/stream`, handlers)

const workspaceSubscribers = new Set<RealtimeStreamHandlers>()
let workspaceSocket: RealtimeStreamHandle | undefined
let workspaceReconnect: ReturnType<typeof setTimeout> | undefined
let workspaceReconnectAttempts = 0

function stopWorkspaceReconnect() {
  if (workspaceReconnect) clearTimeout(workspaceReconnect)
  workspaceReconnect = undefined
}

function openWorkspaceSocket() {
  if (workspaceSocket) return
  stopWorkspaceReconnect()
  const socket = connectRealtimeStream('/api/workspace/stream', {
    onOpen() {
      if (workspaceSocket !== socket) return
      workspaceReconnectAttempts = 0
      for (const handlers of workspaceSubscribers) handlers.onOpen?.()
    },
    onMessage(data) {
      if (workspaceSocket !== socket) return
      for (const handlers of [...workspaceSubscribers]) handlers.onMessage(data)
    },
    onClose() {
      if (workspaceSocket !== socket) return
      workspaceSocket = undefined
      for (const handlers of [...workspaceSubscribers]) handlers.onClose?.()
      if (workspaceSubscribers.size === 0) return
      workspaceReconnect = setTimeout(
        () => {
          workspaceReconnect = undefined
          if (!workspaceSocket && workspaceSubscribers.size > 0)
            openWorkspaceSocket()
        },
        Math.min(1_000 * 2 ** workspaceReconnectAttempts++, 10_000),
      )
    },
    onError() {
      if (workspaceSocket !== socket) return
      for (const handlers of [...workspaceSubscribers]) handlers.onError?.()
    },
  })
  workspaceSocket = socket
}

export function connectWorkspaceStream(
  handlers: RealtimeStreamHandlers,
): RealtimeStreamHandle {
  workspaceSubscribers.add(handlers)
  openWorkspaceSocket()
  return {
    send(data) {
      workspaceSocket?.send(data)
    },
    close() {
      workspaceSubscribers.delete(handlers)
      if (workspaceSubscribers.size > 0) return
      stopWorkspaceReconnect()
      const socket = workspaceSocket
      workspaceSocket = undefined
      socket?.close()
    },
  }
}
