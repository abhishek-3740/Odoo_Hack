import type {
  ApprovalLevel,
  ApprovalRequestStatus,
  ApprovalStatus,
  BackorderTerms,
  BasisPoints,
  BusinessDate,
  Decimal,
  Instant,
  NegotiationStatus,
  NegotiationType,
  RevisionSource,
  RevisionStatus,
  Role,
  Stage,
  UUID,
} from './common'

/**
 * The internal quotation surface — `quotes/dto/QuoteDtos.java`.
 *
 * Requests carry identifiers, quantities and *requested* discounts and nothing
 * else. A client that sends a price is ignored, so no view model here has a
 * writable price field for someone to wire up by mistake.
 */

// ------------------------------------------------------------- requests

export interface CreateQuoteRequest {
  customerId: UUID
  title?: string | null
  validUntil?: BusinessDate | null
}

/** Exactly one of `variantId` or `planId`. The server refuses both or neither. */
export interface QuoteLineRequest {
  /** Stable across revisions. Omit for a new line; echo it when editing one. */
  lineKey?: string | null
  variantId?: UUID | null
  planId?: UUID | null
  quantity: Decimal | number
  lineDiscountBp?: BasisPoints | null
  promisedDate?: BusinessDate | null
  source?: string | null
}

export interface QuoteDraftRequest {
  lines: QuoteLineRequest[]
  orderDiscountBp?: BasisPoints | null
  backorderTerms?: BackorderTerms | null
  requestedActivationDate?: BusinessDate | null
  /** Omit for a pure evaluation; required when saving, so a stale editor cannot overwrite. */
  expectedRowVersion?: number | null
}

export interface SubmitQuoteRequest {
  expectedRevisionId: UUID
  expectedRowVersion?: number | null
  note?: string | null
}

export interface AdoptRevisionRequest {
  revisionId: UUID
  expectedRowVersion?: number | null
  note?: string | null
}

export interface CancelQuoteRequest {
  reason?: string | null
  expectedRowVersion?: number | null
}

// ------------------------------------------------------------ responses

export interface EvaluatedLine {
  lineKey: string
  position: number
  lineKind: 'ONE_TIME' | 'RECURRING'
  productId: UUID | null
  variantId: UUID | null
  planId: UUID | null
  categoryCode: string | null
  description: string
  quantity: Decimal
  unitPrice: Decimal
  /** Internal only. Absent from every customer-facing type by construction. */
  unitCost: Decimal | null
  taxRateBp: number
  lineDiscountBp: BasisPoints
  appliedOrderDiscountBp: BasisPoints
  effectiveDiscountBp: BasisPoints
  base: Decimal
  net: Decimal
  tax: Decimal
  costTotal: Decimal | null
  margin: Decimal | null
  /** Null, not zero, when there is no revenue to divide by. */
  marginPercent: Decimal | null
  intervalMonths: number | null
  requiresStock: boolean
  promisedDate: BusinessDate | null
  source: string | null
}

/** A recurring subtotal for one cadence. Cadences are never summed together. */
export interface RecurringTotal {
  intervalMonths: number
  cadence: string
  net: Decimal
  tax: Decimal
  cost: Decimal | null
  margin: Decimal | null
  marginPercent: Decimal | null
}

/**
 * Deliberately several numbers rather than one.
 *
 * ₹39,300 once and ₹3,000 a month are not ₹42,300 of anything the customer
 * pays today. `comparisonNet` exists only to give risk and margin a consistent
 * denominator and is labelled as such everywhere it is shown.
 */
export interface Totals {
  currency: string
  oneTimeNet: Decimal
  oneTimeTax: Decimal
  oneTimeTotal: Decimal
  recurring: RecurringTotal[]
  recurringFirstCycleNet: Decimal
  /** What is actually payable on confirmation. */
  initialAmountDue: Decimal
  /** One-time plus first full recurring cycles: the risk denominator. */
  comparisonNet: Decimal
  contribution: Decimal | null
  contributionPercent: Decimal | null
  /** A reporting metric. Never an invoice amount. */
  monthlyRecurringRevenue: Decimal
  totalBase: Decimal
  totalDiscount: Decimal
}

export interface RiskReason {
  code: string
  lineKey: string | null
  description: string | null
  observedValue: Decimal | null
  thresholdValue: Decimal | null
  unit: string | null
  requiredLevel: ApprovalLevel | null
  message: string
}

export interface LineRisk {
  lineKey: string
  description: string
  categoryCode: string | null
  effectiveDiscountPercent: Decimal
  allowedPercent: Decimal
  excessPp: Decimal
  excessValue: Decimal
  margin: Decimal | null
  marginPercent: Decimal | null
}

export interface RiskSummary {
  requiredLevel: ApprovalLevel
  reasons: RiskReason[]
  lines: LineRisk[]
  /** M: the worst single line, in percentage points over its ceiling. */
  worstLineExcessPp: Decimal | null
  /** W: value-weighted excess. Percentage points, not a probability. */
  weightedExcessPp: Decimal | null
  /** E: total money conceded beyond ceilings. */
  excessConcessionValue: Decimal | null
  /** D: overall effective discount across the quotation. */
  aggregateDiscountPercent: Decimal | null
  aggregateMarginPercent: Decimal | null
  policyVersionNo: number | null
}

export interface WarehouseStock {
  warehouseId: UUID
  warehouseCode: string
  warehouseName: string
  available: Decimal
  expectedReceiptDate: BusinessDate | null
}

/** Availability beside a line. A preview: it reserves nothing. */
export interface StockPreview {
  lineKey: string
  variantId: UUID
  description: string
  requested: Decimal
  available: Decimal
  shortfall: Decimal
  earliestExpectedReceipt: BusinessDate | null
  byWarehouse: WarehouseStock[]
}

/**
 * The independent conditions for creating an order.
 *
 * Seller agreement, internal approval and customer acceptance are three facts
 * that may land in any order. `blockingReasons` lists what is still missing in
 * words a user can act on.
 */
export interface GateSummary {
  approvalStatus: ApprovalStatus
  approvalCleared: boolean
  sellerAdopted: boolean
  customerAccepted: boolean
  expired: boolean
  orderExists: boolean
  orderId: UUID | null
  readyToExecute: boolean
  blockingReasons: string[]
}

export interface ApprovalStep {
  id: UUID
  step: number
  requiredRole: Role
  status: ApprovalRequestStatus
  assigneeProfileId: UUID | null
  assigneeName: string | null
  dueAt: Instant | null
  decidedByProfileId: UUID | null
  decidedByName: string | null
  decidedAt: Instant | null
  decisionReason: string | null
}

/** The full evaluated picture of one revision. */
export interface QuoteEvaluation {
  quoteId: UUID
  reference: string
  title: string | null
  customerId: UUID
  customerName: string | null
  customerTier: string | null
  ownerProfileId: UUID
  stage: Stage
  validUntil: BusinessDate | null
  revisionId: UUID
  revisionNo: number
  revisionStatus: RevisionStatus
  revisionSource: RevisionSource
  currency: string
  orderDiscountBp: BasisPoints
  backorderTerms: BackorderTerms
  invoicingTerms: string | null
  requestedActivationDate: BusinessDate | null
  lines: EvaluatedLine[]
  totals: Totals
  risk: RiskSummary
  stockPreview: StockPreview[]
  gates: GateSummary
  approvals: ApprovalStep[]
  /**
   * The fingerprint of these exact commercial terms.
   *
   * Minted when the revision is submitted, so a draft that has never been
   * submitted legitimately has none. Anything that needs it — sharing,
   * acceptance, a counteroffer — is gated behind a submitted revision anyway.
   */
  commercialHash: string | null
  rowVersion: number
  /** True for a read-only evaluation that changed nothing. */
  preview: boolean
}

export interface QuoteSummary {
  id: UUID
  reference: string
  title: string | null
  customerId: UUID
  customerName: string | null
  ownerProfileId: UUID
  ownerName: string | null
  stage: Stage
  approvalStatus: ApprovalStatus
  currency: string
  oneTimeNet: Decimal | null
  recurringFirstCycleNet: Decimal | null
  contributionPercent: Decimal | null
  revisionNo: number
  validUntil: BusinessDate | null
  lastActivityAt: Instant | null
  lastProgressAt: Instant | null
  awaitingExternalSince: Instant | null
  rowVersion: number
}

export interface ShareResponse {
  quoteId: UUID
  stage: Stage
  portalPath: string
  commercialHash: string
}

/** `GET /quotes/{id}/revisions` — a hand-built map, not a record. */
export interface RevisionListEntry {
  id: UUID
  revisionNo: number
  status: RevisionStatus
  source: RevisionSource
  approvalStatus: ApprovalStatus
  oneTimeNet: Decimal
  recurringFirstCycleNet: Decimal
  /** Stringified server-side, so an absent value arrives as the text "null". */
  submittedAt: string
  customerAcceptedAt: string
  current: boolean
}

/** `GET /quotes/{id}/history` — the attributable audit trail. */
export interface QuoteHistoryEntry {
  id: UUID
  action: string
  entityType: string
  actor: string
  reason: string
  after: string
  occurredAt: Instant
}

// ---------------------------------------------------------- negotiation

/** The internal view of a customer's request. `NegotiationDeskService`. */
export interface NegotiationView {
  id: UUID
  requestType: NegotiationType
  lineKey: string | null
  message: string | null
  status: NegotiationStatus
  responseMessage: string | null
  revisionId: UUID
  candidateRevisionId: UUID | null
  raisedBy: string | null
  respondedBy: string | null
  createdAt: Instant
  respondedAt: Instant | null
  /** What was proposed: `requestedOrderDiscountBp` and a `lines` array. */
  payload: NegotiationPayload | null
}

export interface NegotiationPayload {
  requestedOrderDiscountBp?: BasisPoints
  lines?: Array<{
    lineKey: string
    quantity?: Decimal | number | null
    requestedDiscountBp?: BasisPoints | null
  }>
  [key: string]: unknown
}

export interface NegotiationReplyRequest {
  message: string
  /** ANSWERED (default) or DECLINED. */
  decision?: 'ANSWERED' | 'DECLINED'
}

// ---------------------------------------------------------- escalations

export interface Escalation {
  id: UUID
  quoteId: UUID
  revisionId: UUID
  reference: string
  raisedBy: UUID
  category: 'DISCOUNT' | 'POLICY' | 'REVIEW'
  targetRole: Role
  reason: string
  status: 'OPEN' | 'RESOLVED'
  resolution: string | null
  createdAt: Instant
  resolvedAt: Instant | null
}

export interface CreateEscalationRequest {
  quoteId: UUID
  expectedRevisionId: UUID
  /** The caller's own key for this intent; the server dedupes on it. */
  requestKey: UUID
  category: 'DISCOUNT' | 'POLICY' | 'REVIEW'
  reason: string
}

export interface ResolveEscalationRequest {
  resolution: string
}
