import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CreditCard, ReceiptText, RotateCcw, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
  billing,
  customers as customersApi,
  keys,
  newIdempotencyKey,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  type CreditNote,
  type Invoice,
} from '@/api'
import { useAuth } from '@/auth/useAuth'
import { CATALOG_QUERY_OPTIONS } from '@/app/queryClient'
import {
  Badge,
  Button,
  DataTable,
  DetailRow,
  Dialog,
  EmptyState,
  Field,
  FilterBar,
  InlineError,
  Input,
  MoneyInput,
  Panel,
  PanelHeader,
  PageHeader,
  RefreshingHint,
  Select,
  StatusBadge,
  TabPanel,
  Tabs,
  Textarea,
  creditNoteStatus,
  invoiceStatus,
  subscriptionStatus,
  useDisclosure,
} from '@/design-system'
import { formatBusinessDate, formatTimestamp } from '@/lib/dates'
import { formatMoney } from '@/lib/money'

/**
 * Billing, organised around one customer at a time.
 *
 * That is not a UI preference — `/invoices`, `/payments` and `/credit-notes` all
 * require a customer (or an order), and there is no unfiltered list on the
 * server. Rather than pretend otherwise, the customer is the first control on
 * the page and it lives in the URL so a view can be shared.
 */
export default function BillingPage() {
  const { me } = useAuth()
  const [params, setParams] = useSearchParams()
  const customerId = params.get('customerId') ?? ''
  const [tab, setTab] = useState('invoices')
  const recordPayment = useDisclosure()
  const recordRefund = useDisclosure()

  const customers = useQuery({
    queryKey: keys.customers({ pageSize: 200 }),
    queryFn: ({ signal }) => customersApi.list({ pageSize: 200 }, signal),
    ...CATALOG_QUERY_OPTIONS,
  })

  const invoices = useQuery({
    queryKey: keys.invoices({ customerId, pageSize: 50 }),
    queryFn: ({ signal }) => billing.invoices({ customerId, pageSize: 50 }, signal),
    enabled: Boolean(customerId),
  })

  const payments = useQuery({
    queryKey: keys.payments({ customerId, pageSize: 50 }),
    queryFn: ({ signal }) => billing.payments({ customerId, pageSize: 50 }, signal),
    enabled: Boolean(customerId) && tab === 'payments',
  })

  const credits = useQuery({
    queryKey: keys.creditNotes({ customerId, pageSize: 50 }),
    queryFn: ({ signal }) => billing.creditNotes({ customerId, pageSize: 50 }, signal),
    enabled: Boolean(customerId) && (tab === 'credits' || recordRefund.open),
  })

  const subscriptions = useQuery({
    queryKey: keys.subscriptions({ customerId }),
    queryFn: ({ signal }) => billing.subscriptions({ customerId }, signal),
    enabled: Boolean(customerId) && tab === 'subscriptions',
  })

  const customer = customers.data?.items.find((row) => row.id === customerId)
  const currency = customer?.currency ?? 'INR'
  const canRecord = me?.role === 'FINANCE' || me?.role === 'ADMIN'

  const openInvoices = (invoices.data?.items ?? []).filter(
    (invoice) => Number(invoice.outstanding) > 0,
  )

  return (
    <>
      <PageHeader
        title="Billing"
        description="Invoices, subscriptions, receipts and credits for one customer. Money recorded here already moved elsewhere — this is not a payment gateway."
        meta={<RefreshingHint visible={invoices.isFetching && !invoices.isLoading} />}
        actions={
          canRecord && customerId ? (
            <>
              <Button
                variant="secondary"
                icon={<RotateCcw className="size-4" />}
                onClick={recordRefund.show}
              >
                Record a refund
              </Button>
              <Button
                variant="primary"
                icon={<Wallet className="size-4" />}
                onClick={recordPayment.show}
              >
                Record a receipt
              </Button>
            </>
          ) : null
        }
      />

      <FilterBar>
        <div className="w-full flex-1 space-y-1.5 sm:min-w-72">
          <label htmlFor="billing-customer" className="block text-[13px] font-medium text-text">
            Customer
          </label>
          <Select
            id="billing-customer"
            value={customerId}
            onChange={(event) => {
              const next = new URLSearchParams(params)
              if (event.target.value) next.set('customerId', event.target.value)
              else next.delete('customerId')
              setParams(next, { replace: true })
            }}
          >
            <option value="">Choose a customer…</option>
            {(customers.data?.items ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>

      {!customerId ? (
        <Panel>
          <EmptyState
            icon={<ReceiptText className="size-5" aria-hidden />}
            title="Choose a customer"
            description="Invoices, receipts and credit notes are read per customer — the server has no unfiltered list of them."
          />
        </Panel>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Panel className="py-3.5">
              <p className="text-2xs uppercase tracking-wide text-text-muted">Open invoices</p>
              <p className="tabular mt-1 text-xl font-semibold">{openInvoices.length}</p>
              <p className="mt-1 text-2xs text-text-muted">On the invoices loaded below</p>
            </Panel>
            <Panel className="py-3.5">
              <p className="text-2xs uppercase tracking-wide text-text-muted">Outstanding</p>
              <p className="tabular mt-1 text-xl font-semibold text-stop-text">
                {formatMoney(
                  String(
                    openInvoices.reduce((sum, inv) => sum + Number(inv.outstanding ?? 0), 0),
                  ),
                  currency,
                )}
              </p>
              <p className="mt-1 text-2xs text-text-muted">Sum of what is loaded, not all time</p>
            </Panel>
            <Panel className="py-3.5">
              <p className="text-2xs uppercase tracking-wide text-text-muted">Invoiced</p>
              <p className="tabular mt-1 text-xl font-semibold">
                {formatMoney(
                  String(
                    (invoices.data?.items ?? []).reduce(
                      (sum, inv) => sum + Number(inv.total ?? 0),
                      0,
                    ),
                  ),
                  currency,
                )}
              </p>
              <p className="mt-1 text-2xs text-text-muted">
                Whole-business figures are in Reports
              </p>
            </Panel>
          </div>

          <Tabs
            label="Billing sections"
            value={tab}
            onValueChange={setTab}
            tabs={[
              { value: 'invoices', label: 'Invoices' },
              { value: 'subscriptions', label: 'Subscriptions' },
              { value: 'payments', label: 'Receipts' },
              { value: 'credits', label: 'Credits' },
            ]}
          >
            <TabPanel value="invoices">
              <DataTable
                caption="Invoices"
                rows={invoices.data?.items ?? []}
                rowKey={(row) => row.id}
                loading={invoices.isLoading}
                error={invoices.error ? <InlineError error={invoices.error} /> : undefined}
                empty={
                  <EmptyState
                    icon={<ReceiptText className="size-5" aria-hidden />}
                    title="No invoices"
                    description="Invoices are raised when an order is confirmed and when a subscription period is billed."
                  />
                }
                columns={invoiceColumns()}
              />
            </TabPanel>

            <TabPanel value="subscriptions">
              <DataTable
                caption="Subscriptions"
                rows={subscriptions.data ?? []}
                rowKey={(row) => row.id}
                loading={subscriptions.isLoading}
                error={subscriptions.error ? <InlineError error={subscriptions.error} /> : undefined}
                empty={
                  <EmptyState
                    icon={<CreditCard className="size-5" aria-hidden />}
                    title="No subscriptions"
                    description="A subscription starts when an order contains a recurring line."
                  />
                }
                columns={[
                  {
                    id: 'reference',
                    header: 'Subscription',
                    cell: (row) => (
                      <Link
                        to={`/admin/subscriptions/${row.id}`}
                        className="tabular font-semibold text-forest-700 hover:underline"
                      >
                        {row.reference}
                      </Link>
                    ),
                  },
                  { id: 'plan', header: 'Plan', cell: (row) => row.planName ?? '—' },
                  {
                    id: 'status',
                    header: 'Status',
                    cell: (row) => {
                      const status = subscriptionStatus(row.status)
                      return <StatusBadge label={status.label} tone={status.tone} size="sm" />
                    },
                  },
                  {
                    id: 'period',
                    header: 'Current period',
                    hideBelow: 'md',
                    cell: (row) =>
                      `${formatBusinessDate(row.periodStart)} – ${formatBusinessDate(row.periodEnd)}`,
                  },
                  {
                    id: 'next',
                    header: 'Next bill',
                    hideBelow: 'lg',
                    cell: (row) => formatBusinessDate(row.nextBillAt),
                  },
                  {
                    id: 'mrr',
                    header: 'MRR',
                    align: 'right',
                    cell: (row) => formatMoney(row.monthlyRecurringRevenue, row.currency),
                  },
                ]}
              />
              <p className="mt-3 text-[13px] leading-relaxed text-text-secondary">
                MRR normalises each subscription to a month for reporting. It is never an invoice
                amount, and quarterly and yearly plans are not billed monthly.
              </p>
            </TabPanel>

            <TabPanel value="payments">
              <DataTable
                caption="Recorded receipts"
                rows={payments.data?.items ?? []}
                rowKey={(row) => row.id}
                loading={payments.isLoading}
                error={payments.error ? <InlineError error={payments.error} /> : undefined}
                empty={
                  <EmptyState
                    icon={<Wallet className="size-5" aria-hidden />}
                    title="No receipts recorded"
                    description="Recording a receipt books money that has already been received elsewhere."
                  />
                }
                columns={[
                  {
                    id: 'reference',
                    header: 'Receipt',
                    cell: (row) => <span className="tabular font-semibold">{row.reference}</span>,
                  },
                  {
                    id: 'method',
                    header: 'Method',
                    cell: (row) => PAYMENT_METHOD_LABEL[row.method] ?? row.method,
                  },
                  {
                    id: 'external',
                    header: 'Reference',
                    hideBelow: 'lg',
                    cell: (row) => (
                      <span className="tabular text-text-secondary">
                        {row.externalReference ?? '—'}
                      </span>
                    ),
                  },
                  {
                    id: 'amount',
                    header: 'Amount',
                    align: 'right',
                    cell: (row) => formatMoney(row.amount, currency),
                  },
                  {
                    id: 'allocated',
                    header: 'Allocated',
                    align: 'right',
                    hideBelow: 'md',
                    cell: (row) => formatMoney(row.allocated, currency),
                  },
                  {
                    id: 'unallocated',
                    header: 'Left as credit',
                    align: 'right',
                    hideBelow: 'md',
                    cell: (row) =>
                      Number(row.unallocated) > 0 ? (
                        <Badge tone="info" size="sm">
                          {formatMoney(row.unallocated, currency)}
                        </Badge>
                      ) : (
                        <span className="text-text-muted">—</span>
                      ),
                  },
                  {
                    id: 'recorded',
                    header: 'Recorded',
                    hideBelow: 'xl',
                    cell: (row) => formatTimestamp(row.recordedAt),
                  },
                ]}
              />
            </TabPanel>

            <TabPanel value="credits">
              <DataTable
                caption="Credit notes"
                rows={credits.data?.items ?? []}
                rowKey={(row) => row.id}
                loading={credits.isLoading}
                error={credits.error ? <InlineError error={credits.error} /> : undefined}
                empty={
                  <EmptyState
                    icon={<RotateCcw className="size-5" aria-hidden />}
                    title="No credit notes"
                    description="A credit note is generated by a supported billing workflow — a proration or a cancellation — and cannot be created by hand."
                  />
                }
                columns={creditColumns(currency)}
              />
              <p className="mt-3 text-[13px] leading-relaxed text-text-secondary">
                Credit notes come from proration and cancellation workflows. There is no manual
                creation, and a refund is recorded against an existing note rather than invented.
              </p>
            </TabPanel>
          </Tabs>
        </>
      )}

      <RecordPaymentDialog
        open={recordPayment.open}
        onOpenChange={recordPayment.setOpen}
        customerId={customerId}
        currency={currency}
        openInvoices={openInvoices}
      />

      <RecordRefundDialog
        open={recordRefund.open}
        onOpenChange={recordRefund.setOpen}
        currency={currency}
        creditNotes={credits.data?.items ?? []}
      />
    </>
  )
}

/* ----------------------------------------------------------------- columns */

function invoiceColumns() {
  return [
    {
      id: 'reference',
      header: 'Invoice',
      cell: (row: Invoice) => (
        <Link
          to={`/admin/invoices/${row.id}`}
          className="tabular font-semibold text-forest-700 hover:underline"
        >
          {row.reference}
        </Link>
      ),
    },
    {
      id: 'kind',
      header: 'Kind',
      hideBelow: 'lg' as const,
      cell: (row: Invoice) => (
        <Badge tone="neutral" size="sm">
          {row.invoiceKind === 'ONE_TIME'
            ? 'One-time'
            : row.invoiceKind === 'RECURRING'
              ? 'Recurring'
              : 'Adjustment'}
        </Badge>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row: Invoice) => {
        const status = invoiceStatus(row.status)
        return <StatusBadge label={status.label} tone={status.tone} size="sm" />
      },
    },
    {
      id: 'issued',
      header: 'Issued',
      hideBelow: 'md' as const,
      cell: (row: Invoice) => formatBusinessDate(row.issueDate),
    },
    {
      id: 'due',
      header: 'Due',
      hideBelow: 'lg' as const,
      cell: (row: Invoice) => formatBusinessDate(row.dueDate),
    },
    {
      id: 'total',
      header: 'Total',
      align: 'right' as const,
      cell: (row: Invoice) => formatMoney(row.total, row.currency),
    },
    {
      id: 'outstanding',
      header: 'Outstanding',
      align: 'right' as const,
      cell: (row: Invoice) => (
        <span className={Number(row.outstanding) > 0 ? 'font-semibold text-stop-text' : ''}>
          {formatMoney(row.outstanding, row.currency)}
        </span>
      ),
    },
  ]
}

function creditColumns(currency: string) {
  return [
    {
      id: 'reference',
      header: 'Credit note',
      cell: (row: CreditNote) => <span className="tabular font-semibold">{row.reference}</span>,
    },
    {
      id: 'reason',
      header: 'Reason',
      cell: (row: CreditNote) => <span className="text-text-secondary">{row.reason ?? '—'}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row: CreditNote) => {
        const status = creditNoteStatus(row.status)
        return <StatusBadge label={status.label} tone={status.tone} size="sm" />
      },
    },
    {
      id: 'total',
      header: 'Total',
      align: 'right' as const,
      cell: (row: CreditNote) => formatMoney(row.total, currency),
    },
    {
      id: 'applied',
      header: 'Applied',
      align: 'right' as const,
      hideBelow: 'md' as const,
      cell: (row: CreditNote) => formatMoney(row.applied, currency),
    },
    {
      id: 'refunded',
      header: 'Refunded',
      align: 'right' as const,
      hideBelow: 'md' as const,
      cell: (row: CreditNote) => formatMoney(row.refunded, currency),
    },
    {
      id: 'available',
      header: 'Available',
      align: 'right' as const,
      cell: (row: CreditNote) => (
        <span className={Number(row.available) > 0 ? 'font-semibold text-ok-text' : ''}>
          {formatMoney(row.available, currency)}
        </span>
      ),
    },
  ]
}

/* ---------------------------------------------------------------- receipts */

function RecordPaymentDialog({
  open,
  onOpenChange,
  customerId,
  currency,
  openInvoices,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customerId: string
  currency: string
  openInvoices: Invoice[]
}) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<string>('BANK_TRANSFER')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [allocations, setAllocations] = useState<Record<string, string>>({})

  const allocated = Object.values(allocations).reduce((sum, value) => sum + Number(value || 0), 0)
  const surplus = Number(amount || 0) - allocated

  const record = useMutation({
    mutationFn: () => {
      const explicit = Object.entries(allocations)
        .filter(([, value]) => Number(value) > 0)
        .map(([invoiceId, value]) => ({ invoiceId, amount: value }))
      return billing.recordPayment(
        {
          customerId,
          amount,
          method,
          externalReference: reference.trim() || null,
          note: note.trim() || null,
          allocations: explicit.length > 0 ? explicit : null,
        },
        // One key per receipt, so a retry after a timeout does not book the
        // money twice.
        newIdempotencyKey(),
      )
    },
    onSuccess: (payment) => {
      toast.success(`Receipt ${payment.reference} recorded`, {
        description:
          Number(payment.unallocated) > 0
            ? `${formatMoney(payment.unallocated, currency)} remains as customer credit.`
            : 'Allocated across the open invoices.',
      })
      onOpenChange(false)
      setAmount('')
      setAllocations({})
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'invoices'] })
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'payments'] })
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record a receipt"
      description="Books money that has already been received. Leave the allocations empty and the server applies it oldest due first."
      size="lg"
      busy={record.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={record.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={record.isPending}
            disabled={!amount || Number(amount) <= 0 || allocated > Number(amount || 0)}
            disabledReason={
              allocated > Number(amount || 0)
                ? 'Allocated more than the receipt amount.'
                : 'Enter an amount first.'
            }
            onClick={() => record.mutate()}
          >
            Record receipt
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyInput
            label="Amount received"
            currency={currency}
            required
            value={amount}
            onChange={setAmount}
          />
          <Field label="Method" required>
            {(props) => (
              <Select {...props} value={method} onChange={(event) => setMethod(event.target.value)}>
                {PAYMENT_METHODS.map((value) => (
                  <option key={value} value={value}>
                    {PAYMENT_METHOD_LABEL[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field
          label="External reference"
          hint="The bank reference, UTR or cheque number this receipt can be traced by."
        >
          {(props) => (
            <Input
              {...props}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          )}
        </Field>

        {openInvoices.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-text">Allocate to invoices</p>
            <p className="text-[13px] leading-relaxed text-text-secondary">
              Optional. Leave every box empty and the server applies the receipt to open invoices
              oldest due first, keeping any surplus as customer credit.
            </p>
            <ul className="space-y-1.5">
              {openInvoices.map((invoice) => (
                <li
                  key={invoice.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[--radius-control] border border-line px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="tabular block text-[13px] font-medium text-text">
                      {invoice.reference}
                    </span>
                    <span className="block text-2xs text-text-muted">
                      Due {formatBusinessDate(invoice.dueDate)} ·{' '}
                      {formatMoney(invoice.outstanding, invoice.currency)} outstanding
                    </span>
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={Number(invoice.outstanding)}
                    aria-label={`Amount to allocate to invoice ${invoice.reference}`}
                    value={allocations[invoice.id] ?? ''}
                    onChange={(event) =>
                      setAllocations((current) => ({
                        ...current,
                        [invoice.id]: event.target.value,
                      }))
                    }
                    className="tabular h-9 w-32 rounded-[--radius-control] border border-line-strong px-2 text-right text-sm"
                  />
                </li>
              ))}
            </ul>
            {allocated > 0 ? (
              <p className="tabular text-[13px] text-text-secondary">
                Allocated {formatMoney(String(allocated), currency)}
                {surplus > 0
                  ? ` · ${formatMoney(String(surplus), currency)} would stay as credit`
                  : surplus < 0
                    ? ' · that is more than the receipt'
                    : ''}
              </p>
            ) : null}
          </div>
        ) : null}

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

        <p className="rounded-[--radius-control] bg-canvas-sunken px-3 py-2.5 text-[13px] leading-relaxed text-text-secondary">
          This records a payment that already happened. No money moves through this form and no
          gateway is involved.
        </p>

        {record.error ? <InlineError error={record.error} /> : null}
      </div>
    </Dialog>
  )
}

/* ----------------------------------------------------------------- refunds */

function RecordRefundDialog({
  open,
  onOpenChange,
  currency,
  creditNotes,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currency: string
  creditNotes: CreditNote[]
}) {
  const queryClient = useQueryClient()
  const [creditNoteId, setCreditNoteId] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('BANK_TRANSFER')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')

  const selected = creditNotes.find((row) => row.id === creditNoteId)
  const available = Number(selected?.available ?? 0)

  const record = useMutation({
    mutationFn: () =>
      billing.recordRefund(
        {
          creditNoteId,
          amount,
          method,
          externalReference: reference.trim() || null,
          note: note.trim() || null,
        },
        newIdempotencyKey(),
      ),
    onSuccess: (refund) => {
      toast.success(`Refund ${refund.reference} recorded`)
      onOpenChange(false)
      setAmount('')
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'credit-notes'] })
    },
  })

  const usable = creditNotes.filter((row) => Number(row.available) > 0)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record a refund"
      description="Recorded against an existing credit note. There is no way to refund more than a note has available."
      busy={record.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={record.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={record.isPending}
            disabled={!creditNoteId || !amount || Number(amount) <= 0 || Number(amount) > available}
            disabledReason={
              Number(amount) > available
                ? 'That is more than the credit note has available.'
                : 'Choose a credit note and an amount.'
            }
            onClick={() => record.mutate()}
          >
            Record refund
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {usable.length === 0 ? (
          <Panel tone="muted" className="text-[13px] text-text-secondary">
            This customer has no credit note with an available balance. Credit notes are produced by
            proration and cancellation workflows; they cannot be created by hand.
          </Panel>
        ) : (
          <>
            <Field label="Credit note" required>
              {(props) => (
                <Select
                  {...props}
                  value={creditNoteId}
                  onChange={(event) => setCreditNoteId(event.target.value)}
                >
                  <option value="">Choose a credit note…</option>
                  {usable.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.reference} · {formatMoney(row.available, currency)} available
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {selected ? (
              <Panel tone="muted" className="space-y-1">
                <PanelHeader as="h4" title={selected.reference} description={selected.reason ?? undefined} />
                <dl className="divide-y divide-line">
                  <DetailRow label="Total">{formatMoney(selected.total, currency)}</DetailRow>
                  <DetailRow label="Already applied">
                    {formatMoney(selected.applied, currency)}
                  </DetailRow>
                  <DetailRow label="Already refunded">
                    {formatMoney(selected.refunded, currency)}
                  </DetailRow>
                  <DetailRow label="Available">
                    {formatMoney(selected.available, currency)}
                  </DetailRow>
                </dl>
              </Panel>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyInput
                label="Refund amount"
                currency={currency}
                required
                value={amount}
                onChange={setAmount}
              />
              <Field label="Method" required>
                {(props) => (
                  <Select
                    {...props}
                    value={method}
                    onChange={(event) => setMethod(event.target.value)}
                  >
                    {PAYMENT_METHODS.map((value) => (
                      <option key={value} value={value}>
                        {PAYMENT_METHOD_LABEL[value]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <Field label="External reference">
              {(props) => (
                <Input
                  {...props}
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
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
          </>
        )}

        {record.error ? <InlineError error={record.error} /> : null}
      </div>
    </Dialog>
  )
}
