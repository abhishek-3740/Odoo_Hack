import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, HeartPulse, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { ALERT_TYPE_LABEL, health, keys, type Alert } from '@/api'
import { canSweepAlerts } from '@/auth/capabilities'
import { useAuth } from '@/auth/useAuth'
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  FilterBar,
  InlineError,
  LoadingPanel,
  Panel,
  PageHeader,
  Pagination,
  RefreshingHint,
  Select,
  StatusBadge,
  Textarea,
  alertSeverity,
} from '@/design-system'
import { formatRelative, formatTimestamp } from '@/lib/dates'

import { describeReason } from './reasons'

const TYPES = Object.keys(ALERT_TYPE_LABEL)

/**
 * Deal health.
 *
 * Each alert is raised by the server's sweep against a real record and names it,
 * so every row links to the thing that is actually wrong. A nudge sends a real
 * notification to the record's owner — it is not a UI-only acknowledgement.
 */
export default function HealthPage() {
  const { me } = useAuth()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('OPEN')
  const [type, setType] = useState('')
  const [page, setPage] = useState(0)
  const [nudging, setNudging] = useState<Alert | null>(null)

  const query = { status, type: type || undefined, page, pageSize: 25 }
  const alerts = useQuery({
    queryKey: keys.alerts(query),
    queryFn: ({ signal }) => health.alerts(query, signal),
  })

  const sweep = useMutation({
    mutationFn: () => health.sweep(),
    onSuccess: (result) => {
      toast.success('Health sweep finished', {
        description: `${result.open} open, ${result.resolved} resolved.`,
      })
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'alerts'] })
    },
  })

  const rows = alerts.data?.items ?? []

  return (
    <>
      <PageHeader
        title="Deal health"
        description="Stalled quotations, unusual discounts, overdue approvals, slipping deliveries, low stock and overdue invoices — found by the server's sweep, not guessed here."
        meta={<RefreshingHint visible={alerts.isFetching && !alerts.isLoading} />}
        actions={
          canSweepAlerts(me) ? (
            <Button
              variant="secondary"
              icon={<RefreshCw className="size-4" />}
              busy={sweep.isPending}
              onClick={() => sweep.mutate()}
            >
              Run the sweep now
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <div className="w-44 space-y-1.5">
          <label htmlFor="alert-status" className="block text-[13px] font-medium text-text">
            Status
          </label>
          <Select
            id="alert-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              setPage(0)
            }}
          >
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
            <option value="ALL">All</option>
          </Select>
        </div>

        <div className="w-60 space-y-1.5">
          <label htmlFor="alert-type" className="block text-[13px] font-medium text-text">
            Type
          </label>
          <Select
            id="alert-type"
            value={type}
            onChange={(event) => {
              setType(event.target.value)
              setPage(0)
            }}
          >
            <option value="">Every type</option>
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {ALERT_TYPE_LABEL[value]}
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>

      {alerts.isLoading && !alerts.data ? (
        <LoadingPanel rows={5} />
      ) : alerts.error ? (
        <InlineError error={alerts.error} onRetry={() => void alerts.refetch()} />
      ) : rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<HeartPulse className="size-5" aria-hidden />}
            title={status === 'OPEN' ? 'Nothing is flagged' : 'Nothing here'}
            description="The sweep runs on a schedule and can be run on demand. An empty list means it found nothing, not that it did not run."
          />
        </Panel>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((alert) => (
            <AlertCard key={alert.id} alert={alert} onNudge={() => setNudging(alert)} />
          ))}
        </ul>
      )}

      {alerts.data ? (
        <Pagination
          page={alerts.data.page}
          pageSize={alerts.data.pageSize}
          totalItems={alerts.data.totalItems}
          totalPages={alerts.data.totalPages}
          busy={alerts.isFetching}
          onPageChange={setPage}
        />
      ) : null}

      {sweep.error ? (
        <InlineError className="mt-4" error={sweep.error} title="The sweep could not run" />
      ) : null}

      <NudgeDialog alert={nudging} onClose={() => setNudging(null)} />
    </>
  )
}

function AlertCard({ alert, onNudge }: { alert: Alert; onNudge: () => void }) {
  const severity = alertSeverity(alert.severity)
  // The API promises an array, but a single object must not silently vanish.
  const rawReasons: unknown[] = Array.isArray(alert.reasons)
    ? alert.reasons
    : alert.reasons == null
      ? []
      : [alert.reasons]
  const reasons = rawReasons.map(describeReason)
  const target = alert.quoteId
    ? `/admin/quotes/${alert.quoteId}`
    : alert.orderId
      ? `/admin/orders/${alert.orderId}`
      : alert.invoiceId
        ? `/admin/invoices/${alert.invoiceId}`
        : alert.subscriptionId
          ? `/admin/subscriptions/${alert.subscriptionId}`
          : null

  return (
    <li>
      <Panel className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-semibold text-text">{alert.title}</span>
              <StatusBadge label={severity.label} tone={severity.tone} size="sm" withIcon={false} />
              <Badge tone="neutral" size="sm">
                {ALERT_TYPE_LABEL[alert.alertType] ?? alert.alertType}
              </Badge>
              {alert.status === 'RESOLVED' ? (
                <Badge tone="ok" size="sm">
                  Resolved
                </Badge>
              ) : null}
            </p>
            <p className="mt-1 text-2xs text-text-muted">
              First seen {formatRelative(alert.firstSeenAt)} · last seen{' '}
              {formatTimestamp(alert.lastSeenAt)}
              {alert.nudgeCount > 0
                ? ` · nudged ${alert.nudgeCount} time${alert.nudgeCount === 1 ? '' : 's'}`
                : ''}
            </p>
          </div>

          <div className="flex shrink-0 gap-2">
            {target ? (
              <Link
                to={target}
                className="inline-flex h-9 items-center rounded-[--radius-control] border border-line-strong bg-panel px-3 text-[13px] font-semibold text-text transition-colors hover:bg-canvas-sunken"
              >
                Open the record
              </Link>
            ) : null}
            {alert.status === 'OPEN' ? (
              <Button
                size="sm"
                variant="secondary"
                icon={<BellRing className="size-3.5" />}
                onClick={onNudge}
              >
                Nudge the owner
              </Button>
            ) : null}
          </div>
        </div>

        {reasons.length > 0 ? (
          <ul className="divide-y divide-line rounded-[--radius-control] bg-canvas-sunken px-3.5">
            {reasons.map((reason, index) => (
              <li key={index} className="py-2.5 text-[13px] leading-relaxed">
                <p className="text-text">{reason.message}</p>
                {reason.details.length > 0 ? (
                  <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-2xs">
                    {reason.details.map((detail, detailIndex) => (
                      <div key={`${detail.label}-${detailIndex}`} className="flex items-baseline gap-1">
                        <dt className="text-text-muted">{detail.label}</dt>
                        <dd className="tabular font-medium text-text-secondary">{detail.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>
    </li>
  )
}

function NudgeDialog({ alert, onClose }: { alert: Alert | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')

  const nudge = useMutation({
    mutationFn: () => health.nudge(alert!.id, message.trim() || undefined),
    onSuccess: () => {
      toast.success('Nudge sent', {
        description: 'The record owner has a real notification in their inbox.',
      })
      setMessage('')
      onClose()
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'alerts'] })
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'notifications'] })
    },
  })

  return (
    <Dialog
      open={alert !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Nudge the owner"
      description="Sends a notification to whoever owns the record this alert is about."
      busy={nudge.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={nudge.isPending}>
            Cancel
          </Button>
          <Button variant="primary" busy={nudge.isPending} onClick={() => nudge.mutate()}>
            Send the nudge
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {alert ? (
          <p className="rounded-[--radius-control] bg-canvas-sunken px-3 py-2.5 text-[13px] text-text">
            {alert.title}
          </p>
        ) : null}
        <Field label="Message" hint="Optional. Without one the notification uses the alert's own wording.">
          {(props) => (
            <Textarea
              {...props}
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="e.g. Customer chased this again today."
            />
          )}
        </Field>
        {nudge.error ? <InlineError error={nudge.error} /> : null}
      </div>
    </Dialog>
  )
}
