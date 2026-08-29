import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

test('removal migration drops feature data and preserves unrelated grants', () => {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE workspace_grant_tools (
      id INTEGER PRIMARY KEY,
      mode TEXT NOT NULL,
      tools_json TEXT NOT NULL,
      bundles_json TEXT NOT NULL
    );
    CREATE TABLE doc (id TEXT PRIMARY KEY);
    CREATE TABLE grill (id TEXT PRIMARY KEY);
    CREATE TABLE grill_participant (grill_id TEXT, user_id TEXT);
    CREATE TABLE grill_attention (id TEXT PRIMARY KEY, grill_id TEXT);
  `)
  sqlite
    .prepare(
      'INSERT INTO workspace_grant_tools (id, mode, tools_json, bundles_json) VALUES (1, ?, ?, ?)',
    )
    .run(
      'allowlist',
      JSON.stringify([
        'workspace.docs',
        'workspace.grill',
        'workspace.list_docs',
        'workspace.get_doc',
        'workspace.set_grill_frontier',
        'workspace.propose_grill_issues',
        'workspace.propose_grill_writeup',
        'workspace.list_issues',
      ]),
      JSON.stringify({
        design: ['workspace.get_doc'],
        delivery: [
          'workspace.propose_grill_issues',
          'workspace.propose_grill_writeup',
          'workspace.create_issue',
        ],
        'workspace.grill': ['workspace.set_grill_frontier'],
        'workspace.list_docs': ['workspace.create_issue'],
      }),
    )

  const migration = readFileSync(
    fileURLToPath(
      new URL('../../drizzle/0038_remove_grills_docs.sql', import.meta.url),
    ),
    'utf8',
  ).replaceAll('--> statement-breakpoint', '')
  sqlite.exec(migration)

  expect(
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('doc', 'grill', 'grill_participant', 'grill_attention')",
      )
      .all(),
  ).toEqual([])
  const config = sqlite
    .prepare(
      'SELECT mode, tools_json, bundles_json FROM workspace_grant_tools WHERE id = 1',
    )
    .get() as { mode: string; tools_json: string; bundles_json: string }
  expect(config.mode).toBe('allowlist')
  expect(JSON.parse(config.tools_json)).toEqual(['workspace.list_issues'])
  expect(JSON.parse(config.bundles_json)).toEqual({
    delivery: ['workspace.create_issue'],
  })
})
