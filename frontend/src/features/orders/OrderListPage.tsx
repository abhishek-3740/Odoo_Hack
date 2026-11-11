import { useQuery } from '@tanstack/react-query'
import { Package } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { keys, ORDER_BILLING_STATUS_LABEL, orders as ordersApi } from '@/api'
import {
  Badge,
  DataTable,
  EmptyState,
  InlineError,
  PageHeader,
  Pagination,
  RefreshingHint,
  StatusBadge,
  fulfillmentStatus,
} from '@/design-system'
import { formatRelative } from '@/lib/dates'
import { formatMoney } from '@/lib/money'

/**
 * Confirmed orders.
 *
 * Orders are never created here — the server creates one the moment a
 * quotation's last outstanding gate clears. This screen is a read, and the
 * actions that exist live on the order itself.
 */
export default function OrderListPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const page = Number(params.get('page') ?? '0')
  const customerId = params.get('customerId') ?? ''

  const query = { customerId: customerId || undefined, page, pageSize: 25 }
  const list = useQuery({
    queryKey: keys.orderList(query),
    queryFn: ({ signal }) => ordersApi.list(query, signal),
  })

  return (
    <>
      <PageHeader
        title="Orders"
        description="Created automatically when a quotation's seller agreement, approval and customer acceptance are all in place."
        meta={<RefreshingHint visible={list.isFetching && !list.isLoading} />}
      />

      <DataTable
        caption="Orders"
        rows={list.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        error={
          list.error ? <InlineError error={list.error} onRetry={() => void list.refetch()} /> : undefined
        }
        empty={
          <EmptyState
            icon={<Package className="size-5" aria-hidden />}
            title="No orders yet"
            description="An order appears here as soon as a quotation clears its last gate."
          />
        }
        onRowClick={(row) => navigate(`/admin/orders/${row.id}`)}
        columns={[
          {
            id: 'reference',
            header: 'Order',
            cell: (row) => (
              <span className="tabular font-semibold text-text">{row.reference}</span>
            ),
          },
          {
            id: 'customer',
            header: 'Customer',
            cell: (row) => <span className="text-text">{row.customerName ?? '—'}</span>,
          },
          {
            id: 'fulfilment',
            header: 'Fulfilment',
            cell: (row) => {
              const status = fulfillmentStatus(row.fulfillmentStatus)
              return <StatusBadge label={status.label} tone={status.tone} size="sm" />
            },
          },
          {
            id: 'billing',
            header: 'Billing',
            hideBelow: 'md',
            cell: (row) => (
              <Badge tone={row.billingStatus === 'INITIALIZED' ? 'ok' : 'wait'} size="sm">
                {ORDER_BILLING_STATUS_LABEL[row.billingStatus] ?? row.billingStatus}
              </Badge>
            ),
          },
          {
            id: 'net',
            header: 'One-time net',
            align: 'right',
            cell: (row) => formatMoney(row.oneTimeNet, row.currency),
          },
          {
            id: 'confirmed',
            header: 'Confirmed',
            hideBelow: 'lg',
            cell: (row) => (
              <span className="text-text-secondary">{formatRelative(row.confirmedAt)}</span>
            ),
          },
        ]}
      />

      {list.data ? (
        <Pagination
          page={list.data.page}
          pageSize={list.data.pageSize}
          totalItems={list.data.totalItems}
          totalPages={list.data.totalPages}
          busy={list.isFetching}
          onPageChange={(next) => {
            const params2 = new URLSearchParams(params)
            params2.set('page', String(next))
            setParams(params2, { replace: true })
          }}
        />
      ) : null}
    </>
  )
}
