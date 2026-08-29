import {
  isIssueStatus,
  parseIssueCreate,
  parseIssuePatch,
  parseOwner,
} from './issue-body'
import {
  resolveIssue,
  type IssueOwner,
  type IssueStore,
} from './issue-store'
import {
  IssueActiveRunError,
  IssueAgentRequiredError,
  type IssueRunner,
} from './issue-runner'
import type {
  AgentDefinitionSummary,
  WorkspaceServerMessage,
} from '#/server/protocol'
import type { RoomUser } from '#/server/features/rooms/room-store'
import {
  overlayLivePreparation,
  type RunSummary,
} from '#/server/features/runs/run-control'
import { json, readBody } from '#/server/http/respond'
import { matchRoute, type Route } from '#/server/http/router'

export function createIssuesHttp(deps: {
  issueStore: IssueStore
  issueRunner?: IssueRunner
  agentDefinitions: (viewerAccountId: string) => AgentDefinitionSummary[]
  listWorkspaceUsers: () => RoomUser[]
  broadcastWorkspace: (message: WorkspaceServerMessage) => void
  liveRun?: (id: string) => RunSummary | undefined
}): (
  request: Request,
  url: URL,
  user: RoomUser,
) => Promise<Response | undefined> {
  const knownAgent = (id: unknown, viewerAccountId: string): id is string =>
    typeof id === 'string' &&
    deps.agentDefinitions(viewerAccountId).some((agent) => agent.id === id)
  const knownAccount = (id: string): boolean =>
    deps.listWorkspaceUsers().some((user) => user.id === id)
  const decodeRef = (raw: string): string | undefined => {
    try {
      return decodeURIComponent(raw)
    } catch {
      return undefined
    }
  }
  const requireOwner = (
    owner: IssueOwner | undefined,
    viewerAccountId: string,
  ): Response | undefined => {
    if (owner?.kind === 'agent' && !knownAgent(owner.id, viewerAccountId))
      return json({ error: 'Unknown agent definition' }, 400)
    if (owner?.kind === 'account' && !knownAccount(owner.id))
      return json({ error: 'Unknown account' }, 400)
    return undefined
  }
  const requireIssue = (
    raw: string,
  ): { ok: true; issue: NonNullable<ReturnType<IssueStore['getIssue']>> } | {
    ok: false
    response: Response
  } => {
    const ref = decodeRef(raw)
    if (!ref)
      return { ok: false, response: json({ error: 'Invalid Issue ref' }, 400) }
    const issue = resolveIssue(deps.issueStore, ref)
    if (!issue)
      return { ok: false, response: json({ error: 'Issue not found' }, 404) }
    return { ok: true, issue }
  }

  const createIssue = async (request: Request, user: RoomUser) => {
    const body = await readBody(request)
    if (!body) return json({ error: 'Invalid Issue' }, 400)
    try {
      const parsed = parseIssueCreate(body)
      if ('error' in parsed) return json({ error: parsed.error }, 400)
      const ownerError = requireOwner(parsed.owner, user.id)
      if (ownerError) return ownerError
      const issue = deps.issueStore.createIssue({
        id: crypto.randomUUID(),
        title: parsed.title,
        description: parsed.description,
        ...(parsed.status ? { status: parsed.status } : {}),
        ...(parsed.priority ? { priority: parsed.priority } : {}),
        ...(parsed.tags ? { tags: parsed.tags } : {}),
        ...(parsed.timeSpent ? { timeSpent: parsed.timeSpent } : {}),
        ...(parsed.parentId ? { parentId: parsed.parentId } : {}),
        ...(parsed.owner ? { owner: parsed.owner } : {}),
        createdBy: { kind: 'account', id: user.id },
        createdAt: Date.now(),
      })
      deps.broadcastWorkspace({ type: 'issue.created', issue })
      if (parsed.owner?.kind === 'agent' && deps.issueRunner) {
        try {
          const started = deps.issueRunner.maybeStartForOwner(issue.id)
          return json(
            {
              issue: started.issue,
              ...(started.run ? { run: started.run } : {}),
            },
            201,
          )
        } catch (error) {
          if (error instanceof IssueActiveRunError)
            return json({ issue, error: error.message }, 201)
          throw error
        }
      }
      return json({ issue }, 201)
    } catch (error) {
      return json(
        {
          error: error instanceof Error ? error.message : 'Invalid Issue',
        },
        400,
      )
    }
  }

  const routesFor = (user: RoomUser): Route[] => [
    {
      method: 'GET',
      path: '/api/issues',
      handle: (_request, url) => {
        const status = url.searchParams.get('status')
        if (status && !isIssueStatus(status))
          return json({ error: 'Invalid status' }, 400)
        return json({
          issues: deps.issueStore.listIssues(
            status && isIssueStatus(status) ? { status } : undefined,
          ),
        })
      },
    },
    {
      method: 'GET',
      path: '/api/issues/:ref',
      handle: (_request, _url, params) => {
        const resolved = requireIssue(params.ref!)
        if (!resolved.ok) return resolved.response
        return json({ issue: resolved.issue })
      },
    },
    {
      method: 'PATCH',
      path: '/api/issues/:ref',
      handle: async (request, _url, params) => {
        const resolved = requireIssue(params.ref!)
        if (!resolved.ok) return resolved.response
        const body = await readBody(request)
        if (!body) return json({ error: 'Invalid Issue' }, 400)
        try {
          const patch = parseIssuePatch(body)
          if ('error' in patch) return json({ error: patch.error }, 400)
          const updated = deps.issueStore.updateIssue(
            resolved.issue.id,
            patch,
            Date.now(),
          )
          deps.broadcastWorkspace({ type: 'issue.changed', issue: updated })
          deps.issueRunner?.noteChanged(updated)
          return json({ issue: updated })
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error ? error.message : 'Invalid Issue',
            },
            400,
          )
        }
      },
    },
    {
      method: 'DELETE',
      path: '/api/issues/:ref',
      handle: (_request, _url, params) => {
        const resolved = requireIssue(params.ref!)
        if (!resolved.ok) return resolved.response
        const children = deps.issueStore.listChildIssues(resolved.issue.id)
        if (!deps.issueStore.deleteIssue(resolved.issue.id))
          return json({ error: 'Issue not found' }, 404)
        deps.broadcastWorkspace({
          type: 'issue.deleted',
          issueId: resolved.issue.id,
        })
        for (const child of children) {
          const updated = deps.issueStore.getIssue(child.id)
          if (updated)
            deps.broadcastWorkspace({ type: 'issue.changed', issue: updated })
        }
        return json({ ok: true })
      },
    },
    {
      method: 'POST',
      path: '/api/issues/:ref/assign',
      handle: async (request, _url, params) => {
        const resolved = requireIssue(params.ref!)
        if (!resolved.ok) return resolved.response
        const body = await readBody(request)
        if (!body) return json({ error: 'Invalid owner' }, 400)
        const owner =
          body.owner === undefined ? false : parseOwner(body.owner)
        if (owner === false) return json({ error: 'Invalid owner' }, 400)
        const ownerError = requireOwner(owner, user.id)
        if (ownerError) return ownerError
        if (!deps.issueRunner)
          return json({ error: 'Issue runs unavailable' }, 503)
        try {
          const result = deps.issueRunner.assignOwner(
            resolved.issue.id,
            owner,
          )
          return json({
            issue: result.issue,
            ...(result.run ? { run: result.run } : {}),
          })
        } catch (error) {
          if (error instanceof IssueActiveRunError)
            return json({ error: error.message }, 409)
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unable to assign Issue',
            },
            400,
          )
        }
      },
    },
    {
      method: 'GET',
      path: '/api/issues/:ref/runs',
      handle: (_request, _url, params) => {
        const resolved = requireIssue(params.ref!)
        if (!resolved.ok) return resolved.response
        return json({
          runs: deps.issueStore
            .listRuns(resolved.issue.id)
            .map((run) => overlayLivePreparation(run, deps.liveRun?.(run.id))),
        })
      },
    },
    {
      method: 'POST',
      path: '/api/issues/:ref/runs',
      handle: async (request, _url, params) => {
        const resolved = requireIssue(params.ref!)
        if (!resolved.ok) return resolved.response
        if (!deps.issueRunner)
          return json({ error: 'Issue runs unavailable' }, 503)
        const body = (await readBody(request)) ?? {}
        const agentDefinitionId =
          body.agentDefinitionId === undefined
            ? undefined
            : typeof body.agentDefinitionId === 'string'
              ? body.agentDefinitionId
              : undefined
        if (
          body.agentDefinitionId !== undefined &&
          (agentDefinitionId === undefined ||
            !knownAgent(agentDefinitionId, user.id))
        )
          return json({ error: 'Unknown agent definition' }, 400)
        try {
          const result = deps.issueRunner.startRun(resolved.issue.id, {
            ...(agentDefinitionId ? { agentDefinitionId } : {}),
          })
          return json(result, 202)
        } catch (error) {
          if (error instanceof IssueActiveRunError)
            return json({ error: error.message }, 409)
          if (error instanceof IssueAgentRequiredError)
            return json({ error: error.message }, 400)
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unable to start Issue run',
            },
            400,
          )
        }
      },
    },
    {
      method: 'GET',
      path: '/api/issue-runs/:runId',
      handle: (_request, _url, params) => {
        const run = deps.issueStore.getRun(params.runId!)
        return run
          ? json({
              run: overlayLivePreparation(run, deps.liveRun?.(run.id)),
            })
          : json({ error: 'Run not found' }, 404)
      },
    },
    {
      method: 'GET',
      path: '/api/issue-runs/:runId/steps',
      handle: (_request, _url, params) => {
        const run = deps.issueStore.getRun(params.runId!)
        if (!run) return json({ error: 'Run not found' }, 404)
        return json({ steps: deps.issueStore.listSteps(run.id) })
      },
    },
    {
      method: 'POST',
      path: '/api/issue-runs/:runId/cancel',
      handle: async (_request, _url, params) => {
        const run = deps.issueStore.getRun(params.runId!)
        if (!run) return json({ error: 'Run not found' }, 404)
        const changed = await deps.issueRunner?.cancel(run.id)
        return json({ run: changed ?? run })
      },
    },
  ]

  return async (
    request: Request,
    url: URL,
    user: RoomUser,
  ): Promise<Response | undefined> => {
    const matched = matchRoute(
      [
        {
          method: 'POST',
          path: '/api/issues',
          handle: (request) => createIssue(request, user),
        },
          ...routesFor(user),
      ],
      request.method,
      url.pathname,
    )
    if (!matched) return undefined
    return matched.handle(request, url, matched.params)
  }
}
