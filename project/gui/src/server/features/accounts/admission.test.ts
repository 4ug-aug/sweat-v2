import { migratedDatabase } from '#/server/test-db'
import { expect, test } from 'bun:test'
import { createAdmissionStore } from './admission'
import { createAdmissionHttpHandler, invitationUrl } from './admission-http'
import { createCoordinator } from '#/server/coordinator'
import { createRoomMessageHub } from '#/server/features/rooms/room-hub'
import { createSqliteRoomStore } from '#/server/features/rooms/room-store'
import type { RunControl } from '#/server/features/runs/run-control'

const makeDatabase = () => {
  const sqlite = migratedDatabase()
  return sqlite
}

test('desktop invitations identify the server and token', () => {
  const value = invitationUrl(
    'invite-token',
    'tauri://localhost',
    'https://sweat.example.com/',
  )
  const url = new URL(value)
  expect(url.protocol).toBe('sweat:')
  expect(url.hostname).toBe('invite')
  expect(url.pathname).toBe('/invite-token')
  expect(url.searchParams.get('server')).toBe('https://sweat.example.com')
})

test('administrator can reset a member password and disconnect sessions', async () => {
  const sqlite = makeDatabase()
  let reset: { userId: string; newPassword: string } | undefined
  let disconnected: string | undefined
  const handler = createAdmissionHttpHandler({
    store: createAdmissionStore(sqlite),
    createAccount: async () => Response.json({}),
    listUsers: async () => [],
    banUser: async () => ({}),
    unbanUser: async () => ({}),
    resetUserPassword: async (_request, userId, newPassword) => {
      reset = { userId, newPassword }
      return Response.json({ success: true })
    },
    authenticate: async (request) =>
      request.headers.get('cookie') === 'admin'
        ? { id: 'admin', name: 'admin', role: 'admin' }
        : { id: 'member', name: 'member', role: 'user' },
    guiOrigin: 'http://localhost:3000',
    onSuspend: (userId) => {
      disconnected = userId
    },
  })
  const request = (cookie: string) =>
    new Request(
      'http://localhost/api/workspace/settings/members/member/password',
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ newPassword: 'new-password' }),
      },
    )
  const url = new URL(
    'http://localhost/api/workspace/settings/members/member/password',
  )

  expect((await handler(request('member'), url))?.status).toBe(403)
  expect((await handler(request('admin'), url))?.status).toBe(200)
  expect(reset).toEqual({ userId: 'member', newPassword: 'new-password' })
  expect(disconnected).toBe('member')
  sqlite.close()
})

test('setup token is created once and only its hash persists', () => {
  const sqlite = makeDatabase()
  const first = createAdmissionStore(sqlite).ensureSetupToken()
  expect(first).toBeTruthy()
  expect(first).not.toBe(createAdmissionStore(sqlite).ensureSetupToken())
  expect(
    sqlite.query('SELECT token_hash FROM admission_setup_token').get(),
  ).toEqual({ token_hash: expect.any(String) })
  const row = sqlite
    .query('SELECT token_hash FROM admission_setup_token')
    .get() as {
    token_hash: string
  }
  expect(row.token_hash).not.toBe(first)
  sqlite.close()
})

test('rotating a setup token invalidates the old token', () => {
  const sqlite = makeDatabase()
  const store = createAdmissionStore(sqlite)
  const original = store.ensureSetupToken()!
  const rotated = store.rotateSetupToken()
  expect(rotated).not.toBe(original)
  expect(store.claimSetupToken(original)).toBe(false)
  expect(store.claimSetupToken(rotated)).toBe(true)
  sqlite.close()
})

test('invitation lifetime, revocation, expiry, and redemption are durable states', () => {
  const sqlite = makeDatabase()
  const store = createAdmissionStore(sqlite)
  const created = store.createInvitation('admin', 3)
  expect(created.invitation.state).toBe('pending')
  expect(store.revokeInvitation(created.invitation.id)).toBe(true)
  expect(store.listInvitations()[0]?.state).toBe('revoked')
  const expired = store.createInvitation('admin', 1)
  sqlite
    .query('UPDATE workspace_invitation SET expires_at = 0 WHERE id = ?')
    .run(expired.invitation.id)
  expect(
    store.listInvitations().find(({ id }) => id === expired.invitation.id)
      ?.state,
  ).toBe('expired')
  expect(store.revokeInvitation(expired.invitation.id)).toBe(false)
  const redeemed = store.createInvitation('admin', 7)
  expect(store.claimInvitation(redeemed.token)?.id).toBe(redeemed.invitation.id)
  expect(store.revokeInvitation(redeemed.invitation.id)).toBe(false)
  store.redeemInvitation(redeemed.invitation.id)
  expect(
    store.listInvitations().find(({ id }) => id === redeemed.invitation.id)
      ?.state,
  ).toBe('redeemed')
  sqlite.close()
})

test('concurrent invitation redemption claims at most once', async () => {
  const sqlite = makeDatabase()
  const store = createAdmissionStore(sqlite)
  const created = store.createInvitation('admin', 3)
  const claims = await Promise.all([
    Promise.resolve(store.claimInvitation(created.token)),
    Promise.resolve(store.claimInvitation(created.token)),
  ])
  expect(claims.filter(Boolean)).toHaveLength(1)
  sqlite.close()
})

test('admission endpoints close open signup and enforce the administrator boundary', async () => {
  const sqlite = migratedDatabase()
  sqlite.exec(`
    INSERT INTO room (id, name, visibility) VALUES ('general', 'General', 'public');
  `)
  const admission = createAdmissionStore(sqlite)
  const token = admission.ensureSetupToken()!
  const createdRoles: string[] = []
  let suspended = 0
  let llm: {
    configured: boolean
    provider?: 'openai' | 'custom'
    baseUrl?: string
    model?: string
  } = {
    configured: false,
  }
  let preview: {
    configured: boolean
    previewCommand?: string
    guestPort: number
    graceDurationMs: number
  } = {
    configured: false,
    guestPort: 3000,
    graceDurationMs: 300000,
  }
  const createAccount = async (
    body: Record<string, unknown>,
    role: 'admin' | 'user',
  ) => {
    const id = crypto.randomUUID()
    sqlite
      .query('INSERT INTO user (id, name, email) VALUES (?, ?, ?)')
      .run(id, body.name as string, body.email as string)
    createdRoles.push(role)
    return Response.json(
      { user: { id } },
      { headers: { 'set-cookie': `sweat=${id}` } },
    )
  }
  const control = {
    listRuns: () => [],
    subscribe: () => () => undefined,
    subscribeSteps: () => () => undefined,
    start: () => '',
    cancel: async () => undefined,
    stop: async () => undefined,
  } as unknown as RunControl
  const store = createSqliteRoomStore(sqlite)
  const coordinator = createCoordinator({
    control,
    store,
    messages: createRoomMessageHub(store),
    authenticator: {
      authenticate: async (request) =>
        request.headers.get('cookie') === 'admin'
          ? { id: 'admin', name: 'admin', role: 'admin' }
          : request.headers.get('cookie') === 'member'
            ? { id: 'member', name: 'member', role: 'user' }
            : undefined,
    },
    authHandler: async () => Response.json({ ok: true }),
    origin: 'http://localhost:3000',
    port: 0,
    admission: {
      store: admission,
      llm: {
        public: () => llm,
        save: ({ provider, baseUrl, model }) =>
          (llm = {
            configured: true,
            provider: provider as 'openai' | 'custom',
            baseUrl,
            model,
          }),
      },
      preview: {
        public: () => preview,
        save: ({ previewCommand, guestPort, graceDurationMs }) =>
          (preview = {
            configured: Boolean(
              typeof previewCommand === 'string' && previewCommand.trim(),
            ),
            ...(typeof previewCommand === 'string' && previewCommand.trim()
              ? { previewCommand: previewCommand.trim() }
              : {}),
            guestPort: Number(guestPort),
            graceDurationMs: Number(graceDurationMs),
          }),
      },
      listUsers: async () => [
        { id: 'admin', name: 'Admin', email: 'admin@example.com' },
      ],
      banUser: async () => {
        suspended++
        return { ok: true }
      },
      unbanUser: async () => ({ ok: true }),
      resetUserPassword: async () => Response.json({ success: true }),
      createAccount,
    },
  })
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`http://localhost:${coordinator.port}${path}`, {
      ...init,
      headers: {
        origin: 'http://localhost:3000',
        ...(init.headers ?? {}),
      },
    })
  try {
    expect((await request('/api/admission/status')).json()).toBeDefined()
    expect(
      (await request('/api/auth/sign-up/email', { method: 'POST' })).status,
    ).toBe(403)
    expect(
      (await request('/api/auth/sign-up/email/', { method: 'POST' })).status,
    ).toBe(403)
    expect(
      (
        await request('/api/auth/admin/create-user', {
          method: 'POST',
          headers: { cookie: 'admin' },
        })
      ).status,
    ).toBe(403)
    const preflight = await request('/api/admission/setup', {
      method: 'OPTIONS',
    })
    expect(preflight.headers.get('access-control-allow-headers')).toContain(
      'x-sweat-setup-token',
    )
    expect(
      (
        await request('/api/admission/setup', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-sweat-setup-token': token,
          },
          body: JSON.stringify({
            email: 'agent@example.com',
            username: 'software-engineer',
            password: 'password-123',
          }),
        })
      ).status,
    ).toBe(400)
    const setup = await request('/api/admission/setup', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sweat-setup-token': token,
      },
      body: JSON.stringify({
        email: 'admin@example.com',
        username: 'admin',
        password: 'password-123',
      }),
    })
    expect(setup.status).toBe(200)
    expect(createdRoles).toEqual(['admin'])
    expect(
      (
        await request('/api/workspace/settings/llm', {
          headers: { cookie: 'member' },
        })
      ).status,
    ).toBe(403)
    const savedLlm = await request('/api/workspace/settings/llm', {
      method: 'POST',
      headers: { cookie: 'admin', 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        baseUrl: 'https://models.example/v1',
        model: 'test-model',
        apiKey: 'secret',
      }),
    })
    expect(savedLlm.status).toBe(200)
    expect(await savedLlm.json()).toEqual({
      configured: true,
      provider: 'openai',
      baseUrl: 'https://models.example/v1',
      model: 'test-model',
    })
    expect(
      (
        await request('/api/workspace/settings/preview', {
          headers: { cookie: 'member' },
        })
      ).status,
    ).toBe(403)
    const savedPreview = await request('/api/workspace/settings/preview', {
      method: 'POST',
      headers: { cookie: 'admin', 'content-type': 'application/json' },
      body: JSON.stringify({
        previewCommand: 'make dev',
        guestPort: 3000,
        graceDurationMs: 60000,
      }),
    })
    expect(savedPreview.status).toBe(200)
    expect(await savedPreview.json()).toEqual({
      configured: true,
      previewCommand: 'make dev',
      guestPort: 3000,
      graceDurationMs: 60000,
    })
    const invitation = await request('/api/workspace/invitations', {
      method: 'POST',
      headers: { cookie: 'admin', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(invitation.status).toBe(201)
    const created = (await invitation.json()) as {
      token: string
      url: string
      invitation: { expiresAt: number }
    }
    expect(created.url).toStartWith('http://localhost:3000/invite/')
    expect(created.invitation.expiresAt - Date.now()).toBeGreaterThan(
      2 * 24 * 60 * 60 * 1000,
    )
    expect(
      (
        await request('/api/workspace/invitations', {
          headers: { cookie: 'member' },
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await request('/api/workspace/invitations', {
          headers: { cookie: 'admin' },
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await request('/api/workspace/settings/members/admin/suspend', {
          method: 'POST',
          headers: { cookie: 'admin' },
        })
      ).status,
    ).toBe(400)
    expect(suspended).toBe(0)
    const memberSocket = new WebSocket(
      `ws://localhost:${coordinator.port}/api/rooms/general/stream`,
      {
        headers: {
          origin: 'http://localhost:3000',
          cookie: 'member',
        },
      } as never,
    )
    await new Promise<void>((resolve, reject) => {
      memberSocket.onopen = () => resolve()
      memberSocket.onerror = () => reject(new Error('socket failed'))
    })
    const closed = new Promise<boolean>((resolve) => {
      memberSocket.onclose = () => resolve(true)
    })
    expect(
      (
        await request('/api/workspace/settings/members/member/suspend', {
          method: 'POST',
          headers: { cookie: 'admin' },
        })
      ).status,
    ).toBe(200)
    expect(suspended).toBe(1)
    expect(await Promise.race([closed, Bun.sleep(100).then(() => false)])).toBe(
      true,
    )
  } finally {
    coordinator.stop()
    sqlite.close()
  }
})
