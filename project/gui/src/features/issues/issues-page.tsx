import { AgentThinking } from '#/components/ui/agent-thinking'
import { cn } from '#/lib/utils'
import { useWindowKeydown } from '#/hooks/use-window-keydown'
import { authClient } from '#/lib/auth-client'
import { useRef, useState } from 'react'
import { IssueCreateDialog } from './components/issue-create-dialog'
import { IssueDetailPage } from './components/issue-detail-page'
import { IssueFiltersBar } from './components/issue-filters-bar'
import { IssueInsights } from './components/issue-insights'
import { IssueBulkActions } from './components/issue-bulk-actions'
import { filterIssues, issueFiltersActive } from './issue-filters'
import type { IssueListFilters } from './issue-filters'
import { IssueList } from './components/issue-list'
import type { IssueStatus } from './types'
import { ISSUE_STATUSES } from './types'
import { useIssues } from './use-issues'
import { useStoredIssueFilters } from './use-stored-issue-filters'

export function IssuesPage({
  createOpen,
  createStatus,
  onCreateOpenChange,
  selectedId,
  onSelectedIdChange,
  onOpenMachine,
}: {
  createOpen: boolean
  createStatus?: IssueStatus
  onCreateOpenChange: (open: boolean, status?: IssueStatus) => void
  selectedId?: string
  onSelectedIdChange: (id: string | undefined) => void
  onOpenMachine?: (sandboxId: string) => void
}) {
  const { data: session } = authClient.useSession()
  const accountId = session?.user.id
  const { data: issues = [], isPending, isError, error } = useIssues()
  const [createParentId, setCreateParentId] = useState<string>()
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(
    () => new Set(),
  )
  const issueListRef = useRef<HTMLDivElement>(null)
  const selectionAnchorRef = useRef<string | undefined>(undefined)
  const [filters, setFilters] = useStoredIssueFilters()
  const [insightsOpen, setInsightsOpen] = useState(false)

  const filtersWithAccount: IssueListFilters = {
    ...filters,
    accountId,
  }
  const visible = filterIssues(issues, filtersWithAccount)
  const selectedIssues = issues.filter((issue) =>
    selectedIssueIds.has(issue.id),
  )
  const filtersActive = issueFiltersActive(filtersWithAccount)
  const knownTags = [...new Set(issues.flatMap((issue) => issue.tags))].sort(
    (a, b) => a.localeCompare(b),
  )
  const visibleStatuses =
    filters.statuses.length > 0
      ? ISSUE_STATUSES.filter((status) => filters.statuses.includes(status))
      : ISSUE_STATUSES

  useWindowKeydown((event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'n')
      return
    if (event.altKey || event.shiftKey) return
    event.preventDefault()
    onCreateOpenChange(true)
  })

  const openCreate = (status?: IssueStatus, parentId?: string) => {
    setCreateParentId(parentId)
    onCreateOpenChange(true, status)
  }

  const changeSelection = (
    issueId: string,
    selected: boolean,
    extendSelection: boolean,
  ) => {
    const visibleIds = Array.from(
      issueListRef.current?.querySelectorAll<HTMLElement>('[data-issue-row]') ??
        [],
    )
      .filter((row) => row.getClientRects().length > 0)
      .map((row) => row.dataset.issueRow)
      .filter((id): id is string => Boolean(id))
    const anchorIndex = selectionAnchorRef.current
      ? visibleIds.indexOf(selectionAnchorRef.current)
      : -1
    const issueIndex = visibleIds.indexOf(issueId)
    const ids =
      extendSelection && anchorIndex >= 0 && issueIndex >= 0
        ? visibleIds.slice(
            Math.min(anchorIndex, issueIndex),
            Math.max(anchorIndex, issueIndex) + 1,
          )
        : [issueId]

    setSelectedIssueIds((current) => {
      const next = new Set(current)
      for (const id of ids) {
        if (selected) next.add(id)
        else next.delete(id)
      }
      return next
    })
    if (!extendSelection || anchorIndex < 0)
      selectionAnchorRef.current = issueId
  }

  if (selectedId) {
    return (
      <>
        <IssueDetailPage
          key={selectedId}
          issueId={selectedId}
          onBack={() => onSelectedIdChange(undefined)}
          onOpenIssue={onSelectedIdChange}
          onAddSubIssue={(parentId) => openCreate(undefined, parentId)}
          onOpenMachine={onOpenMachine}
        />
        <IssueCreateDialog
          open={createOpen}
          onOpenChange={(open) => {
            if (!open) setCreateParentId(undefined)
            onCreateOpenChange(open)
          }}
          defaultStatus={createStatus}
          defaultParentId={createParentId}
        />
      </>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-y-auto px-4 py-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out fill-mode-backwards motion-reduce:animate-none">
          {isPending ? (
            <div
              className="flex justify-center py-12 text-sm text-muted-foreground"
              role="status"
            >
              <AgentThinking label="Loading issues…" />
            </div>
          ) : isError ? (
            <p className="text-sm text-destructive" role="alert">
              {error instanceof Error ? error.message : 'Unable to load issues'}
            </p>
          ) : (
            <>
              <IssueFiltersBar
                filters={filtersWithAccount}
                knownTags={knownTags}
                insightsOpen={insightsOpen}
                onInsightsOpenChange={setInsightsOpen}
                onChange={setFilters}
                onCreate={() => openCreate()}
              />
              {visible.length === 0 && filtersActive ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No issues match these filters.
                </p>
              ) : (
                <div ref={issueListRef}>
                  <IssueList
                    issues={visible}
                    visibleStatuses={visibleStatuses}
                    hideEmptyGroups={filtersActive}
                    onOpenIssue={onSelectedIdChange}
                    onCreateInStatus={(status) => openCreate(status)}
                    selectedIssueIds={selectedIssueIds}
                    onIssueSelectedChange={changeSelection}
                  />
                </div>
              )}
            </>
          )}
        </div>
        {!isPending && !isError && (
          <aside
            className={cn(
              'hidden h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none lg:flex',
              insightsOpen ? 'w-[420px] border-l' : 'w-0',
            )}
            aria-hidden={!insightsOpen}
            inert={!insightsOpen}
          >
            <div
              className={cn(
                'w-[420px] shrink-0 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none',
                insightsOpen
                  ? 'translate-x-0 opacity-100'
                  : 'translate-x-2 opacity-0',
              )}
            >
              <IssueInsights
                issues={visible}
                selectedStatuses={filters.statuses}
                onStatusSelect={(status) =>
                  setFilters({
                    ...filters,
                    statuses:
                      filters.statuses.length === 1 &&
                      filters.statuses[0] === status
                        ? []
                        : [status],
                  })
                }
                onClose={() => setInsightsOpen(false)}
              />
            </div>
          </aside>
        )}
      </div>
      <IssueBulkActions
        issues={selectedIssues}
        onSelectionChange={(ids) => {
          setSelectedIssueIds(new Set(ids))
          if (ids.length === 0) selectionAnchorRef.current = undefined
        }}
      />
      <IssueCreateDialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) setCreateParentId(undefined)
          onCreateOpenChange(open)
        }}
        defaultStatus={createStatus}
        defaultParentId={createParentId}
      />
    </div>
  )
}
