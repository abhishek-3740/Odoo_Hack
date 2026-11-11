import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { keys, notifications as notificationsApi, type Notification } from '@/api'
import {
  Badge,
  Button,
  EmptyState,
  InlineError,
  LoadingPanel,
  Panel,
  PageHeader,
  Pagination,
  RefreshingHint,
} from '@/design-system'
import { formatRelative, formatTimestamp } from '@/lib/dates'
import { cn } from '@/lib/cn'

/**
 * The durable notification inbox.
 *
 * The unread count comes from the response's own meta, which is the server's
 * count across everything — not the number of unread rows on this page, and not
 * the number of open escalations. Those are three different quantities and only
 * one of them belongs on a badge.
 */
export default function NotificationsPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(0)

  const query = { page, pageSize: 25 }
  const inbox = useQuery({
    queryKey: keys.notifications(query),
    queryFn: ({ signal }) => notificationsApi.inbox(query, signal),
  })

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'notifications'] })
    },
  })

  const markAllVisible = useMutation({
    mutationFn: async () => {
      const unread = (inbox.data?.page.items ?? []).filter((row) => !row.readAt)
      // Marked one at a time because that is the operation the API exposes.
      // Doing it in sequence keeps the server's own ordering and avoids a burst.
      for (const row of unread) {
        await notificationsApi.markRead(row.id)
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'notifications'] })
    },
  })

  const rows = inbox.data?.page.items ?? []
  const unreadHere = rows.filter((row) => !row.readAt).length

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Approvals, customer replies, delivery changes and nudges addressed to you."
        meta={
          <>
            {inbox.data ? (
              <span className="text-[13px] text-text-secondary">
                <span className="tabular font-medium text-text">{inbox.data.unread}</span> unread in
                total
              </span>
            ) : null}
            <RefreshingHint visible={inbox.isFetching && !inbox.isLoading} />
          </>
        }
        actions={
          unreadHere > 0 ? (
            <Button
              variant="secondary"
              icon={<CheckCheck className="size-4" />}
              busy={markAllVisible.isPending}
              onClick={() => markAllVisible.mutate()}
            >
              Mark this page read
            </Button>
          ) : null
        }
      />

      {inbox.isLoading && !inbox.data ? (
        <LoadingPanel rows={6} />
      ) : inbox.error ? (
        <InlineError error={inbox.error} onRetry={() => void inbox.refetch()} />
      ) : rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Bell className="size-5" aria-hidden />}
            title="Nothing here"
            description="You will hear about approvals waiting on you, customer replies, and anything the health sweep flags on your deals."
          />
        </Panel>
      ) : (
        <Panel flush className="overflow-hidden">
          <ul className="divide-y divide-line">
            {rows.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onRead={() => markRead.mutate(notification.id)}
              />
            ))}
          </ul>
        </Panel>
      )}

      {inbox.data ? (
        <Pagination
          page={inbox.data.page.page}
          pageSize={inbox.data.page.pageSize}
          totalItems={inbox.data.page.totalItems}
          totalPages={inbox.data.page.totalPages}
          busy={inbox.isFetching}
          onPageChange={setPage}
        />
      ) : null}
    </>
  )
}

function NotificationRow({
  notification,
  onRead,
}: {
  notification: Notification
  onRead: () => void
}) {
  const target = notification.quoteId
    ? `/admin/quotes/${notification.quoteId}`
    : notification.orderId
      ? `/admin/orders/${notification.orderId}`
      : notification.invoiceId
        ? `/admin/invoices/${notification.invoiceId}`
        : null

  const body = (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className={cn(
          'mt-1.5 size-1.5 shrink-0 rounded-full',
          notification.readAt ? 'bg-transparent' : 'bg-forest-500',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-text">{notification.title}</span>
          {!notification.readAt ? (
            <Badge tone="info" size="sm">
              New
            </Badge>
          ) : null}
        </p>
        {notification.body ? (
          <p className="mt-0.5 text-[13px] leading-relaxed text-text-secondary">
            {notification.body}
          </p>
        ) : null}
        <p className="mt-1 text-2xs text-text-muted">
          <time dateTime={notification.createdAt} title={formatTimestamp(notification.createdAt)}>
            {formatRelative(notification.createdAt)}
          </time>
        </p>
      </div>
    </div>
  )

  return (
    <li className={cn(!notification.readAt && 'bg-forest-50/50')}>
      {target ? (
        <Link
          to={target}
          onClick={() => {
            if (!notification.readAt) onRead()
          }}
          className="block px-5 py-3.5 transition-colors hover:bg-canvas-sunken"
        >
          {body}
        </Link>
      ) : (
        <div className="px-5 py-3.5">
          {body}
          {!notification.readAt ? (
            <Button size="sm" variant="ghost" className="mt-2" onClick={onRead}>
              Mark as read
            </Button>
          ) : null}
        </div>
      )}
    </li>
  )
}
