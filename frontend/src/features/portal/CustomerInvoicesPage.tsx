import { useQuery } from '@tanstack/react-query'
import { ReceiptText } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { keys, portal } from '@/api'
import {
  Badge,
  DataTable,
  EmptyState,
  InlineError,
  PageHeader,
  Panel,
  RefreshingHint,
  Stat,
} from '@/design-system'
import { daysUntilBusinessDate, formatBusinessDate } from '@/lib/dates'
import { formatMoney } from '@/lib/money'

/** The customer's invoices, with what is still owed made obvious. */
export default function CustomerInvoicesPage() {
  const navigate = useNavigate()

  const invoices = useQuery({
    queryKey: keys.portalInvoices(),
    queryFn: ({ signal }) => portal.invoices(signal),
  })

  const rows = invoices.data ?? []
  const currency = rows[0]?.currency ?? 'INR'
  const outstanding = rows.reduce((sum, invoice) => sum + Number(invoice.outstanding ?? 0), 0)
  const overdue = rows.filter((invoice) => {
    const days = daysUntilBusinessDate(invoice.dueDate)
    return Number(invoice.outstanding) > 0 && days !== null && days < 0
  })

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Everything raised against your orders and subscriptions."
        meta={<RefreshingHint visible={invoices.isFetching && !invoices.isLoading} />}
      />

      {rows.length > 0 ? (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <Stat label="Invoices" value={rows.length} scope="All time" />
          <Stat
            label="Outstanding"
            value={formatMoney(String(outstanding), currency)}
            scope="Across every open invoice"
            tone={outstanding > 0 ? 'brass' : 'default'}
          />
          <Stat
            label="Past due"
            value={overdue.length}
            scope={overdue.length > 0 ? 'Please settle these first' : 'Nothing is late'}
          />
        </div>
      ) : null}

      <DataTable
        caption="Your invoices"
        rows={rows}
        rowKey={(row) => row.id}
        loading={invoices.isLoading}
        error={
          invoices.error ? (
            <InlineError error={invoices.error} onRetry={() => void invoices.refetch()} />
          ) : undefined
        }
        empty={
          <EmptyState
            icon={<ReceiptText className="size-5" aria-hidden />}
            title="No invoices yet"
            description="An invoice is raised when an order is confirmed, and again for each subscription period."
          />
        }
        onRowClick={(row) => navigate(`/customer/invoices/${row.id}`)}
        columns={[
          {
            id: 'reference',
            header: 'Invoice',
            cell: (row) => <span className="tabular font-semibold text-text">{row.reference}</span>,
          },
          {
            id: 'issued',
            header: 'Issued',
            hideBelow: 'sm',
            cell: (row) => formatBusinessDate(row.issueDate),
          },
          {
            id: 'due',
            header: 'Due',
            cell: (row) => {
              const days = daysUntilBusinessDate(row.dueDate)
              const late = Number(row.outstanding) > 0 && days !== null && days < 0
              return (
                <span className={late ? 'font-medium text-stop-text' : ''}>
                  {formatBusinessDate(row.dueDate)}
                  {late ? (
                    <span className="block text-2xs">{Math.abs(days)} days past due</span>
                  ) : null}
                </span>
              )
            },
          },
          {
            id: 'total',
            header: 'Total',
            align: 'right',
            cell: (row) => formatMoney(row.total, row.currency),
          },
          {
            id: 'outstanding',
            header: 'Outstanding',
            align: 'right',
            cell: (row) =>
              Number(row.outstanding) > 0 ? (
                <span className="font-semibold text-stop-text">
                  {formatMoney(row.outstanding, row.currency)}
                </span>
              ) : (
                <Badge tone="ok" size="sm">
                  Settled
                </Badge>
              ),
          },
        ]}
      />

      <Panel tone="muted" className="mt-4 text-[13px] leading-relaxed text-text-secondary">
        Payments are recorded by our finance team once received. There is no card payment here —
        settle an invoice through the bank details on the document itself.
      </Panel>
    </>
  )
}
