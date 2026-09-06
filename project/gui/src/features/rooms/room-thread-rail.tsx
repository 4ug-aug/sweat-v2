import { Avatar } from '#/components/avatar'
import { timestamp } from './format'
import { Markdown } from '#/components/markdown'
import { AgentThinking } from '#/components/ui/agent-thinking'
import { Button } from '#/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '#/components/ui/sheet'
import {
  agentNameFrom,
  useAgentDefinitions,
} from '#/features/agents/use-agent-definitions'
import { AttachmentView } from '#/features/rooms/attachment-view'
import { RunCapsule } from '#/features/runs/run-capsule'
import { useMediaQuery } from '#/hooks/use-media-query'
import { ArrowDown, X } from 'lucide-react'
import type { AnimationEvent } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import { MessageComposer } from './message-composer'
import { runsForThread } from './thread-helpers'
import {
  acknowledgeNewReplies,
  applyIncomingReplies,
  applyScrollMetrics,
  initialThreadScrollState,
} from './thread-scroll'
import type {
  MentionableAccount,
  RoomMessage,
  RoomRun,
  RunResultReply,
} from './types'
import { useRoomThread } from './use-room-thread'

function ThreadResult({
  result,
  agentName,
}: {
  result: RunResultReply
  agentName: string
}) {
  return (
    <article className="flex gap-3" data-run-result-id={result.id}>
      <Avatar author={{ id: result.agentId, name: agentName }} agent />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">{agentName}</span>
          <time className="text-xs text-muted-foreground">
            {timestamp(result.createdAt)}
          </time>
        </div>
        <div className="mt-0.5 text-sm leading-6">
          <Markdown>{result.text}</Markdown>
        </div>
      </div>
    </article>
  )
}

function ThreadMessage({
  message,
  mentionHandles,
  currentUserId,
  onEdit,
  focused,
  onFocusHandled,
  run,
  openRun,
  bubble = false,
}: {
  message: RoomMessage
  mentionHandles: string[]
  currentUserId?: string
  onEdit?: (message: RoomMessage) => void
  focused?: boolean
  onFocusHandled?: () => void
  run?: RoomRun
  openRun?: (runId: string) => void
  /** Root message only — replies stay flush with the thread timeline. */
  bubble?: boolean
}) {
  const canEdit =
    Boolean(onEdit) &&
    message.author.kind !== 'agent' &&
    message.author.id === currentUserId
  return (
    <article
      className={`group flex gap-3${focused ? ' message-search-hit' : ''}`}
      data-message-id={message.id}
      onAnimationEnd={
        focused
          ? (event: AnimationEvent<HTMLElement>) => {
              if (event.animationName !== 'message-search-hit') return
              onFocusHandled?.()
            }
          : undefined
      }
    >
      <Avatar author={message.author} agent={message.author.kind === 'agent'} />
      <div
        className={
          bubble
            ? 'min-w-0 flex-1 rounded-lg border bg-muted/30 px-3 py-2'
            : 'min-w-0 flex-1'
        }
      >
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">{message.author.name}</span>
          <time className="text-xs text-muted-foreground">
            {timestamp(message.createdAt)}
          </time>
          {message.editedAt != null && (
            <span className="text-xs text-muted-foreground">Edited</span>
          )}
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => onEdit?.(message)}
            >
              Edit
            </Button>
          )}
        </div>
        <div className="mt-0.5 text-sm leading-6">
          <Markdown mentions={mentionHandles}>{message.text}</Markdown>
        </div>
        {message.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap items-start gap-2">
            {message.attachments.map((attachment) => (
              <AttachmentView attachment={attachment} key={attachment.id} />
            ))}
          </div>
        )}
        {run && openRun && <RunCapsule run={run} openRun={openRun} />}
      </div>
    </article>
  )
}

function RoomThreadRailContent({
  roomId,
  roomName,
  rootId,
  liveReplies,
  runs = [],
  openRun,
  mentionHandles,
  mentionableAccounts,
  currentUserId,
  onClose,
  sendReply,
  editMessage,
  focusReplyId,
  onFocusReplyHandled,
  draftText,
  onDraftChange,
  onDraftSubmitted,
}: {
  roomId: string
  roomName: string
  rootId: string
  liveReplies: RoomMessage[]
  /** Room-wide runs; filtered down to this thread's root and replies. */
  runs?: RoomRun[]
  openRun?: (runId: string) => void
  mentionHandles: string[]
  mentionableAccounts: MentionableAccount[]
  currentUserId?: string
  onClose?: () => void
  sendReply: (
    rootId: string,
    text: string,
    files: File[],
  ) => Promise<RoomMessage | undefined>
  editMessage: (
    messageId: string,
    text: string,
  ) => Promise<RoomMessage | undefined>
  /** A search hit's matching reply id to scroll to and highlight once loaded. */
  focusReplyId?: string
  onFocusReplyHandled?: () => void
  /** The one in-memory draft kept for this root across rail switching/closing. */
  draftText: string
  onDraftChange: (text: string) => void
  /** Clears this root's draft after a reply or edit is submitted successfully. */
  onDraftSubmitted: () => void
}) {
  const { root, replies, results, isLoading, error } = useRoomThread(
    roomId,
    rootId,
    liveReplies,
    runs,
  )
  const { data: agents = [] } = useAgentDefinitions()
  const [editingReply, setEditingReply] = useState<RoomMessage>()
  const threadRuns = new Map(
    runsForThread(runs, root, replies).map((run) => [
      run.triggerMessageId,
      run,
    ]),
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const timelineItems = [
    ...replies.map((reply) => ({
      id: reply.id,
      createdAt: reply.createdAt,
      reply,
    })),
    ...results.map((result) => ({
      id: result.id,
      createdAt: result.createdAt,
      result,
    })),
  ].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const replyCount = replies.length + results.length

  const [scrollState, setScrollState] = useState(initialThreadScrollState)
  const previousReplyCountRef = useRef(replyCount)
  if (previousReplyCountRef.current !== replyCount) {
    const delta = replyCount - previousReplyCountRef.current
    previousReplyCountRef.current = replyCount
    if (delta > 0) {
      const next = applyIncomingReplies(scrollState, delta)
      if (next !== scrollState) setScrollState(next)
    }
  }

  useLayoutEffect(() => {
    if (!focusReplyId) return
    const target = scrollRef.current?.querySelector(
      `[data-message-id="${CSS.escape(focusReplyId)}"]`,
    )
    target?.scrollIntoView({ block: 'center', behavior: 'instant' })
  }, [focusReplyId, replies])

  useLayoutEffect(() => {
    if (focusReplyId) return
    const el = scrollRef.current
    if (el && scrollState.atBottom) el.scrollTop = el.scrollHeight
  }, [replyCount, root, focusReplyId, scrollState.atBottom])

  const submit = async (text: string, files: File[]) => {
    if (editingReply) {
      if (!text.trim()) return false
      const result = await editMessage(editingReply.id, text)
      if (result) {
        setEditingReply(undefined)
        onDraftSubmitted()
      }
      return Boolean(result)
    }
    if (!text.trim() && !files.length) return false
    const result = await sendReply(rootId, text, files)
    if (result) onDraftSubmitted()
    return Boolean(result)
  }

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <p className="font-semibold">Thread</p>
        <p className="text-xs text-muted-foreground">
          {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
        </p>
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            aria-label="Close thread"
            onClick={onClose}
          >
            <X />
          </Button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto p-4"
          onScroll={() => {
            const el = scrollRef.current
            if (!el) return
            setScrollState((current) =>
              applyScrollMetrics(current, {
                scrollTop: el.scrollTop,
                scrollHeight: el.scrollHeight,
                clientHeight: el.clientHeight,
              }),
            )
          }}
        >
          {isLoading && !root && (
            <p className="text-sm text-muted-foreground" role="status">
              <AgentThinking label="Loading thread" />
            </p>
          )}
          {error && !root && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          {root && (
            <>
              <div className="border-b pb-4">
                <ThreadMessage
                  message={root}
                  mentionHandles={mentionHandles}
                  currentUserId={currentUserId}
                  run={threadRuns.get(root.id)}
                  openRun={openRun}
                  bubble
                />
              </div>
              <div className="space-y-4 pt-4">
                {timelineItems.map((item) =>
                  'reply' in item ? (
                    <ThreadMessage
                      key={item.id}
                      message={item.reply}
                      mentionHandles={mentionHandles}
                      currentUserId={currentUserId}
                      onEdit={setEditingReply}
                      focused={focusReplyId === item.reply.id}
                      onFocusHandled={onFocusReplyHandled}
                      run={threadRuns.get(item.reply.id)}
                      openRun={openRun}
                    />
                  ) : (
                    <ThreadResult
                      key={item.id}
                      result={item.result}
                      agentName={agentNameFrom(agents, item.result.agentId)}
                    />
                  ),
                )}
                {!timelineItems.length && (
                  <p className="text-sm text-muted-foreground">
                    No replies yet.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
        {scrollState.newReplyCount > 0 && (
          <Button
            type="button"
            size="sm"
            className="absolute right-4 bottom-3 rounded-full shadow-md"
            onClick={() => {
              setScrollState(acknowledgeNewReplies)
              const el = scrollRef.current
              el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
            }}
          >
            {scrollState.newReplyCount}{' '}
            {scrollState.newReplyCount === 1 ? 'new reply' : 'new replies'}
            <ArrowDown data-icon="inline-end" />
          </Button>
        )}
      </div>
      <div className="shrink-0 p-3 pt-2">
        <div className="rounded-xl border bg-background p-2.5 shadow-sm">
          <MessageComposer
            value={draftText}
            onChange={onDraftChange}
            onSubmit={submit}
            disabled={!root}
            roomName={roomName}
            mentionableAccounts={mentionableAccounts}
            editing={Boolean(editingReply)}
            onCancelEdit={() => {
              setEditingReply(undefined)
              onDraftChange('')
            }}
          />
        </div>
      </div>
    </>
  )
}

export function RoomThreadRail({
  exiting = false,
  onExited,
  ...contentProps
}: Parameters<typeof RoomThreadRailContent>[0] & {
  /** Playing the exit transition before the next surface enters (never stacked). */
  exiting?: boolean
  onExited?: () => void
}) {
  const inline = useMediaQuery('(min-width: 1024px)')

  if (inline)
    return (
      <aside
        className={`flex h-full min-h-0 w-full flex-col bg-background ${
          exiting
            ? 'animate-out fade-out-0 slide-out-to-right-2 fill-mode-forwards duration-100'
            : 'animate-in fade-in-0 slide-in-from-right-2 fill-mode-backwards duration-200'
        }`}
        aria-label="Thread"
        onAnimationEnd={
          exiting
            ? (event) => {
                if (event.target !== event.currentTarget) return
                onExited?.()
              }
            : undefined
        }
      >
        <RoomThreadRailContent {...contentProps} />
      </aside>
    )

  return (
    <Sheet
      open={!exiting}
      onOpenChange={(open) => {
        if (!open && !exiting) contentProps.onClose?.()
      }}
      onOpenChangeComplete={(open) => {
        if (!open && exiting) onExited?.()
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full max-w-none gap-0 p-0 sm:max-w-md"
      >
        <SheetTitle className="sr-only">Thread</SheetTitle>
        <SheetDescription className="sr-only">
          Thread root, replies, and composer
        </SheetDescription>
        <RoomThreadRailContent {...contentProps} />
      </SheetContent>
    </Sheet>
  )
}
