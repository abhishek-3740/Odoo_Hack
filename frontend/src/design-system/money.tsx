import type { ReactNode } from 'react'

import type { RecurringTotal } from '@/api'
import { cn } from '@/lib/cn'
import { formatMoney, type Decimal } from '@/lib/money'

/**
 * Amount display.
 *
 * The one thing these components refuse to do is add a one-time charge to a
 * recurring one. ₹39,300 today and ₹3,000 a month are not ₹42,300 of anything,
 * so a hybrid deal is always shown as several labelled figures.
 */

export function Money({
  amount,
  currency,
  className,
  signed,
  round,
  fallback,
}: {
  amount: Decimal
  currency?: string | null
  className?: string
  signed?: boolean
  round?: boolean
  fallback?: string
}) {
  const absent = amount === null || amount === undefined || amount === ''
  return (
    <span
      className={cn('tabular', absent && 'text-text-muted', className)}
      title={absent ? 'This figure was not supplied by the server.' : undefined}
    >
      {formatMoney(amount, currency, { signed, round, fallback })}
    </span>
  )
}

/** A one-time figure and each recurring cadence, kept visibly separate. */
export function ChargeBreakdown({
  currency,
  oneTime,
  recurring,
  dueNow,
  className,
  dense,
}: {
  currency: string
  oneTime: Decimal
  recurring: Array<Pick<RecurringTotal, 'cadence' | 'net'>> | Array<{ cadence: string; amount: Decimal }>
  dueNow?: Decimal
  className?: string
  dense?: boolean
}) {
  const rows = recurring.map((entry) =>
    'net' in entry
      ? { cadence: entry.cadence, amount: entry.net }
      : { cadence: entry.cadence, amount: entry.amount },
  )

  return (
    <dl className={cn('space-y-1.5', dense ? 'text-[13px]' : 'text-sm', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-text-secondary">One-time charges</dt>
        <dd className="font-semibold">
          <Money amount={oneTime} currency={currency} />
        </dd>
      </div>
      {rows.map((row) => (
        <div key={row.cadence} className="flex items-baseline justify-between gap-4">
          <dt className="text-text-secondary">Recurring · {row.cadence.toLowerCase()}</dt>
          <dd className="font-semibold">
            <Money amount={row.amount} currency={currency} />
            <span className="ml-1 text-2xs font-normal text-text-muted">
              per {row.cadence.toLowerCase().replace(/ly$/, '')}
            </span>
          </dd>
        </div>
      ))}
      {dueNow !== undefined ? (
        <div className="flex items-baseline justify-between gap-4 border-t border-line pt-1.5">
          <dt className="font-medium text-text">Payable on confirmation</dt>
          <dd className="text-base font-semibold text-forest-600">
            <Money amount={dueNow} currency={currency} />
          </dd>
        </div>
      ) : null}
    </dl>
  )
}

/**
 * A figure whose meaning needs a sentence.
 *
 * Used for `comparisonNet` and MRR — numbers that are correct but easy to
 * misread as "what the customer pays".
 */
export function QualifiedFigure({
  label,
  value,
  explanation,
  className,
}: {
  label: string
  value: ReactNode
  explanation: string
  className?: string
}) {
  return (
    <div className={cn('rounded-[--radius-control] bg-canvas-sunken px-3 py-2.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-text">{label}</span>
        <span className="tabular text-[13px] font-semibold text-text">{value}</span>
      </div>
      <p className="mt-1 text-2xs leading-relaxed text-text-secondary">{explanation}</p>
    </div>
  )
}
