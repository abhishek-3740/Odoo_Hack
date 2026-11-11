import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  Info,
  RefreshCw,
  WifiOff,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { ApiError, RECOVERY_GUIDANCE } from '@/api'
import { cn } from '@/lib/cn'

import { Badge, Button, Panel, Skeleton, type BadgeTone } from './primitives'

/* -------------------------------------------------------------- empty state */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-canvas-sunken text-text-muted">
        {icon ?? <CircleDashed className="size-5" aria-hidden />}
      </div>
      <p className="text-sm font-semibold text-text">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-text-secondary">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------- inline error */

/**
 * A failure shown where the user was working.
 *
 * Errors that matter stay on screen: a toast that disappears after four seconds
 * is not a way to report that a payment was refused. The server's message says
 * what happened; {@link RECOVERY_GUIDANCE} adds what to do about it; the request
 * id is shown so a support conversation can find the log line.
 */
export function InlineError({
  error,
  title,
  onRetry,
  className,
}: {
  error: unknown
  title?: string
  onRetry?: () => void
  className?: string
}) {
  if (!error) return null

  const api = error instanceof ApiError ? error : null
  const message =
    api?.message ?? (error instanceof Error ? error.message : 'Something went wrong.')
  const guidance = api ? RECOVERY_GUIDANCE[api.code] : undefined
  const offline = api?.code === 'NETWORK_ERROR'
  const denied = api?.status === 403
  const fields = api ? Object.entries(api.fieldErrors) : []

  return (
    <div
      role="alert"
      className={cn(
        'rounded-[--radius-panel] border px-4 py-3',
        denied
          ? 'border-neutral-border bg-neutral-surface'
          : 'border-stop-border bg-stop-surface',
        className,
      )}
    >
      <div className="flex gap-3">
        <span className={cn('mt-0.5 shrink-0', denied ? 'text-neutral-text' : 'text-stop-text')}>
          {offline ? (
            <WifiOff className="size-4" aria-hidden />
          ) : denied ? (
            <Ban className="size-4" aria-hidden />
          ) : (
            <AlertTriangle className="size-4" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-[13px] font-semibold',
              denied ? 'text-neutral-text' : 'text-stop-text',
            )}
          >
            {title ?? (denied ? 'Not available to your role' : 'That did not work')}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-text">{message}</p>
          {guidance ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-text-secondary">{guidance}</p>
          ) : null}

          {fields.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-[13px] text-text-secondary">
              {fields.map(([field, detail]) => (
                <li key={field}>
                  <span className="font-medium text-text">{field}</span>: {detail}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            {onRetry ? (
              <Button size="sm" variant="secondary" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
                Try again
              </Button>
            ) : null}
            {api?.requestId ? (
              <span className="tabular text-2xs text-text-muted">
                Request {api.requestId}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- page states */

/** The first load of a screen. Distinct from a background refresh. */
export function LoadingPanel({
  rows = 4,
  className,
  label,
}: {
  rows?: number
  className?: string
  /**
   * Shown in place of the first skeleton line for a wait long enough that a
   * silent placeholder reads as a broken screen. Say what is being worked out,
   * not "Loading".
   */
  label?: string
}) {
  return (
    <Panel className={cn('space-y-3', className)} aria-busy="true" aria-live="polite">
      {label ? (
        <p className="text-[13px] text-text-secondary">{label}</p>
      ) : (
        <Skeleton className="h-4 w-40" />
      )}
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-11 w-full" />
      ))}
      <span className="sr-only">{label ?? 'Loading'}</span>
    </Panel>
  )
}

/**
 * A refresh happening behind data that is already on screen.
 *
 * The previous figures stay visible and are marked as being re-read, rather
 * than being replaced by a spinner — blanking a table the user is reading is
 * worse than a moment of slightly stale data that says so.
 */
export function RefreshingHint({ visible, className }: { visible: boolean; className?: string }) {
  if (!visible) return null
  return (
    <span
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-1.5 text-2xs font-medium text-text-muted',
        className,
      )}
    >
      <RefreshCw className="size-3 animate-spin" aria-hidden />
      Refreshing
    </span>
  )
}

/* -------------------------------------------------------------- status chip */

const STATE_ICON = {
  ok: <CheckCircle2 className="size-3.5" aria-hidden />,
  wait: <Clock className="size-3.5" aria-hidden />,
  stop: <Ban className="size-3.5" aria-hidden />,
  info: <Info className="size-3.5" aria-hidden />,
  neutral: <CircleDashed className="size-3.5" aria-hidden />,
  brass: <Info className="size-3.5" aria-hidden />,
} satisfies Record<BadgeTone, ReactNode>

export interface StatusBadgeProps {
  /** The words the user reads. Never a raw SCREAMING_CASE token. */
  label: string
  tone?: BadgeTone
  withIcon?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export function StatusBadge({
  label,
  tone = 'neutral',
  withIcon = true,
  size = 'md',
  className,
}: StatusBadgeProps) {
  return (
    <Badge tone={tone} size={size} icon={withIcon ? STATE_ICON[tone] : undefined} className={className}>
      {label}
    </Badge>
  )
}
