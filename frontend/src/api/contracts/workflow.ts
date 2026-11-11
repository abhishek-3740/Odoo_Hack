import type {
  AlertSeverity,
  AlertStatus,
  AlertType,
  AllocationMode,
  ApprovalLevel,
  ApprovalRequestStatus,
  ApprovalStatus,
  BackorderStatus,
  BackorderTerms,
  BasisPoints,
  BusinessDate,
  Decimal,
  FulfillmentStatus,
  Instant,
  MovementType,
  OrderBillingStatus,
  OrderStatus,
  Role,
  ShipmentStatus,
  UUID,
} from './common'

/* ======================================================================
 * Approvals — approvals/dto/ApprovalDtos.java
 * ====================================================================== */

export type ApprovalDecision = 'APPROVE' | 'REJECT' | 'RETURN_FOR_REVISION'

export const APPROVAL_DECISION_LABEL: Record<ApprovalDecision, string> = {
  APPROVE: 'Approve',
  REJECT: 'Reject',
  RETURN_FOR_REVISION: 'Return for revision',
}

export interface DecisionRequest {
  decision: ApprovalDecision
  /** Guards against deciding a step whose terms have since been replaced. */
  expectedRevisionId?: UUID | null
  expectedRowVersion?: number | null
  reason?: string | null
}

export interface ReassignRequest {
  assigneeProfileId: UUID
  reason: string
}

export interface ApprovalReason {
  code: string
  lineKey: string | null
  description: string | null
  observedValue: Decimal | null
  thresholdValue: Decimal | null
  unit: string | null
  requiredLevel: ApprovalLevel | null
  message: string
}

/** A step in the approver's queue, with enough context to decide. */
export interface ApprovalQueueItem {
  id: UUID
  quoteId: UUID
  quoteReference: string | null
  customerName: string | null
  revisionId: UUID
  revisionNo: number
  step: number
  requiredRole: Role
  status: ApprovalRequestStatus
  assigneeProfileId: UUID | null
  assigneeName: string | null
  dueAt: Instant | null
  overdue: boolean
  /** False while an earlier step is still pending, or the version is superseded. */
  actionable: boolean
  blockedReason: string | null
  currency: string
  oneTimeNet: Decimal | null
  recurringFirstCycleNet: Decimal | null
  contributionPercent: Decimal | null
  worstLineExcessPp: Decimal | null
  reasons: ApprovalReason[]
  createdAt: Instant
}

export interface DecisionResponse {
  approvalRequestId: UUID
  stepStatus: ApprovalRequestStatus
  revisionApprovalStatus: ApprovalStatus
  /** Set when this decision completed the last gate and created an order. */
  orderId: UUID | null
  finalizationStatus: string | null
  remainingGates: string[]
}

/* ======================================================================
 * Orders — orders/controller/OrderController.java
 * ====================================================================== */

export interface OrderLine {
  id: UUID
  lineKey: string
  lineKind: 'ONE_TIME' | 'RECURRING'
  variantId: UUID | null
  planId: UUID | null
  description: string
  quantity: Decimal
  unitPrice: Decimal
  effectiveDiscountBp: BasisPoints
  net: Decimal
  tax: Decimal
  intervalMonths: number | null
  requiresStock: boolean
  promisedDate: BusinessDate | null
}

export interface Order {
  id: UUID
  reference: string
  quoteId: UUID
  revisionId: UUID
  customerId: UUID
  customerName: string | null
  ownerProfileId: UUID
  currency: string
  orderStatus: OrderStatus
  fulfillmentStatus: FulfillmentStatus
  billingStatus: OrderBillingStatus
  backorderTerms: BackorderTerms
  oneTimeNet: Decimal
  oneTimeTax: Decimal
  confirmedAt: Instant | null
  lines: OrderLine[]
  rowVersion: number
}

/* ======================================================================
 * Fulfilment — fulfillment/dto/FulfillmentDtos.java
 * ====================================================================== */

export interface AllocationLineRequest {
  orderLineId: UUID
  warehouseId: UUID
  quantity: Decimal | number
}

export interface OverrideAllocationRequest {
  allocations: AllocationLineRequest[]
  reason?: string | null
}

export interface DispatchRequest {
  trackingReference?: string | null
  note?: string | null
}

export interface StockMovementRequest {
  variantId: UUID
  warehouseId: UUID
  quantity: Decimal | number
  movementType: MovementType
  expectedNextReceiptDate?: BusinessDate | null
  expectedNextReceiptQty?: Decimal | number | null
  note?: string | null
}

export interface StockLevelUpdateRequest {
  variantId: UUID
  warehouseId: UUID
  reorderPoint?: Decimal | number | null
  targetQty?: Decimal | number | null
  expectedReceiptDate?: BusinessDate | null
  expectedReceiptQty?: Decimal | number | null
}

export interface PlannedAllocation {
  warehouseId: UUID
  warehouseCode: string
  warehouseName: string
  orderLineId: UUID
  lineKey: string
  description: string
  quantity: Decimal
}

export interface PlannedShortage {
  orderLineId: UUID
  lineKey: string
  description: string
  quantity: Decimal
  /** Only from a real expected receipt. Null means the date is unconfirmed. */
  expectedDate: BusinessDate | null
}

/** A costed plan. Before confirmation a preview; after it, what is reserved. */
export interface AllocationPlan {
  orderId: UUID
  mode: AllocationMode
  allocations: PlannedAllocation[]
  shortages: PlannedShortage[]
  shipmentCount: number
  estimatedShippingCost: Decimal
  score: Decimal
  fullyFulfilled: boolean
  /** False when the warehouse count exceeded the exhaustive search limit. */
  exhaustive: boolean
  backorderTerms: BackorderTerms
  preview: boolean
}

export interface ShipmentLine {
  id: UUID
  orderLineId: UUID
  lineKey: string | null
  description: string | null
  quantity: Decimal
}

export interface Shipment {
  id: UUID
  warehouseId: UUID
  warehouseCode: string | null
  warehouseName: string | null
  status: ShipmentStatus
  estimatedCost: Decimal
  dispatchedAt: Instant | null
  trackingReference: string | null
  lines: ShipmentLine[]
}

export interface Backorder {
  id: UUID
  orderLineId: UUID
  description: string | null
  quantity: Decimal
  expectedDate: BusinessDate | null
  status: BackorderStatus
  /** Set when a receipt has made stock available to close this shortage. */
  consolidationAvailable: boolean
}

export interface OrderFulfillment {
  orderId: UUID
  orderReference: string
  fulfillmentStatus: FulfillmentStatus
  backorderTerms: BackorderTerms
  shipments: Shipment[]
  backorders: Backorder[]
  replanSuggested: boolean
}

export interface StockLevel {
  variantId: UUID
  sku: string | null
  productName: string | null
  warehouseId: UUID
  warehouseCode: string | null
  onHand: Decimal
  reserved: Decimal
  available: Decimal
  reorderPoint: Decimal
  targetQty: Decimal
  expectedReceiptDate: BusinessDate | null
  needsReplenishment: boolean
  replenishmentSuggestion: Decimal
}

export interface StockMovement {
  id: UUID
  variantId: UUID
  warehouseId: UUID
  quantity: Decimal
  movementType: MovementType
  note: string | null
  occurredAt: Instant
  /** True when the idempotency key replayed an earlier receipt. */
  replayed: boolean
}

/* ======================================================================
 * Health and notifications — health/controller/AlertController.java
 * ====================================================================== */

export interface Alert {
  id: UUID
  alertType: AlertType
  severity: AlertSeverity
  status: AlertStatus
  title: string
  /** A free-form JSON array the server parsed out of the alert row. */
  reasons: unknown
  quoteId: UUID | null
  orderId: UUID | null
  subscriptionId: UUID | null
  invoiceId: UUID | null
  variantId: UUID | null
  ownerProfileId: UUID | null
  firstSeenAt: Instant
  lastSeenAt: Instant
  resolvedAt: Instant | null
  lastNudgedAt: Instant | null
  nudgeCount: number
}

export interface Notification {
  id: UUID
  type: string
  title: string
  body: string | null
  quoteId: UUID | null
  orderId: UUID | null
  invoiceId: UUID | null
  alertId: UUID | null
  readAt: Instant | null
  createdAt: Instant
}

/* ======================================================================
 * Operations — jobs/controller/JobController.java
 * ====================================================================== */

export type JobName = 'recurring-billing' | 'deal-health' | 'quote-expiry'

export interface JobRun {
  id: UUID
  jobName: string
  status: string
  trigger: string
  businessDate: string
  startedAt: Instant
  finishedAt: string
  processed: number
  failed: number
  message: string
}

/* ======================================================================
 * Live events — notifications/DealEventPublisher.java
 * ====================================================================== */

/**
 * The WebSocket frame. It carries an id, a type, the entity it concerns, a
 * version and a timestamp — and nothing else. The client uses it to decide what
 * to refetch over REST, where the authorised view is assembled per role.
 */
export interface DealEvent {
  eventId: UUID
  type: string
  entityType: string
  entityId: UUID
  version: number
  occurredAt: Instant
  payload: Record<string, unknown> | null
}
