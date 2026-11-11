import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'
import { formatMoney, formatMoneyCompact, type Decimal } from '@/lib/money'

import { Panel } from './primitives'

/* -------------------------------------------------------------- page header */

export interface Crumb {
  label: string
  to?: string
}

export function PageHeader({
  title,
  eyebrow,
  description,
  crumbs,
  actions,
  meta,
  className,
}: {
  title: ReactNode
  eyebrow?: ReactNode
  description?: ReactNode
  crumbs?: Crumb[]
  actions?: ReactNode
  /** Small facts under the title — reference, last refresh, owner. */
  meta?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('mb-5', className)}>
      {crumbs && crumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-[13px] text-text-secondary">
            {crumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {index > 0 ? (
                  <ChevronRight className="size-3.5 text-text-muted" aria-hidden />
                ) : null}
                {crumb.to ? (
                  <Link to={crumb.to} className="rounded hover:text-forest-600 hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="font-medium text-text">
                    {crumb.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.09em] text-brass-600">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-xl font-semibold leading-tight text-text sm:text-2xl">{title}</h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-text-secondary">
              {description}
            </p>
          ) : null}
          {meta ? <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  )
}

/* --------------------------------------------------------------- filter bar */

export function FilterBar({
  children,
  className,
  actions,
}: {
  children: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'mb-4 flex flex-wrap items-end gap-3 rounded-[--radius-panel] border border-line',
        'bg-panel px-4 py-3 shadow-panel',
        className,
      )}
    >
      {children}
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/* ---------------------------------------------------------------- action bar */

/**
 * A sticky bar of the actions available on the current record.
 *
 * Actions live in one place rather than being scattered down the page, and each
 * disabled one carries its own reason.
 */
export function ActionBar({
  children,
  status,
  className,
}: {
  children: ReactNode
  status?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-20 -mx-4 mt-6 flex flex-wrap items-center gap-3 border-t border-line',
        // The trailing padding keeps the last action clear of the floating
        // assistant launcher, which sits in the same corner.
        'bg-panel/95 py-3 pl-4 pr-20 backdrop-blur-sm sm:-mx-6 sm:pl-6 sm:pr-24',
        className,
      )}
    >
      {status ? <div className="min-w-0 flex-1 text-[13px] text-text-secondary">{status}</div> : null}
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

/* ------------------------------------------------------------------- stats */

/**
 * A headline figure.
 *
 * `scope` is not decoration: a number without its scope ("this page", "your
 * team", "all time") is the fastest way for a dashboard to mislead, so the
 * component requires somewhere to say it.
 */
export function Stat({
  label,
  value,
  scope,
  delta,
  tone = 'default',
  className,
}: {
  label: string
  value: ReactNode
  scope?: string
  delta?: ReactNode
  tone?: 'default' | 'forest' | 'brass'
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-[--radius-panel] border border-line bg-panel px-4 py-3.5 shadow-panel',
        className,
      )}
    >
      <p className="text-2xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p
        className={cn(
          'tabular mt-1.5 text-xl font-semibold leading-none',
          tone === 'forest' ? 'text-forest-600' : tone === 'brass' ? 'text-brass-600' : 'text-text',
        )}
      >
        {value}
      </p>
      {scope ? <p className="mt-1.5 text-2xs text-text-muted">{scope}</p> : null}
      {delta ? <div className="mt-1.5 text-2xs">{delta}</div> : null}
    </div>
  )
}

export function MoneyStat({
  label,
  amount,
  currency,
  scope,
  compact,
  tone,
}: {
  label: string
  amount: Decimal
  currency: string
  scope?: string
  compact?: boolean
  tone?: 'default' | 'forest' | 'brass'
}) {
  return (
    <Stat
      label={label}
      scope={scope}
      tone={tone}
      value={compact ? formatMoneyCompact(amount, currency) : formatMoney(amount, currency)}
    />
  )
}

/* ------------------------------------------------------------ section shell */

export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <section
      id={id}
      className={cn('min-w-0 space-y-3', className)}
      aria-labelledby={id ? `${id}-heading` : undefined}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={id ? `${id}-heading` : undefined}
            className="text-[15px] font-semibold leading-tight text-text"
          >
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-text-secondary">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

/* --------------------------------------------------------- permission gate */

/**
 * Hides a control the signed-in role cannot use, and says so where the absence
 * would be confusing.
 *
 * This is a courtesy, not a security boundary — every endpoint enforces its own
 * rules. What it must never do is hide *data* a screen already fetched: a
 * customer page does not fetch internal figures and then hide them with CSS; it
 * calls a different endpoint that has no such field.
 */
export function PermissionBoundary({
  allowed,
  reason,
  children,
  fallback,
}: {
  allowed: boolean
  reason?: string
  children: ReactNode
  fallback?: ReactNode
}) {
  if (allowed) return <>{children}</>
  if (fallback) return <>{fallback}</>
  if (!reason) return null
  return (
    <Panel tone="muted" className="text-[13px] text-text-secondary">
      {reason}
    </Panel>
  )
}
