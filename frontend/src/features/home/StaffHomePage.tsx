import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  ClipboardCheck,
  HeartPulse,
  Plus,
  ScrollText,
  Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'

import {
  approvals as approvalsApi,
  health,
  keys,
  quotes as quotesApi,
  ROLE_LABEL,
  type Alert,
  type ApprovalQueueItem,
  type QuoteSummary,
} from '@/api'
import { can } from '@/auth/capabilities'
import { useAuth } from '@/auth/useAuth'
import {
  Badge,
  Button,
  EmptyState,
  InlineError,
  LoadingPanel,
  Panel,
  PanelHeader,
  PageHeader,
  RefreshingHint,
  Stat,
  StatusBadge,
  alertSeverity,
  alertType,
  approvalStatus,
  stageStatus,
} from '@/design-system'
import { formatRelative } from '@/lib/dates'
import { formatMoney } from '@/lib/money'

/**
 * What needs this person now.
 *
 * Deliberately not a business dashboard. Every figure here is scoped to what
 * this role can see and says so — "on this page", "your team" — because the
 * fastest way for a workspace to mislead is to present the first page of a
 * paged list as an organisation-wide total. Whole-business numbers live in
 * Reports, where the server computes them.
 */
export default function StaffHomePage() {
  const { me } = useAuth()

  const approvalQuery = { status: 'PENDING', pageSize: 5 }
  const pendingApprovals = useQuery({
    queryKey: keys.approvalQueue(approvalQuery),
    queryFn: ({ signal }) => approvalsApi.queue(approvalQuery, signal),
    enabled: Boolean(me),
  })

  const quoteQuery = { pageSize: 8, sort: 'updatedAt' }
  const recentQuotes = useQuery({
    queryKey: keys.quoteList(quoteQuery),
    queryFn: ({ signal }) => quotesApi.list(quoteQuery, signal),
    enabled: Boolean(me),
  })

  const alertQuery = { status: 'OPEN', pageSize: 5 }
  const openAlerts = useQuery({
    queryKey: keys.alerts(alertQuery),
    queryFn: ({ signal }) => health.alerts(alertQuery, signal),
    enabled: Boolean(me),
  })

  if (!me) return null

  const approvalItems = pendingApprovals.data?.items ?? []
  const actionable = approvalItems.filter((item) => item.actionable)
  const quotes = recentQuotes.data?.items ?? []
  const alerts = openAlerts.data?.items ?? []

  const greeting = me.fullName?.split(' ')[0] ?? ROLE_LABEL[me.role]

  return (
    <>
      <PageHeader
        eyebrow={ROLE_LABEL[me.role]}
        title={`Good to see you, ${greeting}`}
        description="Everything below is scoped to what your role and team can see. Organisation-wide figures are in Reports."
        meta={
          <RefreshingHint
            visible={pendingApprovals.isFetching || recentQuotes.isFetching || openAlerts.isFetching}
          />
        }
        actions={
          can(me, 'quotes:create') || me.role === 'ADMIN' ? (
            <Link
              to="/admin/quotes"
              className="inline-flex h-10 items-center gap-2 rounded-[--radius-control] bg-forest-500 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-forest-600"
            >
              <Plus className="size-4" aria-hidden />
              New quotation
            </Link>
          ) : null
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Waiting on you"
          value={actionable.length}
          scope="Approval steps you can decide now"
          tone={actionable.length > 0 ? 'brass' : 'default'}
        />
        <Stat
          label="Pending steps in view"
          value={pendingApprovals.data?.totalItems ?? '—'}
          scope="Including steps blocked by an earlier one"
        />
        <Stat
          label="Open deal alerts"
          value={openAlerts.data?.totalItems ?? '—'}
          scope="Stalled deals, overdue approvals, stock and invoices"
        />
        <Stat
          label="Quotations in view"
          value={recentQuotes.data?.totalItems ?? '—'}
          scope={me.role === 'REP' || me.role === 'MANAGER' ? 'Your team' : 'All you can see'}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ------------------------------------------------------ approvals */}
        <Panel flush className="overflow-hidden">
          <PanelHeader
            className="border-b border-line px-5 py-4"
            title="Approvals"
            description={
              me.role === 'FINANCE'
                ? 'Step 2. A step stays locked until the manager approves step 1.'
                : 'Steps raised because a version breached the discount policy.'
            }
            actions={
              <Link
                to="/admin/approvals"
                className="inline-flex items-center gap-1 text-[13px] font-medium text-forest-600 hover:underline"
              >
                All approvals
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            }
          />
          {pendingApprovals.isLoading ? (
            <LoadingPanel rows={3} className="border-0 shadow-none" />
          ) : pendingApprovals.error ? (
            <div className="p-4">
              <InlineError
                error={pendingApprovals.error}
                onRetry={() => void pendingApprovals.refetch()}
              />
            </div>
          ) : approvalItems.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck className="size-5" aria-hidden />}
              title="Nothing pending"
              description="A quotation inside policy never creates an approval step, so an empty queue usually means the deals are simply within their ceilings."
            />
          ) : (
            <ul className="divide-y divide-line">
              {approvalItems.map((item) => (
                <ApprovalRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </Panel>

        {/* --------------------------------------------------------- alerts */}
        <Panel flush className="overflow-hidden">
          <PanelHeader
            className="border-b border-line px-5 py-4"
            title="Deal health"
            description="Raised by the health sweep against real records."
            actions={
              <Link
                to="/admin/health"
                className="inline-flex items-center gap-1 text-[13px] font-medium text-forest-600 hover:underline"
              >
                All alerts
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            }
          />
          {openAlerts.isLoading ? (
            <LoadingPanel rows={3} className="border-0 shadow-none" />
          ) : openAlerts.error ? (
            <div className="p-4">
              <InlineError error={openAlerts.error} onRetry={() => void openAlerts.refetch()} />
            </div>
          ) : alerts.length === 0 ? (
            <EmptyState
              icon={<HeartPulse className="size-5" aria-hidden />}
              title="Nothing flagged"
              description="Stalled deals, overdue approvals, low stock and overdue invoices appear here when the sweep finds them."
            />
          ) : (
            <ul className="divide-y divide-line">
              {alerts.map((alert) => (
                <AlertRow key={alert.id} alert={alert} />
              ))}
            </ul>
          )}
        </Panel>

        {/* --------------------------------------------------------- quotes */}
        <Panel flush className="overflow-hidden lg:col-span-2">
          <PanelHeader
            className="border-b border-line px-5 py-4"
            title="Recently active quotations"
            description="Most recently updated first."
            actions={
              <Link
                to="/admin/quotes"
                className="inline-flex items-center gap-1 text-[13px] font-medium text-forest-600 hover:underline"
              >
                Open the pipeline
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            }
          />
          {recentQuotes.isLoading ? (
            <LoadingPanel rows={4} className="border-0 shadow-none" />
          ) : recentQuotes.error ? (
            <div className="p-4">
              <InlineError error={recentQuotes.error} onRetry={() => void recentQuotes.refetch()} />
            </div>
          ) : quotes.length === 0 ? (
            <EmptyState
              icon={<ScrollText className="size-5" aria-hidden />}
              title="No quotations yet"
              description="Start one from the pipeline, or wait for a customer to request one from the catalogue."
              action={
                <Button variant="primary" size="sm">
                  <Link to="/admin/quotes">Open the pipeline</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {quotes.map((quote) => (
                <QuoteRow key={quote.id} quote={quote} />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel tone="muted" className="mt-6">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-brass-500" aria-hidden />
          <p className="text-[13px] leading-relaxed text-text-secondary">
            The assistant at the bottom right reads whatever screen you are on and explains it — why
            a version needs approval, what is blocking a deal, what a subscription change would
            cost. It cannot approve, send or change anything.
          </p>
        </div>
      </Panel>
    </>
  )
}

/* ------------------------------------------------------------------- rows */

function ApprovalRow({ item }: { item: ApprovalQueueItem }) {
  const status = approvalStatus(item.status)
  return (
    <li>
      <Link
        to={`/admin/quotes/${item.quoteId}`}
        className="flex items-start justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-canvas-sunken"
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular text-[13px] font-semibold text-text">
              {item.quoteReference}
            </span>
            <Badge tone="neutral" size="sm">
              Step {item.step}
            </Badge>
            {!item.actionable ? (
              <Badge tone="neutral" size="sm">
                Waiting on step 1
              </Badge>
            ) : null}
            {item.overdue ? (
              <Badge tone="stop" size="sm">
                Overdue
              </Badge>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-text-secondary">
            {item.customerName} · {item.reasons[0]?.message ?? status.label}
          </span>
        </span>
        <span className="tabular shrink-0 text-[13px] font-medium">
          {formatMoney(item.oneTimeNet, item.currency)}
        </span>
      </Link>
    </li>
  )
}

function AlertRow({ alert }: { alert: Alert }) {
  const severity = alertSeverity(alert.severity)
  const target = alert.quoteId
    ? `/admin/quotes/${alert.quoteId}`
    : alert.orderId
      ? `/admin/orders/${alert.orderId}`
      : '/admin/health'
  return (
    <li>
      <Link
        to={target}
        className="flex items-start justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-canvas-sunken"
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-text">{alert.title}</span>
            <StatusBadge label={severity.label} tone={severity.tone} size="sm" withIcon={false} />
          </span>
          <span className="mt-0.5 block text-2xs text-text-muted">
            {alertType(alert.alertType)} · first seen {formatRelative(alert.firstSeenAt)}
          </span>
        </span>
      </Link>
    </li>
  )
}

function QuoteRow({ quote }: { quote: QuoteSummary }) {
  const stage = stageStatus(quote.stage)
  const approval = approvalStatus(quote.approvalStatus)
  return (
    <li>
      <Link
        to={`/admin/quotes/${quote.id}`}
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-canvas-sunken"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular text-[13px] font-semibold text-text">{quote.reference}</span>
            <StatusBadge label={stage.label} tone={stage.tone} size="sm" withIcon={false} />
            <Badge tone={approval.tone} size="sm">
              {approval.label}
            </Badge>
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-text-secondary">
            {quote.customerName}
            {quote.title ? ` · ${quote.title}` : ''} · updated{' '}
            {formatRelative(quote.lastActivityAt)}
          </span>
        </span>
        <span className="tabular shrink-0 text-[13px] font-medium">
          {formatMoney(quote.oneTimeNet, quote.currency)}
        </span>
      </Link>
    </li>
  )
}
