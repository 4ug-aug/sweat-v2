import { migratedDatabase } from '#/server/test-db'
import { expect, test } from 'bun:test'
import { createAdmissionStore } from '#/server/features/accounts/admission'
import { createAdmissionHttpHandler } from '#/server/features/accounts/admission-http'
import { createWorkspaceGrantToolsConfig } from './grant-tools-config'

test('admin can read and save run tool assignment over HTTP', async () => {
  const sqlite = migratedDatabase()
  sqlite
    .query('INSERT INTO user (id, name, email) VALUES (?, ?, ?)')
    .run('admin', 'Admin', 'admin@example.com')
  const grantTools = createWorkspaceGrantToolsConfig(sqlite)
  const handler = createAdmissionHttpHandler({
    store: createAdmissionStore(sqlite),
    authenticate: async (request) =>
      request.headers.get('cookie') === 'admin'
        ? { id: 'admin', name: 'admin', role: 'admin' }
        : request.headers.get('cookie') === 'user'
          ? { id: 'user', name: 'user', role: 'user' }
          : undefined,
    guiOrigin: 'http://localhost:3000',
    onSuspend: () => {},
    createAccount: async () => Response.json({}),
    listUsers: async () => [],
    banUser: async () => ({}),
    unbanUser: async () => ({}),
    resetUserPassword: async () => Response.json({}),
    grantTools,
  })
  const url = new URL('http://localhost/api/workspace/settings/grant-tools')

  const forbidden = await handler(
    new Request(url, { headers: { cookie: 'user' } }),
    url,
  )
  expect(forbidden?.status).toBe(403)

  const listed = await handler(
    new Request(url, { headers: { cookie: 'admin' } }),
    url,
  )
  expect(listed?.status).toBe(200)
  expect(await listed!.json()).toEqual({
    mode: 'all',
    tools: [],
    bundles: {},
  })

  const saved = await handler(
    new Request(url, {
      method: 'POST',
      headers: { cookie: 'admin', 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'allowlist',
        tools: ['workspace.get_issue'],
      }),
    }),
    url,
  )
  expect(saved?.status).toBe(200)
  expect(await saved!.json()).toMatchObject({
    mode: 'allowlist',
    tools: ['workspace.get_issue'],
  })
})
