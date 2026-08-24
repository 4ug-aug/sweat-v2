import { Button } from '#/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Kbd, KbdGroup } from '#/components/ui/kbd'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { cn } from '#/lib/utils'
import { BarChart3, ChevronDown, Plus, UserRound, X } from 'lucide-react'
import { useState } from 'react'
import { EMPTY_ISSUE_FILTERS, issueFiltersActive } from '../issue-filters'
import type { IssueListFilters } from '../issue-filters'
import { IssuePriorityIcon, IssueStatusIcon } from './issue-icons'
import { LabelDot } from './issue-labels'
import { LabelCheck } from './property-picker'
import type { IssuePriority, IssueStatus } from '../types'
import {
  ISSUE_PRIORITIES,
  ISSUE_PRIORITY_LABEL,
  ISSUE_STATUS_LABEL,
  ISSUE_STATUSES,
} from '../types'

const isApplePlatform = (): boolean =>
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((current) => current !== value)
    : [...values, value]
}

function filterTriggerClass(active: boolean) {
  return cn(
    'h-7 gap-1 px-2 text-xs font-medium text-muted-foreground',
    active && 'bg-muted text-foreground',
  )
}

function PriorityFilter({
  selected,
  onChange,
}: {
  selected: IssuePriority[]
  onChange: (priorities: IssuePriority[]) => void
}) {
  const active = selected.length > 0
  const label =
    selected.length === 0
      ? 'Priority'
      : selected.length === 1
        ? ISSUE_PRIORITY_LABEL[selected[0]]
        : `Priority  ${selected.length}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={filterTriggerClass(active)}
          />
        }
      >
        {label}
        <ChevronDown className="size-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {ISSUE_PRIORITIES.map((priority) => (
          <DropdownMenuCheckboxItem
            key={priority}
            checked={selected.includes(priority)}
            onCheckedChange={() => onChange(toggleValue(selected, priority))}
          >
            <IssuePriorityIcon priority={priority} />
            {ISSUE_PRIORITY_LABEL[priority]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StatusFilter({
  selected,
  onChange,
}: {
  selected: IssueStatus[]
  onChange: (statuses: IssueStatus[]) => void
}) {
  const active = selected.length > 0
  const label =
    selected.length === 0
      ? 'Status'
      : selected.length === 1
        ? ISSUE_STATUS_LABEL[selected[0]]
        : `Status  ${selected.length}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={filterTriggerClass(active)}
          />
        }
      >
        {label}
        <ChevronDown className="size-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {ISSUE_STATUSES.map((status) => (
          <DropdownMenuCheckboxItem
            key={status}
            checked={selected.includes(status)}
            onCheckedChange={() => onChange(toggleValue(selected, status))}
          >
            <IssueStatusIcon status={status} />
            {ISSUE_STATUS_LABEL[status]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TagsFilter({
  knownTags,
  selected,
  onChange,
}: {
  knownTags: string[]
  selected: string[]
  onChange: (tags: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const active = selected.length > 0
  const selectedSet = new Set(selected)
  const label =
    selected.length === 0
      ? 'Tags'
      : selected.length === 1
        ? selected[0]
        : `Tags  ${selected.length}`

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={filterTriggerClass(active)}
          />
        }
      >
        {label}
        <ChevronDown className="size-3 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command shouldFilter>
          <CommandInput
            placeholder="Search tags…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No tags found.</CommandEmpty>
            <CommandGroup>
              {knownTags.map((tag) => {
                const checked = selectedSet.has(tag)
                return (
                  <CommandItem
                    key={tag}
                    value={tag}
                    onSelect={() => onChange(toggleValue(selected, tag))}
                  >
                    <LabelCheck checked={checked} />
                    <LabelDot tag={tag} />
                    <span className="min-w-0 flex-1 truncate">{tag}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function IssueFiltersBar({
  filters,
  knownTags,
  insightsOpen,
  onInsightsOpenChange,
  onChange,
  onCreate,
}: {
  filters: IssueListFilters
  knownTags: string[]
  insightsOpen: boolean
  onInsightsOpenChange: (open: boolean) => void
  onChange: (filters: IssueListFilters) => void
  onCreate: () => void
}) {
  const active = issueFiltersActive(filters)
  const modifier = isApplePlatform() ? '⌘' : 'Ctrl'

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={filterTriggerClass(filters.assignedToMe)}
        aria-pressed={filters.assignedToMe}
        onClick={() =>
          onChange({ ...filters, assignedToMe: !filters.assignedToMe })
        }
      >
        <UserRound className="size-3.5" />
        Assigned to me
      </Button>
      <PriorityFilter
        selected={filters.priorities}
        onChange={(priorities) => onChange({ ...filters, priorities })}
      />
      <TagsFilter
        knownTags={knownTags}
        selected={filters.tags}
        onChange={(tags) => onChange({ ...filters, tags })}
      />
      <StatusFilter
        selected={filters.statuses}
        onChange={(statuses) => onChange({ ...filters, statuses })}
      />
      {active && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
          onClick={() =>
            onChange({
              ...EMPTY_ISSUE_FILTERS,
              accountId: filters.accountId,
            })
          }
        >
          <X className="size-3.5" />
          Clear
        </Button>
      )}
      <div className="ml-auto flex items-center gap-1">
        <Button
          type="button"
          variant={insightsOpen ? 'secondary' : 'ghost'}
          size="icon-sm"
          className="size-7 text-muted-foreground"
          aria-label="Toggle insights panel"
          aria-expanded={insightsOpen}
          onClick={() => onInsightsOpenChange(!insightsOpen)}
        >
          <BarChart3 className="size-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1.5"
          title={`${modifier}+N`}
          onClick={onCreate}
        >
          <Plus data-icon="inline-start" />
          New issue
          <KbdGroup className="pointer-events-none hidden sm:inline-flex opacity-80">
            <Kbd className="bg-primary-foreground/15 text-primary-foreground">
              {modifier}
            </Kbd>
            <Kbd className="bg-primary-foreground/15 text-primary-foreground">
              N
            </Kbd>
          </KbdGroup>
        </Button>
      </div>
    </div>
  )
}
