import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { act } from 'react'
import { suggestionMenu, type MentionItem } from './mention-suggestion'

if (!globalThis.document) GlobalRegistrator.register()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

const agentItem: MentionItem = {
  id: 'antboy',
  label: 'antboy',
  name: 'Antboy',
  description: 'Sweat the small stuff',
  kind: 'agent',
}

test('mention popup renders agent rows when mounted outside the app tree', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const mentionOpen = { current: false }
  const renderer = suggestionMenu(mentionOpen, { current: host }, queryClient)

  await act(() => {
    renderer.onStart({
      items: [agentItem],
      command: () => undefined,
    })
  })

  expect(mentionOpen.current).toBe(true)
  expect(host.textContent).toContain('Agents')
  expect(host.textContent).toContain('Antboy')
  expect(host.textContent).toContain('Sweat the small stuff')

  await act(() => {
    renderer.onExit()
  })
  host.remove()
})
