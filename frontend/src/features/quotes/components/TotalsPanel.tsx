import { Boxes, TriangleAlert } from 'lucide-react'

import type { QuoteEvaluation } from '@/api'
import {
  ChargeBreakdown,
  DetailRow,
  Panel,
  PanelHeader,
  QualifiedFigure,
  RefreshingHint,
} from '@/design-system'
import { formatBusinessDate } from '@/lib/dates'
import { formatMoney, formatPercent, formatQuantity } from '@/lib/money'

/**
 * Server totals, stock preview, and the two figures that need a sentence.
 *
 * `comparisonNet` and MRR are correct numbers that read wrongly on their own —
 * neither is what the customer pays — so each is rendered with its explanation
 * attached rather than as a bare figure in a row.
 */
export function TotalsPanel({
  evaluation,
  evaluating,
  showInternalFigures,
}: {
  evaluation: QuoteEvaluation
  evaluating: boolean
  showInternalFigures: boolean
}) {
  const { totals, currency } = evaluation
  const shortages = evaluation.stockPreview.filter(
    (preview) => Number(preview.shortfall ?? 0) > 0,
  )

  return (
    <div className="space-y-4">
      <Panel className="space-y-4">
        <PanelHeader
          title="Totals"
          description="Resolved by the server from these exact terms."
          actions={<RefreshingHint visible={evaluating} />}
        />

        <ChargeBreakdown
          currency={currency}
          oneTime={totals.oneTimeTotal}
          recurring={totals.recurring}
          dueNow={totals.initialAmountDue}
        />

        <dl className="divide-y divide-line border-t border-line pt-1">
          <DetailRow label="Before discount">{formatMoney(totals.totalBase, currency)}</DetailRow>
          <DetailRow label="Discount given">
            <span className="text-brass-600">
              {formatMoney(totals.totalDiscount, currency, { signed: false })}
            </span>
          </DetailRow>
          <DetailRow label="Tax (one-time)">{formatMoney(totals.oneTimeTax, currency)}</DetailRow>
          {showInternalFigures ? (
            <DetailRow label="Contribution">
              {formatMoney(totals.contribution, currency)} ·{' '}
              {formatPercent(totals.contributionPercent)}
            </DetailRow>
          ) : null}
        </dl>

        <div className="space-y-2">
          <QualifiedFigure
            label="Comparison value"
            value={formatMoney(totals.comparisonNet, currency)}
            explanation="One-time charges plus the first full recurring cycles. Used only to give risk and margin a consistent denominator — nobody is billed this."
          />
          <QualifiedFigure
            label="Monthly recurring revenue"
            value={formatMoney(totals.monthlyRecurringRevenue, currency)}
            explanation="Recurring commitments normalised to a month, for reporting. Never an invoice amount."
          />
        </div>
      </Panel>

      {evaluation.stockPreview.length > 0 ? (
        <Panel className="space-y-3">
          <PanelHeader
            title="Availability"
            description="A preview only — nothing is reserved until the order is confirmed."
          />
          <ul className="space-y-2">
            {evaluation.stockPreview.map((preview) => {
              const short = Number(preview.shortfall ?? 0) > 0
              return (
                <li
                  key={preview.lineKey}
                  className={`rounded-[--radius-control] border px-3 py-2.5 ${
                    short ? 'border-wait-border bg-wait-surface' : 'border-line bg-panel-muted'
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">
                      {preview.description}
                    </span>
                    <span className="tabular text-[13px] text-text-secondary">
                      {formatQuantity(preview.available)} of {formatQuantity(preview.requested)}
                    </span>
                  </div>
                  {short ? (
                    <p className="mt-1 flex items-start gap-1.5 text-[13px] leading-snug text-wait-text">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span>
                        Short by {formatQuantity(preview.shortfall)}.{' '}
                        {preview.earliestExpectedReceipt
                          ? `Next receipt expected ${formatBusinessDate(preview.earliestExpectedReceipt)}.`
                          : 'No expected receipt date is recorded.'}
                      </span>
                    </p>
                  ) : (
                    <p className="mt-1 flex items-center gap-1.5 text-2xs text-text-muted">
                      <Boxes className="size-3" aria-hidden />
                      Across {preview.byWarehouse.length} warehouse
                      {preview.byWarehouse.length === 1 ? '' : 's'}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
          {shortages.length > 0 ? (
            <p className="text-[13px] leading-relaxed text-text-secondary">
              These figures are read again under a lock when the order is actually confirmed, so a
              line that is available now may still be short then.
            </p>
          ) : null}
        </Panel>
      ) : null}
    </div>
  )
}
