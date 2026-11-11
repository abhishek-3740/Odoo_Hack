import { ShieldCheck, TriangleAlert } from 'lucide-react'

import { APPROVAL_LEVEL_LABEL, type RiskSummary } from '@/api'
import { Badge, DetailRow, Panel, PanelHeader, StatusBadge, approvalLevelStatus } from '@/design-system'
import { formatMoney, formatPercent, formatPoints } from '@/lib/money'

/**
 * Renders a policy threshold in the unit the server measured it in.
 *
 * The API sends the unit as a bare word — "percent", "pp", "minor" — which reads
 * as "30.00percent" if concatenated. Money arrives in minor units here, so it is
 * converted rather than shown as a raw integer.
 */
function measured(value: string, unit: string | null, currency: string): string {
  switch (unit) {
    case 'percent':
      return `${value}%`
    case 'pp':
      return `${value} pp`
    case 'minor':
      return formatMoney(String(Number(value) / 100), currency)
    default:
      return unit ? `${value} ${unit}` : value
  }
}

/**
 * Why this version needs approval — or why it does not.
 *
 * The point of this panel is that the *reason* is a number, not a colour. Each
 * entry says which line, which ceiling and how far over, because "review
 * required" on its own gives a salesperson nothing to act on and an approver
 * nothing to weigh.
 *
 * The empty case is treated as a real answer, not an absence. A quotation
 * inside policy has no approval step in anyone's queue, and saying so plainly
 * is the difference between "nothing is waiting" and "something failed".
 */
export function RiskPanel({
  risk,
  currency,
  submitted,
}: {
  risk: RiskSummary
  currency: string
  /** Whether these terms have actually been submitted, for accurate wording. */
  submitted: boolean
}) {
  const level = approvalLevelStatus(risk.requiredLevel)
  const clean = risk.requiredLevel === 'NONE'

  return (
    <Panel className="space-y-4">
      <PanelHeader
        title="Policy check"
        description={
          risk.policyVersionNo != null
            ? `Measured against discount policy version ${risk.policyVersionNo}.`
            : 'Measured against the discount policy in force.'
        }
        actions={
          <StatusBadge
            label={
              clean && submitted
                ? 'Within policy · no approval required'
                : (APPROVAL_LEVEL_LABEL[risk.requiredLevel] ?? level.label)
            }
            tone={level.tone}
          />
        }
      />

      {clean ? (
        <p
          aria-label="Approval route"
          className="flex items-start gap-2 rounded-[--radius-control] border border-ok-border bg-ok-surface px-3 py-2.5 text-[13px] leading-relaxed text-ok-text"
        >
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Nothing here breaches a ceiling and margin holds, so{' '}
            <strong className="font-semibold">no manager or finance step was created</strong>.
            Nothing is waiting in an approver's queue for this quotation.
          </span>
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Reasons approval is required">
          {risk.reasons.map((reason, index) => (
            <li
              key={`${reason.code}-${reason.lineKey ?? index}`}
              className="rounded-[--radius-control] border border-wait-border bg-wait-surface px-3 py-2.5"
            >
              <p className="flex items-start gap-2 text-[13px] leading-relaxed text-wait-text">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{reason.message}</span>
              </p>
              {reason.observedValue != null && reason.thresholdValue != null ? (
                <p className="tabular mt-1.5 pl-5 text-2xs text-wait-text">
                  Observed {measured(reason.observedValue, reason.unit, currency)} against a limit
                  of {measured(reason.thresholdValue, reason.unit, currency)}
                  {reason.description ? ` · ${reason.description}` : ''}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* The four risk measures, named the way the policy names them. */}
      <dl className="divide-y divide-line border-t border-line pt-1">
        <DetailRow label="Worst line over its ceiling">
          {formatPoints(risk.worstLineExcessPp)}
        </DetailRow>
        <DetailRow label="Value-weighted excess">{formatPoints(risk.weightedExcessPp)}</DetailRow>
        <DetailRow label="Conceded beyond ceilings">
          {formatMoney(risk.excessConcessionValue, currency)}
        </DetailRow>
        <DetailRow label="Overall discount">
          {formatPercent(risk.aggregateDiscountPercent)}
        </DetailRow>
        <DetailRow label="Overall margin">{formatPercent(risk.aggregateMarginPercent)}</DetailRow>
      </dl>

      {risk.lines.length > 0 ? (
        <div>
          <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-text-muted">
            Lines over their ceiling
          </p>
          <ul className="space-y-1.5">
            {risk.lines.map((line) => (
              <li
                key={line.lineKey}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-[--radius-control] bg-canvas-sunken px-3 py-2 text-[13px]"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-text">
                  {line.description}
                </span>
                <span className="tabular flex items-center gap-2 text-text-secondary">
                  {formatPercent(line.effectiveDiscountPercent)} vs{' '}
                  {formatPercent(line.allowedPercent)}
                  <Badge tone="wait" size="sm">
                    +{formatPoints(line.excessPp)}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  )
}
