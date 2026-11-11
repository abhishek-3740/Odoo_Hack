import {
  ALERT_TYPE_LABEL,
  APPROVAL_LEVEL_LABEL,
  APPROVAL_REQUEST_STATUS_LABEL,
  APPROVAL_STATUS_LABEL,
  CREDIT_NOTE_STATUS_LABEL,
  FULFILLMENT_STATUS_LABEL,
  INVOICE_STATUS_LABEL,
  NEGOTIATION_STATUS_LABEL,
  REVISION_STATUS_LABEL,
  SHIPMENT_STATUS_LABEL,
  STAGE_LABEL,
  SUBSCRIPTION_STATUS_LABEL,
} from '@/api'

import type { BadgeTone } from './primitives'

/**
 * One place that decides how a server state is worded and coloured.
 *
 * Every screen goes through here, so "PENDING_FINANCE" reads the same in the
 * pipeline, the deal workspace and the approver's queue. The label always
 * carries the meaning; the tone only reinforces it.
 */

export interface StatusPresentation {
  label: string
  tone: BadgeTone
}

function present(
  value: string | null | undefined,
  labels: Record<string, string>,
  tones: Record<string, BadgeTone>,
  fallback: StatusPresentation,
): StatusPresentation {
  if (!value) return fallback
  return {
    label: labels[value] ?? humanise(value),
    tone: tones[value] ?? fallback.tone,
  }
}

/** Last resort for a state we have no wording for: never print raw SNAKE_CASE. */
export function humanise(value: string): string {
  const words = value.toLowerCase().replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const STAGE_TONES: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  REVIEW: 'wait',
  SENT: 'info',
  UNDER_NEGOTIATION: 'brass',
  CONFIRMED: 'ok',
  CANCELED: 'neutral',
  LOST: 'stop',
  EXPIRED: 'stop',
}

export const stageStatus = (value: string | null | undefined) =>
  present(value, STAGE_LABEL, STAGE_TONES, { label: 'Unknown', tone: 'neutral' })

const APPROVAL_TONES: Record<string, BadgeTone> = {
  NOT_EVALUATED: 'neutral',
  NOT_REQUIRED: 'ok',
  PENDING_MANAGER: 'wait',
  PENDING_FINANCE: 'wait',
  APPROVED: 'ok',
  REJECTED: 'stop',
  REVISION_REQUIRED: 'brass',
}

export const approvalStatus = (value: string | null | undefined) =>
  present(value, APPROVAL_STATUS_LABEL, APPROVAL_TONES, { label: 'Unknown', tone: 'neutral' })

const STEP_TONES: Record<string, BadgeTone> = {
  PENDING: 'wait',
  APPROVED: 'ok',
  REJECTED: 'stop',
  REVISION_REQUIRED: 'brass',
  SUPERSEDED: 'neutral',
}

export const approvalStepStatus = (value: string | null | undefined) =>
  present(value, APPROVAL_REQUEST_STATUS_LABEL, STEP_TONES, { label: 'Unknown', tone: 'neutral' })

const LEVEL_TONES: Record<string, BadgeTone> = {
  NONE: 'ok',
  MANAGER: 'wait',
  MANAGER_FINANCE: 'brass',
}

export const approvalLevelStatus = (value: string | null | undefined) =>
  present(value, APPROVAL_LEVEL_LABEL, LEVEL_TONES, { label: 'Not evaluated', tone: 'neutral' })

const REVISION_TONES: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  SUPERSEDED: 'neutral',
  CANCELED: 'stop',
}

export const revisionStatus = (value: string | null | undefined) =>
  present(value, REVISION_STATUS_LABEL, REVISION_TONES, { label: 'Unknown', tone: 'neutral' })

const NEGOTIATION_TONES: Record<string, BadgeTone> = {
  OPEN: 'wait',
  ANSWERED: 'info',
  ADOPTED: 'ok',
  DECLINED: 'stop',
  SUPERSEDED: 'neutral',
}

export const negotiationStatus = (value: string | null | undefined) =>
  present(value, NEGOTIATION_STATUS_LABEL, NEGOTIATION_TONES, { label: 'Unknown', tone: 'neutral' })

const INVOICE_TONES: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  ISSUED: 'wait',
  PARTIALLY_PAID: 'info',
  PAID: 'ok',
  VOID: 'neutral',
}

export const invoiceStatus = (value: string | null | undefined) =>
  present(value, INVOICE_STATUS_LABEL, INVOICE_TONES, { label: 'Unknown', tone: 'neutral' })

const SUBSCRIPTION_TONES: Record<string, BadgeTone> = {
  PENDING_ACTIVATION: 'wait',
  ACTIVE: 'ok',
  CANCEL_AT_PERIOD_END: 'brass',
  CANCELED: 'neutral',
}

export const subscriptionStatus = (value: string | null | undefined) =>
  present(value, SUBSCRIPTION_STATUS_LABEL, SUBSCRIPTION_TONES, {
    label: 'Unknown',
    tone: 'neutral',
  })

const FULFILLMENT_TONES: Record<string, BadgeTone> = {
  NOT_REQUIRED: 'neutral',
  UNALLOCATED: 'wait',
  PARTIALLY_RESERVED: 'wait',
  RESERVED: 'info',
  PARTIALLY_DISPATCHED: 'info',
  DISPATCHED: 'ok',
}

export const fulfillmentStatus = (value: string | null | undefined) =>
  present(value, FULFILLMENT_STATUS_LABEL, FULFILLMENT_TONES, { label: 'Unknown', tone: 'neutral' })

const SHIPMENT_TONES: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  RESERVED: 'info',
  DISPATCHED: 'ok',
  CANCELED: 'neutral',
}

export const shipmentStatus = (value: string | null | undefined) =>
  present(value, SHIPMENT_STATUS_LABEL, SHIPMENT_TONES, { label: 'Unknown', tone: 'neutral' })

const CREDIT_TONES: Record<string, BadgeTone> = {
  ISSUED: 'info',
  PARTIALLY_APPLIED: 'wait',
  APPLIED: 'ok',
  VOID: 'neutral',
}

export const creditNoteStatus = (value: string | null | undefined) =>
  present(value, CREDIT_NOTE_STATUS_LABEL, CREDIT_TONES, { label: 'Unknown', tone: 'neutral' })

const SEVERITY_TONES: Record<string, BadgeTone> = {
  INFO: 'info',
  WARNING: 'wait',
  CRITICAL: 'stop',
}

export const alertSeverity = (value: string | null | undefined): StatusPresentation => ({
  label: value ? humanise(value) : 'Unknown',
  tone: value ? (SEVERITY_TONES[value] ?? 'neutral') : 'neutral',
})

export const alertType = (value: string | null | undefined): string =>
  value ? (ALERT_TYPE_LABEL[value] ?? humanise(value)) : 'Alert'

/**
 * The customer portal's own status vocabulary.
 *
 * The server sends tokens (`AWAITING_YOUR_REVIEW`), not prose. Printing one at a
 * customer would be the crudest possible failure of this screen, so every value
 * the portal service can produce is worded here and anything unrecognised falls
 * back to sentence case rather than shouting.
 */
const PORTAL_STATUS: Record<string, StatusPresentation> = {
  IN_PREPARATION: { label: 'Being prepared', tone: 'neutral' },
  AWAITING_YOUR_REVIEW: { label: 'Ready for you to review', tone: 'info' },
  UNDER_DISCUSSION: { label: 'Under discussion', tone: 'brass' },
  ACCEPTED_PENDING_CONFIRMATION: { label: 'Accepted — confirming', tone: 'wait' },
  CONFIRMED: { label: 'Confirmed', tone: 'ok' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'stop' },
}

export function portalStatus(status: string | null | undefined): StatusPresentation {
  if (!status) return { label: 'Unknown', tone: 'neutral' }
  return PORTAL_STATUS[status] ?? { label: humanise(status), tone: 'info' }
}
