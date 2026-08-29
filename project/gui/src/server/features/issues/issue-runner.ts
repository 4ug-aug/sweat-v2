import type { RunControl, RunSummary } from '#/server/features/runs/run-control'
import { runStep } from '#/server/features/runs/run-storage'
import {
  buildIssueRunTask,
  issueLineBranch,
  type Issue,
  type IssueOwner,
  type IssueRun,
  type IssueRunStep,
  type IssueStore,
} from './issue-store'

export class IssueAgentRequiredError extends Error {
  constructor() {
    super('agentDefinitionId is required when the Issue owner is not an agent')
    this.name = 'IssueAgentRequiredError'
  }
}

export class IssueActiveRunError extends Error {
  constructor() {
    super('An Issue run is already active')
    this.name = 'IssueActiveRunError'
  }
}

export type IssueRunner = {
  startRun(
    issueId: string,
    options?: { agentDefinitionId?: string },
  ): { issue: Issue; run: IssueRun }
  /** Assign owner; auto-start when assigning an agent and the Issue is idle. */
  assignOwner(
    issueId: string,
    owner: IssueOwner | undefined,
  ): { issue: Issue; run?: IssueRun }
  /** After create with an agent owner — start a run when the Issue is idle. */
  maybeStartForOwner(issueId: string): { issue: Issue; run?: IssueRun }
  /** After an Issue changes, start an integrate run on its parent when direct children have settled. */
  noteChanged(issue: Issue): void
  cancel(runId: string): Promise<IssueRun | undefined>
  failStaleRuns(): IssueRun[]
  stop(): void
}

export function createIssueRunner(options: {
  store: IssueStore
  control: RunControl
  now?: () => number
  onIssueChange?: (issue: Issue) => void
  onRunCreated?: (run: IssueRun) => void
  onRunChange?: (run: IssueRun) => void
  onStep?: (step: IssueRunStep) => void
}): IssueRunner {
  const now = options.now ?? Date.now
  const pendingIntegrate = new Set<string>()
  const settled = (status: Issue['status']) =>
    status === 'in_review' || status === 'done'
  const ended = (state: RunSummary['state']) =>
    state === 'succeeded' || state === 'failed' || state === 'cancelled'

  const considerIntegrate = (parentId: string): void => {
    const parent = options.store.getIssue(parentId)
    if (!parent) return
    const children = options.store.listChildIssues(parent.id)
    if (children.length === 0) return
    if (!children.every((child) => settled(child.status))) return
    if (parent.owner?.kind !== 'agent') return
    if (settled(parent.status)) return
    if (options.store.hasActiveRun(parent.id)) {
      pendingIntegrate.add(parent.id)
      return
    }
    try {
      startRun(parent.id)
    } catch (error) {
      if (error instanceof IssueActiveRunError) return
      throw error
    }
  }

  const project = (summary: RunSummary): void => {
    const existing = options.store.getRun(summary.id)
    if (!existing) return
    const wasActive =
      existing.state === 'preparing' || existing.state === 'running'
    const changed = { ...existing, ...summary }
    options.store.updateRun(changed)
    options.onRunChange?.(changed)
    if (wasActive && changed.state === 'succeeded') {
      try {
        const updated = options.store.setDeliverable(
          changed.issueId,
          changed.stdout,
          now(),
        )
        options.onIssueChange?.(updated)
      } catch (error) {
        console.error(
          'Failed to set Issue deliverable from succeeded run',
          changed.id,
          error,
        )
      }
    }
    if (
      wasActive &&
      ended(changed.state) &&
      pendingIntegrate.delete(changed.issueId)
    )
      considerIntegrate(changed.issueId)
  }
  const unsubscribe = options.control.subscribe(project)
  const unsubscribeSteps = options.control.subscribeSteps((runId, step) => {
    const run = options.store.getRun(runId)
    if (!run) return
    const stored = runStep(runId, options.store.listSteps(runId).length, step)
    options.store.appendStep(stored)
    options.onStep?.(stored)
  })

  const rootOf = (issue: Issue): Issue => {
    let current = issue
    while (current.parentId) {
      const parent = options.store.getIssue(current.parentId)
      if (!parent) break
      current = parent
    }
    return current
  }

  const startRun = (
    issueId: string,
    startOptions: { agentDefinitionId?: string } = {},
  ): { issue: Issue; run: IssueRun } => {
    const issue = options.store.getIssue(issueId)
    if (!issue) throw new Error('Issue not found')
    const agentDefinitionId =
      issue.owner?.kind === 'agent'
        ? issue.owner.id
        : startOptions.agentDefinitionId
    if (!agentDefinitionId) throw new IssueAgentRequiredError()
    let repositoryBase = issue.effectiveBranch
    if (!repositoryBase && issue.parentId) {
      const root = rootOf(issue)
      repositoryBase = root.branch ?? root.effectiveBranch
      if (!repositoryBase) {
        repositoryBase = issueLineBranch(root.number)
        const updated = options.store.updateIssue(
          root.id,
          { branch: repositoryBase },
          now(),
        )
        options.onIssueChange?.(updated)
      }
    }
    const parent = issue.parentId
      ? options.store.getIssue(issue.parentId)
      : undefined
    const children = options.store.listChildIssues(issue.id)
    const integrating =
      children.length > 0 && children.every((child) => settled(child.status))
    const mergeRevisions = integrating
      ? children
          .slice()
          .sort((a, b) => a.number - b.number)
          .flatMap((child) =>
            child.branch && child.branch !== repositoryBase
              ? [child.branch]
              : [],
          )
      : []
    const task = buildIssueRunTask(issue, parent, children)
    return options.control.start(task, {
      issueId: issue.id,
      agentDefinitionId,
      ...(issue.createdBy?.kind === 'account'
        ? { responsibleAccountId: issue.createdBy.id }
        : {}),
      ...(repositoryBase ? { repositoryBase } : {}),
      ...(mergeRevisions.length ? { mergeRevisions } : {}),
      onCreate: (summary) => {
        const created = options.store.createRun({
          ...summary,
          issueId: issue.id,
        })
        if (!created) throw new IssueActiveRunError()
        options.onRunCreated?.(created)
        if (issue.status !== 'done' && issue.status !== 'in_progress') {
          const updated = options.store.updateIssue(
            issue.id,
            { status: 'in_progress' },
            now(),
          )
          options.onIssueChange?.(updated)
          return { issue: updated, run: created }
        }
        return { issue, run: created }
      },
    })
  }

  const maybeStartForOwner = (
    issueId: string,
  ): { issue: Issue; run?: IssueRun } => {
    const issue = options.store.getIssue(issueId)
    if (!issue) throw new Error('Issue not found')
    if (issue.owner?.kind !== 'agent') return { issue }
    if (options.store.hasActiveRun(issue.id)) return { issue }
    return startRun(issueId)
  }

  return {
    startRun,
    assignOwner: (issueId, owner) => {
      const issue = options.store.assignIssue(issueId, owner, now())
      options.onIssueChange?.(issue)
      if (owner?.kind !== 'agent') return { issue }
      if (options.store.hasActiveRun(issue.id)) return { issue }
      return startRun(issueId)
    },
    maybeStartForOwner,
    noteChanged: (issue) => {
      if (!settled(issue.status) || !issue.parentId) return
      considerIntegrate(issue.parentId)
    },
    cancel: async (runId) => {
      const run = await options.control.cancel(runId)
      return run ? options.store.getRun(run.id) : undefined
    },
    failStaleRuns: () => {
      const runs = options.store.failStaleRuns(now())
      for (const run of runs) options.onRunChange?.(run)
      return runs
    },
    stop: () => {
      unsubscribe()
      unsubscribeSteps()
    },
  }
}
