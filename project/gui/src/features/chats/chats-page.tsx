import { Markdown } from '#/components/markdown'
import { BrailleLoader } from '#/components/ui/braille-loader'
import { Button } from '#/components/ui/button'
import { toast } from '#/components/ui/toast'
import { AgentMark } from '#/features/agents/agent-mark'
import {
  agentNameFrom,
  useAgentDefinitions,
} from '#/features/agents/use-agent-definitions'
import { MessageComposer } from '#/features/rooms/message-composer'
import { asRunStep, RunTranscript } from '#/features/runs/run-transcript'
import type { AgentDefinition } from '#/features/schedules/types'
import { cn } from '#/lib/utils'
import { Ban, MessageSquare, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { ChatHistorySheet } from './chat-history-sheet'
import type { Chat } from './types'
import {
  useCancelChatTurn,
  useChat,
  useChats,
  useCreateChat,
  useLastChatAgent,
  useSendChatMessage,
} from './use-chats'

const DEFAULT_AGENT_ID = 'software-engineer'

function CoworkerPicker({
  agents,
  selectedId,
  disabled,
  onSelect,
}: {
  agents: AgentDefinition[]
  selectedId?: string
  disabled?: boolean
  onSelect: (id: string) => void
}) {
  return (
    <div className="@container">
      <div className="flex h-8 items-center rounded-t-md bg-muted/60 px-3">
        <p className="text-xs font-medium text-muted-foreground">Agents</p>
      </div>
      <ul className="rounded-b-md border border-t-0 border-border/50">
        {agents.map((agent) => {
          const selected = agent.id === selectedId
          return (
            <li key={agent.id}>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => onSelect(agent.id)}
                className={cn(
                  'flex h-9 w-full items-center gap-2 border-b border-border/40 px-2 text-left text-sm outline-none last:border-b-0 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
                  selected && 'bg-muted/60 font-medium',
                )}
              >
                <AgentMark agentId={agent.id} />
                <span className="min-w-0 truncate font-medium">
                  {agent.name}
                </span>
                <span className="hidden min-w-0 truncate text-xs text-muted-foreground @min-[24rem]:block">
                  {agent.description}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function RecentChats({
  chats,
  onSelect,
}: {
  chats: Chat[]
  onSelect: (id: string) => void
}) {
  const recent = chats.slice(0, 7)
  if (recent.length === 0) return null
  return (
    <div className="@container">
      <div className="flex h-8 items-center rounded-t-md bg-muted/60 px-3">
        <p className="text-xs font-medium text-muted-foreground">Recent chats</p>
      </div>
      <ul className="rounded-b-md border border-t-0 border-border/50">
        {recent.map((chat) => (
          <li key={chat.id}>
            <button
              type="button"
              onClick={() => onSelect(chat.id)}
              className="flex h-9 w-full items-center gap-2 border-b border-border/40 px-2 text-left text-sm outline-none last:border-b-0 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <AgentMark agentId={chat.agentDefinitionId} />
              <span className="min-w-0 truncate font-medium">{chat.title}</span>
              <span className="ml-auto hidden shrink-0 text-xs tabular-nums text-muted-foreground @min-[24rem]:block">
                {new Intl.DateTimeFormat(undefined, {
                  month: 'short',
                  day: 'numeric',
                }).format(chat.updatedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ChatsPage({
  selectedId,
  onSelectedIdChange,
}: {
  selectedId?: string
  onSelectedIdChange: (id: string | undefined) => void
}) {
  const { data: agents = [] } = useAgentDefinitions()
  const { data: chats = [] } = useChats()
  const [agentId, setAgentId] = useLastChatAgent(DEFAULT_AGENT_ID)
  const selectedAgent =
    agents.find((agent) => agent.id === agentId) ?? agents[0]
  const { data, error, isPending } = useChat(selectedId)
  const create = useCreateChat()
  const send = useSendChatMessage()
  const cancel = useCancelChatTurn()
  const [draft, setDraft] = useState('')
  const follow = useRef(true)
  const chat = data?.chat
  const messages = data?.messages ?? []
  const liveSteps = data?.liveSteps ?? []
  const linkedRun = data?.linkedRun
  const turnActive = Boolean(linkedRun?.turnActive)
  const working = turnActive || create.isPending || send.isPending
  const coworkerId = chat?.agentDefinitionId ?? selectedAgent?.id
  const coworkerName = chat
    ? agentNameFrom(agents, chat.agentDefinitionId)
    : selectedAgent?.name

  const submit = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || !selectedAgent || turnActive) return false
    setAgentId(selectedAgent.id)
    try {
      let chatId = selectedId
      if (!chatId) {
        const created = await create.mutateAsync(selectedAgent.id)
        chatId = created.id
        setDraft('')
        onSelectedIdChange(created.id)
      }
      await send.mutateAsync({ chatId, text: trimmed })
      setDraft('')
      return true
    } catch (reason) {
      setDraft(trimmed)
      toast.add({
        type: 'error',
        title: 'Could not send message',
        description:
          reason instanceof Error ? reason.message : 'Please try again.',
      })
      return false
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out fill-mode-backwards motion-reduce:animate-none">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        {coworkerId && coworkerName ? (
          <>
            <AgentMark agentId={coworkerId} />
            <p className="min-w-0 truncate font-semibold">{coworkerName}</p>
            {chat ? (
              <p className="hidden min-w-0 truncate text-sm text-muted-foreground sm:block">
                {chat.title}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <MessageSquare className="size-4 text-muted-foreground" />
            <p className="font-semibold">Chat</p>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => onSelectedIdChange(undefined)}
        >
          <Plus data-icon="inline-start" />
          New chat
        </Button>
      </header>

      <div className="relative min-h-0 flex-1">
        <ChatHistorySheet
          selectedChatId={selectedId}
          onSelectChat={onSelectedIdChange}
        />
        <div
          className="no-scrollbar min-h-0 h-full overflow-y-auto"
          onScroll={(event) => {
            const el = event.currentTarget
            follow.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 80
          }}
          ref={(node) => {
            if (node && follow.current) node.scrollTop = node.scrollHeight
          }}
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
            {selectedId && isPending && !data ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                <BrailleLoader text="Loading chat" />
              </p>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error instanceof Error ? error.message : 'Could not load chat'}
              </p>
            ) : null}
            {!selectedId && !messages.length ? (
              <>
                <CoworkerPicker
                  agents={agents}
                  selectedId={selectedAgent?.id}
                  disabled={working}
                  onSelect={setAgentId}
                />
                <RecentChats chats={chats} onSelect={onSelectedIdChange} />
              </>
            ) : null}
            {messages.map((message) =>
              message.role === 'user' ? (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm leading-6">
                    <Markdown>{message.text}</Markdown>
                  </div>
                </div>
              ) : (
                <RunTranscript
                  key={message.id}
                  agentId={coworkerId ?? DEFAULT_AGENT_ID}
                  text={message.text}
                  steps={message.steps.map((step) =>
                    asRunStep(step, message.runId ?? message.id),
                  )}
                />
              ),
            )}
            {turnActive ? (
              <RunTranscript
                agentId={coworkerId ?? DEFAULT_AGENT_ID}
                text=""
                steps={liveSteps.map((step) =>
                  asRunStep(step, linkedRun?.id ?? 'live'),
                )}
                working
                error={linkedRun?.error}
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="shrink-0 px-4 pb-4">
        <div className="mx-auto max-w-3xl rounded-xl border bg-background p-2.5 shadow-sm">
          {turnActive && selectedId ? (
            <div className="mb-2 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => void cancel.mutateAsync(selectedId)}
                disabled={cancel.isPending}
              >
                <Ban data-icon="inline-start" />
                Stop
              </Button>
            </div>
          ) : null}
          <MessageComposer
            value={draft}
            onChange={setDraft}
            onSubmit={async (text) => submit(text)}
            disabled={working || !selectedAgent}
            roomName="chat"
            mentionableAccounts={[]}
            hideMentions
            hideAttachments
            placeholder={
              selectedAgent
                ? `Message ${selectedAgent.name}`
                : 'Message an agent'
            }
          />
        </div>
      </div>
    </div>
  )
}
