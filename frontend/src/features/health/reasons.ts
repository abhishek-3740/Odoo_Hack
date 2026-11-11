import { formatBusinessDate } from '@/lib/dates'
import { formatMoney, formatQuantity } from '@/lib/money'

/**
 * Turns an alert reason into something a person can read.
 *
 * The sweep stores reasons as a JSON array of `{ code, message, ...fields }`
 * objects. `code` is routing metadata, and the remaining fields are the exact
 * numbers behind the sentence — useful, but only once they are named and
 * formatted. Nothing here ever falls back to `JSON.stringify`: a shape this
 * module does not recognise is summarised, not dumped as source code.
 */

export interface ReasonDetail {
  label: string
  value: string
}

export interface DescribedReason {
  message: string
  details: ReasonDetail[]
}

/** Keys that are either internal or already represented by the message. */
const HIDDEN_KEYS = new Set(['code', 'message'])

const LABELS: Record<string, string> = {
  promisedDate: 'Promised date',
  expectedDate: 'Expected date',
  dueDate: 'Due date',
  outstandingQuantity: 'Outstanding quantity',
  available: 'Available',
  reorderPoint: 'Reorder point',
  suggestedOrderQuantity: 'Suggested order',
}

function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function labelFor(key: string): string {
  if (LABELS[key]) return LABELS[key]
  // `outstandingMinor` is the same figure as `outstanding`, in minor units.
  if (key.endsWith('Minor')) return labelFor(key.slice(0, -'Minor'.length))
  return humanizeKey(key)
}

function formatValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return key.endsWith('Minor') ? formatMoney(value / 100, 'INR') : formatQuantity(value)
  }
  if (typeof value === 'string') {
    return /^\d{4}-\d{2}-\d{2}/.test(value) ? formatBusinessDate(value) : value
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => (typeof entry === 'object' ? null : String(entry)))
      .filter((entry): entry is string => Boolean(entry))
    return parts.length > 0 ? parts.join(', ') : null
  }
  // Nested objects have no safe one-line rendering. Say what we know and move on.
  return null
}

function describeObject(reason: Record<string, unknown>): DescribedReason {
  const details = Object.entries(reason)
    .filter(([key]) => !HIDDEN_KEYS.has(key))
    .map(([key, value]) => ({ label: labelFor(key), value: formatValue(key, value) }))
    .filter((detail): detail is ReasonDetail => detail.value !== null)

  const message = typeof reason.message === 'string' ? reason.message.trim() : ''
  if (message) return { message, details }

  // No sentence supplied: turn the fields themselves into one.
  if (details.length > 0) {
    return {
      message: details.map((detail) => `${detail.label} ${detail.value}`).join(' · '),
      details: [],
    }
  }
  return { message: 'The server flagged this record without further detail.', details: [] }
}

export function describeReason(reason: unknown): DescribedReason {
  if (typeof reason === 'string') {
    return { message: reason, details: [] }
  }
  if (Array.isArray(reason)) {
    const parts = reason.map((entry) => describeReason(entry).message).filter(Boolean)
    return {
      message: parts.join(' · ') || 'The server flagged this record without further detail.',
      details: [],
    }
  }
  if (reason !== null && typeof reason === 'object') {
    return describeObject(reason as Record<string, unknown>)
  }
  if (reason === null || reason === undefined) {
    return { message: 'The server flagged this record without further detail.', details: [] }
  }
  return { message: String(reason), details: [] }
}
