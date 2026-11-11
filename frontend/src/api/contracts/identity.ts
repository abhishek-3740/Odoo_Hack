import type { BusinessDate, CustomerTier, Decimal, Instant, Role, UUID } from './common'

/* ======================================================================
 * Identity — auth/*
 * ====================================================================== */

/** What the sign-in page may offer, so it never renders a form that cannot work. */
export interface AuthOptions {
  passwordLogin: boolean
  selfRegistration: boolean
  demoPersonas: boolean
}

export interface LoginRequest {
  email: string
  password?: string
}

export interface RegisterRequest {
  email: string
  password: string
  fullName: string
  companyName: string
  phone?: string | null
}

export interface InternalRegisterRequest {
  email: string
  password: string
  fullName: string
  role: Exclude<Role, 'CUSTOMER'>
  teamId?: UUID | null
  teamName?: string | null
  phone?: string | null
}

export interface AuthToken {
  email: string
  fullName: string | null
  role: Role
  tokenType: string
  accessToken: string
  expiresIn: number
  capabilities: string[]
  sampleCurl?: string | null
}

export interface DemoAccount {
  email: string
  fullName?: string | null
  role: Role
  token: string
  [key: string]: unknown
}

/**
 * Who am I, and what may I do — as the server sees it.
 *
 * `capabilities` is a courtesy to the UI; every endpoint enforces the same rules
 * again. The UI uses it to avoid offering an action that will certainly fail,
 * never as the only thing standing between a user and a mutation.
 */
export interface Me {
  profileId: UUID
  email: string
  fullName: string | null
  phone: string | null
  role: Role
  teamId: UUID | null
  customerId: UUID | null
  customerName: string | null
  customerTier: CustomerTier | null
  internal: boolean
  authProvider: 'LOCAL' | 'DEMO' | 'SUPABASE'
  capabilities: string[]
}

export interface Team {
  id: UUID
  name: string
  [key: string]: unknown
}

/* ======================================================================
 * People administration — auth/controller/ProfileAdminController.java
 * ====================================================================== */

export interface ProvisionProfileRequest {
  email: string
  fullName?: string | null
  role: Role
  teamId?: UUID | null
  customerId?: UUID | null
}

export interface ProfileUpdateRequest {
  role?: Role | null
  teamId?: UUID | null
  customerId?: UUID | null
  active?: boolean | null
  unavailableUntil?: Instant | null
  fullName?: string | null
}

export interface Profile {
  id: UUID
  authUserId: UUID | null
  email: string
  fullName: string | null
  role: Role
  teamId: UUID | null
  customerId: UUID | null
  active: boolean
  unavailableUntil: Instant | null
  /** True once a real identity has claimed this pre-provisioned profile. */
  bound: boolean
}

export interface DelegationRequest {
  approverRole: Exclude<Role, 'CUSTOMER' | 'REP'> | Role
  teamId?: UUID | null
  delegateProfileId: UUID
  validFrom: Instant
  validUntil: Instant
  reason: string
}

export interface Delegation {
  id: UUID
  approverRole: Role
  teamId: UUID | null
  delegateProfileId: UUID
  validFrom: Instant
  validUntil: Instant
  reason: string
  activeNow: boolean
}

/* ======================================================================
 * Discount policy — policy/*
 * ====================================================================== */

export interface ManagerTriggers {
  /** Any excess at all routes to a manager. */
  anyPositiveExcess: boolean
  /** Aggregate concession budget: strictly above this routes to manager. */
  aggregateDiscountPercentAbove: Decimal
  /** Strictly below this overall margin routes to manager. */
  aggregateMarginPercentBelow: Decimal
}

export interface FinanceTriggers {
  /** M — worst single line, in percentage points over its ceiling. */
  worstLineExcessPpAtLeast: Decimal
  /** W — value-weighted excess across the quotation. */
  weightedExcessPpAtLeast: Decimal
  /** E — total money conceded beyond ceilings, in minor units. */
  excessValueMinorAtLeast: number
  aggregateMarginPercentBelow: Decimal
  /** A line that sells at a positive price yet earns nothing or loses money. */
  nonPositiveLineContribution: boolean
}

export interface DiscountPolicyDefinition {
  tierCeilingPercent: Record<CustomerTier, Decimal>
  /** Keyed by category CODE, so renaming a category does not move its ceiling. */
  categoryCeilingPercent: Record<string, Decimal>
  manager: ManagerTriggers
  finance: FinanceTriggers
}

export interface DiscountPolicy {
  id: UUID | null
  versionNo: number
  definition: DiscountPolicyDefinition
  effectiveAt: Instant
  note: string | null
  current: boolean
}

export interface PublishPolicyRequest {
  definition: DiscountPolicyDefinition
  note?: string | null
}

/* ======================================================================
 * Reporting — reporting/dto/ReportDtos.java
 * ====================================================================== */

/**
 * Date semantics are fixed and documented: quotations by creation date, orders
 * by confirmation date, invoices by issue date, payments by recorded date.
 */
export interface ReportFilter {
  from?: BusinessDate | null
  to?: BusinessDate | null
  ownerProfileId?: UUID | null
  teamId?: UUID | null
  customerId?: UUID | null
  stage?: string | null
  categoryId?: UUID | null
}

export interface StageCount {
  stage: string
  count: number
  oneTimeNet: Decimal
}

export interface RepRow {
  ownerProfileId: UUID
  ownerName: string | null
  quotations: number
  orders: number
  oneTimeSales: Decimal
  monthlyRecurringRevenue: Decimal
  averageDiscountPercent: Decimal | null
}

export interface CategoryRow {
  categoryId: UUID
  categoryCode: string
  categoryName: string
  oneTimeSales: Decimal
  recurringFirstCycle: Decimal
  contribution: Decimal | null
  contributionPercent: Decimal | null
  lines: number
}

export interface ProductRow {
  productId: UUID
  productCode: string
  productName: string
  quantity: Decimal
  net: Decimal
  orders: number
}

export interface QuoteRow {
  quoteId: UUID
  reference: string
  customerName: string | null
  ownerName: string | null
  stage: string
  approvalStatus: string
  currency: string
  oneTimeNet: Decimal
  recurringFirstCycleNet: Decimal
  contributionPercent: Decimal | null
  createdOn: BusinessDate
}

/**
 * Four money figures that are never added together, because they answer four
 * different questions: one-time sales, MRR, invoiced and collected.
 */
export interface SalesReport {
  filter: ReportFilter
  currency: string
  /** When the figures were computed, so an export cannot pass as live. */
  generatedAt: Instant
  quotationCount: number
  orderCount: number
  invoiceCount: number
  paymentCount: number
  oneTimeSales: Decimal
  monthlyRecurringRevenue: Decimal
  invoicedRevenue: Decimal
  cashCollected: Decimal
  outstandingReceivables: Decimal
  pipeline: StageCount[]
  byRep: RepRow[]
  byCategory: CategoryRow[]
  topProducts: ProductRow[]
  quotations: QuoteRow[]
}

/* ======================================================================
 * Assistant — assistant/AssistantController.java
 * ====================================================================== */

export interface AssistantStatus {
  configured: boolean
  provider: string
  role: Role
}

export interface AssistantTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantChatRequest {
  message: string
  quoteId?: UUID | null
  /** At most eight prior turns; the server bounds it. */
  history?: AssistantTurn[]
}

export interface AssistantAnswer {
  answer: string
  generatedAt: Instant
  scope: string
  sources: string[]
}

/* ======================================================================
 * Seller recommendations — recommendations/service/DealRecommendationService
 * ====================================================================== */

export interface SellerOffer {
  variantId: UUID
  name: string
  /** CROSS_SELL adds a line; UPSELL replaces the identified compatible one. */
  type: 'CROSS_SELL' | 'UPSELL' | string
  replaceLineKey: string | null
  reason: string | null
  basis: string | null
  promoted: boolean
  unitPrice: Decimal
  netDelta: Decimal
  contributionDelta: Decimal | null
  marginPercentDelta: Decimal | null
  /** What accepting this offer would require: NONE, MANAGER, MANAGER_FINANCE. */
  requiredApproval: string | null
  availabilityNote: string | null
  inStock: boolean
}

export interface SellerRecommendationResult {
  revisionId: UUID
  rowVersion: number
  suggestions: SellerOffer[]
  limitedHistory: boolean
  note: string | null
  eligibleHistoricalOrders: number
}

export interface ApplyRecommendationRequest {
  variantId: UUID
  replaceLineKey?: string | null
  expectedRevisionId: UUID
  expectedRowVersion: number
}

export interface DismissRecommendationRequest {
  variantId: UUID
}
