import type { AgentRuntimeKind } from '#project/agents/definition'
import { isSeededAgentId } from '#project/agents/roster-people'
import { SEEDED_AGENT_DEFINITIONS } from '#project/agents/seed-definitions'
import { parseAccountColor } from '#/lib/account-color'
import type { Sqlite } from '#/server/sqlite'

export type AgentVisibility = 'private' | 'workspace'

export type AgentDefinitionRecord = {
  id: string
  name: string
  description: string
  instructions: string
  kind: AgentRuntimeKind
  visibility: AgentVisibility
  creatorAccountId: string
  creatingAgentId?: string
  updaterAccountId: string
  githubAccess: boolean
  color?: string
  archivedAt?: number
  createdAt: number
  updatedAt: number
}

export type CreateAgentDefinitionInput = {
  name: string
  description: string
  instructions: string
  kind: AgentRuntimeKind
  visibility: AgentVisibility
  creatorAccountId: string
  creatingAgentId?: string
  githubAccess?: boolean
  color?: string
}

export type DuplicateAgentDefinitionInput = {
  creatorAccountId: string
  creatingAgentId?: string
}

export type UpdateAgentDefinitionPatch = Partial<{
  name: string
  description: string
  instructions: string
  visibility: AgentVisibility
  githubAccess: boolean
  color: string | null
}>

export class AgentDefinitionError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'forbidden' | 'archived' | 'conflict' | 'invalid',
  ) {
    super(message)
    this.name = 'AgentDefinitionError'
  }
}

type Row = {
  id: string
  name: string
  description: string
  instructions: string
  runtime_kind: AgentRuntimeKind
  visibility: AgentVisibility
  creator_account_id: string
  creating_agent_id: string | null
  updater_account_id: string | null
  github_access: number
  color: string | null
  archived_at: number | null
  created_at: number
  updated_at: number
}

const COLUMNS = `id, name, description, instructions, runtime_kind, visibility,
            creator_account_id, creating_agent_id, updater_account_id, github_access,
            color, archived_at, created_at, updated_at`

const mapRow = (row: Row): AgentDefinitionRecord => ({
  id: row.id,
  name: row.name,
  description: row.description,
  instructions: row.instructions,
  kind: row.runtime_kind,
  visibility: row.visibility,
  creatorAccountId: row.creator_account_id,
  ...(row.creating_agent_id ? { creatingAgentId: row.creating_agent_id } : {}),
  updaterAccountId: row.updater_account_id ?? row.creator_account_id,
  githubAccess: row.github_access === 1,
  ...(row.color ? { color: row.color } : {}),
  ...(row.archived_at != null ? { archivedAt: row.archived_at } : {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export function slugFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'agent'
}

const isKind = (value: string): value is AgentRuntimeKind =>
  value === 'cursor' || value === 'openai-agents'

const isVisibility = (value: string): value is AgentVisibility =>
  value === 'private' || value === 'workspace'

const requireText = (value: string, field: string, max: number): string => {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max)
    throw new AgentDefinitionError(`Invalid ${field}`, 'invalid')
  return trimmed
}

const normalizeColor = (value: string | null | undefined): string | undefined => {
  if (value == null || value.trim() === '') return undefined
  const parsed = parseAccountColor(value)
  if (!parsed) throw new AgentDefinitionError('Invalid color', 'invalid')
  return parsed
}

const visibleTo = (row: AgentDefinitionRecord, viewerAccountId: string) =>
  row.archivedAt === undefined &&
  (row.visibility === 'workspace' || row.creatorAccountId === viewerAccountId)

export function createAgentDefinitionStore(sqlite: Sqlite) {
  const selectById = sqlite.prepare(
    `SELECT ${COLUMNS} FROM agent_definition WHERE id = ?`,
  )

  const get = (id: string): AgentDefinitionRecord | undefined => {
    const row = selectById.get(id) as Row | undefined
    return row ? mapRow(row) : undefined
  }

  const insert = (
    record: AgentDefinitionRecord & { creatingAgentId?: string },
  ): void => {
    sqlite
      .prepare(
        `INSERT INTO agent_definition (
           id, name, description, instructions, runtime_kind, visibility,
           creator_account_id, creating_agent_id, updater_account_id, github_access,
           color, archived_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.name,
        record.description,
        record.instructions,
        record.kind,
        record.visibility,
        record.creatorAccountId,
        record.creatingAgentId ?? null,
        record.updaterAccountId,
        record.githubAccess ? 1 : 0,
        record.color ?? null,
        record.archivedAt ?? null,
        record.createdAt,
        record.updatedAt,
      )
  }

  const nextSlug = (name: string): string => {
    const base = slugFromName(name)
    if (!get(base)) return base
    for (let suffix = 2; suffix < 10_000; suffix++) {
      const candidate = `${base}-${suffix}`
      if (!get(candidate)) return candidate
    }
    throw new AgentDefinitionError('Unable to allocate Agent slug', 'conflict')
  }

  const requireCreator = (id: string, accountId: string): AgentDefinitionRecord => {
    const current = get(id)
    if (!current) throw new AgentDefinitionError('Unknown agent definition', 'not_found')
    if (current.creatorAccountId !== accountId)
      throw new AgentDefinitionError('Forbidden', 'forbidden')
    return current
  }

  return {
    ensureSeeded(creatorAccountId: string, now = Date.now()): void {
      for (const seed of Object.values(SEEDED_AGENT_DEFINITIONS)) {
        if (get(seed.id)) continue
        insert({
          id: seed.id,
          name: seed.name,
          description: seed.description,
          instructions: seed.instructions,
          kind: seed.kind,
          visibility: 'workspace',
          creatorAccountId,
          updaterAccountId: creatorAccountId,
          githubAccess: seed.githubAccess,
          createdAt: now,
          updatedAt: now,
        })
      }
    },

    get,

    listVisible(viewerAccountId: string): AgentDefinitionRecord[] {
      const rows = sqlite
        .prepare(
          `SELECT ${COLUMNS} FROM agent_definition
           ORDER BY name COLLATE NOCASE, id`,
        )
        .all() as Row[]
      return rows.map(mapRow).filter((row) => visibleTo(row, viewerAccountId))
    },

    listAll(): AgentDefinitionRecord[] {
      return (
        sqlite
          .prepare(
            `SELECT ${COLUMNS} FROM agent_definition
             ORDER BY name COLLATE NOCASE, id`,
          )
          .all() as Row[]
      ).map(mapRow)
    },

    create(input: CreateAgentDefinitionInput, now: number): AgentDefinitionRecord {
      if (!isKind(input.kind))
        throw new AgentDefinitionError('Invalid runtime kind', 'invalid')
      if (!isVisibility(input.visibility))
        throw new AgentDefinitionError('Invalid visibility', 'invalid')
      const name = requireText(input.name, 'name', 80)
      const description = requireText(input.description, 'description', 500)
      const instructions = requireText(input.instructions, 'instructions', 20_000)
      const color = normalizeColor(input.color)
      if (input.creatingAgentId && !get(input.creatingAgentId))
        throw new AgentDefinitionError('Unknown creating agent', 'invalid')
      const record: AgentDefinitionRecord = {
        id: nextSlug(name),
        name,
        description,
        instructions,
        kind: input.kind,
        visibility: input.visibility,
        creatorAccountId: input.creatorAccountId,
        ...(input.creatingAgentId
          ? { creatingAgentId: input.creatingAgentId }
          : {}),
        updaterAccountId: input.creatorAccountId,
        githubAccess: Boolean(input.githubAccess),
        ...(color ? { color } : {}),
        createdAt: now,
        updatedAt: now,
      }
      insert(record)
      return record
    },

    duplicate(
      id: string,
      input: DuplicateAgentDefinitionInput,
      now: number,
    ): AgentDefinitionRecord {
      const source = get(id)
      if (!source)
        throw new AgentDefinitionError('Unknown agent definition', 'not_found')
      return this.create(
        {
          name: `${source.name} copy`,
          description: source.description,
          instructions: source.instructions,
          kind: source.kind,
          visibility: source.visibility,
          creatorAccountId: input.creatorAccountId,
          creatingAgentId: input.creatingAgentId,
          githubAccess: source.githubAccess,
          color: source.color,
        },
        now,
      )
    },

    update(
      id: string,
      accountId: string,
      patch: UpdateAgentDefinitionPatch,
      now: number,
    ): AgentDefinitionRecord {
      const current = requireCreator(id, accountId)
      const name =
        patch.name === undefined ? current.name : requireText(patch.name, 'name', 80)
      const description =
        patch.description === undefined
          ? current.description
          : requireText(patch.description, 'description', 500)
      const instructions =
        patch.instructions === undefined
          ? current.instructions
          : requireText(patch.instructions, 'instructions', 20_000)
      const visibility = patch.visibility ?? current.visibility
      if (!isVisibility(visibility))
        throw new AgentDefinitionError('Invalid visibility', 'invalid')
      const githubAccess = patch.githubAccess ?? current.githubAccess
      const color =
        patch.color === undefined ? current.color : normalizeColor(patch.color)
      sqlite
        .prepare(
          `UPDATE agent_definition
           SET name = ?, description = ?, instructions = ?, visibility = ?,
               github_access = ?, color = ?, updater_account_id = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          name,
          description,
          instructions,
          visibility,
          githubAccess ? 1 : 0,
          color ?? null,
          accountId,
          now,
          id,
        )
      return get(id)!
    },

    archive(id: string, accountId: string, now: number): AgentDefinitionRecord {
      const current = requireCreator(id, accountId)
      if (isSeededAgentId(current.id))
        throw new AgentDefinitionError(
          'System agents cannot be archived',
          'forbidden',
        )
      sqlite
        .prepare(
          `UPDATE agent_definition
           SET archived_at = ?, updater_account_id = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(now, accountId, now, id)
      return get(id)!
    },

    mentionHandles(): ReadonlySet<string> {
      return new Set(
        (sqlite.prepare(`SELECT id FROM agent_definition`).all() as { id: string }[])
          .map((row) => row.id),
      )
    },

    mentionPattern(): RegExp {
      const ids = (sqlite.prepare(
        `SELECT id FROM agent_definition WHERE archived_at IS NULL`,
      ).all() as { id: string }[])
        .map((row) => row.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      if (!ids.length) return /(?!)/
      return new RegExp(`(^|\\s)@(${ids.join('|')})\\b\\s*`)
    },
  }
}

export type AgentDefinitionStore = ReturnType<typeof createAgentDefinitionStore>
