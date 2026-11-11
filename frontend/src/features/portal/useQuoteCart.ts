import { useCallback, useEffect, useState } from 'react'

import type { UUID } from '@/api'

/**
 * The catalogue selection a customer is building into a quotation request.
 *
 * Transient by nature, so it lives in `localStorage` rather than on the server:
 * nothing has been agreed, no price has been quoted, and abandoning it should
 * leave no trace anywhere but this browser. It is deliberately *not* mirrored
 * into the query cache — it is not a server record and must never look like one.
 *
 * Reads and writes are wrapped because a private window can throw on access; a
 * cart that cannot be saved still works for this tab.
 */

export interface CartLine {
  key: string
  variantId?: UUID
  planId?: UUID
  name: string
  /** List price for display only. The real price is resolved server-side. */
  listPrice: string
  currency: string
  cadence?: string
  quantity: number
}

const STORAGE_KEY = 'dealflow.quote-cart'

function read(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as CartLine[]) : []
  } catch {
    return []
  }
}

function write(lines: CartLine[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
  } catch {
    // Nothing to do; the in-memory cart still works for this tab.
  }
}

export function useQuoteCart() {
  const [lines, setLines] = useState<CartLine[]>(read)

  useEffect(() => {
    write(lines)
  }, [lines])

  const add = useCallback((line: Omit<CartLine, 'key' | 'quantity'> & { quantity?: number }) => {
    const key = line.variantId ? `v:${line.variantId}` : `p:${line.planId}`
    setLines((current) => {
      const existing = current.find((row) => row.key === key)
      if (existing) {
        return current.map((row) =>
          row.key === key ? { ...row, quantity: row.quantity + (line.quantity ?? 1) } : row,
        )
      }
      return [...current, { ...line, key, quantity: line.quantity ?? 1 }]
    })
  }, [])

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((current) =>
      current.map((row) => (row.key === key ? { ...row, quantity: Math.max(1, quantity) } : row)),
    )
  }, [])

  const remove = useCallback((key: string) => {
    setLines((current) => current.filter((row) => row.key !== key))
  }, [])

  const clear = useCallback(() => setLines([]), [])

  const has = useCallback(
    (id: UUID) => lines.some((row) => row.variantId === id || row.planId === id),
    [lines],
  )

  return { lines, add, setQuantity, remove, clear, has, count: lines.length }
}
