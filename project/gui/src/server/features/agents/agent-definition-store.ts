import type { AgentRuntimeKind } from '#project/agents/definition'
import { SEEDED_AGENT_DEFINITIONS } from '#project/agents/seed-definitions'
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
  githubAccess: boolean
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
  github_access: number
  archived_at: number | null
  created_at: number
  updated_at: number
}

const mapRow = (row: Row): AgentDefinitionRecord => ({
  id: row.id,
  name: row.name,
  description: row.description,
  instructions: row.instructions,
  kind: row.runtime_kind,
  visibility: row.visibility,
  creatorAccountId: row.creator_account_id,
  ...(row.creating_agent_id ? { creatingAgentId: row.creating_agent_id } : {}),
  githubAccess: row.github_access === 1,
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

const visibleTo = (row: AgentDefinitionRecord, viewerAccountId: string) =>
  row.archivedAt === undefined &&
  (row.visibility === 'workspace' || row.creatorAccountId === viewerAccountId)

export function createAgentDefinitionStore(sqlite: Sqlite) {
  const selectById = sqlite.prepare(
    `SELECT id, name, description, instructions, runtime_kind, visibility,
            creator_account_id, creating_agent_id, github_access, archived_at,
            created_at, updated_at
     FROM agent_definition WHERE id = ?`,
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
           creator_account_id, creating_agent_id, github_access, archived_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        record.githubAccess ? 1 : 0,
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
      for (const seed of SEEDED_AGENT_DEFINITIONS) {
        if (get(seed.id)) continue
        insert({
          id: seed.id,
          name: seed.name,
          description: seed.description,
          instructions: seed.instructions,
          kind: seed.kind,
          visibility: 'workspace',
          creatorAccountId,
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
          `SELECT id, name, description, instructions, runtime_kind, visibility,
                  creator_account_id, creating_agent_id, github_access, archived_at,
                  created_at, updated_at
           FROM agent_definition
           ORDER BY name COLLATE NOCASE, id`,
        )
        .all() as Row[]
      return rows.map(mapRow).filter((row) => visibleTo(row, viewerAccountId))
    },

    listAll(): AgentDefinitionRecord[] {
      return (
        sqlite
          .prepare(
            `SELECT id, name, description, instructions, runtime_kind, visibility,
                    creator_account_id, creating_agent_id, github_access, archived_at,
                    created_at, updated_at
             FROM agent_definition
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
        githubAccess: Boolean(input.githubAccess),
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
      sqlite
        .prepare(
          `UPDATE agent_definition
           SET name = ?, description = ?, instructions = ?, visibility = ?,
               github_access = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          name,
          description,
          instructions,
          visibility,
          githubAccess ? 1 : 0,
          now,
          id,
        )
      return get(id)!
    },

    archive(id: string, accountId: string, now: number): AgentDefinitionRecord {
      requireCreator(id, accountId)
      sqlite
        .prepare(
          `UPDATE agent_definition SET archived_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(now, now, id)
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
