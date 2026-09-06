import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Box, CircleCheckBig, Clock, Zap, Waypoints } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'
import { AccountFace, AgentAnt } from '#/components/avatar'
import { StaticDither } from '#/components/static-dither'
import { Button } from '#/components/ui/button'
import { AgentThinking } from '#/components/ui/agent-thinking'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '#/components/ui/chart'
import type { ChartConfig } from '#/components/ui/chart'
import { Input } from '#/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import type { Author } from '#/features/rooms/types'
import { useMediaQuery } from '#/hooks/use-media-query'
import { authClient } from '#/lib/auth-client'
import { parseAccountColor } from '#/lib/account-color'
import {
  clearServerConfig,
  currentServerBase,
  isTauriRuntime,
} from '#/lib/server-config'
import {
  countUpValue,
  formatRuntime,
  useAccountAnalytics,
} from './account-analytics'

const chartConfig = {
  delegations: { label: 'Delegations', color: 'var(--primary)' },
} satisfies ChartConfig

function AnimatedNumber({
  value,
  pending,
  reducedMotion,
  format = (number) => number.toLocaleString(),
}: {
  value: number
  pending: boolean
  reducedMotion: boolean
  format?: (value: number) => string
}) {
  const [display, setDisplay] = useState(0)
  const current = useRef(0)

  useEffect(() => {
    if (pending) return
    const from = current.current
    if (reducedMotion || from === value) {
      current.current = value
      setDisplay(value)
      return
    }
    const startedAt = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const next = countUpValue(from, value, (now - startedAt) / 700)
      current.current = next
      setDisplay(next)
      if (next !== value) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [pending, reducedMotion, value])

  return pending ? '—' : format(display)
}

export function AccountSettingsPage({
  user,
  onChangeServer,
}: {
  user: Author
  onChangeServer: () => void
}) {
  const queryClient = useQueryClient()
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const {
    data: analytics,
    isPending: analyticsPending,
    isError: analyticsError,
  } = useAccountAnalytics(user.id)
  const [displayName, setDisplayName] = useState(user.displayName ?? '')
  const [color, setColor] = useState(user.color)
  const [hexInput, setHexInput] = useState(user.color ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [pending, setPending] = useState<
    'profile' | 'password' | 'sessions' | 'server'
  >()
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const [version, setVersion] = useState<string>()
  const preview = { ...user, displayName, color }
  const saveProfile = useMutation({
    mutationFn: async () => {
      const parsed = hexInput.trim() ? parseAccountColor(hexInput) : undefined
      if (hexInput.trim() && !parsed)
        throw new Error('Enter a hex color like #1d4ed8')
      const result = await authClient.updateUser({
        name: displayName.trim() || user.name,
        color: parsed ?? '',
      } as Parameters<typeof authClient.updateUser>[0])
      if (result.error) throw new Error(result.error.message)
      return parsed
    },
    onSuccess: async (parsed) => {
      setColor(parsed)
      setHexInput(parsed ?? '')
      await queryClient.invalidateQueries({ queryKey: ['workspace-members'] })
      setMessage('Profile saved.')
      setError(undefined)
    },
    onError: (reason) =>
      setError(
        reason instanceof Error && reason.message.startsWith('Enter a hex')
          ? reason.message
          : 'Could not save profile.',
      ),
  })

  useEffect(() => {
    if (isTauriRuntime()) void getVersion().then(setVersion)
  }, [])

  const changePassword = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending('password')
    setError(undefined)
    setMessage(undefined)
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      })
      if (result.error) return setError(result.error.message)
      setCurrentPassword('')
      setNewPassword('')
      setMessage('Password changed and other sessions signed out.')
    } catch {
      setError('Could not change password.')
    } finally {
      setPending(undefined)
    }
  }

  const revokeOtherSessions = async () => {
    setPending('sessions')
    setError(undefined)
    setMessage(undefined)
    try {
      const result = await authClient.revokeOtherSessions()
      if (result.error) return setError(result.error.message)
      setMessage('Other sessions signed out.')
    } catch {
      setError('Could not sign out other sessions.')
    } finally {
      setPending(undefined)
    }
  }

  const changeServer = async () => {
    setPending('server')
    try {
      await authClient.signOut()
    } finally {
      try {
        await clearServerConfig()
      } finally {
        onChangeServer()
      }
    }
  }

  const metrics = [
    {
      label: 'Issues created by agents',
      value: analytics?.agentCreatedIssues ?? 0,
      icon: Waypoints,
      description: 'Workspace-wide Issues whose creator is an agent.',
    },
    {
      label: 'Tasks done by agents',
      value: analytics?.agentCompletedIssues ?? 0,
      icon: CircleCheckBig,
      description: 'Workspace-wide Done Issues currently owned by an agent.',
    },
    {
      label: 'Invocations',
      value: analytics?.delegations ?? 0,
      icon: AgentAnt,
    },
    {
      label: 'Oneshots',
      value: analytics?.oneshots ?? 0,
      icon: Zap,
    },
    {
      label: 'Runtime coordinated',
      value: analytics?.runtimeMs ?? 0,
      icon: Clock,
      format: formatRuntime,
    },
  ]

  return (
    <div className="relative min-h-full overflow-hidden bg-muted/30">
      <StaticDither />

      <main className="relative mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6 lg:p-8">
        <Card className="bg-card/90 shadow-sm backdrop-blur-sm animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out fill-mode-backwards motion-reduce:animate-none">
          <CardContent className="flex items-center gap-4">
            <AccountFace
              name={preview.name}
              image={preview.image}
              color={preview.color}
              className="size-14 text-lg ring-4 ring-background"
            />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {user.name}
              </h1>
              <p className="truncate text-sm text-muted-foreground">
                {[preview.displayName, user.email].filter(Boolean).join(' · ')}
              </p>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="overview" className="gap-4">
          <TabsList className="w-full bg-card/90 shadow-sm backdrop-blur-sm animate-in fade-in-0 slide-in-from-bottom-1 duration-300 ease-out fill-mode-backwards [animation-delay:80ms] motion-reduce:animate-none sm:w-fit">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {metrics.map(
                ({ label, value, icon: Icon, format, description }, index) => (
                  <Card
                    key={label}
                    size="sm"
                    className="gap-0 bg-card/75 py-0 shadow-sm backdrop-blur-sm animate-in fade-in-0 slide-in-from-bottom-2 duration-500 ease-out fill-mode-backwards motion-reduce:animate-none"
                    style={{ animationDelay: `${140 + index * 60}ms` }}
                  >
                    <CardContent className="p-1.5 pb-0">
                      <div className="flex min-h-20 items-center rounded-md bg-background/80 px-3 shadow-sm ring-1 ring-foreground/10">
                        <span className="text-3xl font-semibold tracking-tight tabular-nums">
                          <AnimatedNumber
                            value={value}
                            pending={analyticsPending || analyticsError}
                            reducedMotion={reducedMotion}
                            format={format}
                          />
                        </span>
                      </div>
                    </CardContent>
                    <div className="flex min-h-10 items-center gap-2 px-3 py-2 text-muted-foreground">
                      <Icon className="size-3.5 shrink-0" />
                      {description ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                              className="text-left text-xs leading-tight font-medium underline decoration-dotted underline-offset-4"
                              />
                            }
                          >
                            {label}
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {description}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-xs leading-tight font-medium">
                          {label}
                        </span>
                      )}
                    </div>
                  </Card>
                ),
              )}
            </div>

            <Card className="bg-card/90 shadow-sm backdrop-blur-sm animate-in fade-in-0 slide-in-from-bottom-2 duration-500 ease-out fill-mode-backwards [animation-delay:380ms] motion-reduce:animate-none">
              <CardHeader>
                <CardTitle>Invocation rhythm</CardTitle>
                <CardDescription>
                  Room invocations over the last seven days
                </CardDescription>
              </CardHeader>
              <CardContent>
                {analyticsError ? (
                  <div
                    className="grid h-[220px] place-items-center text-sm text-muted-foreground"
                    role="alert"
                  >
                    Could not load analytics.
                  </div>
                ) : (
                  <ChartContainer
                    config={chartConfig}
                    className="h-[220px] w-full aspect-auto"
                  >
                    <AreaChart
                      accessibilityLayer
                      data={analytics?.rhythm ?? []}
                      margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
                    >
                      <defs>
                        <linearGradient
                          id="delegations-fill"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="var(--color-delegations)"
                            stopOpacity={0.32}
                          />
                          <stop
                            offset="95%"
                            stopColor="var(--color-delegations)"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="day"
                        axisLine={false}
                        tickLine={false}
                        tickMargin={10}
                        tickFormatter={(day: string) =>
                          new Intl.DateTimeFormat([], {
                            weekday: 'short',
                            timeZone: 'UTC',
                          }).format(new Date(`${day}T00:00:00Z`))
                        }
                      />
                      <ChartTooltip
                        cursor={false}
                        content={<ChartTooltipContent indicator="line" />}
                      />
                      <Area
                        dataKey="delegations"
                        type="monotone"
                        fill="url(#delegations-fill)"
                        stroke="var(--color-delegations)"
                        strokeWidth={2}
                        isAnimationActive={!reducedMotion}
                        animationDuration={700}
                        animationEasing="ease-out"
                      />
                    </AreaChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent
            value="account"
            className="space-y-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-300 ease-out motion-reduce:animate-none"
          >
            {(error || message) && (
              <Card
                size="sm"
                className={
                  error
                    ? 'bg-destructive/5 text-destructive'
                    : 'bg-card/90 text-muted-foreground backdrop-blur-sm'
                }
              >
                <CardContent role={error ? 'alert' : 'status'}>
                  {error ?? message}
                </CardContent>
              </Card>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <Card className="bg-card/90 shadow-sm backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Profile</CardTitle>
                  <CardDescription>
                    How people recognize you around the workspace
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    className="space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault()
                      setPending('profile')
                      setError(undefined)
                      setMessage(undefined)
                      void saveProfile
                        .mutateAsync()
                        .finally(() => setPending(undefined))
                    }}
                  >
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Display name</span>
                      <Input
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        maxLength={80}
                        placeholder={user.name}
                        aria-label="Display name"
                        disabled={pending !== undefined}
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Account color</span>
                      <Input
                        value={hexInput}
                        onChange={(event) => {
                          const value = event.target.value
                          setHexInput(value)
                          if (!value.trim()) return setColor(undefined)
                          const parsed = parseAccountColor(value)
                          if (parsed) setColor(parsed)
                        }}
                        placeholder="#1d4ed8"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        maxLength={7}
                        aria-label="Account color hex"
                        disabled={pending !== undefined}
                      />
                      <span className="text-xs text-muted-foreground">
                        Leave blank for an automatic color.
                      </span>
                    </label>
                    <Button
                      type="submit"
                      size="sm"
                      aria-busy={pending === 'profile'}
                      disabled={pending !== undefined}
                    >
                      {pending === 'profile' ? (
                        <AgentThinking label="Saving profile" />
                      ) : (
                        'Save profile'
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="bg-card/90 shadow-sm backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Security</CardTitle>
                  <CardDescription>
                    Changing your password signs out other sessions
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    className="space-y-3"
                    onSubmit={(event) => void changePassword(event)}
                  >
                    <Input
                      type="password"
                      autoComplete="current-password"
                      placeholder="Current password"
                      aria-label="Current password"
                      value={currentPassword}
                      onChange={(event) =>
                        setCurrentPassword(event.target.value)
                      }
                      disabled={pending !== undefined}
                      required
                    />
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder="New password"
                      aria-label="New password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      disabled={pending !== undefined}
                      minLength={8}
                      required
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        size="sm"
                        aria-busy={pending === 'password'}
                        disabled={pending !== undefined}
                      >
                        {pending === 'password' ? (
                          <AgentThinking label="Changing password" />
                        ) : (
                          'Change password'
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-busy={pending === 'sessions'}
                        disabled={pending !== undefined}
                        onClick={() => void revokeOtherSessions()}
                      >
                        {pending === 'sessions' ? (
                          <AgentThinking label="Signing out" />
                        ) : (
                          'Sign out others'
                        )}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              {isTauriRuntime() && (
                <Card className="bg-card/90 shadow-sm backdrop-blur-sm md:col-span-2">
                  <CardHeader>
                    <CardTitle>Connected server</CardTitle>
                    <CardDescription className="truncate">
                      {currentServerBase()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
                      {version ? `Colony ${version}` : 'Colony desktop'}
                    </span>
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={pending !== undefined}
                          />
                        }
                      >
                        Change server
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogMedia>
                            <Box />
                          </AlertDialogMedia>
                          <AlertDialogTitle>Change server?</AlertDialogTitle>
                          <AlertDialogDescription>
                            You will be signed out and disconnected from this
                            workspace. Colony will return to the server
                            connection screen.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            disabled={pending !== undefined}
                            onClick={() => void changeServer()}
                          >
                            {pending === 'server' ? (
                              <AgentThinking label="Disconnecting" />
                            ) : (
                              'Change server'
                            )}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
