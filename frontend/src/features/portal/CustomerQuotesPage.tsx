import { useQuery } from '@tanstack/react-query'
import { FileText, Store } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { keys, portal } from '@/api'
import {
  DataTable,
  EmptyState,
  InlineError,
  PageHeader,
  RefreshingHint,
  StatusBadge,
  portalStatus,
} from '@/design-system'
import { daysUntilBusinessDate, formatBusinessDate, formatRelative } from '@/lib/dates'
import { formatMoney } from '@/lib/money'

/** Every quotation shared with this customer. Drafts are not visible here. */
export default function CustomerQuotesPage() {
  const navigate = useNavigate()

  const quotes = useQuery({
    queryKey: keys.portalQuotes(),
    queryFn: ({ signal }) => portal.quotes(signal),
  })

  return (
    <>
      <PageHeader
        title="Your quotations"
        description="Everything your account manager has shared with you, and where each one stands."
        meta={<RefreshingHint visible={quotes.isFetching && !quotes.isLoading} />}
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

      <DataTable
        caption="Your quotations"
        rows={quotes.data ?? []}
        rowKey={(row) => row.id}
        loading={quotes.isLoading}
        error={
          quotes.error ? (
            <InlineError error={quotes.error} onRetry={() => void quotes.refetch()} />
          ) : undefined
        }
        empty={
          <EmptyState
            icon={<FileText className="size-5" aria-hidden />}
            title="No quotations yet"
            description="Browse the catalogue and ask for one. Your account manager prices it and shares it back here."
          />
        }
        onRowClick={(row) => navigate(`/customer/quotes/${row.id}`)}
        columns={[
          {
            id: 'reference',
            header: 'Reference',
            cell: (row) => (
              <span>
                <span className="tabular block font-semibold text-text">{row.reference}</span>
                {row.title ? (
                  <span className="block max-w-64 truncate text-2xs text-text-muted">
                    {row.title}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            id: 'status',
            header: 'Status',
            cell: (row) => {
              const status = portalStatus(row.status)
              return <StatusBadge label={status.label} tone={status.tone} size="sm" />
            },
          },
          {
            id: 'total',
            header: 'One-time total',
            align: 'right',
            cell: (row) => formatMoney(row.oneTimeTotal, row.currency),
          },
          {
            id: 'valid',
            header: 'Valid to',
            hideBelow: 'md',
            cell: (row) => {
              const days = daysUntilBusinessDate(row.validUntil)
              return (
                <span
                  className={
                    days !== null && days >= 0 && days <= 7 ? 'font-medium text-wait-text' : ''
                  }
                >
                  {formatBusinessDate(row.validUntil)}
                  {days !== null && days >= 0 && days <= 7 ? (
                    <span className="block text-2xs">
                      {days} day{days === 1 ? '' : 's'} left
                    </span>
                  ) : null}
                </span>
              )
            },
          },
          {
            id: 'updated',
            header: 'Updated',
            hideBelow: 'lg',
            cell: (row) => (
              <span className="text-text-secondary">{formatRelative(row.updatedAt)}</span>
            ),
          },
        ]}
      />
    </>
  )
}
