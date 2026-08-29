import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Mention from '@tiptap/extension-mention'
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from '@tiptap/react'
import { createRoot, type Root } from 'react-dom/client'
import { AccountFace } from '#/components/avatar'
import { AgentMark, AgentMentionChip } from '#/features/agents/agent-mark'
import { isAgentMentionId } from '#/features/agents/agent-color'
import {
  agentNameFrom,
  useAgentDefinitions,
} from '#/features/agents/use-agent-definitions'

export type MentionItem = {
  id: string
  label: string
  name: string
  description: string
  kind: 'account' | 'agent'
  image?: string
  faceName?: string
}

function ComposerMentionView({ node }: ReactNodeViewProps) {
  const id = String(node.attrs.id ?? '')
  const { data: agents = [] } = useAgentDefinitions()
  const isAgent = isAgentMentionId(
    id,
    agents.map((agent) => agent.id),
  )
  return (
    <NodeViewWrapper as="span">
      {isAgent ? (
        <AgentMentionChip agentId={id} label={agentNameFrom(agents, id)} />
      ) : (
        <>@{node.attrs.label ?? id}</>
      )}
    </NodeViewWrapper>
  )
}

export const ComposerMention = Mention.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ComposerMentionView, {
      as: 'span',
      className: 'mention',
      attrs: ({ node }) => {
        const mentionId = node.attrs.id
        return {
          'data-type': 'mention',
          ...(mentionId ? { 'data-id': String(mentionId) } : {}),
        }
      },
    })
  },
})

function MentionMenu({
  items,
  selected,
  command,
}: {
  items: MentionItem[]
  selected: number
  command: (item: MentionItem) => void
}) {
  const groups = [
    { kind: 'account' as const, label: 'People' },
    { kind: 'agent' as const, label: 'Agents' },
  ]
  return (
    <>
      {groups.map(({ kind, label }) => {
        const rows = items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.kind === kind)
        if (!rows.length) return null
        return (
          <div
            key={kind}
            className="mention-menu-group"
            role="group"
            aria-label={label}
          >
            <div className="mention-menu-heading" aria-hidden="true">
              {label}
            </div>
            {rows.map(({ item, index }) => (
              <button
                key={`${item.kind}-${item.id}`}
                type="button"
                role="option"
                aria-selected={index === selected}
                className={index === selected ? 'is-selected' : ''}
                onMouseDown={(event) => {
                  event.preventDefault()
                  command(item)
                }}
              >
                {item.kind === 'agent' ? (
                  <AgentMark agentId={item.id} className="shrink-0" />
                ) : (
                  <AccountFace
                    name={item.faceName ?? item.name}
                    image={item.image}
                    className="size-6 shrink-0 text-xs"
                  />
                )}
                <span className="mention-menu-copy">
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </span>
              </button>
            ))}
          </div>
        )
      })}
    </>
  )
}

export function suggestionMenu(
  mentionOpen: { current: boolean },
  container: { current: HTMLDivElement | null },
  queryClient: QueryClient,
): {
  onStart: (props: {
    items: MentionItem[]
    command: (item: MentionItem) => void
    clientRect?: (() => DOMRect | null) | null
  }) => void
  onUpdate: (props: {
    items: MentionItem[]
    command: (item: MentionItem) => void
    clientRect?: (() => DOMRect | null) | null
  }) => void
  onKeyDown: ({ event }: { event: KeyboardEvent }) => boolean
  onExit: () => void
} {
  let popup: HTMLDivElement | undefined
  let root: Root | undefined
  let selected = 0
  let current:
    | {
        items: MentionItem[]
        command: (item: MentionItem) => void
        clientRect?: (() => DOMRect | null) | null
      }
    | undefined
  const render = (props: {
    items: MentionItem[]
    command: (item: MentionItem) => void
    clientRect?: (() => DOMRect | null) | null
  }) => {
    current = props
    if (!root) return
    // Detached createRoot does not inherit the app QueryClient; AgentMark needs one.
    root.render(
      <QueryClientProvider client={queryClient}>
        <MentionMenu
          items={props.items}
          selected={selected}
          command={props.command}
        />
      </QueryClientProvider>,
    )
  }
  return {
    onStart(props) {
      popup = document.createElement('div')
      popup.className = 'mention-menu'
      popup.setAttribute('role', 'listbox')
      popup.setAttribute('aria-label', 'People and agents')
      ;(container.current ?? document.body).appendChild(popup)
      root = createRoot(popup)
      render(props)
      mentionOpen.current = true
    },
    onUpdate(props) {
      selected = Math.min(selected, Math.max(0, props.items.length - 1))
      render(props)
    },
    onKeyDown({ event }: { event: KeyboardEvent }) {
      const props = current
      if (!props) return false
      if (!props.items.length) return false
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        selected =
          (selected +
            (event.key === 'ArrowDown' ? 1 : -1) +
            props.items.length) %
          props.items.length
        render(props)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        props.command(props.items[selected])
        return true
      }
      if (event.key === 'Escape') return true
      return false
    },
    onExit() {
      const leaving = popup
      const leavingRoot = root
      if (leaving) {
        leaving.classList.add('is-leaving')
        let removed = false
        const remove = () => {
          if (removed) return
          removed = true
          leavingRoot?.unmount()
          leaving.remove()
        }
        leaving.addEventListener('animationend', remove, { once: true })
        // Fallback in case the animation never fires (e.g. reduced motion).
        setTimeout(remove, 200)
      }
      popup = undefined
      root = undefined
      selected = 0
      current = undefined
      mentionOpen.current = false
    },
  }
}
