import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PackageCheck, RefreshCw, SlidersHorizontal, Truck, Warehouse } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
  ALLOCATION_MODE_LABEL,
  BACKORDER_TERMS_LABEL,
  billing,
  fulfillment,
  keys,
  ORDER_BILLING_STATUS_LABEL,
  orders as ordersApi,
  type AllocationPlan,
  type Shipment,
} from '@/api'
import { useAuth } from '@/auth/useAuth'
import {
  Badge,
  Button,
  DataTable,
  DetailRow,
  Dialog,
  EmptyState,
  Field,
  InlineError,
  Input,
  LoadingPanel,
  Panel,
  PanelHeader,
  PageHeader,
  RefreshingHint,
  Section,
  StatusBadge,
  TabPanel,
  Tabs,
  Textarea,
  fulfillmentStatus,
  invoiceStatus,
  shipmentStatus,
  useDisclosure,
} from '@/design-system'
import { formatBusinessDate, formatTimestamp } from '@/lib/dates'
import { formatBasisPoints, formatMoney, formatQuantity } from '@/lib/money'

import { AllocationOverrideDialog } from './AllocationOverrideDialog'

/**
 * One confirmed order: its exact accepted terms, its stock and its billing.
 *
 * The terms are read-only by construction — they are what the customer
 * accepted, and changing them after the fact would make the acceptance
 * meaningless. Everything actionable here is downstream: allocate, re-plan,
 * dispatch, invoice.
 */
export default function OrderDetailPage() {
  const { orderId = '' } = useParams()
  const { me } = useAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('terms')
  const override = useDisclosure()

  const order = useQuery({
    queryKey: keys.order(orderId),
    queryFn: ({ signal }) => ordersApi.get(orderId, signal),
    enabled: Boolean(orderId),
  })

  const allocation = useQuery({
    queryKey: keys.orderAllocation(orderId),
    queryFn: ({ signal }) => fulfillment.allocation(orderId, signal),
    enabled: Boolean(orderId),
  })

  const status = useQuery({
    queryKey: keys.orderFulfillment(orderId),
    queryFn: ({ signal }) => fulfillment.status(orderId, signal),
    enabled: Boolean(orderId),
  })

  const invoices = useQuery({
    queryKey: keys.invoices({ orderId }),
    queryFn: ({ signal }) => billing.invoices({ orderId }, signal),
    enabled: Boolean(orderId),
  })

  const subscriptions = useQuery({
    queryKey: keys.subscriptions({ orderId }),
    queryFn: ({ signal }) => billing.subscriptions({ orderId }, signal),
    enabled: Boolean(orderId),
  })

  const replan = useMutation({
    mutationFn: () => fulfillment.replan(orderId),
    onSuccess: () => {
      toast.success('Re-planned', {
        description: 'Unshipped quantities were re-allocated into the parcels already open.',
      })
      void queryClient.invalidateQueries({ queryKey: keys.order(orderId) })
      void queryClient.invalidateQueries({ queryKey: keys.orderAllocation(orderId) })
      void queryClient.invalidateQueries({ queryKey: keys.orderFulfillment(orderId) })
    },
  })

  if (order.isLoading && !order.data) return <LoadingPanel rows={6} />
  if (order.error) {
    return (
      <InlineError
        error={order.error}
        title="This order could not be opened"
        onRetry={() => void order.refetch()}
      />
    )
  }
  if (!order.data) return null

  const row = order.data
  const fulfil = fulfillmentStatus(row.fulfillmentStatus)
  const canOperate = me?.role === 'FINANCE' || me?.role === 'ADMIN'
  const physical = row.lines.some((line) => line.requiresStock)

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Orders', to: '/admin/orders' }, { label: row.reference }]}
        eyebrow={row.customerName ?? undefined}
        title={row.reference}
        meta={
          <>
            <StatusBadge label={fulfil.label} tone={fulfil.tone} size="sm" />
            <Badge tone={row.billingStatus === 'INITIALIZED' ? 'ok' : 'wait'} size="sm">
              {ORDER_BILLING_STATUS_LABEL[row.billingStatus] ?? row.billingStatus}
            </Badge>
            <Badge tone="neutral" size="sm">
              {BACKORDER_TERMS_LABEL[row.backorderTerms] ?? row.backorderTerms}
            </Badge>
            <span className="text-[13px] text-text-secondary">
              Confirmed {formatTimestamp(row.confirmedAt)}
            </span>
            <RefreshingHint visible={order.isFetching && !order.isLoading} />
          </>
        }
        actions={
          <Link
            to={`/admin/quotes/${row.quoteId}`}
            className="inline-flex h-10 items-center rounded-[--radius-control] border border-line-strong bg-panel px-3.5 text-[13px] font-semibold text-text transition-colors hover:bg-canvas-sunken"
          >
            Open the quotation
          </Link>
        }
      />

      <Tabs
        label="Order sections"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'terms', label: 'Accepted terms' },
          {
            value: 'fulfilment',
            label: 'Fulfilment',
            disabled: !physical,
            disabledReason: 'This order has no physical lines, so nothing is allocated or shipped.',
          },
          { value: 'billing', label: 'Billing' },
        ]}
      >
        {/* ------------------------------------------------------- terms */}
        <TabPanel value="terms">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0">
              <DataTable
                caption="Accepted order lines"
                rows={row.lines}
                rowKey={(line) => line.id}
                columns={[
                  {
                    id: 'description',
                    header: 'Item',
                    cell: (line) => (
                      <span>
                        <span className="block font-medium text-text">{line.description}</span>
                        <span className="block text-2xs text-text-muted">
                          {line.lineKind === 'RECURRING'
                            ? `Recurring · every ${line.intervalMonths} month${line.intervalMonths === 1 ? '' : 's'}`
                            : 'One-time'}
                          {line.requiresStock ? ' · needs stock' : ''}
                        </span>
                      </span>
                    ),
                  },
                  {
                    id: 'quantity',
                    header: 'Qty',
                    align: 'right',
                    cell: (line) => formatQuantity(line.quantity),
                  },
                  {
                    id: 'unit',
                    header: 'Unit price',
                    align: 'right',
                    cell: (line) => formatMoney(line.unitPrice, row.currency),
                  },
                  {
                    id: 'discount',
                    header: 'Discount',
                    align: 'right',
                    hideBelow: 'md',
                    cell: (line) => formatBasisPoints(line.effectiveDiscountBp),
                  },
                  {
                    id: 'net',
                    header: 'Net',
                    align: 'right',
                    cell: (line) => formatMoney(line.net, row.currency),
                  },
                  {
                    id: 'tax',
                    header: 'Tax',
                    align: 'right',
                    hideBelow: 'lg',
                    cell: (line) => formatMoney(line.tax, row.currency),
                  },
                  {
                    id: 'promised',
                    header: 'Promised',
                    hideBelow: 'xl',
                    cell: (line) => formatBusinessDate(line.promisedDate),
                  },
                ]}
              />
            </div>

            <Panel className="h-fit space-y-2">
              <PanelHeader title="Order" />
              <dl className="divide-y divide-line">
                <DetailRow label="One-time net">
                  {formatMoney(row.oneTimeNet, row.currency)}
                </DetailRow>
                <DetailRow label="One-time tax">
                  {formatMoney(row.oneTimeTax, row.currency)}
                </DetailRow>
                <DetailRow label="Currency">{row.currency}</DetailRow>
                <DetailRow label="Status">{row.orderStatus}</DetailRow>
              </dl>
              <p className="border-t border-line pt-3 text-[13px] leading-relaxed text-text-secondary">
                These are the exact terms the customer accepted. They are read-only — a change would
                make the acceptance meaningless.
              </p>
            </Panel>
          </div>
        </TabPanel>

        {/* -------------------------------------------------- fulfilment */}
        <TabPanel value="fulfilment">
          <div className="space-y-6">
            <Section
              id="allocation"
              title="Warehouse allocation"
              description={
                allocation.data?.preview
                  ? 'A preview. Nothing is reserved until the order is allocated.'
                  : 'What is actually reserved for this order.'
              }
              actions={
                canOperate ? (
                  <>
                    {status.data?.replanSuggested ? (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<RefreshCw className="size-3.5" />}
                        busy={replan.isPending}
                        onClick={() => replan.mutate()}
                      >
                        Re-plan with new stock
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<SlidersHorizontal className="size-3.5" />}
                      onClick={override.show}
                    >
                      Allocate by hand
                    </Button>
                  </>
                ) : null
              }
            >
              {allocation.isLoading ? (
                <LoadingPanel rows={3} />
              ) : allocation.error ? (
                <InlineError error={allocation.error} onRetry={() => void allocation.refetch()} />
              ) : allocation.data ? (
                <AllocationView plan={allocation.data} currency={row.currency} />
              ) : null}
            </Section>

            <Section
              id="shipments"
              title="Shipments"
              description="Dispatched quantities are protected by the server and cannot be re-allocated."
            >
              {status.isLoading ? (
                <LoadingPanel rows={2} />
              ) : status.error ? (
                <InlineError error={status.error} onRetry={() => void status.refetch()} />
              ) : (status.data?.shipments ?? []).length === 0 ? (
                <Panel>
                  <EmptyState
                    icon={<Truck className="size-5" aria-hidden />}
                    title="Nothing packed yet"
                    description="A shipment appears once stock has been reserved for this order."
                  />
                </Panel>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {(status.data?.shipments ?? []).map((shipment) => (
                    <ShipmentCard
                      key={shipment.id}
                      shipment={shipment}
                      currency={row.currency}
                      canDispatch={canOperate}
                      orderId={orderId}
                    />
                  ))}
                </div>
              )}
            </Section>

            {(status.data?.backorders ?? []).length > 0 ? (
              <Section
                id="backorders"
                title="Backorders"
                description="Quantities that could not be reserved. A date is shown only when a real receipt is expected."
              >
                <DataTable
                  caption="Backordered lines"
                  rows={status.data?.backorders ?? []}
                  rowKey={(backorder) => backorder.id}
                  columns={[
                    {
                      id: 'description',
                      header: 'Item',
                      cell: (backorder) => backorder.description ?? '—',
                    },
                    {
                      id: 'quantity',
                      header: 'Quantity',
                      align: 'right',
                      cell: (backorder) => formatQuantity(backorder.quantity),
                    },
                    {
                      id: 'expected',
                      header: 'Expected',
                      cell: (backorder) =>
                        backorder.expectedDate ? (
                          formatBusinessDate(backorder.expectedDate)
                        ) : (
                          <span className="text-text-muted">Unconfirmed</span>
                        ),
                    },
                    {
                      id: 'status',
                      header: 'Status',
                      cell: (backorder) => (
                        <Badge
                          tone={
                            backorder.status === 'RESOLVED'
                              ? 'ok'
                              : backorder.consolidationAvailable
                                ? 'info'
                                : 'wait'
                          }
                          size="sm"
                        >
                          {backorder.consolidationAvailable
                            ? 'Stock now available'
                            : backorder.status === 'OPEN'
                              ? 'Open'
                              : backorder.status}
                        </Badge>
                      ),
                    },
                  ]}
                />
              </Section>
            ) : null}

            {replan.error ? <InlineError error={replan.error} title="Could not re-plan" /> : null}

            <AllocationOverrideDialog
              open={override.open}
              onOpenChange={override.setOpen}
              order={row}
              plan={allocation.data}
            />
          </div>
        </TabPanel>

        {/* ----------------------------------------------------- billing */}
        <TabPanel value="billing">
          <div className="space-y-6">
            <Section
              id="order-invoices"
              title="Invoices"
              description="Raised from this order's one-time lines and from each recurring period."
            >
              <DataTable
                caption="Invoices for this order"
                rows={invoices.data?.items ?? []}
                rowKey={(invoice) => invoice.id}
                loading={invoices.isLoading}
                error={invoices.error ? <InlineError error={invoices.error} /> : undefined}
                empty={
                  <EmptyState
                    icon={<PackageCheck className="size-5" aria-hidden />}
                    title="Not invoiced yet"
                    description="Invoicing runs when the order is finalised or when a subscription period is billed."
                  />
                }
                columns={[
                  {
                    id: 'reference',
                    header: 'Invoice',
                    cell: (invoice) => (
                      <Link
                        to={`/admin/invoices/${invoice.id}`}
                        className="tabular font-semibold text-forest-700 hover:underline"
                      >
                        {invoice.reference}
                      </Link>
                    ),
                  },
                  {
                    id: 'status',
                    header: 'Status',
                    cell: (invoice) => {
                      const presentation = invoiceStatus(invoice.status)
                      return (
                        <StatusBadge
                          label={presentation.label}
                          tone={presentation.tone}
                          size="sm"
                        />
                      )
                    },
                  },
                  {
                    id: 'issued',
                    header: 'Issued',
                    hideBelow: 'md',
                    cell: (invoice) => formatBusinessDate(invoice.issueDate),
                  },
                  {
                    id: 'total',
                    header: 'Total',
                    align: 'right',
                    cell: (invoice) => formatMoney(invoice.total, invoice.currency),
                  },
                  {
                    id: 'outstanding',
                    header: 'Outstanding',
                    align: 'right',
                    cell: (invoice) => formatMoney(invoice.outstanding, invoice.currency),
                  },
                ]}
              />
            </Section>

            {(subscriptions.data ?? []).length > 0 ? (
              <Section
                id="order-subscriptions"
                title="Subscriptions"
                description="Started by the recurring lines on this order."
              >
                <DataTable
                  caption="Subscriptions from this order"
                  rows={subscriptions.data ?? []}
                  rowKey={(sub) => sub.id}
                  columns={[
                    {
                      id: 'reference',
                      header: 'Subscription',
                      cell: (sub) => (
                        <Link
                          to={`/admin/subscriptions/${sub.id}`}
                          className="tabular font-semibold text-forest-700 hover:underline"
                        >
                          {sub.reference}
                        </Link>
                      ),
                    },
                    { id: 'plan', header: 'Plan', cell: (sub) => sub.planName ?? '—' },
                    { id: 'cadence', header: 'Cadence', cell: (sub) => sub.cadence },
                    {
                      id: 'period',
                      header: 'Current period',
                      hideBelow: 'md',
                      cell: (sub) =>
                        `${formatBusinessDate(sub.periodStart)} – ${formatBusinessDate(sub.periodEnd)}`,
                    },
                    {
                      id: 'mrr',
                      header: 'MRR',
                      align: 'right',
                      cell: (sub) => formatMoney(sub.monthlyRecurringRevenue, sub.currency),
                    },
                  ]}
                />
              </Section>
            ) : null}
          </div>
        </TabPanel>
      </Tabs>
    </>
  )
}

/* --------------------------------------------------------------- allocation */

function AllocationView({ plan, currency }: { plan: AllocationPlan; currency: string }) {
  // Grouped by warehouse, because that is how someone picking the goods thinks
  // about it — one column per place they have to walk to.
  const byWarehouse = new Map<string, AllocationPlan['allocations']>()
  for (const line of plan.allocations) {
    const list = byWarehouse.get(line.warehouseId) ?? []
    list.push(line)
    byWarehouse.set(line.warehouseId, list)
  }

  return (
    <div className="space-y-4">
      <Panel className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-2xs uppercase tracking-wide text-text-muted">Plan</p>
          <p className="mt-0.5 text-[13px] font-medium text-text">
            {ALLOCATION_MODE_LABEL[plan.mode] ?? plan.mode}
          </p>
        </div>
        <div>
          <p className="text-2xs uppercase tracking-wide text-text-muted">Parcels</p>
          <p className="tabular mt-0.5 text-[13px] font-medium">{plan.shipmentCount}</p>
        </div>
        <div>
          <p className="text-2xs uppercase tracking-wide text-text-muted">Estimated shipping</p>
          <p className="tabular mt-0.5 text-[13px] font-medium">
            {formatMoney(plan.estimatedShippingCost, currency)}
          </p>
        </div>
        <div>
          <p className="text-2xs uppercase tracking-wide text-text-muted">Coverage</p>
          <p className="mt-0.5">
            <Badge tone={plan.fullyFulfilled ? 'ok' : 'wait'} size="sm">
              {plan.fullyFulfilled ? 'Fully covered' : 'Partly short'}
            </Badge>
          </p>
        </div>
      </Panel>

      {!plan.exhaustive ? (
        <Panel tone="muted" className="text-[13px] leading-relaxed text-text-secondary">
          There are more warehouses than the exhaustive search covers, so this is the best plan
          found rather than a proof that no cheaper split exists.
        </Panel>
      ) : null}

      {byWarehouse.size === 0 ? (
        <Panel>
          <EmptyState
            icon={<Warehouse className="size-5" aria-hidden />}
            title="Nothing allocated"
            description="No warehouse currently covers any line on this order."
          />
        </Panel>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[...byWarehouse.entries()].map(([warehouseId, lines]) => (
            <Panel key={warehouseId} className="space-y-2">
              <PanelHeader
                as="h4"
                title={lines[0]?.warehouseName ?? 'Warehouse'}
                description={lines[0]?.warehouseCode}
              />
              <ul className="space-y-1">
                {lines.map((line) => (
                  <li
                    key={`${line.orderLineId}-${line.warehouseId}`}
                    className="flex items-baseline justify-between gap-3 text-[13px]"
                  >
                    <span className="min-w-0 flex-1 truncate text-text">{line.description}</span>
                    <span className="tabular font-medium">{formatQuantity(line.quantity)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}

      {plan.shortages.length > 0 ? (
        <Panel className="space-y-2 border-wait-border bg-wait-surface">
          <PanelHeader
            as="h4"
            title="Short on stock"
            description="These quantities cannot be reserved from anywhere right now."
          />
          <ul className="space-y-1">
            {plan.shortages.map((shortage) => (
              <li
                key={shortage.orderLineId}
                className="flex flex-wrap items-baseline justify-between gap-2 text-[13px] text-wait-text"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{shortage.description}</span>
                <span className="tabular">
                  {formatQuantity(shortage.quantity)} short ·{' '}
                  {shortage.expectedDate
                    ? `expected ${formatBusinessDate(shortage.expectedDate)}`
                    : 'no expected date'}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  )
}

/* ---------------------------------------------------------------- shipment */

function ShipmentCard({
  shipment,
  currency,
  canDispatch,
  orderId,
}: {
  shipment: Shipment
  currency: string
  canDispatch: boolean
  orderId: string
}) {
  const queryClient = useQueryClient()
  const dispatch = useDisclosure()
  const [tracking, setTracking] = useState('')
  const [note, setNote] = useState('')
  const status = shipmentStatus(shipment.status)

  const send = useMutation({
    mutationFn: () =>
      fulfillment.dispatch(shipment.id, {
        trackingReference: tracking.trim() || null,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      dispatch.hide()
      toast.success('Dispatched', {
        description: 'The reserved quantities on this parcel are now protected.',
      })
      void queryClient.invalidateQueries({ queryKey: keys.orderFulfillment(orderId) })
      void queryClient.invalidateQueries({ queryKey: keys.order(orderId) })
    },
  })

  return (
    <Panel className="space-y-3">
      <PanelHeader
        as="h4"
        title={shipment.warehouseName ?? 'Shipment'}
        description={`${shipment.warehouseCode ?? ''} · ${formatMoney(shipment.estimatedCost, currency)} estimated`}
        actions={<StatusBadge label={status.label} tone={status.tone} size="sm" />}
      />

      <ul className="space-y-1">
        {shipment.lines.map((line) => (
          <li key={line.id} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 flex-1 truncate text-text">{line.description ?? line.lineKey}</span>
            <span className="tabular font-medium">{formatQuantity(line.quantity)}</span>
          </li>
        ))}
      </ul>

      {shipment.dispatchedAt ? (
        <p className="border-t border-line pt-2.5 text-[13px] text-text-secondary">
          Dispatched {formatTimestamp(shipment.dispatchedAt)}
          {shipment.trackingReference ? ` · ${shipment.trackingReference}` : ''}
        </p>
      ) : canDispatch ? (
        <div className="border-t border-line pt-2.5">
          <Button
            size="sm"
            variant="primary"
            icon={<Truck className="size-3.5" />}
            disabled={shipment.status !== 'RESERVED'}
            disabledReason="Only a parcel with reserved stock can be dispatched."
            onClick={dispatch.show}
          >
            Record dispatch
          </Button>
        </div>
      ) : null}

      <Dialog
        open={dispatch.open}
        onOpenChange={dispatch.setOpen}
        title="Record this dispatch"
        description="Marks the parcel as gone. Its quantities are then protected from re-allocation."
        busy={send.isPending}
        footer={
          <>
            <Button variant="ghost" onClick={dispatch.hide} disabled={send.isPending}>
              Cancel
            </Button>
            <Button variant="primary" busy={send.isPending} onClick={() => send.mutate()}>
              Record dispatch
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Tracking reference" hint="Optional, but it is what a customer will ask for.">
            {(props) => (
              <Input
                {...props}
                value={tracking}
                onChange={(event) => setTracking(event.target.value)}
                placeholder="e.g. BLR-889231-IN"
              />
            )}
          </Field>
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
          {send.error ? <InlineError error={send.error} /> : null}
        </div>
      </Dialog>
    </Panel>
  )
}
