import { DEFAULT_WARM_IDLE_TTL_MS } from '#project/runs'
import type { Step } from '#project/runs'
import type { RunSummary } from '#/server/features/runs/run-control'
import type { ChatMessageStep } from './chat-store'

/** Warm spine stays `running` between turns; `turnActive` means a turn is in flight. */
export type ChatLinkedRunView = RunSummary & { turnActive: boolean }

export type ChatTurnComplete = {
  chatId: string
  runId: string
  text: string
  state: RunSummary['state']
  error?: string
  steps: ChatMessageStep[]
}

export type ChatLinkedRuns = {
  start(input: {
    chatId: string
    task: string
    agentDefinitionId: string
    responsibleAccountId?: string
  }): RunSummary
  followUp(chatId: string, task: string): Promise<RunSummary | undefined>
  dispose(chatId: string): Promise<void>
  getLinkedRun(chatId: string): ChatLinkedRunView | undefined
  getTurnSteps(chatId: string): ChatMessageStep[]
}

export const chatRunIsLive = (state: RunSummary['state']) =>
  state === 'preparing' || state === 'running'

export function createChatLinkedRuns(deps: {
  startWarm: (input: {
    chatId: string
    task: string
    agentDefinitionId: string
    idleTtlMs: number
    responsibleAccountId?: string
    onCreate: (run: RunSummary) => RunSummary
  }) => RunSummary
  followUp: (runId: string, task: string) => Promise<RunSummary | undefined>
  cancel: (runId: string) => Promise<unknown>
  getRun: (runId: string) => RunSummary | undefined
  subscribe: (listener: (run: RunSummary) => void) => () => void
  subscribeSteps: (listener: (runId: string, step: Step) => void) => () => void
  onTurnComplete?: (turn: ChatTurnComplete) => void
}): ChatLinkedRuns {
  const byChat = new Map<string, string>()
  const chatByRun = new Map<string, string>()
  const turnSteps = new Map<string, ChatMessageStep[]>()
  const followUpInFlight = new Set<string>()
  const pendingTurn = new Set<string>()
  const previousStdout = new Map<string, string>()

  const getLinkedRunView = (
    chatId: string,
  ): ChatLinkedRunView | undefined => {
    const runId = byChat.get(chatId)
    if (!runId) return undefined
    const run = deps.getRun(runId)
    if (!run) return undefined
    const turnActive =
      followUpInFlight.has(chatId) ||
      pendingTurn.has(chatId) ||
      run.state === 'preparing' ||
      run.turnActive === true
    return { ...run, turnActive }
  }

  const stepsFor = (chatId: string): ChatMessageStep[] => [
    ...(turnSteps.get(chatId) ?? []),
  ]

  const beginTurn = (chatId: string) => {
    turnSteps.set(chatId, [])
    pendingTurn.add(chatId)
  }

  const completeTurn = (chatId: string, run: RunSummary) => {
    if (!pendingTurn.delete(chatId)) return
    const steps = stepsFor(chatId)
    const lastMessage = [...steps]
      .reverse()
      .find((step) => step.kind === 'message' && step.text.trim())
    const output = run.stdout ?? ''
    const prior = previousStdout.get(chatId) ?? ''
    const delta = output.startsWith(prior) ? output.slice(prior.length) : output
    previousStdout.set(chatId, output)
    const text =
      lastMessage?.text.trim() ||
      delta.trim() ||
      (run.state === 'failed' ? (run.error ?? 'The run failed.') : '') ||
      (run.state === 'cancelled' ? 'The run was cancelled.' : '')
    turnSteps.set(chatId, [])
    deps.onTurnComplete?.({
      chatId,
      runId: run.id,
      text,
      state: run.state,
      ...(run.error ? { error: run.error } : {}),
      steps,
    })
  }

  const remember = (chatId: string, runId: string) => {
    const previous = byChat.get(chatId)
    if (previous) chatByRun.delete(previous)
    byChat.set(chatId, runId)
    chatByRun.set(runId, chatId)
  }

  deps.subscribeSteps((runId, step) => {
    const chatId = chatByRun.get(runId)
    if (!chatId || !pendingTurn.has(chatId)) return
    const list = turnSteps.get(chatId) ?? []
    list.push({
      id: crypto.randomUUID(),
      idx: list.length,
      kind: step.kind,
      ...(step.tool !== undefined ? { tool: step.tool } : {}),
      ...(step.callId !== undefined ? { callId: step.callId } : {}),
      text: step.text,
      createdAt: step.at,
    })
    turnSteps.set(chatId, list)
  })

  deps.subscribe((run) => {
    const chatId = chatByRun.get(run.id)
    if (!chatId || !pendingTurn.has(chatId) || followUpInFlight.has(chatId))
      return
    if (run.state === 'preparing' || run.turnActive === true) return
    completeTurn(chatId, run)
  })

  return {
    start: ({ chatId, task, agentDefinitionId, responsibleAccountId }) => {
      const existing = byChat.get(chatId)
      if (existing) void deps.cancel(existing)
      followUpInFlight.delete(chatId)
      previousStdout.delete(chatId)
      beginTurn(chatId)
      const run = deps.startWarm({
        chatId,
        task,
        agentDefinitionId,
        idleTtlMs: DEFAULT_WARM_IDLE_TTL_MS,
        ...(responsibleAccountId ? { responsibleAccountId } : {}),
        onCreate: (summary) => {
          remember(chatId, summary.id)
          return summary
        },
      })
      remember(chatId, run.id)
      if (run.turnActive === false && run.state !== 'preparing')
        completeTurn(chatId, run)
      return run
    },
    followUp: async (chatId, task) => {
      const runId = byChat.get(chatId)
      if (!runId) return undefined
      previousStdout.set(chatId, deps.getRun(runId)?.stdout ?? '')
      beginTurn(chatId)
      followUpInFlight.add(chatId)
      try {
        const run = await deps.followUp(runId, task)
        if (run && byChat.get(chatId) === runId) completeTurn(chatId, run)
        return run
      } finally {
        followUpInFlight.delete(chatId)
      }
    },
    dispose: async (chatId) => {
      const runId = byChat.get(chatId)
      byChat.delete(chatId)
      turnSteps.delete(chatId)
      pendingTurn.delete(chatId)
      followUpInFlight.delete(chatId)
      previousStdout.delete(chatId)
      if (runId) {
        chatByRun.delete(runId)
        await deps.cancel(runId)
      }
    },
    getLinkedRun: (chatId) => getLinkedRunView(chatId),
    getTurnSteps: (chatId) => stepsFor(chatId),
  }
}
