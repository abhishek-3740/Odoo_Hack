import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, ChevronDown, LogOut, RefreshCcw, User, Wifi, WifiOff } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { keys, notifications as notificationsApi, ROLE_LABEL, type Notification } from '@/api'
import { useAuth } from '@/auth/useAuth'
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  Spinner,
  Tooltip,
} from '@/design-system'
import { formatRelative } from '@/lib/dates'
import { cn } from '@/lib/cn'
import { useConnectionStatus } from '@/realtime/RealtimeProvider'

/**
 * Live-connection indicator.
 *
 * Says which of three states the workspace is in, because they mean different
 * things to someone waiting on an approval: live, reconnecting, or falling back
 * to polling every few seconds.
 */
export function ConnectionIndicator({ className }: { className?: string }) {
  const status = useConnectionStatus()

  const copy =
    status === 'connected'
      ? { label: 'Live', detail: 'Changes from other people appear as they happen.' }
      : status === 'connecting'
        ? { label: 'Reconnecting', detail: 'Re-establishing the live connection.' }
        : {
            label: 'Not live',
            detail: 'The live connection is down. This screen re-reads every few seconds instead.',
          }

  return (
    <Tooltip content={copy.detail}>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-2xs font-medium',
          status === 'connected'
            ? 'border-ok-border bg-ok-surface text-ok-text'
            : status === 'connecting'
              ? 'border-wait-border bg-wait-surface text-wait-text'
              : 'border-neutral-border bg-neutral-surface text-neutral-text',
          className,
        )}
      >
        {status === 'disconnected' ? (
          <WifiOff className="size-3" aria-hidden />
        ) : (
          <Wifi className="size-3" aria-hidden />
        )}
        <span className="hidden sm:inline">{copy.label}</span>
        <span className="sr-only">Live connection: {copy.label}</span>
      </span>
    </Tooltip>
  )
}

/**
 * The notification inbox.
 *
 * The badge is the server's own unread count from the response meta, not the
 * length of the first page and not the number of open escalations. Those are
 * different quantities and conflating them is how a "3" appears next to an
 * empty list.
 */
export function NotificationBell() {
  const queryClient = useQueryClient()
  const params = { pageSize: 12 }

  const inbox = useQuery({
    queryKey: keys.notifications(params),
    queryFn: ({ signal }) => notificationsApi.inbox(params, signal),
    refetchInterval: 60_000,
  })

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'notifications'] })
    },
  })

  const unread = inbox.data?.unread ?? 0
  const items: Notification[] = inbox.data?.page.items ?? []

  return (
    <Popover
      align="end"
      className="p-0"
      trigger={
        <button
          type="button"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          className="relative inline-flex size-10 items-center justify-center rounded-[--radius-control] text-text-secondary transition-colors hover:bg-canvas-sunken hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-500"
        >
          <Bell className="size-[18px]" aria-hidden />
          {unread > 0 ? (
            <span className="tabular absolute right-1 top-1 min-w-4 rounded-full bg-brass-500 px-1 text-center text-[10px] font-bold leading-4 text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </button>
      }
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="text-[13px] font-semibold text-text">Notifications</p>
        <div className="flex items-center gap-2">
          {inbox.isFetching ? <Spinner /> : null}
          <Link to="/admin/notifications" className="text-2xs font-medium text-forest-600 hover:underline">
            See all
          </Link>
        </div>
      </div>

      <div className="scroll-subtle max-h-96 overflow-y-auto">
        {items.length === 0 ? (
          <EmptyState
            icon={<Bell className="size-5" aria-hidden />}
            title="Nothing waiting"
            description="Approvals, customer replies and delivery changes arrive here."
            className="py-8"
          />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((notification) => {
              const target = notification.quoteId
                ? `/admin/quotes/${notification.quoteId}`
                : notification.orderId
                  ? `/admin/orders/${notification.orderId}`
                  : notification.invoiceId
                    ? `/admin/invoices/${notification.invoiceId}`
                    : '/admin/notifications'
              return (
                <li key={notification.id}>
                  <Link
                    to={target}
                    onClick={() => {
                      if (!notification.readAt) markRead.mutate(notification.id)
                    }}
                    className={cn(
                      'block px-4 py-3 transition-colors hover:bg-canvas-sunken',
                      !notification.readAt && 'bg-forest-50/60',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {!notification.readAt ? (
                        <span
                          aria-hidden
                          className="mt-1.5 size-1.5 shrink-0 rounded-full bg-forest-500"
                        />
                      ) : (
                        <span aria-hidden className="mt-1.5 size-1.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium leading-snug text-text">
                          {notification.title}
                        </p>
                        {notification.body ? (
                          <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-text-secondary">
                            {notification.body}
                          </p>
                        ) : null}
                        <p className="mt-1 text-2xs text-text-muted">
                          {formatRelative(notification.createdAt)}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Popover>
  )
}

/** The signed-in identity, its role, and the way out. */
export function UserMenu({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { me, session, signOut, refresh } = useAuth()
  const navigate = useNavigate()
  if (!me) return null

  const initials =
    (me.fullName ?? me.email)
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'

  return (
    <Menu
      trigger={
        <button
          type="button"
          className={cn(
            'flex min-w-0 items-center gap-2 rounded-[--radius-control] py-1.5 pl-1.5 pr-2 transition-colors',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-500',
            tone === 'dark' ? 'hover:bg-ink-700' : 'hover:bg-canvas-sunken',
          )}
        >
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-forest-500 text-2xs font-bold text-white"
          >
            {initials}
          </span>
          <span className="hidden min-w-0 text-left lg:block">
            <span
              className={cn(
                'block max-w-36 truncate text-[13px] font-semibold leading-tight',
                tone === 'dark' ? 'text-text-inverse' : 'text-text',
              )}
            >
              {me.fullName ?? me.email}
            </span>
            <span
              className={cn(
                'block text-2xs leading-tight',
                tone === 'dark' ? 'text-text-inverse-muted' : 'text-text-muted',
              )}
            >
              {ROLE_LABEL[me.role]}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              'size-3.5 shrink-0',
              tone === 'dark' ? 'text-text-inverse-muted' : 'text-text-muted',
            )}
          />
        </button>
      }
    >
      <MenuLabel>Signed in</MenuLabel>
      <div className="px-2.5 pb-2">
        <p className="truncate text-[13px] font-medium text-text">{me.fullName ?? me.email}</p>
        <p className="truncate text-2xs text-text-muted">{me.email}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral" size="sm">
            {ROLE_LABEL[me.role]}
          </Badge>
          {me.customerName ? (
            <Badge tone="brass" size="sm">
              {me.customerName}
            </Badge>
          ) : null}
          {session?.source === 'DEMO' ? (
            <Badge tone="wait" size="sm">
              Demo persona
            </Badge>
          ) : null}
        </div>
      </div>
      <MenuSeparator />
      {me.role === 'CUSTOMER' ? (
        <MenuItem icon={<User className="size-3.5" />} onSelect={() => navigate('/customer/account')}>
          Account settings
        </MenuItem>
      ) : null}
      <MenuItem icon={<RefreshCcw className="size-3.5" />} onSelect={() => void refresh()}>
        Refresh my permissions
      </MenuItem>
      <MenuSeparator />
      <MenuItem tone="danger" icon={<LogOut className="size-3.5" />} onSelect={() => signOut()}>
        Sign out
      </MenuItem>
    </Menu>
  )
}

/** A visible way back to the sign-in chooser for demo walkthroughs. */
export function SwitchPersonaButton() {
  const { session, signOut } = useAuth()
  if (session?.source !== 'DEMO') return null
  return (
    <Button size="sm" variant="ghost" className="hidden sm:inline-flex" onClick={() => signOut()}>
      Switch persona
    </Button>
  )
}

export { IconButton }
