import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, Lock, UserRoundCog } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import {
  APPROVAL_DECISION_LABEL,
  approvals as approvalsApi,
  keys,
  newIdempotencyKey,
  people,
  ROLE_LABEL,
  type ApprovalDecision,
  type ApprovalQueueItem,
} from '@/api'
import { useAuth } from '@/auth/useAuth'
import { CATALOG_QUERY_OPTIONS } from '@/app/queryClient'
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  InlineError,
  LoadingPanel,
  Panel,
  PageHeader,
  Pagination,
  RefreshingHint,
  Select,
  StatusBadge,
  Textarea,
  approvalStepStatus,
  useDisclosure,
} from '@/design-system'
import { formatRelative, formatTimestamp } from '@/lib/dates'
import { formatMoney, formatPercent, formatPoints } from '@/lib/money'

/** See RiskPanel: the API sends units as bare words that need spacing and scaling. */
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
import { cn } from '@/lib/cn'

/**
 * The approver's queue.
 *
 * Scope comes from the server: a manager sees step 1 for their team, finance
 * sees step 2, an administrator sees everything, and a rep sees the steps on
 * their own quotations. The client does not filter by role and must not pretend
 * to.
 *
 * The rule that shapes this screen is sequencing. Both steps exist from the
 * moment a breaching version is submitted, so a finance step appears here
 * straight away — with `actionable: false` and the server's own reason — rather
 * than being hidden until step 1 clears. Hiding it is what makes people believe
 * the finance queue is broken.
 */
export default function ApprovalInboxPage() {
  const { me } = useAuth()
  const [status, setStatus] = useState('PENDING')
  const [page, setPage] = useState(0)

  const query = { status, page, pageSize: 20 }
  const queue = useQuery({
    queryKey: keys.approvalQueue(query),
    queryFn: ({ signal }) => approvalsApi.queue(query, signal),
  })

  const rows = queue.data?.items ?? []
  const actionable = rows.filter((row) => row.actionable).length
  const blocked = rows.length - actionable

  return (
    <>
      <PageHeader
        title="Approvals"
        description={
          me?.role === 'FINANCE'
            ? 'Step 2. A step becomes actionable once the manager has approved step 1 — until then it is visible but locked.'
            : me?.role === 'MANAGER'
              ? 'Step 1 for your team. Approving here releases the finance step when one is required.'
              : 'Approval steps across the workspace.'
        }
        meta={
          <>
            {rows.length > 0 ? (
              <span className="text-[13px] text-text-secondary">
                <span className="tabular font-medium text-text">{actionable}</span> you can decide
                now
                {blocked > 0 ? ` · ${blocked} waiting on an earlier step` : ''}
              </span>
            ) : null}
            <RefreshingHint visible={queue.isFetching && !queue.isLoading} />
          </>
        }
        actions={
          <div className="w-48">
            <label htmlFor="approval-status" className="sr-only">
              Filter by status
            </label>
            <Select
              id="approval-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value)
                setPage(0)
              }}
            >
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="REVISION_REQUIRED">Returned for revision</option>
              <option value="SUPERSEDED">Superseded</option>
            </Select>
          </div>
        }
      />

      {queue.isLoading && !queue.data ? (
        <LoadingPanel rows={4} />
      ) : queue.error ? (
        <InlineError error={queue.error} onRetry={() => void queue.refetch()} />
      ) : rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<ClipboardCheck className="size-5" aria-hidden />}
            title={
              status === 'PENDING'
                ? `No ${me?.role === 'FINANCE' ? 'step 2 ' : ''}approval requests are pending`
                : 'Nothing here'
            }
            description={
              status === 'PENDING'
                ? 'A step is only created when a submitted version breaches the discount policy. Quotations inside policy never reach an approver.'
                : 'Change the filter to see steps in another state.'
            }
          />
        </Panel>
      ) : (
        <ul className="space-y-3">
          {rows.map((item) => (
            <ApprovalCard key={item.id} item={item} canReassign={me?.role === 'ADMIN'} />
          ))}
        </ul>
      )}

      {queue.data ? (
        <Pagination
          page={queue.data.page}
          pageSize={queue.data.pageSize}
          totalItems={queue.data.totalItems}
          totalPages={queue.data.totalPages}
          busy={queue.isFetching}
          onPageChange={setPage}
        />
      ) : null}
    </>
  )
}

/* ---------------------------------------------------------------- one step */

export function ApprovalCard({
  item,
  canReassign,
}: {
  item: ApprovalQueueItem
  canReassign: boolean
}) {
  const queryClient = useQueryClient()
  const decide = useDisclosure()
  const reassign = useDisclosure()
  const [decision, setDecision] = useState<ApprovalDecision>('APPROVE')
  const [reason, setReason] = useState('')

  const status = approvalStepStatus(item.status)

  const record = useMutation({
    mutationFn: () =>
      approvalsApi.decide(
        item.id,
        {
          decision,
          expectedRevisionId: item.revisionId,
          reason: reason.trim() || null,
        },
        // One key per decision intent, so a double-clicked approve is one
        // decision and a retry after a dropped connection returns the same one.
        newIdempotencyKey(),
      ),
    onSuccess: (result) => {
      decide.hide()
      setReason('')
      toast.success(`${APPROVAL_DECISION_LABEL[decision]} recorded`, {
        description: result.orderId
          ? 'That was the last outstanding gate — the order has been created.'
          : result.remainingGates.length > 0
            ? `Still outstanding: ${result.remainingGates.join(', ')}.`
            : undefined,
      })
      void queryClient.invalidateQueries({ queryKey: keys.approvals() })
      void queryClient.invalidateQueries({ queryKey: keys.quote(item.quoteId) })
      void queryClient.invalidateQueries({ queryKey: keys.quotes() })
    },
  })

  return (
    <li>
      <Panel className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <Link
                to={`/admin/quotes/${item.quoteId}`}
                className="tabular text-[15px] font-semibold text-forest-700 hover:underline"
              >
                {item.quoteReference ?? 'Quotation'}
              </Link>
              <Badge tone="neutral" size="sm">
                Step {item.step} · {ROLE_LABEL[item.requiredRole] ?? item.requiredRole}
              </Badge>
              <Badge tone="neutral" size="sm">
                Version {item.revisionNo}
              </Badge>
              <StatusBadge label={status.label} tone={status.tone} size="sm" />
              {item.overdue ? (
                <Badge tone="stop" size="sm">
                  Overdue
                </Badge>
              ) : null}
            </p>
            <p className="mt-1 text-[13px] text-text-secondary">
              {item.customerName ?? 'Customer'} · raised {formatRelative(item.createdAt)}
              {item.assigneeName ? ` · with ${item.assigneeName}` : ''}
              {item.dueAt ? ` · due ${formatTimestamp(item.dueAt)}` : ''}
            </p>
          </div>

          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-right text-[13px]">
            <div>
              <dt className="text-2xs uppercase tracking-wide text-text-muted">One-time</dt>
              <dd className="tabular font-semibold">
                {formatMoney(item.oneTimeNet, item.currency)}
              </dd>
            </div>
            {Number(item.recurringFirstCycleNet ?? 0) > 0 ? (
              <div>
                <dt className="text-2xs uppercase tracking-wide text-text-muted">Recurring</dt>
                <dd className="tabular font-semibold">
                  {formatMoney(item.recurringFirstCycleNet, item.currency)}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-2xs uppercase tracking-wide text-text-muted">Margin</dt>
              <dd className="tabular font-semibold">{formatPercent(item.contributionPercent)}</dd>
            </div>
            {item.worstLineExcessPp != null ? (
              <div>
                <dt className="text-2xs uppercase tracking-wide text-text-muted">Worst line</dt>
                <dd className="tabular font-semibold text-brass-600">
                  +{formatPoints(item.worstLineExcessPp)}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>

        {/* The reasons come before the buttons, deliberately. */}
        {item.reasons.length > 0 ? (
          <ul className="space-y-1.5">
            {item.reasons.map((reasonRow, index) => (
              <li
                key={`${reasonRow.code}-${index}`}
                className="rounded-[--radius-control] border border-wait-border bg-wait-surface px-3 py-2 text-[13px] leading-relaxed text-wait-text"
              >
                {reasonRow.message}
                {reasonRow.observedValue != null && reasonRow.thresholdValue != null ? (
                  <span className="tabular block text-2xs text-wait-text">
                    Observed {measured(reasonRow.observedValue, reasonRow.unit, item.currency)}{' '}
                    against a limit of{' '}
                    {measured(reasonRow.thresholdValue, reasonRow.unit, item.currency)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {!item.actionable && item.blockedReason ? (
          <p
            className={cn(
              'flex items-start gap-2 rounded-[--radius-control] border border-line',
              'bg-canvas-sunken px-3 py-2 text-[13px] leading-relaxed text-text-secondary',
            )}
          >
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {item.blockedReason}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button
            variant="primary"
            size="sm"
            disabled={!item.actionable || item.status !== 'PENDING'}
            disabledReason={
              item.status !== 'PENDING'
                ? 'This step already has a decision.'
                : (item.blockedReason ?? 'This step is not actionable yet.')
            }
            onClick={() => {
              setDecision('APPROVE')
              decide.show()
            }}
          >
            Decide
          </Button>
          <Link
            to={`/admin/quotes/${item.quoteId}`}
            className="inline-flex h-9 items-center rounded-[--radius-control] border border-line-strong bg-panel px-3 text-[13px] font-semibold text-text transition-colors hover:bg-canvas-sunken"
          >
            Open the quotation
          </Link>
          {canReassign && item.status === 'PENDING' ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<UserRoundCog className="size-3.5" />}
              onClick={reassign.show}
            >
              Reassign
            </Button>
          ) : null}
        </div>
      </Panel>

      {/* ------------------------------------------------------- decision */}
      <Dialog
        open={decide.open}
        onOpenChange={decide.setOpen}
        title={`Decide step ${item.step} · ${item.quoteReference ?? ''}`}
        description="Recorded against this exact version. If the terms have since been replaced, the decision is refused rather than applied to the wrong version."
        busy={record.isPending}
        footer={
          <>
            <Button variant="ghost" onClick={decide.hide} disabled={record.isPending}>
              Cancel
            </Button>
            <Button
              variant={decision === 'APPROVE' ? 'primary' : 'danger'}
              busy={record.isPending}
              disabled={decision !== 'APPROVE' && reason.trim().length < 3}
              disabledReason="Give a reason when rejecting or returning."
              onClick={() => record.mutate()}
            >
              {APPROVAL_DECISION_LABEL[decision]}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Decision" required>
            {(props) => (
              <Select
                {...props}
                value={decision}
                onChange={(event) => setDecision(event.target.value as ApprovalDecision)}
              >
                <option value="APPROVE">Approve — release the next step or the gate</option>
                <option value="REJECT">Reject — this version will not proceed</option>
                <option value="RETURN_FOR_REVISION">
                  Return for revision — send it back to the salesperson
                </option>
              </Select>
            )}
          </Field>

          <Field
            label="Reason"
            required={decision !== 'APPROVE'}
            hint="Kept in the quotation's history and visible to the salesperson."
          >
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={
                  decision === 'APPROVE'
                    ? 'Optional — anything the salesperson should know.'
                    : 'Explain what needs to change.'
                }
              />
            )}
          </Field>

          {decision === 'RETURN_FOR_REVISION' ? (
            <p className="rounded-[--radius-control] bg-canvas-sunken px-3 py-2.5 text-[13px] leading-relaxed text-text-secondary">
              Returning closes this attempt rather than pausing it. The salesperson revises the
              terms and submits again, which creates a fresh approval chain.
            </p>
          ) : null}

          {record.error ? <InlineError error={record.error} /> : null}
        </div>
      </Dialog>

      <ReassignDialog open={reassign.open} onOpenChange={reassign.setOpen} item={item} />
    </li>
  )
}

/* -------------------------------------------------------------- reassignment */

function ReassignDialog({
  open,
  onOpenChange,
  item,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: ApprovalQueueItem
}) {
  const queryClient = useQueryClient()
  const [assignee, setAssignee] = useState('')
  const [reason, setReason] = useState('')

  const profiles = useQuery({
    queryKey: keys.profiles({ role: item.requiredRole }),
    queryFn: ({ signal }) => people.profiles({ role: item.requiredRole, pageSize: 100 }, signal),
    enabled: open,
    ...CATALOG_QUERY_OPTIONS,
  })

  const move = useMutation({
    mutationFn: () =>
      approvalsApi.reassign(item.id, { assigneeProfileId: assignee, reason: reason.trim() }),
    onSuccess: () => {
      onOpenChange(false)
      toast.success('Step reassigned')
      void queryClient.invalidateQueries({ queryKey: keys.approvals() })
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Reassign this approval step"
      description="Hands the step to another qualified approver. The server checks that they are eligible for this role."
      busy={move.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={move.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={move.isPending}
            disabled={!assignee || reason.trim().length < 3}
            disabledReason="Choose an approver and give a reason."
            onClick={() => move.mutate()}
          >
            Reassign
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={`Qualified ${ROLE_LABEL[item.requiredRole] ?? item.requiredRole}`} required>
          {(props) => (
            <Select {...props} value={assignee} onChange={(event) => setAssignee(event.target.value)}>
              <option value="">Choose an approver…</option>
              {(profiles.data?.items ?? [])
                .filter((profile) => profile.active && profile.id !== item.assigneeProfileId)
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.fullName ?? profile.email}
                  </option>
                ))}
            </Select>
          )}
        </Field>

        <Field label="Reason" required hint="Recorded in the audit trail.">
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. On leave until Monday."
            />
          )}
        </Field>

        {profiles.error ? <InlineError error={profiles.error} /> : null}
        {move.error ? <InlineError error={move.error} /> : null}
      </div>
    </Dialog>
  )
}
