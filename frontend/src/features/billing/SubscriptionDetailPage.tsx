import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Repeat, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
  billing,
  CANCELLATION_POLICY_LABEL,
  catalog,
  keys,
  newIdempotencyKey,
  PRORATION_POLICY_LABEL,
  type CancellationPolicy,
  type PlanChangePreview,
  type Subscription,
  type SubscriptionChangePreview,
} from '@/api'
import { useAuth } from '@/auth/useAuth'
import { CATALOG_QUERY_OPTIONS } from '@/app/queryClient'
import {
  Badge,
  Button,
  DateInput,
  DetailRow,
  Dialog,
  Field,
  InlineError,
  Input,
  LoadingPanel,
  Panel,
  PanelHeader,
  PageHeader,
  PermissionBoundary,
  Section,
  Select,
  Spinner,
  StatusBadge,
  Textarea,
  subscriptionStatus,
  useDisclosure,
} from '@/design-system'
import { formatBusinessDate, todayAsBusinessDate } from '@/lib/dates'
import { formatMoney, formatQuantity } from '@/lib/money'

/**
 * One subscription, and the three things that can be done to it.
 *
 * The discipline this screen exists to enforce: **preview and confirmation use
 * the identical inputs.** Every change here is previewed first, the preview is
 * invalidated the instant any input changes, and the confirmation sends exactly
 * the body that produced the preview on screen. A slow earlier preview can never
 * be the one a user confirms against.
 *
 * There is no generic cancellation-preview endpoint in this API, so cancellation
 * states the policy and its known consequences rather than inventing a refund
 * figure in the browser.
 */
export default function SubscriptionDetailPage() {
  const { subscriptionId = '' } = useParams()
  const { me } = useAuth()
  const quantityDialog = useDisclosure()
  const planDialog = useDisclosure()
  const cancelDialog = useDisclosure()

  const subscription = useQuery({
    queryKey: keys.subscription(subscriptionId),
    queryFn: ({ signal }) => billing.subscription(subscriptionId, signal),
    enabled: Boolean(subscriptionId),
  })

  const invoices = useQuery({
    queryKey: keys.invoices({ customerId: subscription.data?.customerId ?? '', pageSize: 20 }),
    queryFn: ({ signal }) =>
      billing.invoices({ customerId: subscription.data!.customerId, pageSize: 20 }, signal),
    enabled: Boolean(subscription.data?.customerId),
  })

  if (subscription.isLoading && !subscription.data) return <LoadingPanel rows={6} />
  if (subscription.error) {
    return (
      <InlineError
        error={subscription.error}
        title="This subscription could not be opened"
        onRetry={() => void subscription.refetch()}
      />
    )
  }
  if (!subscription.data) return null

  const row = subscription.data
  const status = subscriptionStatus(row.status)
  const canChange = me?.role === 'FINANCE' || me?.role === 'ADMIN'
  const live = row.status === 'ACTIVE'

  const related = (invoices.data?.items ?? []).filter(
    (invoice) => invoice.subscriptionId === row.id,
  )

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Billing', to: `/admin/billing?customerId=${row.customerId}` },
          { label: row.reference },
        ]}
        eyebrow={row.customerName ?? undefined}
        title={row.planName ?? row.reference}
        meta={
          <>
            <span className="tabular text-[13px] text-text-secondary">{row.reference}</span>
            <StatusBadge label={status.label} tone={status.tone} size="sm" />
            <Badge tone="neutral" size="sm">
              {row.cadence}
            </Badge>
            <span className="text-[13px] text-text-secondary">
              Period {formatBusinessDate(row.periodStart)} – {formatBusinessDate(row.periodEnd)}
            </span>
          </>
        }
        actions={
          canChange ? (
            <>
              <Button
                variant="secondary"
                icon={<Repeat className="size-4" />}
                disabled={!live}
                disabledReason="Only an active subscription can change quantity."
                onClick={quantityDialog.show}
              >
                Change quantity
              </Button>
              <Button
                variant="secondary"
                icon={<CalendarClock className="size-4" />}
                disabled={!live}
                disabledReason="Only an active subscription can switch plan."
                onClick={planDialog.show}
              >
                Switch plan
              </Button>
              <Button
                variant="ghost"
                icon={<XCircle className="size-4" />}
                disabled={!live}
                disabledReason="This subscription is already ending or cancelled."
                onClick={cancelDialog.show}
              >
                Cancel
              </Button>
            </>
          ) : null
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Panel className="space-y-2">
            <PanelHeader
              title="Current terms"
              description="What is billed each period, and when the next one falls."
            />
            <dl className="divide-y divide-line">
              <DetailRow label="Plan">{row.planName ?? '—'}</DetailRow>
              <DetailRow label="Quantity">{formatQuantity(row.quantity)}</DetailRow>
              <DetailRow label="Price per interval">
                {formatMoney(row.unitIntervalPrice, row.currency)} per unit
              </DetailRow>
              <DetailRow label="Interval">
                Every {row.intervalMonths} month{row.intervalMonths === 1 ? '' : 's'} ·{' '}
                {row.cadence}
              </DetailRow>
              <DetailRow label="Activated">{formatBusinessDate(row.activationDate)}</DetailRow>
              <DetailRow label="Current period">
                {formatBusinessDate(row.periodStart)} – {formatBusinessDate(row.periodEnd)}
              </DetailRow>
              <DetailRow label="Next bill">{formatBusinessDate(row.nextBillAt)}</DetailRow>
              {row.cancelEffectiveDate ? (
                <DetailRow label="Ends">{formatBusinessDate(row.cancelEffectiveDate)}</DetailRow>
              ) : null}
            </dl>
          </Panel>

          <Section
            id="subscription-invoices"
            title="Invoices from this subscription"
            description="One per billed period, plus any mid-period adjustment."
          >
            {related.length === 0 ? (
              <Panel tone="muted" className="text-[13px] text-text-secondary">
                No invoice has been raised from this subscription yet.
              </Panel>
            ) : (
              <ul className="space-y-1.5">
                {related.map((invoice) => (
                  <li key={invoice.id}>
                    <Link
                      to={`/admin/invoices/${invoice.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[--radius-control] border border-line bg-panel px-3.5 py-2.5 transition-colors hover:bg-canvas-sunken"
                    >
                      <span className="min-w-0">
                        <span className="tabular block text-[13px] font-semibold text-text">
                          {invoice.reference}
                        </span>
                        <span className="block text-2xs text-text-muted">
                          Issued {formatBusinessDate(invoice.issueDate)}
                        </span>
                      </span>
                      <span className="tabular text-[13px] font-medium">
                        {formatMoney(invoice.total, invoice.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Panel className="space-y-2">
            <PanelHeader title="Policies" description="Set on the plan; they govern every change." />
            <div className="space-y-2.5">
              <div>
                <p className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
                  Mid-period change
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-text">
                  {PRORATION_POLICY_LABEL[row.prorationPolicy] ?? row.prorationPolicy}
                </p>
              </div>
              <div>
                <p className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
                  Cancellation
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-text">
                  {CANCELLATION_POLICY_LABEL[row.cancellationPolicy] ?? row.cancellationPolicy}
                </p>
              </div>
            </div>
          </Panel>

          <Panel className="space-y-2">
            <PanelHeader title="Reporting" />
            <dl className="divide-y divide-line">
              <DetailRow label="Monthly recurring revenue">
                {formatMoney(row.monthlyRecurringRevenue, row.currency)}
              </DetailRow>
            </dl>
            <p className="border-t border-line pt-3 text-[13px] leading-relaxed text-text-secondary">
              MRR normalises this subscription to a month so different cadences can be compared. It
              is never what gets invoiced — a yearly plan is billed yearly.
            </p>
          </Panel>

          <PermissionBoundary
            allowed={canChange}
            reason="Changing a subscription is limited to finance and administrators."
          >
            <Panel tone="muted" className="text-[13px] leading-relaxed text-text-secondary">
              Every change is previewed with its exact arithmetic before it is committed, and the
              confirmation sends the same inputs that produced the preview.
            </Panel>
          </PermissionBoundary>
        </div>
      </div>

      <QuantityChangeDialog
        open={quantityDialog.open}
        onOpenChange={quantityDialog.setOpen}
        subscription={row}
      />
      <PlanChangeDialog
        open={planDialog.open}
        onOpenChange={planDialog.setOpen}
        subscription={row}
      />
      <CancelDialog
        open={cancelDialog.open}
        onOpenChange={cancelDialog.setOpen}
        subscription={row}
      />
    </>
  )
}

/* ------------------------------------------------------- quantity change */

function QuantityChangeDialog({
  open,
  onOpenChange,
  subscription,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  subscription: Subscription
}) {
  const queryClient = useQueryClient()
  const [quantity, setQuantity] = useState(String(subscription.quantity))
  const [effectiveDate, setEffectiveDate] = useState<string | null>(todayAsBusinessDate())
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<SubscriptionChangePreview | null>(null)
  const [previewOf, setPreviewOf] = useState<string>('')

  // The body that both the preview and the confirmation send. Deriving them
  // from the same object is what guarantees they cannot differ.
  const body = useMemo(
    () => ({ newQuantity: quantity, effectiveDate, note: note.trim() || null }),
    [quantity, effectiveDate, note],
  )
  const bodyKey = JSON.stringify(body)

  // Any edit invalidates the preview immediately, so nothing stale is ever the
  // thing a user confirms against.
  useEffect(() => {
    if (previewOf && previewOf !== bodyKey) setPreview(null)
  }, [bodyKey, previewOf])

  useEffect(() => {
    if (open) {
      setQuantity(String(subscription.quantity))
      setEffectiveDate(todayAsBusinessDate())
      setNote('')
      setPreview(null)
      setPreviewOf('')
    }
  }, [open, subscription.quantity])

  const runPreview = useMutation({
    mutationFn: () => billing.previewQuantityChange(subscription.id, body),
    onSuccess: (result) => {
      setPreview(result)
      setPreviewOf(bodyKey)
    },
  })

  const apply = useMutation({
    mutationFn: () => billing.applyQuantityChange(subscription.id, body, newIdempotencyKey()),
    onSuccess: (result) => {
      toast.success('Quantity changed', {
        description:
          Number(result.adjustmentNet) >= 0
            ? `An extra charge of ${formatMoney(result.adjustmentNet, subscription.currency)} was raised.`
            : `A credit of ${formatMoney(String(Math.abs(Number(result.adjustmentNet))), subscription.currency)} was issued.`,
      })
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: keys.subscription(subscription.id) })
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'invoices'] })
    },
  })

  const stale = preview !== null && previewOf !== bodyKey
  const changed = Number(quantity) !== Number(subscription.quantity)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change the quantity"
      description={`Currently ${formatQuantity(subscription.quantity)} at ${formatMoney(subscription.unitIntervalPrice, subscription.currency)} per unit per period.`}
      size="lg"
      busy={apply.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={apply.isPending}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            busy={runPreview.isPending}
            disabled={!changed}
            disabledReason="Change the quantity first."
            onClick={() => runPreview.mutate()}
          >
            Preview the change
          </Button>
          <Button
            variant="primary"
            busy={apply.isPending}
            disabled={!preview || stale}
            disabledReason={
              stale
                ? 'The inputs changed. Preview again before confirming.'
                : 'Preview the change first.'
            }
            onClick={() => apply.mutate()}
          >
            Confirm this change
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New quantity" required>
            {(props) => (
              <Input
                {...props}
                type="number"
                step="0.001"
                min="0.001"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            )}
          </Field>
          <DateInput
            label="Effective from"
            hint="Must fall inside the current period and never before today — backdating is refused."
            value={effectiveDate}
            min={todayAsBusinessDate()}
            max={subscription.periodEnd ?? undefined}
            onChange={setEffectiveDate}
          />
        </div>

        <Field label="Note">
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>

        {runPreview.isPending ? (
          <div className="flex items-center gap-2 text-[13px] text-text-secondary">
            <Spinner /> Working out the proration…
          </div>
        ) : null}

        {runPreview.error ? <InlineError error={runPreview.error} /> : null}

        {preview ? (
          <div
            className={
              stale
                ? 'rounded-[--radius-panel] border border-wait-border bg-wait-surface p-4'
                : 'rounded-[--radius-panel] border border-line bg-panel-muted p-4'
            }
          >
            {stale ? (
              <p className="mb-3 text-[13px] font-semibold text-wait-text">
                These figures are for the earlier inputs. Preview again before confirming.
              </p>
            ) : null}
            <ProrationSummary preview={preview} currency={subscription.currency} />
          </div>
        ) : null}

        {apply.error ? <InlineError error={apply.error} title="Could not apply the change" /> : null}
      </div>
    </Dialog>
  )
}

function ProrationSummary({
  preview,
  currency,
}: {
  preview: SubscriptionChangePreview
  currency: string
}) {
  const charge = Number(preview.adjustmentNet)
  return (
    <>
      <dl className="divide-y divide-line">
        <DetailRow label="Effective from">{formatBusinessDate(preview.effectiveDate)}</DetailRow>
        <DetailRow label="Period">
          {formatBusinessDate(preview.periodStart)} – {formatBusinessDate(preview.periodEnd)}
        </DetailRow>
        <DetailRow label="Days remaining">
          {preview.remainingDays} of {preview.totalDays}
        </DetailRow>
        <DetailRow label="Quantity">
          {formatQuantity(preview.priorQuantity)} → {formatQuantity(preview.newQuantity)}
        </DetailRow>
        <DetailRow label={charge >= 0 ? 'Extra charge (net)' : 'Credit (net)'}>
          <span className={charge >= 0 ? 'font-semibold' : 'font-semibold text-ok-text'}>
            {formatMoney(preview.adjustmentNet, currency, { signed: true })}
          </span>
        </DetailRow>
        <DetailRow label="Tax on the adjustment">
          {formatMoney(preview.adjustmentTax, currency, { signed: true })}
        </DetailRow>
      </dl>
      <p className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-text-secondary">
        {preview.explanation}
      </p>
    </>
  )
}

/* ----------------------------------------------------------- plan change */

function PlanChangeDialog({
  open,
  onOpenChange,
  subscription,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  subscription: Subscription
}) {
  const queryClient = useQueryClient()
  const [newPlanId, setNewPlanId] = useState('')
  const [effectiveDate, setEffectiveDate] = useState<string | null>(todayAsBusinessDate())
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<PlanChangePreview | null>(null)
  const [previewOf, setPreviewOf] = useState('')

  const plans = useQuery({
    queryKey: keys.plans(),
    queryFn: ({ signal }) => catalog.plans(undefined, signal),
    enabled: open,
    ...CATALOG_QUERY_OPTIONS,
  })

  const body = useMemo(
    () => ({
      newPlanId,
      effectiveDate,
      note: note.trim() || null,
      expectedRowVersion: subscription.rowVersion,
    }),
    [newPlanId, effectiveDate, note, subscription.rowVersion],
  )
  const bodyKey = JSON.stringify(body)

  useEffect(() => {
    if (previewOf && previewOf !== bodyKey) setPreview(null)
  }, [bodyKey, previewOf])

  useEffect(() => {
    if (open) {
      setNewPlanId('')
      setEffectiveDate(todayAsBusinessDate())
      setNote('')
      setPreview(null)
      setPreviewOf('')
    }
  }, [open])

  const runPreview = useMutation({
    mutationFn: () => billing.previewPlanChange(subscription.id, body),
    onSuccess: (result) => {
      setPreview(result)
      setPreviewOf(bodyKey)
    },
  })

  const apply = useMutation({
    mutationFn: () => billing.applyPlanChange(subscription.id, body, newIdempotencyKey()),
    onSuccess: () => {
      toast.success('Plan switched')
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: keys.subscription(subscription.id) })
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'invoices'] })
    },
  })

  const stale = preview !== null && previewOf !== bodyKey

  // The service restricts a switch to an active plan on the same product and in
  // the same currency, so only those are offered rather than letting the server
  // reject the choice afterwards.
  const candidates = (plans.data ?? []).filter(
    (plan) =>
      plan.active && plan.id !== subscription.planId && plan.currency === subscription.currency,
  )

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Switch plan"
      description="Unused coverage on the current plan is credited and the new plan is charged from the effective date."
      size="lg"
      busy={apply.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={apply.isPending}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            busy={runPreview.isPending}
            disabled={!newPlanId}
            disabledReason="Choose the new plan first."
            onClick={() => runPreview.mutate()}
          >
            Preview the switch
          </Button>
          <Button
            variant="primary"
            busy={apply.isPending}
            disabled={!preview || stale}
            disabledReason={
              stale ? 'The inputs changed. Preview again.' : 'Preview the switch first.'
            }
            onClick={() => apply.mutate()}
          >
            Confirm the switch
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="New plan"
          required
          hint="Only active plans in the same currency are offered; the server restricts a switch to those."
        >
          {(props) => (
            <Select
              {...props}
              value={newPlanId}
              onChange={(event) => setNewPlanId(event.target.value)}
            >
              <option value="">Choose a plan…</option>
              {candidates.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} · {formatMoney(plan.intervalPrice, plan.currency)} every{' '}
                  {plan.intervalMonths} month{plan.intervalMonths === 1 ? '' : 's'}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <DateInput
          label="Effective from"
          value={effectiveDate}
          min={todayAsBusinessDate()}
          onChange={setEffectiveDate}
        />

        <Field label="Note">
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>

        {runPreview.isPending ? (
          <div className="flex items-center gap-2 text-[13px] text-text-secondary">
            <Spinner /> Working out the credit and the new charge…
          </div>
        ) : null}
        {runPreview.error ? <InlineError error={runPreview.error} /> : null}

        {preview ? (
          <div
            className={
              stale
                ? 'rounded-[--radius-panel] border border-wait-border bg-wait-surface p-4'
                : 'rounded-[--radius-panel] border border-line bg-panel-muted p-4'
            }
          >
            {stale ? (
              <p className="mb-3 text-[13px] font-semibold text-wait-text">
                These figures are for the earlier inputs. Preview again before confirming.
              </p>
            ) : null}
            <dl className="divide-y divide-line">
              <DetailRow label="New plan">{preview.newPlanName ?? '—'}</DetailRow>
              <DetailRow label="Effective from">
                {formatBusinessDate(preview.effectiveDate)}
              </DetailRow>
              <DetailRow label="Coverage credited to">
                {formatBusinessDate(preview.coverageEnd)}
              </DetailRow>
              <DetailRow label="Credit for unused coverage">
                <span className="text-ok-text">
                  {formatMoney(preview.oldCreditNet, subscription.currency)}
                </span>
              </DetailRow>
              <DetailRow label="Charge for the new plan">
                {formatMoney(preview.newChargeNet, subscription.currency)}
              </DetailRow>
              <DetailRow label="Billing interval">
                {preview.intervalChanged ? 'Changes with this switch' : 'Unchanged'}
              </DetailRow>
            </dl>
            <p className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-text-secondary">
              {preview.explanation}
            </p>
          </div>
        ) : null}

        {apply.error ? <InlineError error={apply.error} title="Could not switch the plan" /> : null}
      </div>
    </Dialog>
  )
}

/* --------------------------------------------------------------- cancel */

function CancelDialog({
  open,
  onOpenChange,
  subscription,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  subscription: Subscription
}) {
  const queryClient = useQueryClient()
  const [policy, setPolicy] = useState<CancellationPolicy>(subscription.cancellationPolicy)
  const [effectiveDate, setEffectiveDate] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const cancel = useMutation({
    mutationFn: () =>
      billing.cancelSubscription(
        subscription.id,
        { policy, effectiveDate, reason: reason.trim() || null },
        newIdempotencyKey(),
      ),
    onSuccess: (result) => {
      toast.success('Cancellation recorded', {
        description:
          Number(result.adjustmentNet) < 0
            ? `A credit of ${formatMoney(String(Math.abs(Number(result.adjustmentNet))), subscription.currency)} was issued for unused coverage.`
            : undefined,
      })
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: keys.subscription(subscription.id) })
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'credit-notes'] })
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cancel this subscription"
      description="What happens next depends on the policy below."
      busy={cancel.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={cancel.isPending}>
            Keep it running
          </Button>
          <Button variant="danger" busy={cancel.isPending} onClick={() => cancel.mutate()}>
            Cancel the subscription
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Policy" hint="Defaults to the policy set on the plan.">
          {(props) => (
            <Select
              {...props}
              value={policy}
              onChange={(event) => setPolicy(event.target.value as CancellationPolicy)}
            >
              <option value="END_OF_PERIOD">{CANCELLATION_POLICY_LABEL.END_OF_PERIOD}</option>
              <option value="IMMEDIATE_PRORATED">
                {CANCELLATION_POLICY_LABEL.IMMEDIATE_PRORATED}
              </option>
            </Select>
          )}
        </Field>

        <DateInput
          label="Effective date"
          hint="Leave empty to use the policy's own date."
          value={effectiveDate}
          min={todayAsBusinessDate()}
          onChange={setEffectiveDate}
        />

        <Field label="Reason">
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>

        <div className="rounded-[--radius-control] bg-canvas-sunken px-3 py-2.5 text-[13px] leading-relaxed text-text-secondary">
          <p className="font-medium text-text">What this will do</p>
          <p className="mt-1">
            {policy === 'END_OF_PERIOD'
              ? `Billing stops after ${formatBusinessDate(subscription.periodEnd)}. The current period is already paid for and is not refunded.`
              : 'Coverage stops on the effective date and a credit note is issued for the unused part of the current period.'}
          </p>
          <p className="mt-2">
            There is no cancellation preview endpoint on this API, so no refund figure is estimated
            here. The credit note produced by the cancellation is the authoritative amount.
          </p>
        </div>

        {cancel.error ? <InlineError error={cancel.error} /> : null}
      </div>
    </Dialog>
  )
}
