import type {
  BasisPoints,
  BusinessDate,
  Decimal,
  Instant,
  NegotiationStatus,
  NegotiationType,
  UUID,
} from './common'

/**
 * The customer-facing surface — `portal/dto/PortalDtos.java`.
 *
 * These are separate types, not the internal ones with fields hidden. A portal
 * response has no field for unit cost, margin, policy threshold or another
 * customer, so nothing here can leak one. The same discipline applies on this
 * side of the wire: no customer screen imports a type from `quotes.ts`.
 */

// ------------------------------------------------------------- requests

/** A proposed change to one line, or to the order-level discount. */
export interface CounterLineRequest {
  lineKey: string
  quantity?: Decimal | number | null
  /** Bounded at 9999. A line that nets to zero is refused outright. */
  requestedDiscountBp?: BasisPoints | null
}

export interface PortalRequestBody {
  requestType: NegotiationType
  lineKey?: string | null
  message?: string | null
  lines?: CounterLineRequest[] | null
  requestedOrderDiscountBp?: BasisPoints | null
  /** The version the customer was looking at. A mismatch is refused. */
  expectedRevisionId: UUID
}

/**
 * An acceptance of one exact version.
 *
 * Both the revision id and the commercial hash are required: a click made on a
 * phone that has been asleep for an hour must not become consent to a price the
 * customer never saw.
 */
export interface AcceptanceRequest {
  revisionId: UUID
  commercialHash: string
  note?: string | null
}

// ------------------------------------------------------------ responses

/** A quotation line as the customer sees it. No cost, no margin. */
export interface PortalLine {
  lineKey: string
  description: string
  quantity: Decimal
  unitPrice: Decimal
  /** Line plus order discount combined — what this line actually costs. */
  discountPercentBp: BasisPoints
  /**
   * The discount carried by this line alone. A counteroffer proposes this
   * number; seeding a form with the combined figure would re-apply the
   * order-level discount a second time.
   */
  lineDiscountPercentBp: BasisPoints
  lineTotal: Decimal
  tax: Decimal
  billingCadence: string | null
  promisedDate: BusinessDate | null
  /** Availability as a plain statement, with no warehouse detail. */
  availabilityNote: string | null
}

export interface PortalRecurringTotal {
  cadence: string
  amount: Decimal
  tax: Decimal
}

export interface PortalTotals {
  currency: string
  oneTimeSubtotal: Decimal
  oneTimeTax: Decimal
  oneTimeTotal: Decimal
  recurring: PortalRecurringTotal[]
  /** What is payable on confirmation. Recurring charges are separate. */
  dueOnConfirmation: Decimal
}

export interface PortalActivity {
  id: UUID
  requestType: NegotiationType
  lineKey: string | null
  message: string | null
  status: NegotiationStatus
  responseMessage: string | null
  fromCustomer: boolean
  createdAt: Instant
  respondedAt: Instant | null
}

export interface PortalQuoteSummary {
  id: UUID
  reference: string
  title: string | null
  status: string
  currency: string
  oneTimeTotal: Decimal
  validUntil: BusinessDate | null
  updatedAt: Instant | null
}

export interface PortalQuoteDetail {
  id: UUID
  reference: string
  title: string | null
  revisionId: UUID
  versionNumber: number
  status: string
  /** Plain language: "Awaiting internal approval", never a threshold. */
  statusMessage: string
  awaitingInternalApproval: boolean
  /** The only correct source of "can I accept this". Never infer it from a stage. */
  acceptable: boolean
  acceptedByYou: boolean
  acceptedAt: Instant | null
  orderPlaced: boolean
  orderReference: string | null
  validUntil: BusinessDate | null
  expired: boolean
  backorderTerms: string | null
  invoicingNote: string | null
  /** Order-level discount on these terms, so a counteroffer can start from it. */
  orderDiscountBp: BasisPoints
  lines: PortalLine[]
  totals: PortalTotals
  activity: PortalActivity[]
  /** Echoed back on acceptance so the server can verify the exact terms. */
  commercialHash: string
}

export interface PortalInvoiceSummary {
  id: UUID
  reference: string
  status: string
  currency: string
  total: Decimal
  outstanding: Decimal
  issueDate: BusinessDate | null
  dueDate: BusinessDate | null
}

export interface AcceptanceResponse {
  quoteId: UUID
  revisionId: UUID
  accepted: boolean
  /** True when acceptance is recorded but approval is still outstanding. */
  conditional: boolean
  message: string
  orderReference: string | null
  remainingSteps: string[]
}

// --------------------------------------------------------- account & cart

export interface PortalOrganisation {
  id: UUID
  name: string
  tier: string
  currency: string
  contactEmail: string | null
  contactPhone: string | null
  billingAddress: string | null
}

export interface PortalContact {
  name: string | null
  email: string | null
}

export interface PortalAccount {
  profileId: UUID
  email: string
  fullName: string | null
  phone: string | null
  role: string
  /** LOCAL | DEMO | SUPABASE — which system holds the credential. */
  authProvider: 'LOCAL' | 'DEMO' | 'SUPABASE'
  canChangePassword: boolean
  memberSince: Instant | null
  organisation: PortalOrganisation | null
  accountManager: PortalContact | null
  preferences: Record<string, unknown>
}

export interface PortalAccountUpdate {
  fullName?: string | null
  phone?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  billingAddress?: string | null
}

/** One catalogue item to be priced: a variant or a plan, never both. */
export interface QuoteRequestLine {
  variantId?: UUID | null
  planId?: UUID | null
  quantity: Decimal | number
}

export interface PortalQuoteRequest {
  title?: string | null
  note?: string | null
  lines: QuoteRequestLine[]
}

// -------------------------------------------------- portal recommendations

/** The restricted offer a customer sees. No margin, no approval routing. */
export interface PortalOffer {
  variantId: UUID
  name: string
  type: 'CROSS_SELL' | 'UPSELL' | string
  replaceLineKey: string | null
  unitPrice: Decimal
  netDelta: Decimal
  availabilityNote: string | null
}

export interface PortalRecommendationResult {
  revisionId: UUID
  suggestions: PortalOffer[]
  limitedHistory: boolean
}

export interface PortalRecommendationRequest {
  variantId: UUID
  replaceLineKey?: string | null
  expectedRevisionId: UUID
}
