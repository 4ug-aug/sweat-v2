import { migratedDatabase } from '#/server/test-db'
import { expect, test } from 'bun:test'
import { createAdmissionStore } from '#/server/features/accounts/admission'
import { createAdmissionHttpHandler } from '#/server/features/accounts/admission-http'
import { createWorkspaceConnections } from './workspace-connections'


test('admin can save, link, and clear workspace connections over HTTP', async () => {
  const previous = process.env.BETTER_AUTH_SECRET
  process.env.BETTER_AUTH_SECRET = 'test-secret'
  try {
    const sqlite = migratedDatabase()
    sqlite
      .query('INSERT INTO user (id, name, email) VALUES (?, ?, ?)')
      .run('admin', 'Admin', 'admin@example.com')
    const connections = createWorkspaceConnections(sqlite)
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
      connections,
    })

    const memberList = await handler(
      new Request('http://localhost/api/workspace/settings/connections', {
        headers: { cookie: 'member' },
      }),
      new URL('http://localhost/api/workspace/settings/connections'),
    )
    expect(memberList?.status).toBe(401)

    const forbidden = await handler(
      new Request('http://localhost/api/workspace/settings/connections', {
        headers: { cookie: 'user' },
      }),
      new URL('http://localhost/api/workspace/settings/connections'),
    )
    expect(forbidden?.status).toBe(403)

    const listed = await handler(
      new Request('http://localhost/api/workspace/settings/connections', {
        headers: { cookie: 'admin' },
      }),
      new URL('http://localhost/api/workspace/settings/connections'),
    )
    expect(listed?.status).toBe(200)
    const catalog = (await listed!.json()) as {
      connections: { id: string; configured: boolean }[]
    }
    expect(catalog.connections.map((item) => item.id)).toContain('grafana')

    const saved = await handler(
      new Request('http://localhost/api/workspace/settings/connections', {
        method: 'PUT',
        headers: {
          cookie: 'admin',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          kind: 'grafana',
          fields: { url: 'https://mcp.example.com/mcp' },
          apiKey: 'grafana-key',
        }),
      }),
      new URL('http://localhost/api/workspace/settings/connections'),
    )
    expect(saved?.status).toBe(200)

    const linked = await handler(
      new Request(
        'http://localhost/api/workspace/settings/connections/grafana/links',
        {
          method: 'PUT',
          headers: {
            cookie: 'admin',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ agentDefinitionIds: ['antboy'] }),
        },
      ),
      new URL(
        'http://localhost/api/workspace/settings/connections/grafana/links',
      ),
    )
    expect(linked?.status).toBe(200)
    expect(await linked!.json()).toEqual({
      kind: 'grafana',
      linkedAgentIds: ['antboy'],
    })

    const cleared = await handler(
      new Request(
        'http://localhost/api/workspace/settings/connections/grafana/clear',
        {
          method: 'POST',
          headers: { cookie: 'admin' },
        },
      ),
      new URL(
        'http://localhost/api/workspace/settings/connections/grafana/clear',
      ),
    )
    expect(cleared?.status).toBe(200)
    const clearedBody = (await cleared!.json()) as {
      connection: { configured: boolean; linkedAgentIds: string[] }
    }
    expect(clearedBody.connection.configured).toBe(false)
    expect(clearedBody.connection.linkedAgentIds).toEqual([])
  } finally {
    if (previous === undefined) delete process.env.BETTER_AUTH_SECRET
    else process.env.BETTER_AUTH_SECRET = previous
  }
})
