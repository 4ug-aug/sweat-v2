import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import { authClient } from '#/lib/auth-client'
import { apiFetch } from '#/lib/api-transport'
import { ColonyMark } from '#/components/colony-mark'
import { Button } from '#/components/ui/button'
import { BrailleLoader } from '#/components/ui/braille-loader'
import { Input } from '#/components/ui/input'
import {
  clearServerConfig,
  currentServerBase,
  isTauriRuntime,
} from '#/lib/server-config'

type Mode = 'sign-in' | 'setup' | 'invite'

export function SignIn({ onChangeServer }: { onChangeServer: () => void }) {
  const pathToken = window.location.pathname.match(/^\/invite\/([^/]+)$/)?.[1]
  const [mode, setMode] = useState<Mode>(pathToken ? 'invite' : 'sign-in')
  const [identifier, setIdentifier] = useState('')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [checking, setChecking] = useState(!pathToken)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    void apiFetch('/api/admission/status')
      .then((response) => {
        if (!response.ok) throw new Error()
        return response.json() as Promise<{ setupRequired?: boolean }>
      })
      .then((status) => {
        if (status.setupRequired && !pathToken) setMode('setup')
      })
      .catch(() => setError('Unable to reach the Colony server.'))
      .finally(() => setChecking(false))
  }, [pathToken])

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(undefined)
    setPending(true)
    try {
      if (mode === 'sign-in') {
        const result = identifier.includes('@')
          ? await authClient.signIn.email({ email: identifier, password })
          : await authClient.signIn.username({ username: identifier, password })
        if (result.error) setError(result.error.message)
        return
      }
      const token = mode === 'setup' ? setupToken : pathToken
      const response = await apiFetch(
        mode === 'setup'
          ? '/api/admission/setup'
          : `/api/workspace/invitations/${token}/redeem`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(mode === 'setup' ? { 'x-sweat-setup-token': token ?? '' } : {}),
          },
          body: JSON.stringify({ email, username, displayName, password }),
        },
      )
      if (!response.ok) {
        const body = (await response.json()) as {
          error?: string
          message?: string
        }
        throw new Error(
          body.error ?? body.message ?? 'Unable to create account',
        )
      }
      const result = await authClient.signIn.email({ email, password })
      if (result.error) setError(result.error.message)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to reach Colony',
      )
    } finally {
      setPending(false)
    }
  }

  const admission = mode !== 'sign-in'
  if (checking)
    return (
      <p className="entry-form text-sm text-muted-foreground">
        <BrailleLoader text="Connecting to Colony" />
      </p>
    )
  return (
    <form
      key={mode}
      className="entry-form flex flex-col gap-4"
      onSubmit={(event) => void submit(event)}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ColonyMark className="size-8" />
        Colony
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {mode === 'setup'
            ? 'Set up Colony'
            : mode === 'invite'
              ? 'Join workspace'
              : 'Welcome back'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {mode === 'setup'
            ? 'Create the first administrator for this workspace.'
            : mode === 'invite'
              ? 'Create your account to join this workspace.'
              : 'Sign in to your Colony workspace.'}
        </p>
      </div>
      {mode === 'setup' && (
        <Input
          placeholder="Setup token"
          aria-label="Setup token"
          autoComplete="off"
          value={setupToken}
          onChange={(event) => setSetupToken(event.target.value)}
          disabled={pending}
          required
        />
      )}
      {admission && (
        <>
          <Input
            type="email"
            placeholder="Email"
            aria-label="Email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={pending}
            required
          />
          <Input
            placeholder="Username"
            aria-label="Username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={pending}
            minLength={3}
            maxLength={30}
            pattern="[A-Za-z0-9_]+"
            required
          />
          <Input
            placeholder="Display name (optional)"
            aria-label="Display name"
            autoComplete="name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={pending}
          />
        </>
      )}
      {!admission && (
        <Input
          placeholder="Email or username"
          aria-label="Email or username"
          autoComplete="username"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          disabled={pending}
          required
        />
      )}
      <Input
        type="password"
        placeholder="Password"
        aria-label="Password"
        autoComplete={admission ? 'new-password' : 'current-password'}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={pending}
        minLength={8}
        required
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button className="w-full" type="submit" disabled={pending}>
        {pending ? (
          <BrailleLoader text={admission ? 'Creating account' : 'Signing in'} />
        ) : admission ? (
          'Create account'
        ) : (
          'Sign in'
        )}
      </Button>
      {mode === 'invite' && (
        <Button
          variant="link"
          type="button"
          onClick={() => setMode('sign-in')}
          disabled={pending}
        >
          Back to sign in
        </Button>
      )}
      {mode === 'sign-in' && isTauriRuntime() && currentServerBase() && (
        <div className="flex min-w-0 items-center gap-3 rounded-lg bg-muted px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {currentServerBase()}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => void clearServerConfig().finally(onChangeServer)}
          >
            Change
          </Button>
        </div>
      )}
    </form>
  )
}
