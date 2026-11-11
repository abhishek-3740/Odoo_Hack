import { Check, CircleDashed, Clock, Package } from 'lucide-react'
import { Link } from 'react-router-dom'

import { APPROVAL_STATUS_LABEL, type GateSummary } from '@/api'
import { cn } from '@/lib/cn'

/**
 * The three conditions for an order, and which of them are met.
 *
 * They are genuinely independent and can land in any order: a customer may
 * accept before finance approves, or the other way round. Showing them as a
 * numbered sequence would be a lie about how the system works, so this is a
 * checklist — three facts, each true or not yet true, with the sentence the
 * server gave for what is still missing.
 */
export function GateChecklist({
  gates,
  className,
  compact,
}: {
  gates: GateSummary
  className?: string
  compact?: boolean
}) {
  const items = [
    {
      id: 'seller',
      label: 'Seller agreement',
      met: gates.sellerAdopted,
      pending: 'The salesperson has not adopted these exact terms yet.',
      done: 'The salesperson stands behind these terms.',
    },
    {
      id: 'approval',
      label: 'Internal approval',
      met: gates.approvalCleared,
      pending: APPROVAL_STATUS_LABEL[gates.approvalStatus] ?? gates.approvalStatus,
      done:
        gates.approvalStatus === 'NOT_REQUIRED'
          ? 'Within policy — no approval was required.'
          : 'Approved.',
    },
    {
      id: 'customer',
      label: 'Customer acceptance',
      met: gates.customerAccepted,
      pending: 'The customer has not accepted this version yet.',
      done: 'The customer accepted this exact version.',
    },
  ]

  return (
    <div className={cn('space-y-2', className)}>
      <ul className="space-y-1.5" aria-label="Order gates">
        {items.map((item) => (
          <li
            key={item.id}
            className={cn(
              'flex items-start gap-2.5 rounded-[--radius-control] border px-3 py-2',
              item.met ? 'border-ok-border bg-ok-surface' : 'border-line bg-panel-muted',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
                item.met ? 'bg-ok-text text-white' : 'bg-line-strong text-panel',
              )}
            >
              {item.met ? <Check className="size-2.5" strokeWidth={3.5} /> : null}
            </span>
            <div className="min-w-0">
              <p
                className={cn(
                  'text-[13px] font-semibold leading-tight',
                  item.met ? 'text-ok-text' : 'text-text',
                )}
              >
                {item.label}
                <span className="sr-only">: {item.met ? 'met' : 'not met'}</span>
              </p>
              {!compact ? (
                <p
                  className={cn(
                    'mt-0.5 text-[13px] leading-snug',
                    item.met ? 'text-ok-text/85' : 'text-text-secondary',
                  )}
                >
                  {item.met ? item.done : item.pending}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {gates.orderExists && gates.orderId ? (
        <Link
          to={`/admin/orders/${gates.orderId}`}
          className="flex items-center gap-2 rounded-[--radius-control] border border-forest-200 bg-forest-50 px-3 py-2 text-[13px] font-semibold text-forest-700 transition-colors hover:bg-forest-100"
        >
          <Package className="size-4" aria-hidden />
          Order confirmed — open it
        </Link>
      ) : gates.expired ? (
        <p className="flex items-start gap-2 rounded-[--radius-control] border border-stop-border bg-stop-surface px-3 py-2 text-[13px] text-stop-text">
          <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          This quotation has passed its validity date.
        </p>
      ) : gates.blockingReasons.length > 0 ? (
        <p className="flex items-start gap-2 rounded-[--radius-control] bg-canvas-sunken px-3 py-2 text-[13px] leading-relaxed text-text-secondary">
          <CircleDashed className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{gates.blockingReasons.join(' ')}</span>
        </p>
      ) : null}
    </div>
  )
}

/**
 * A one-line summary of the same three gates, for list rows.
 *
 * Reads "2 of 3" plus the missing one, so a pipeline row says what is
 * outstanding without opening the deal.
 */
export function GateSummaryLine({ gates }: { gates: GateSummary }) {
  const met = [gates.sellerAdopted, gates.approvalCleared, gates.customerAccepted].filter(
    Boolean,
  ).length
  if (gates.orderExists) return <span className="text-ok-text">Order confirmed</span>
  const missing = [
    !gates.sellerAdopted && 'seller',
    !gates.approvalCleared && 'approval',
    !gates.customerAccepted && 'customer',
  ].filter(Boolean) as string[]
  return (
    <span className="text-text-secondary">
      <span className="tabular font-medium text-text">{met}/3</span> gates · waiting on{' '}
      {missing.join(', ')}
    </span>
  )
}
