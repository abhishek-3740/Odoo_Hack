import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'

import { keys, type DealEvent } from '@/api'
import { useAuth } from '@/auth/useAuth'

import {
  connectRealtime,
  disconnectRealtime,
  getConnectionStatus,
  onConnectionStatus,
  onDealEvent,
  type ConnectionStatus,
} from './connection'

/**
 * Turns server events into targeted cache invalidations.
 *
 * Two things this deliberately does not do:
 *
 *  - It does not put event payloads into the cache. A frame carries an id, a
 *    type and a version; the authorised view of a record is assembled per role
 *    on the server, so the client refetches instead of patching.
 *  - It does not invalidate everything on every frame. A busy quotation can emit
 *    several events in a second; those are coalesced into one flush so a burst
 *    costs one round trip per affected resource, not one per frame.
 */

/** How long to gather events before flushing invalidations. */
const COALESCE_MS = 250

/** Fallback poll interval while the socket is down. Bounded, and never in a hidden tab. */
const FALLBACK_POLL_MS = 5000

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { session, me } = useAuth()
  const queryClient = useQueryClient()
  const token = session?.token ?? null

  useEffect(() => {
    if (!token) {
      disconnectRealtime()
      return
    }
    connectRealtime(token)
    return () => disconnectRealtime()
  }, [token])

  // ------------------------------------------------- coalesced invalidation
  const pending = useRef<DealEvent[]>([])
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!me) return

    const flush = () => {
      timer.current = null
      const batch = pending.current
      pending.current = []
      if (batch.length === 0) return

      const quoteIds = new Set<string>()
      const orderIds = new Set<string>()
      let touchesApprovals = false
      let touchesBilling = false
      let touchesInbox = false

      for (const event of batch) {
        const entity = (event.entityType ?? '').toUpperCase()
        const type = (event.type ?? '').toUpperCase()

        if (entity === 'QUOTE' || entity === 'QUOTE_REVISION' || type.startsWith('QUOTE')) {
          const id = (event.payload?.quoteId as string) ?? event.entityId
          if (id) quoteIds.add(id)
        }
        if (entity === 'ORDER' || type.startsWith('ORDER') || type.includes('FULFIL')) {
          const id = (event.payload?.orderId as string) ?? event.entityId
          if (id) orderIds.add(id)
        }
        if (entity === 'APPROVAL_REQUEST' || type.includes('APPROVAL')) {
          touchesApprovals = true
          const id = event.payload?.quoteId as string | undefined
          if (id) quoteIds.add(id)
        }
        if (
          entity === 'INVOICE' ||
          entity === 'SUBSCRIPTION' ||
          entity === 'PAYMENT' ||
          type.includes('INVOICE') ||
          type.includes('PAYMENT')
        ) {
          touchesBilling = true
        }
        if (entity === 'NOTIFICATION' || entity === 'ALERT' || type.includes('NOTIF')) {
          touchesInbox = true
        }
      }

      // A quotation event always affects that quotation and the lists it appears
      // in — including the customer's own view of it, which is a separate cache.
      if (quoteIds.size > 0) {
        void queryClient.invalidateQueries({ queryKey: keys.quotes() })
        void queryClient.invalidateQueries({ queryKey: keys.portalQuotes() })
        for (const id of quoteIds) {
          void queryClient.invalidateQueries({ queryKey: keys.quote(id) })
          void queryClient.invalidateQueries({ queryKey: keys.portalQuote(id) })
        }
      }
      if (orderIds.size > 0) {
        void queryClient.invalidateQueries({ queryKey: keys.orders() })
        for (const id of orderIds) {
          void queryClient.invalidateQueries({ queryKey: keys.order(id) })
          void queryClient.invalidateQueries({ queryKey: keys.orderAllocation(id) })
          void queryClient.invalidateQueries({ queryKey: keys.orderFulfillment(id) })
        }
      }
      if (touchesApprovals) {
        void queryClient.invalidateQueries({ queryKey: keys.approvals() })
      }
      if (touchesBilling) {
        void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'invoices'] })
        void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'subscriptions'] })
        void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'payments'] })
        void queryClient.invalidateQueries({ queryKey: keys.portalInvoices() })
      }
      if (touchesInbox) {
        void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'notifications'] })
        void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'alerts'] })
      }
    }

    const unsubscribe = onDealEvent((event) => {
      pending.current.push(event)
      if (timer.current === null) {
        timer.current = window.setTimeout(flush, COALESCE_MS)
      }
    })

    return () => {
      unsubscribe()
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
        timer.current = null
      }
      pending.current = []
    }
  }, [me, queryClient])

  // ------------------------------------------------- reconnect and fallback
  useEffect(() => {
    if (!me) return

    let pollTimer: number | null = null

    const stopPolling = () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer)
        pollTimer = null
      }
    }

    const startPolling = () => {
      if (pollTimer !== null) return
      pollTimer = window.setInterval(() => {
        // Only refresh what is actually mounted, and never in a background tab.
        if (document.visibilityState !== 'visible') return
        void queryClient.invalidateQueries({ type: 'active' })
      }, FALLBACK_POLL_MS)
    }

    const react = (next: ConnectionStatus) => {
      if (next === 'connected') {
        stopPolling()
        // Whatever happened during the gap was not delivered. Re-read what the
        // user can currently see rather than assuming the cache is still true.
        void queryClient.invalidateQueries({ type: 'active' })
      } else if (next === 'disconnected') {
        startPolling()
      }
    }

    react(getConnectionStatus())
    const unsubscribe = onConnectionStatus(react)

    return () => {
      unsubscribe()
      stopPolling()
    }
  }, [me, queryClient])

  return <>{children}</>
}

/** Subscribes a component to connection status for a live indicator. */
export function useConnectionStatus(): ConnectionStatus {
  return useSyncExternalStore(onConnectionStatus, getConnectionStatus, getConnectionStatus)
}
