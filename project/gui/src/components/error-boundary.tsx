import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'

export type ErrorBoundaryProps = {
  children: ReactNode
  /** Remount/reset when this changes. */
  resetKeys?: ReadonlyArray<string | number | boolean | null | undefined>
  title?: string
  description?: string
  className?: string
  onError?: (error: Error, info: ErrorInfo) => void
  onReset?: () => void
  /** Full-app fallback: reload instead of in-place retry. */
  fatal?: boolean
}

export type ErrorBoundaryState = {
  error: Error | null
}

function resetKeysChanged(
  prev?: ErrorBoundaryProps['resetKeys'],
  next?: ErrorBoundaryProps['resetKeys'],
) {
  if (prev === next) return false
  if (!prev || !next) return prev !== next
  if (prev.length !== next.length) return true
  return prev.some((value, index) => !Object.is(value, next[index]))
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render failed', error, info)
    this.props.onError?.(error, info)
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (
      this.state.error &&
      resetKeysChanged(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.reset()
    }
  }

  reset = () => {
    this.props.onReset?.()
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const title = this.props.title ?? 'Colony hit a problem'
    const description =
      this.props.description ??
      (this.props.fatal
        ? 'Reload the app to try again.'
        : 'You can retry this view without leaving Colony.')

    return (
      <main
        className={cn(
          'grid place-items-center p-6 text-center',
          this.props.fatal ? 'min-h-svh' : 'h-full min-h-48',
          this.props.className,
        )}
        role="alert"
      >
        <div className="flex max-w-md flex-col items-center gap-3">
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
          <p
            className="max-h-32 w-full overflow-auto rounded-md border bg-muted/40 px-3 py-2 text-left font-mono text-xs text-destructive"
            title={error.message}
          >
            {error.message || String(error)}
          </p>
          {this.props.fatal ? (
            <Button type="button" onClick={() => window.location.reload()}>
              Reload app
            </Button>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button type="button" onClick={this.reset}>
                Try again
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Reload app
              </Button>
            </div>
          )}
        </div>
      </main>
    )
  }
}
