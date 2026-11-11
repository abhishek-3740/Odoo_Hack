import { ArrowUpRight, Check, Clock, Lock, X } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ROLE_LABEL, type ApprovalStep } from '@/api'
import { approvalStepStatus } from '@/design-system'
import { formatTimestamp } from '@/lib/dates'
import { cn } from '@/lib/cn'

/**
 * The approval chain for this version, step by step.
 *
 * Both steps are created the moment a breaching version is submitted, so
 * finance can see what is coming — but step 2 is not actionable until step 1 is
 * approved, and this shows that as a locked state rather than as an absence.
 * An empty chain is its own answer and is rendered by {@link RiskPanel}; this
 * component only draws a chain that exists.
 */
export function ApprovalRoute({ steps }: { steps: ApprovalStep[] }) {
  if (steps.length === 0) return null

  const firstApproved = steps.find((step) => step.step === 1)?.status === 'APPROVED'

  return (
    <ol className="space-y-2" aria-label="Approval route">
      {steps.map((step) => {
        const presentation = approvalStepStatus(step.status)
        const waitingOnEarlier = step.step === 2 && step.status === 'PENDING' && !firstApproved
        return (
          <li
            key={step.id}
            className={cn(
              'flex items-start gap-3 rounded-[--radius-control] border px-3 py-2.5',
              step.status === 'APPROVED'
                ? 'border-ok-border bg-ok-surface'
                : step.status === 'REJECTED'
                  ? 'border-stop-border bg-stop-surface'
                  : 'border-line bg-panel-muted',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-white',
                step.status === 'APPROVED'
                  ? 'bg-ok-text'
                  : step.status === 'REJECTED'
                    ? 'bg-stop-text'
                    : waitingOnEarlier
                      ? 'bg-line-strong'
                      : 'bg-wait-text',
              )}
            >
              {step.status === 'APPROVED' ? (
                <Check className="size-3" strokeWidth={3} />
              ) : step.status === 'REJECTED' ? (
                <X className="size-3" strokeWidth={3} />
              ) : waitingOnEarlier ? (
                <Lock className="size-2.5" />
              ) : (
                <Clock className="size-3" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-text">
                Step {step.step} · {ROLE_LABEL[step.requiredRole] ?? step.requiredRole}
                <span className="ml-2 font-normal text-text-secondary">{presentation.label}</span>
              </p>

              {waitingOnEarlier ? (
                <p className="mt-0.5 text-[13px] leading-snug text-text-secondary">
                  Visible to finance already, but it cannot be decided until the manager step is
                  approved.
                </p>
              ) : null}

              {step.assigneeName ? (
                <p className="mt-0.5 text-2xs text-text-muted">
                  With {step.assigneeName}
                  {step.dueAt ? ` · due ${formatTimestamp(step.dueAt)}` : ''}
                </p>
              ) : null}

              {step.decidedByName ? (
                <p className="mt-1 text-[13px] leading-snug text-text-secondary">
                  {step.status === 'APPROVED' ? 'Approved' : 'Decided'} by {step.decidedByName}
                  {step.decidedAt ? ` on ${formatTimestamp(step.decidedAt)}` : ''}
                  {step.decisionReason ? ` — “${step.decisionReason}”` : ''}
                </p>
              ) : null}

              <Link
                to={`/admin/approvals/${step.id}`}
                className="mt-1.5 inline-flex items-center gap-1 text-2xs font-medium text-forest-600 hover:underline"
              >
                Open this step
                <ArrowUpRight className="size-3" aria-hidden />
              </Link>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
