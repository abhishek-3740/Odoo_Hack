import type {
  BillingAnchor,
  BusinessDate,
  CancellationPolicy,
  CreditNoteStatus,
  Decimal,
  Instant,
  InvoiceKind,
  InvoiceLineType,
  InvoiceStatus,
  ProrationPolicy,
  SubscriptionStatus,
  UUID,
} from './common'

/** The billing surface — `billing/dto/BillingDtos.java`. */

// ------------------------------------------------------------- requests

/** Explicit allocation of a receipt to one invoice. */
export interface PaymentAllocationRequest {
  invoiceId: UUID
  amount: Decimal | number
}

/**
 * A recorded receipt.
 *
 * With no allocations the amount is applied to open invoices oldest-due first,
 * and anything left over stays as customer credit rather than pushing an
 * invoice negative. This form records money that already moved; it is not a
 * payment gateway and never claims to be one.
 */
export interface RecordPaymentRequest {
  customerId: UUID
  amount: Decimal | number
  method: string
  externalReference?: string | null
  note?: string | null
  allocations?: PaymentAllocationRequest[] | null
}

export interface RecordRefundRequest {
  creditNoteId: UUID
  amount: Decimal | number
  method: string
  externalReference?: string | null
  note?: string | null
}

/** A quantity change on a live subscription. Backdating is refused. */
export interface SubscriptionChangeRequest {
  newQuantity: Decimal | number
  effectiveDate?: BusinessDate | null
  note?: string | null
}

export interface PlanChangeRequest {
  newPlanId: UUID
  effectiveDate?: BusinessDate | null
  note?: string | null
  expectedRowVersion?: number | null
}

export interface CancelSubscriptionRequest {
  /** END_OF_PERIOD | IMMEDIATE_PRORATED. Defaults to the plan's own policy. */
  policy?: CancellationPolicy | null
  effectiveDate?: BusinessDate | null
  reason?: string | null
}

// ------------------------------------------------------------ responses

export interface InvoiceLine {
  id: UUID
  description: string
  quantity: Decimal
  unitPrice: Decimal
  net: Decimal
  tax: Decimal
  coverageStart: BusinessDate | null
  coverageEnd: BusinessDate | null
  lineType: InvoiceLineType
}

export interface Invoice {
  id: UUID
  reference: string
  customerId: UUID
  customerName: string | null
  orderId: UUID | null
  subscriptionId: UUID | null
  invoiceKind: InvoiceKind
  status: InvoiceStatus
  currency: string
  issueDate: BusinessDate | null
  dueDate: BusinessDate | null
  net: Decimal
  tax: Decimal
  total: Decimal
  credited: Decimal
  paid: Decimal
  /** Derived server-side: total less credits and payments. */
  outstanding: Decimal
  lines: InvoiceLine[]
}

export interface PaymentAllocation {
  invoiceId: UUID
  invoiceReference: string | null
  amount: Decimal
  invoiceOutstanding: Decimal | null
  invoiceStatus: InvoiceStatus | null
}

export interface Payment {
  id: UUID
  reference: string
  customerId: UUID
  amount: Decimal
  allocated: Decimal
  /** Receipt in excess of the debt; stays as customer credit. */
  unallocated: Decimal
  method: string
  externalReference: string | null
  recordedAt: Instant
  allocations: PaymentAllocation[]
}

export interface CreditNote {
  id: UUID
  reference: string
  customerId: UUID
  subscriptionId: UUID | null
  currency: string
  reason: string | null
  net: Decimal
  tax: Decimal
  total: Decimal
  applied: Decimal
  refunded: Decimal
  available: Decimal
  coverageStart: BusinessDate | null
  coverageEnd: BusinessDate | null
  status: CreditNoteStatus
  createdAt: Instant
}

export interface Refund {
  id: UUID
  reference: string
  creditNoteId: UUID
  amount: Decimal
  method: string
  recordedAt: Instant
}

/** Preview or result of a quantity change, with the arithmetic shown. */
export interface SubscriptionChangePreview {
  subscriptionId: UUID
  changeType: string
  effectiveDate: BusinessDate
  periodStart: BusinessDate
  periodEnd: BusinessDate
  remainingDays: number
  totalDays: number
  remainingFraction: Decimal
  priorQuantity: Decimal
  newQuantity: Decimal
  /** Positive is an extra charge; negative is a credit. */
  adjustmentNet: Decimal
  adjustmentTax: Decimal
  explanation: string
  /** Set once applied. */
  adjustmentInvoiceId: UUID | null
  creditNoteId: UUID | null
  applied: boolean
}

/** Preview or result of a plan switch — `PlanSwitchService.Preview`. */
export interface PlanChangePreview {
  subscriptionId: UUID
  newPlanId: UUID
  newPlanName: string | null
  rowVersion: number
  effectiveDate: BusinessDate
  coverageEnd: BusinessDate | null
  oldCreditNet: Decimal
  oldCreditTax: Decimal
  newChargeNet: Decimal
  newChargeTax: Decimal
  intervalChanged: boolean
  explanation: string
  invoiceId: UUID | null
  creditNoteId: UUID | null
  applied: boolean
}

export interface Subscription {
  id: UUID
  reference: string
  orderId: UUID
  customerId: UUID
  customerName: string | null
  planId: UUID
  planName: string | null
  currency: string
  quantity: Decimal
  unitIntervalPrice: Decimal
  intervalMonths: number
  cadence: string
  activationDate: BusinessDate | null
  periodStart: BusinessDate | null
  periodEnd: BusinessDate | null
  nextBillAt: BusinessDate | null
  status: SubscriptionStatus
  cancelEffectiveDate: BusinessDate | null
  prorationPolicy: ProrationPolicy
  cancellationPolicy: CancellationPolicy
  /** A normalised monthly value for reporting. Never an invoice amount. */
  monthlyRecurringRevenue: Decimal
  rowVersion: number
}

/** Payment methods the recording forms offer. Free text on the wire. */
export const PAYMENT_METHODS = [
  'BANK_TRANSFER',
  'UPI',
  'CHEQUE',
  'CARD',
  'CASH',
  'ADJUSTMENT',
] as const

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  BANK_TRANSFER: 'Bank transfer',
  UPI: 'UPI',
  CHEQUE: 'Cheque',
  CARD: 'Card',
  CASH: 'Cash',
  ADJUSTMENT: 'Internal adjustment',
}

export type { BillingAnchor }
