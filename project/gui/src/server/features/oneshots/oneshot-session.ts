import type { RunControl, RunSummary } from '#/server/features/runs/run-control'
import { runStep, type RunStep } from '#/server/features/runs/run-storage'

export type { RunStep as OneshotRunStep } from '#/server/features/runs/run-storage'

export type OneshotRun = RunSummary & {
  oneshotId: string
  accountId: string
  repositoryBase?: string
}

export class OneshotActiveRunError extends Error {
  constructor() {
    super('A Oneshot run is already active')
    this.name = 'OneshotActiveRunError'
  }
}

export type OneshotSession = {
  start(input: {
    accountId: string
    task: string
    agentDefinitionId: string
    repositoryBase?: string
  }): OneshotRun
  cancel(runId: string, accountId: string): Promise<OneshotRun | undefined>
  discard(runId: string, accountId: string): Promise<OneshotRun | undefined>
  get(runId: string, accountId: string): OneshotRun | undefined
  listSteps(runId: string, accountId: string): RunStep[] | undefined
  activeForAccount(accountId: string): OneshotRun | undefined
  stop(): void
}

const isActive = (state: OneshotRun['state']): boolean =>
  state === 'preparing' || state === 'running'

export function createOneshotSession(options: {
  control: RunControl
  onRunCreated?: (run: OneshotRun) => void
  onRunChange?: (run: OneshotRun) => void
}): OneshotSession {
  const runs = new Map<string, OneshotRun>()
  const steps = new Map<string, RunStep[]>()
  const startingAccounts = new Set<string>()

  const getForAccount = (runId: string, accountId: string) => {
    const run = runs.get(runId)
    return run?.accountId === accountId ? run : undefined
  }

  const activeForAccount = (accountId: string) => {
    for (const run of runs.values()) {
      if (run.accountId === accountId && isActive(run.state)) return run
    }
    return undefined
  }

  const project = (summary: RunSummary): void => {
    const existing = runs.get(summary.id)
    if (!existing) return
    const changed = { ...existing, ...summary }
    runs.set(summary.id, changed)
    options.onRunChange?.(changed)
  }

  const unsubscribe = options.control.subscribe(project)
  const unsubscribeSteps = options.control.subscribeSteps((runId, step) => {
    if (!runs.has(runId)) return
    const list = steps.get(runId)
    if (!list) return
    list.push(runStep(runId, list.length, step))
  })

  return {
    start(input) {
      if (
        startingAccounts.has(input.accountId) ||
        activeForAccount(input.accountId)
      ) {
        throw new OneshotActiveRunError()
      }
      startingAccounts.add(input.accountId)
      try {
        const oneshotId = crypto.randomUUID()
        const repositoryBase = input.repositoryBase?.trim() || undefined
        return options.control.start(input.task.trim(), {
          oneshotId,
          agentDefinitionId: input.agentDefinitionId,
          ...(repositoryBase ? { repositoryBase } : {}),
          onCreate: (summary) => {
            if (activeForAccount(input.accountId))
              throw new OneshotActiveRunError()
            const created: OneshotRun = {
              ...summary,
              oneshotId,
              accountId: input.accountId,
              ...(repositoryBase ? { repositoryBase } : {}),
            }
            options.onRunCreated?.(created)
            runs.set(created.id, created)
            steps.set(created.id, [])
            return created
          },
        })
      } finally {
        startingAccounts.delete(input.accountId)
      }
    },
    async cancel(runId, accountId) {
      const existing = getForAccount(runId, accountId)
      if (!existing) return undefined
      const summary = await options.control.cancel(runId)
      if (!summary) return existing
      const changed: OneshotRun = { ...existing, ...summary }
      runs.set(runId, changed)
      options.onRunChange?.(changed)
      return changed
    },
    async discard(runId, accountId) {
      const existing = getForAccount(runId, accountId)
      if (!existing) return undefined
      if (isActive(existing.state)) {
        const summary = await options.control.cancel(runId)
        if (summary) options.onRunChange?.({ ...existing, ...summary })
      }
      runs.delete(runId)
      steps.delete(runId)
      return existing
    },
    get: getForAccount,
    listSteps(runId, accountId) {
      if (!getForAccount(runId, accountId)) return undefined
      return [...(steps.get(runId) ?? [])]
    },
    activeForAccount,
    stop() {
      unsubscribe()
      unsubscribeSteps()
    },
  }
}
