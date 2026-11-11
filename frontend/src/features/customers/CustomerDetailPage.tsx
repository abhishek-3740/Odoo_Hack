import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, ReceiptText, ScrollText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
  billing,
  customers as customersApi,
  keys,
  quotes as quotesApi,
  TIER_LABEL,
  type Customer,
  type CustomerTier,
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
  Section,
  Select,
  StatusBadge,
  Textarea,
  invoiceStatus,
  stageStatus,
  subscriptionStatus,
  useDisclosure,
} from '@/design-system'
import { formatBusinessDate } from '@/lib/dates'
import { formatMoney } from '@/lib/money'

const TIERS: CustomerTier[] = ['BRONZE', 'SILVER', 'GOLD']

/**
 * One customer account and everything hanging off it.
 *
 * The invoice and subscription endpoints both require a customer or order
 * filter — there is no unfiltered list — so this page is the natural place from
 * which to read them, and it does so with the filter the server expects rather
 * than fetching everything and narrowing in the browser.
 */
export default function CustomerDetailPage() {
  const { customerId = '' } = useParams()
  const { me } = useAuth()
  const edit = useDisclosure()

  const customer = useQuery({
    queryKey: keys.customer(customerId),
    queryFn: ({ signal }) => customersApi.get(customerId, signal),
    enabled: Boolean(customerId),
  })

  const quoteQuery = { customerId, pageSize: 20 }
  const quotes = useQuery({
    queryKey: keys.quoteList(quoteQuery),
    queryFn: ({ signal }) => quotesApi.list(quoteQuery, signal),
    enabled: Boolean(customerId),
  })

  const invoiceQuery = { customerId, pageSize: 20 }
  const invoices = useQuery({
    queryKey: keys.invoices(invoiceQuery),
    queryFn: ({ signal }) => billing.invoices(invoiceQuery, signal),
    enabled: Boolean(customerId),
  })

  const subscriptions = useQuery({
    queryKey: keys.subscriptions({ customerId }),
    queryFn: ({ signal }) => billing.subscriptions({ customerId }, signal),
    enabled: Boolean(customerId),
  })

  if (customer.isLoading && !customer.data) return <LoadingPanel rows={6} />
  if (customer.error) {
    return (
      <InlineError
        error={customer.error}
        title="This customer could not be opened"
        onRetry={() => void customer.refetch()}
      />
    )
  }
  if (!customer.data) return null

  const row = customer.data
  const canEdit = me?.role === 'ADMIN' || me?.role === 'MANAGER'
  const outstanding = (invoices.data?.items ?? []).reduce(
    (total, invoice) => total + Number(invoice.outstanding ?? 0),
    0,
  )

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Customers', to: '/admin/customers' }, { label: row.name }]}
        title={row.name}
        meta={
          <>
            <Badge tone={row.tier === 'GOLD' ? 'brass' : 'neutral'} size="sm">
              {TIER_LABEL[row.tier] ?? row.tier} tier
            </Badge>
            <Badge tone={row.active ? 'ok' : 'neutral'} size="sm">
              {row.active ? 'Active' : 'Inactive'}
            </Badge>
            <span className="tabular text-[13px] text-text-secondary">{row.currency}</span>
          </>
        }
        actions={
          canEdit ? (
            <Button variant="secondary" icon={<Pencil className="size-3.5" />} onClick={edit.show}>
              Edit
            </Button>
          ) : null
        }
      />

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel className="space-y-2">
            <PanelHeader title="Account" />
            <dl className="divide-y divide-line">
              <DetailRow label="Tier">{TIER_LABEL[row.tier] ?? row.tier}</DetailRow>
              <DetailRow label="Currency">{row.currency}</DetailRow>
              <DetailRow label="Contact email">{row.contactEmail ?? '—'}</DetailRow>
              <DetailRow label="Contact phone">{row.contactPhone ?? '—'}</DetailRow>
            </dl>
            {row.billingAddress ? (
              <div className="border-t border-line pt-3">
                <p className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
                  Billing address
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-text">
                  {row.billingAddress}
                </p>
              </div>
            ) : null}
            <p className="border-t border-line pt-3 text-[13px] leading-relaxed text-text-secondary">
              Tier is not cosmetic: it selects the price rules that apply and the discount ceiling
              this customer's quotations are measured against.
            </p>
          </Panel>

          <Panel className="space-y-2">
            <PanelHeader title="Money" description="From the invoices loaded below." />
            <dl className="divide-y divide-line">
              <DetailRow label="Open invoices">
                {invoices.data?.items.filter((invoice) => Number(invoice.outstanding) > 0).length ??
                  '—'}
              </DetailRow>
              <DetailRow label="Outstanding on this page">
                {formatMoney(String(outstanding), row.currency)}
              </DetailRow>
              <DetailRow label="Live subscriptions">
                {subscriptions.data?.filter((sub) => sub.status === 'ACTIVE').length ?? '—'}
              </DetailRow>
            </dl>
            <Link
              to={`/admin/billing?customerId=${row.id}`}
              className="inline-flex text-[13px] font-medium text-forest-600 hover:underline"
            >
              Open billing for this customer →
            </Link>
          </Panel>
        </div>

        <div className="min-w-0 space-y-6">
          <Section
            id="customer-quotes"
            title="Quotations"
            description="Every quotation for this customer that you are entitled to see."
            actions={
              <Link
                to={`/admin/quotes?customerId=${row.id}`}
                className="text-[13px] font-medium text-forest-600 hover:underline"
              >
                Open in the pipeline
              </Link>
            }
          >
            <DataTable
              caption={`Quotations for ${row.name}`}
              rows={quotes.data?.items ?? []}
              rowKey={(quote) => quote.id}
              loading={quotes.isLoading}
              error={quotes.error ? <InlineError error={quotes.error} /> : undefined}
              empty={
                <EmptyState
                  icon={<ScrollText className="size-5" aria-hidden />}
                  title="No quotations yet"
                  description="Start one from the pipeline."
                />
              }
              columns={[
                {
                  id: 'reference',
                  header: 'Reference',
                  cell: (quote) => (
                    <Link
                      to={`/admin/quotes/${quote.id}`}
                      className="tabular font-semibold text-forest-700 hover:underline"
                    >
                      {quote.reference}
                    </Link>
                  ),
                },
                {
                  id: 'stage',
                  header: 'Stage',
                  cell: (quote) => {
                    const stage = stageStatus(quote.stage)
                    return <StatusBadge label={stage.label} tone={stage.tone} size="sm" />
                  },
                },
                {
                  id: 'oneTime',
                  header: 'One-time',
                  align: 'right',
                  cell: (quote) => formatMoney(quote.oneTimeNet, quote.currency),
                },
                {
                  id: 'recurring',
                  header: 'Recurring',
                  align: 'right',
                  hideBelow: 'md',
                  cell: (quote) => formatMoney(quote.recurringFirstCycleNet, quote.currency),
                },
                {
                  id: 'valid',
                  header: 'Valid to',
                  align: 'right',
                  hideBelow: 'lg',
                  cell: (quote) => formatBusinessDate(quote.validUntil),
                },
              ]}
            />
          </Section>

          <Section
            id="customer-invoices"
            title="Invoices"
            description="Raised from confirmed orders and from recurring periods."
          >
            <DataTable
              caption={`Invoices for ${row.name}`}
              rows={invoices.data?.items ?? []}
              rowKey={(invoice) => invoice.id}
              loading={invoices.isLoading}
              error={invoices.error ? <InlineError error={invoices.error} /> : undefined}
              empty={
                <EmptyState
                  icon={<ReceiptText className="size-5" aria-hidden />}
                  title="No invoices yet"
                  description="An invoice is raised when an order is confirmed, or when a subscription period is billed."
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
                    const status = invoiceStatus(invoice.status)
                    return <StatusBadge label={status.label} tone={status.tone} size="sm" />
                  },
                },
                {
                  id: 'issued',
                  header: 'Issued',
                  hideBelow: 'md',
                  cell: (invoice) => formatBusinessDate(invoice.issueDate),
                },
                {
                  id: 'due',
                  header: 'Due',
                  hideBelow: 'lg',
                  cell: (invoice) => formatBusinessDate(invoice.dueDate),
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
                  cell: (invoice) => (
                    <span
                      className={
                        Number(invoice.outstanding) > 0 ? 'font-semibold text-stop-text' : ''
                      }
                    >
                      {formatMoney(invoice.outstanding, invoice.currency)}
                    </span>
                  ),
                },
              ]}
            />
          </Section>

          {(subscriptions.data ?? []).length > 0 ? (
            <Section
              id="customer-subscriptions"
              title="Subscriptions"
              description="Recurring commitments, each with its own period and cadence."
            >
              <DataTable
                caption={`Subscriptions for ${row.name}`}
                rows={subscriptions.data ?? []}
                rowKey={(sub) => sub.id}
                loading={subscriptions.isLoading}
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
                  {
                    id: 'plan',
                    header: 'Plan',
                    cell: (sub) => <span className="text-text">{sub.planName ?? '—'}</span>,
                  },
                  {
                    id: 'status',
                    header: 'Status',
                    cell: (sub) => {
                      const status = subscriptionStatus(sub.status)
                      return <StatusBadge label={status.label} tone={status.tone} size="sm" />
                    },
                  },
                  {
                    id: 'period',
                    header: 'Current period',
                    hideBelow: 'lg',
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
      </div>

      <EditCustomerDialog open={edit.open} onOpenChange={edit.setOpen} customer={row} />
    </>
  )
}

/* -------------------------------------------------------------------- edit */

function EditCustomerDialog({
  open,
  onOpenChange,
  customer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer: Customer
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(customer)

  useEffect(() => {
    if (open) setForm(customer)
  }, [open, customer])

  const save = useMutation({
    mutationFn: () =>
      customersApi.update(customer.id, {
        name: form.name.trim(),
        tier: form.tier,
        contactEmail: form.contactEmail?.trim() || null,
        contactPhone: form.contactPhone?.trim() || null,
        billingAddress: form.billingAddress?.trim() || null,
        active: form.active,
      }),
    onSuccess: () => {
      toast.success('Customer updated')
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: keys.customer(customer.id) })
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'customers'] })
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${customer.name}`}
      description="Changing the tier changes which price rules and discount ceilings apply to the next evaluation."
      busy={save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Company name" required>
          {(props) => (
            <Input
              {...props}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tier" hint="Affects the next evaluation, not quotations already decided.">
            {(props) => (
              <Select
                {...props}
                value={form.tier}
                onChange={(event) => setForm({ ...form, tier: event.target.value as CustomerTier })}
              >
                {TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {TIER_LABEL[tier]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Status">
            {(props) => (
              <Select
                {...props}
                value={form.active ? 'active' : 'inactive'}
                onChange={(event) => setForm({ ...form, active: event.target.value === 'active' })}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact email">
            {(props) => (
              <Input
                {...props}
                type="email"
                value={form.contactEmail ?? ''}
                onChange={(event) => setForm({ ...form, contactEmail: event.target.value })}
              />
            )}
          </Field>
          <Field label="Contact phone">
            {(props) => (
              <Input
                {...props}
                type="tel"
                value={form.contactPhone ?? ''}
                onChange={(event) => setForm({ ...form, contactPhone: event.target.value })}
              />
            )}
          </Field>
        </div>

        <Field label="Billing address">
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={form.billingAddress ?? ''}
              onChange={(event) => setForm({ ...form, billingAddress: event.target.value })}
            />
          )}
        </Field>

        {save.error ? <InlineError error={save.error} title="Could not save" /> : null}
      </div>
    </Dialog>
  )
}
