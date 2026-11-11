import { Plus, Trash2 } from 'lucide-react'

import {
  BACKORDER_TERMS_LABEL,
  type BackorderTerms,
  type EvaluatedLine,
  type QuoteEvaluation,
} from '@/api'
import {
  Badge,
  Button,
  DateInput,
  IconButton,
  PercentInput,
  QuantityInput,
  Select,
  Tooltip,
} from '@/design-system'
import { cn } from '@/lib/cn'
import { formatBasisPoints, formatMoney, formatPercent } from '@/lib/money'

import type { DraftLine } from '../useQuoteDraft'

/**
 * The editable terms table.
 *
 * Two things the plan insists on and this enforces:
 *
 *  - **Line discount and order discount stay visibly separate.** The table shows
 *    the line's own discount as an input and the *effective* discount — line
 *    plus the order-level one — as a read-only figure beside it. Merging them
 *    is how a counteroffer form ends up applying the order discount twice.
 *  - **Monthly, quarterly and yearly charges are never summed.** Each line
 *    carries its own cadence, and the totals panel reports each separately.
 *
 * Costs and margin are shown only where the caller says the viewer is entitled
 * to them — and they are simply not rendered otherwise, rather than hidden with
 * a class a screenshot could still capture.
 */
export function QuoteEditor({
  evaluation,
  lines,
  onChangeLine,
  onRemoveLine,
  onAddLine,
  orderDiscountBp,
  onOrderDiscountChange,
  backorderTerms,
  onBackorderTermsChange,
  requestedActivationDate,
  onActivationDateChange,
  readOnly,
  readOnlyReason,
  showInternalFigures,
}: {
  evaluation: QuoteEvaluation
  lines: DraftLine[]
  onChangeLine: (lineKey: string, patch: Partial<DraftLine>) => void
  onRemoveLine: (lineKey: string) => void
  onAddLine: () => void
  orderDiscountBp: number | null
  onOrderDiscountChange: (bp: number | null) => void
  backorderTerms: BackorderTerms
  onBackorderTermsChange: (terms: BackorderTerms) => void
  requestedActivationDate: string | null
  onActivationDateChange: (date: string | null) => void
  readOnly: boolean
  readOnlyReason?: string
  showInternalFigures: boolean
}) {
  const evaluated = new Map<string, EvaluatedLine>(
    evaluation.lines.map((line) => [line.lineKey, line]),
  )
  const currency = evaluation.currency
  const hasStockLines = evaluation.lines.some((line) => line.requiresStock)
  const hasRecurring = evaluation.lines.some((line) => line.lineKind === 'RECURRING')

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[--radius-panel] border border-line bg-panel shadow-panel">
        <div className="scroll-subtle overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <caption className="sr-only">Quotation lines</caption>
            <thead>
              <tr className="border-b border-line bg-panel-muted text-2xs uppercase tracking-wide text-text-muted">
                <th scope="col" className="px-3 py-2.5 text-left font-semibold">
                  Item
                </th>
                <th scope="col" className="w-24 px-3 py-2.5 text-right font-semibold">
                  Qty
                </th>
                <th scope="col" className="w-28 px-3 py-2.5 text-right font-semibold">
                  Unit price
                </th>
                <th scope="col" className="w-28 px-3 py-2.5 text-right font-semibold">
                  Line disc.
                </th>
                <th
                  scope="col"
                  className="hidden w-24 px-3 py-2.5 text-right font-semibold md:table-cell"
                >
                  Effective
                </th>
                {showInternalFigures ? (
                  <th
                    scope="col"
                    className="hidden w-24 px-3 py-2.5 text-right font-semibold xl:table-cell"
                  >
                    Margin
                  </th>
                ) : null}
                <th scope="col" className="w-28 px-3 py-2.5 text-right font-semibold">
                  Net
                </th>
                <th
                  scope="col"
                  className="hidden w-24 px-3 py-2.5 text-right font-semibold lg:table-cell"
                >
                  Tax
                </th>
                {!readOnly ? <th scope="col" className="w-12 px-2 py-2.5" /> : null}
              </tr>
            </thead>

            <tbody>
              {lines.map((line) => {
                const priced = evaluated.get(line.lineKey)
                const recurring = (priced?.lineKind ?? line.lineKind) === 'RECURRING'
                return (
                  <tr key={line.lineKey} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5">
                      <span className="block font-medium text-text">
                        {priced?.description ?? line.description ?? 'New line'}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-text-muted">
                        {recurring ? (
                          <Badge tone="info" size="sm">
                            {priced?.intervalMonths === 1
                              ? 'Monthly'
                              : priced?.intervalMonths === 3
                                ? 'Quarterly'
                                : priced?.intervalMonths === 12
                                  ? 'Yearly'
                                  : 'Recurring'}
                          </Badge>
                        ) : (
                          <Badge tone="neutral" size="sm">
                            One-time
                          </Badge>
                        )}
                        {priced?.categoryCode ? <span>{priced.categoryCode}</span> : null}
                        {priced?.requiresStock ? <span>· needs stock</span> : null}
                      </span>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      {readOnly ? (
                        <span className="tabular">{priced?.quantity ?? line.quantity}</span>
                      ) : (
                        <QuantityInput
                          label={`Quantity for ${priced?.description ?? 'line'}`}
                          value={line.quantity}
                          onChange={(value) => onChangeLine(line.lineKey, { quantity: value })}
                        />
                      )}
                    </td>

                    <td className="tabular px-3 py-2.5 text-right text-text-secondary">
                      {formatMoney(priced?.unitPrice, currency)}
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      {readOnly ? (
                        <span className="tabular">{formatBasisPoints(priced?.lineDiscountBp)}</span>
                      ) : (
                        <PercentInput
                          aria-label={`Line discount for ${priced?.description ?? 'line'}`}
                          valueBp={line.lineDiscountBp}
                          onChangeBp={(bp) => onChangeLine(line.lineKey, { lineDiscountBp: bp })}
                          className="w-24"
                        />
                      )}
                    </td>

                    <td className="tabular hidden px-3 py-2.5 text-right md:table-cell">
                      <Tooltip content="Line discount and the order-level discount combined — what this line actually costs.">
                        <span
                          className={cn(
                            'cursor-help',
                            (priced?.effectiveDiscountBp ?? 0) > (priced?.lineDiscountBp ?? 0)
                              ? 'font-medium text-brass-600'
                              : 'text-text-secondary',
                          )}
                        >
                          {formatBasisPoints(priced?.effectiveDiscountBp)}
                        </span>
                      </Tooltip>
                    </td>

                    {showInternalFigures ? (
                      <td className="tabular hidden px-3 py-2.5 text-right xl:table-cell">
                        <span
                          className={cn(
                            priced?.marginPercent != null && Number(priced.marginPercent) < 20
                              ? 'font-medium text-stop-text'
                              : 'text-text-secondary',
                          )}
                        >
                          {formatPercent(priced?.marginPercent)}
                        </span>
                      </td>
                    ) : null}

                    <td className="tabular px-3 py-2.5 text-right font-medium">
                      {formatMoney(priced?.net, currency)}
                      {recurring ? (
                        <span className="block text-2xs font-normal text-text-muted">
                          per period
                        </span>
                      ) : null}
                    </td>

                    <td className="tabular hidden px-3 py-2.5 text-right text-text-secondary lg:table-cell">
                      {formatMoney(priced?.tax, currency)}
                    </td>

                    {!readOnly ? (
                      <td className="px-2 py-2.5 text-right">
                        <IconButton
                          label={`Remove ${priced?.description ?? 'line'}`}
                          size="sm"
                          onClick={() => onRemoveLine(line.lineKey)}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </IconButton>
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {!readOnly ? (
          <div className="border-t border-line bg-panel-muted px-3 py-2.5">
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={onAddLine}>
              Add a line
            </Button>
          </div>
        ) : readOnlyReason ? (
          <p className="border-t border-line bg-panel-muted px-3 py-2.5 text-[13px] text-text-secondary">
            {readOnlyReason}
          </p>
        ) : null}
      </div>

      {/* Order-level terms. Kept apart from the table so the two discounts are
          never confused for one another. */}
      <div className="grid gap-4 rounded-[--radius-panel] border border-line bg-panel p-4 shadow-panel sm:grid-cols-2 lg:grid-cols-3">
        <PercentInput
          label="Order discount"
          hint="Applied on top of each line's own discount. The effective column shows the two combined."
          valueBp={orderDiscountBp}
          onChangeBp={onOrderDiscountChange}
          disabled={readOnly}
        />

        {hasStockLines ? (
          <div className="space-y-1.5">
            <label
              htmlFor="backorder-terms"
              className="block text-[13px] font-medium text-text"
            >
              If stock is short
            </label>
            <Select
              id="backorder-terms"
              value={backorderTerms}
              disabled={readOnly}
              onChange={(event) => onBackorderTermsChange(event.target.value as BackorderTerms)}
            >
              <option value="ALLOW_BACKORDER">{BACKORDER_TERMS_LABEL.ALLOW_BACKORDER}</option>
              <option value="IN_STOCK_ONLY">{BACKORDER_TERMS_LABEL.IN_STOCK_ONLY}</option>
            </Select>
            <p className="text-[13px] leading-relaxed text-text-secondary">
              Ship-complete refuses confirmation outright if anything is short.
            </p>
          </div>
        ) : null}

        {hasRecurring ? (
          <DateInput
            label="Requested activation"
            hint="When the recurring lines should start. Leave empty to start on confirmation."
            value={requestedActivationDate}
            onChange={onActivationDateChange}
            disabled={readOnly}
          />
        ) : null}
      </div>
    </div>
  )
}
