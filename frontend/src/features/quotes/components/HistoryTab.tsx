import { useQuery } from '@tanstack/react-query'
import { GitCompareArrows, History } from 'lucide-react'
import { useState } from 'react'

import {
  keys,
  quotes as quotesApi,
  REVISION_SOURCE_LABEL,
  type QuoteEvaluation,
  type UUID,
} from '@/api'
import {
  Badge,
  DataTable,
  EmptyState,
  InlineError,
  LoadingPanel,
  Panel,
  Section,
  Select,
  StatusBadge,
  revisionStatus,
} from '@/design-system'
import { formatTimestamp } from '@/lib/dates'
import { formatBasisPoints, formatMoney, formatQuantity } from '@/lib/money'
import { cn } from '@/lib/cn'

/**
 * Versions and the audit trail.
 *
 * "What changed?" is answered by fetching the two revisions and comparing them
 * on stable line keys — not by diffing rendered text, and not by asking the
 * backend for an endpoint that does not exist. A rejected submission stays in
 * the list on purpose: a history that quietly drops the versions somebody said
 * no to is not a history.
 */
export function HistoryTab({ evaluation }: { evaluation: QuoteEvaluation }) {
  const quoteId = evaluation.quoteId
  const [compareId, setCompareId] = useState<UUID | ''>('')

  const revisions = useQuery({
    queryKey: keys.quoteRevisions(quoteId),
    queryFn: ({ signal }) => quotesApi.revisions(quoteId, signal),
  })

  const audit = useQuery({
    queryKey: keys.quoteHistory(quoteId),
    queryFn: ({ signal }) => quotesApi.history(quoteId, signal),
  })

  const comparison = useQuery({
    queryKey: keys.quoteRevision(quoteId, compareId || 'none'),
    queryFn: ({ signal }) => quotesApi.revision(quoteId, compareId as UUID, signal),
    enabled: Boolean(compareId),
  })

  const rows = revisions.data ?? []
  const older = rows.filter((row) => row.id !== evaluation.revisionId)

  return (
    <div className="space-y-6">
      <Section
        id="versions"
        title="Versions"
        description="Every saved set of terms, newest first. Superseded and rejected versions stay visible."
      >
        {revisions.isLoading && rows.length === 0 ? (
          <LoadingPanel rows={3} />
        ) : revisions.error ? (
          <InlineError error={revisions.error} onRetry={() => void revisions.refetch()} />
        ) : (
          <DataTable
            caption="Quotation versions"
            rows={rows}
            rowKey={(row) => row.id}
            isActive={(row) => row.current}
            columns={[
              {
                id: 'version',
                header: 'Version',
                cell: (row) => (
                  <span className="flex items-center gap-2">
                    <span className="tabular font-medium">v{row.revisionNo}</span>
                    {row.current ? (
                      <Badge tone="ok" size="sm">
                        Current
                      </Badge>
                    ) : null}
                  </span>
                ),
              },
              {
                id: 'source',
                header: 'Proposed by',
                hideBelow: 'sm',
                cell: (row) => (
                  <span className="text-text-secondary">
                    {REVISION_SOURCE_LABEL[row.source] ?? row.source}
                  </span>
                ),
              },
              {
                id: 'status',
                header: 'Status',
                cell: (row) => {
                  const status = revisionStatus(row.status)
                  return <StatusBadge label={status.label} tone={status.tone} size="sm" />
                },
              },
              {
                id: 'oneTime',
                header: 'One-time',
                align: 'right',
                cell: (row) => formatMoney(row.oneTimeNet, evaluation.currency),
              },
              {
                id: 'recurring',
                header: 'Recurring',
                align: 'right',
                hideBelow: 'md',
                cell: (row) => formatMoney(row.recurringFirstCycleNet, evaluation.currency),
              },
              {
                id: 'submitted',
                header: 'Submitted',
                hideBelow: 'lg',
                // The API stringifies these with String.valueOf, so an absent
                // value arrives as the literal text "null".
                cell: (row) =>
                  row.submittedAt && row.submittedAt !== 'null' ? (
                    formatTimestamp(row.submittedAt)
                  ) : (
                    <span className="text-text-muted">Not submitted</span>
                  ),
              },
              {
                id: 'accepted',
                header: 'Accepted',
                hideBelow: 'xl',
                cell: (row) =>
                  row.customerAcceptedAt && row.customerAcceptedAt !== 'null' ? (
                    formatTimestamp(row.customerAcceptedAt)
                  ) : (
                    <span className="text-text-muted">—</span>
                  ),
              },
            ]}
          />
        )}
      </Section>

      {older.length > 0 ? (
        <Section
          id="compare"
          title="What changed?"
          description="Compare the current version against an earlier one, line by line."
        >
          <Panel className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-56 space-y-1.5">
                <label htmlFor="compare-with" className="block text-[13px] font-medium text-text">
                  Compare version {evaluation.revisionNo} with
                </label>
                <Select
                  id="compare-with"
                  value={compareId}
                  onChange={(event) => setCompareId(event.target.value as UUID | '')}
                >
                  <option value="">Choose an earlier version…</option>
                  {older.map((row) => (
                    <option key={row.id} value={row.id}>
                      v{row.revisionNo} · {REVISION_SOURCE_LABEL[row.source] ?? row.source}
                    </option>
                  ))}
                </Select>
              </div>
              {comparison.isFetching ? (
                <span className="pb-2 text-[13px] text-text-secondary">Loading that version…</span>
              ) : null}
            </div>

            {comparison.error ? (
              <InlineError error={comparison.error} onRetry={() => void comparison.refetch()} />
            ) : comparison.data ? (
              <RevisionDiff current={evaluation} previous={comparison.data} />
            ) : (
              <p className="text-[13px] text-text-secondary">
                Pick a version to see which lines, quantities and discounts differ.
              </p>
            )}
          </Panel>
        </Section>
      ) : null}

      <Section
        id="audit"
        title="Audit trail"
        description="Who did what, when, and why — as recorded by the server."
      >
        {audit.isLoading && !audit.data ? (
          <LoadingPanel rows={4} />
        ) : audit.error ? (
          <InlineError error={audit.error} onRetry={() => void audit.refetch()} />
        ) : (audit.data ?? []).length === 0 ? (
          <Panel>
            <EmptyState
              icon={<History className="size-5" aria-hidden />}
              title="Nothing recorded yet"
              description="Saves, submissions, decisions and acceptances all appear here."
            />
          </Panel>
        ) : (
          <Panel flush className="overflow-hidden">
            <ol className="divide-y divide-line">
              {(audit.data ?? []).map((entry) => (
                <li key={entry.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[13px] font-medium text-text">
                      {humaniseAction(entry.action)}
                      <span className="ml-2 font-normal text-text-secondary">by {entry.actor}</span>
                    </p>
                    <time
                      dateTime={entry.occurredAt}
                      className="tabular text-2xs text-text-muted"
                    >
                      {formatTimestamp(entry.occurredAt)}
                    </time>
                  </div>
                  {entry.reason && entry.reason !== 'null' ? (
                    <p className="mt-0.5 text-[13px] leading-relaxed text-text-secondary">
                      “{entry.reason}”
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </Panel>
        )}
      </Section>
    </div>
  )
}

/* -------------------------------------------------------------------- diff */

function RevisionDiff({
  current,
  previous,
}: {
  current: QuoteEvaluation
  previous: QuoteEvaluation
}) {
  const before = new Map(previous.lines.map((line) => [line.lineKey, line]))
  const after = new Map(current.lines.map((line) => [line.lineKey, line]))
  const keys = [...new Set([...before.keys(), ...after.keys()])]

  const changes = keys
    .map((key) => {
      const a = before.get(key)
      const b = after.get(key)
      if (!a) return { key, kind: 'added' as const, before: null, after: b! }
      if (!b) return { key, kind: 'removed' as const, before: a, after: null }
      const same =
        Number(a.quantity) === Number(b.quantity) &&
        a.lineDiscountBp === b.lineDiscountBp &&
        a.net === b.net
      return same
        ? null
        : { key, kind: 'changed' as const, before: a, after: b }
    })
    .filter(Boolean) as Array<{
    key: string
    kind: 'added' | 'removed' | 'changed'
    before: QuoteEvaluation['lines'][number] | null
    after: QuoteEvaluation['lines'][number] | null
  }>

  const orderDiscountChanged = previous.orderDiscountBp !== current.orderDiscountBp

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <SideTotals label={`Version ${previous.revisionNo}`} evaluation={previous} />
        <SideTotals label={`Version ${current.revisionNo}`} evaluation={current} highlight />
      </div>

      {orderDiscountChanged ? (
        <p className="rounded-[--radius-control] border border-brass-200 bg-brass-50 px-3 py-2 text-[13px] text-text">
          Order discount moved from{' '}
          <span className="tabular font-semibold">
            {formatBasisPoints(previous.orderDiscountBp)}
          </span>{' '}
          to{' '}
          <span className="tabular font-semibold">
            {formatBasisPoints(current.orderDiscountBp)}
          </span>
          .
        </p>
      ) : null}

      {changes.length === 0 ? (
        <p className="text-[13px] text-text-secondary">
          No line differs between these versions
          {orderDiscountChanged ? ' beyond the order discount above' : ''}.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {changes.map((change) => (
            <li
              key={change.key}
              className={cn(
                'rounded-[--radius-control] border px-3 py-2 text-[13px]',
                change.kind === 'added'
                  ? 'border-ok-border bg-ok-surface'
                  : change.kind === 'removed'
                    ? 'border-stop-border bg-stop-surface'
                    : 'border-line bg-panel-muted',
              )}
            >
              <p className="font-medium text-text">
                {change.kind === 'added'
                  ? 'Added: '
                  : change.kind === 'removed'
                    ? 'Removed: '
                    : ''}
                {change.after?.description ?? change.before?.description ?? change.key}
              </p>
              {change.kind === 'changed' && change.before && change.after ? (
                <p className="tabular mt-0.5 text-text-secondary">
                  Quantity {formatQuantity(change.before.quantity)} →{' '}
                  {formatQuantity(change.after.quantity)} · discount{' '}
                  {formatBasisPoints(change.before.lineDiscountBp)} →{' '}
                  {formatBasisPoints(change.after.lineDiscountBp)} · net{' '}
                  {formatMoney(change.before.net, previous.currency)} →{' '}
                  {formatMoney(change.after.net, current.currency)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SideTotals({
  label,
  evaluation,
  highlight,
}: {
  label: string
  evaluation: QuoteEvaluation
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-[--radius-control] border px-3 py-2.5',
        highlight ? 'border-forest-200 bg-forest-50' : 'border-line bg-panel-muted',
      )}
    >
      <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-text-muted">
        <GitCompareArrows className="size-3" aria-hidden />
        {label}
      </p>
      <dl className="mt-1.5 space-y-1 text-[13px]">
        <div className="flex justify-between gap-3">
          <dt className="text-text-secondary">One-time</dt>
          <dd className="tabular font-medium">
            {formatMoney(evaluation.totals.oneTimeTotal, evaluation.currency)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text-secondary">Recurring (first cycle)</dt>
          <dd className="tabular font-medium">
            {formatMoney(evaluation.totals.recurringFirstCycleNet, evaluation.currency)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text-secondary">Overall discount</dt>
          <dd className="tabular font-medium">
            {formatMoney(evaluation.totals.totalDiscount, evaluation.currency)}
          </dd>
        </div>
      </dl>
    </div>
  )
}

function humaniseAction(action: string): string {
  const words = action.toLowerCase().replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export { GitCompareArrows }
