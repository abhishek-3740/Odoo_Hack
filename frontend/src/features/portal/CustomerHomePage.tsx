import { useQuery } from '@tanstack/react-query'
import { ArrowRight, FileText, ReceiptText, Store } from 'lucide-react'
import { Link } from 'react-router-dom'

import { keys, portal, portalAccount } from '@/api'
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
  portalStatus,
} from '@/design-system'
import { formatBusinessDate, formatRelative } from '@/lib/dates'
import { formatMoney } from '@/lib/money'

/**
 * The customer's overview.
 *
 * Ordered by what needs them: quotations they can act on first, then money
 * outstanding, then everything else. Nothing here is an internal figure — the
 * portal endpoints have no field for cost or margin to begin with.
 */
export default function CustomerHomePage() {
  const { me } = useAuth()

  const quotes = useQuery({
    queryKey: keys.portalQuotes(),
    queryFn: ({ signal }) => portal.quotes(signal),
  })

  const invoices = useQuery({
    queryKey: keys.portalInvoices(),
    queryFn: ({ signal }) => portal.invoices(signal),
  })

  const account = useQuery({
    queryKey: keys.portalAccount(),
    queryFn: ({ signal }) => portalAccount.get(signal),
  })

  const outstanding = (invoices.data ?? []).filter((invoice) => Number(invoice.outstanding) > 0)
  const outstandingTotal = outstanding.reduce(
    (sum, invoice) => sum + Number(invoice.outstanding ?? 0),
    0,
  )
  const currency = invoices.data?.[0]?.currency ?? account.data?.organisation?.currency ?? 'INR'

  const openQuotes = (quotes.data ?? []).filter(
    (quote) => !/(confirm|expire|cancel)/i.test(quote.status),
  )

  return (
    <>
      <PageHeader
        eyebrow={me?.customerName ?? undefined}
        title={`Welcome back${me?.fullName ? `, ${me.fullName.split(' ')[0]}` : ''}`}
        description="Your quotations, what they cost, and anything still outstanding."
        meta={<RefreshingHint visible={quotes.isFetching || invoices.isFetching} />}
        actions={
          <Link
            to="/customer/catalogue"
            className="inline-flex h-10 items-center gap-2 rounded-[--radius-control] bg-forest-500 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-forest-600"
          >
            <Store className="size-4" aria-hidden />
            Request a quotation
          </Link>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Open quotations" value={openQuotes.length} scope="Waiting on you or on us" />
        <Stat
          label="Outstanding"
          value={formatMoney(String(outstandingTotal), currency)}
          scope={`Across ${outstanding.length} invoice${outstanding.length === 1 ? '' : 's'}`}
          tone={outstandingTotal > 0 ? 'brass' : 'default'}
        />
        <Stat
          label="Account manager"
          value={account.data?.accountManager?.name ?? '—'}
          scope={account.data?.accountManager?.email ?? 'Assigned to your organisation'}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel flush className="overflow-hidden">
          <PanelHeader
            className="border-b border-line px-5 py-4"
            title="Your quotations"
            description="Newest first."
            actions={
              <Link
                to="/customer/quotes"
                className="inline-flex items-center gap-1 text-[13px] font-medium text-forest-600 hover:underline"
              >
                See all
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            }
          />
          {quotes.isLoading ? (
            <LoadingPanel rows={3} className="border-0 shadow-none" />
          ) : quotes.error ? (
            <div className="p-4">
              <InlineError error={quotes.error} onRetry={() => void quotes.refetch()} />
            </div>
          ) : (quotes.data ?? []).length === 0 ? (
            <EmptyState
              icon={<FileText className="size-5" aria-hidden />}
              title="No quotations yet"
              description="Browse the catalogue and ask for one — your account manager will price it."
              action={
                <Button variant="primary" size="sm">
                  <Link to="/customer/catalogue">Browse the catalogue</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {(quotes.data ?? []).slice(0, 6).map((quote) => {
                const status = portalStatus(quote.status)
                return (
                  <li key={quote.id}>
                    <Link
                      to={`/customer/quotes/${quote.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-canvas-sunken"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="tabular text-[13px] font-semibold text-text">
                            {quote.reference}
                          </span>
                          <StatusBadge
                            label={status.label}
                            tone={status.tone}
                            size="sm"
                            withIcon={false}
                          />
                        </span>
                        <span className="mt-0.5 block truncate text-[13px] text-text-secondary">
                          {quote.title ?? 'Quotation'} · updated {formatRelative(quote.updatedAt)}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-[13px] font-medium">
                        {formatMoney(quote.oneTimeTotal, quote.currency)}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <Panel flush className="overflow-hidden">
          <PanelHeader
            className="border-b border-line px-5 py-4"
            title="Invoices"
            description="Anything outstanding is listed first."
            actions={
              <Link
                to="/customer/invoices"
                className="inline-flex items-center gap-1 text-[13px] font-medium text-forest-600 hover:underline"
              >
                See all
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            }
          />
          {invoices.isLoading ? (
            <LoadingPanel rows={3} className="border-0 shadow-none" />
          ) : invoices.error ? (
            <div className="p-4">
              <InlineError error={invoices.error} onRetry={() => void invoices.refetch()} />
            </div>
          ) : (invoices.data ?? []).length === 0 ? (
            <EmptyState
              icon={<ReceiptText className="size-5" aria-hidden />}
              title="No invoices yet"
              description="An invoice appears once an order is confirmed."
            />
          ) : (
            <ul className="divide-y divide-line">
              {[...(invoices.data ?? [])]
                .sort((a, b) => Number(b.outstanding) - Number(a.outstanding))
                .slice(0, 6)
                .map((invoice) => (
                  <li key={invoice.id}>
                    <Link
                      to={`/customer/invoices/${invoice.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-canvas-sunken"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="tabular text-[13px] font-semibold text-text">
                            {invoice.reference}
                          </span>
                          {Number(invoice.outstanding) > 0 ? (
                            <Badge tone="wait" size="sm">
                              Outstanding
                            </Badge>
                          ) : (
                            <Badge tone="ok" size="sm">
                              Settled
                            </Badge>
                          )}
                        </span>
                        <span className="mt-0.5 block text-[13px] text-text-secondary">
                          Due {formatBusinessDate(invoice.dueDate)}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-right text-[13px]">
                        <span className="block font-medium">
                          {formatMoney(invoice.total, invoice.currency)}
                        </span>
                        {Number(invoice.outstanding) > 0 ? (
                          <span className="block text-2xs text-stop-text">
                            {formatMoney(invoice.outstanding, invoice.currency)} to pay
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  )
}
