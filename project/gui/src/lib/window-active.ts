import { useSyncExternalStore } from 'react'
import { isTauriRuntime } from './server-config'

export function windowIsActive(input: {
  visibilityState: DocumentVisibilityState
  documentFocused: boolean
  tauriFocused?: boolean
}): boolean {
  if (input.visibilityState !== 'visible') return false
  if (input.tauriFocused === false) return false
  return input.tauriFocused === true || input.documentFocused
}

let tauriFocused: boolean | undefined
let tauriListenStarted = false
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function startTauriFocusListen() {
  if (!isTauriRuntime() || tauriListenStarted) return
  tauriListenStarted = true
  void import('@tauri-apps/api/window')
    .then(async ({ getCurrentWindow }) => {
      const current = getCurrentWindow()
      tauriFocused = await current.isFocused()
      notify()
      return current.onFocusChanged(({ payload: focused }) => {
        tauriFocused = focused
        notify()
      })
    })
    .catch(() => {
      tauriListenStarted = false
      tauriFocused = undefined
    })
}

export function windowIsActiveNow(): boolean {
  return windowIsActive({
    visibilityState: document.visibilityState,
    documentFocused: document.hasFocus(),
    tauriFocused,
  })
}

export function subscribeWindowActive(listener: () => void): () => void {
  if (listeners.size === 0) {
    startTauriFocusListen()
    document.addEventListener('visibilitychange', notify)
    window.addEventListener('focus', notify)
    window.addEventListener('blur', notify)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    document.removeEventListener('visibilitychange', notify)
    window.removeEventListener('focus', notify)
    window.removeEventListener('blur', notify)
  }
}

export function useWindowActive() {
  return useSyncExternalStore(
    subscribeWindowActive,
    windowIsActiveNow,
    () => true,
  )
}
