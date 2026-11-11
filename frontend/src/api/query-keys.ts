import type { ReportFilter, UUID } from './contracts'

/**
 * Query keys, partitioned by session.
 *
 * Every key begins with a scope token that changes on sign-in, sign-out and
 * persona switch. The cache is cleared at the same moment, so the token is not
 * the only defence — it is there for the race the clear cannot cover: a read
 * that was already in flight for the previous identity and settles a moment
 * after the new one has loaded. Under a shared key that response would be
 * written into the new user's cache. Under a scoped key it lands somewhere
 * nothing is subscribed to and is garbage-collected.
 */

let scope = 'anonymous'

/** Called by the auth layer whenever the acting identity changes. */
export function setQueryScope(profileId: string | null): void {
  scope = profileId ?? 'anonymous'
}

export function currentQueryScope(): string {
  return scope
}

const root = () => ['dealflow', scope] as const

/** Serialises a filter object into a stable, comparable key segment. */
function stable(value: object): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  )
}

export const keys = {
  all: root,

  // --------------------------------------------------------------- identity
  me: () => [...root(), 'me'] as const,
  authOptions: () => ['dealflow', 'anonymous', 'auth-options'] as const,
  demoAccounts: () => ['dealflow', 'anonymous', 'demo-accounts'] as const,
  publicTeams: () => ['dealflow', 'anonymous', 'public-teams'] as const,

  // ----------------------------------------------------------------- quotes
  quotes: () => [...root(), 'quotes'] as const,
  quoteList: (params: object) => [...root(), 'quotes', 'list', stable(params)] as const,
  quote: (id: UUID) => [...root(), 'quotes', id] as const,
  quoteRevisions: (id: UUID) => [...root(), 'quotes', id, 'revisions'] as const,
  quoteRevision: (id: UUID, revisionId: UUID) =>
    [...root(), 'quotes', id, 'revisions', revisionId] as const,
  quoteHistory: (id: UUID) => [...root(), 'quotes', id, 'history'] as const,
  quoteRequests: (id: UUID) => [...root(), 'quotes', id, 'requests'] as const,
  quoteRecommendations: (id: UUID) => [...root(), 'quotes', id, 'recommendations'] as const,

  // ------------------------------------------------------------- approvals
  approvals: () => [...root(), 'approvals'] as const,
  approvalQueue: (params: object) => [...root(), 'approvals', 'queue', stable(params)] as const,
  approval: (id: UUID) => [...root(), 'approvals', id] as const,

  escalations: (quoteId?: UUID) => [...root(), 'escalations', quoteId ?? 'all'] as const,

  // ----------------------------------------------------------------- orders
  orders: () => [...root(), 'orders'] as const,
  orderList: (params: object) => [...root(), 'orders', 'list', stable(params)] as const,
  order: (id: UUID) => [...root(), 'orders', id] as const,
  orderAllocation: (id: UUID) => [...root(), 'orders', id, 'allocation'] as const,
  orderFulfillment: (id: UUID) => [...root(), 'orders', id, 'fulfillment'] as const,

  // ------------------------------------------------------------------ stock
  stockLevels: (params: object) => [...root(), 'stock-levels', stable(params)] as const,

  // ---------------------------------------------------------------- billing
  invoices: (params: object) => [...root(), 'invoices', stable(params)] as const,
  invoice: (id: UUID) => [...root(), 'invoices', id] as const,
  subscriptions: (params: object) => [...root(), 'subscriptions', stable(params)] as const,
  subscription: (id: UUID) => [...root(), 'subscriptions', id] as const,
  payments: (params: object) => [...root(), 'payments', stable(params)] as const,
  creditNotes: (params: object) => [...root(), 'credit-notes', stable(params)] as const,

  // ---------------------------------------------------------------- catalog
  customers: (params: object) => [...root(), 'customers', stable(params)] as const,
  customer: (id: UUID) => [...root(), 'customers', id] as const,
  categories: () => [...root(), 'categories'] as const,
  products: (params: object) => [...root(), 'products', stable(params)] as const,
  product: (id: UUID) => [...root(), 'products', id] as const,
  variants: (productId: UUID) => [...root(), 'variants', productId] as const,
  priceRules: (variantId: UUID) => [...root(), 'price-rules', variantId] as const,
  plans: (productId?: UUID) => [...root(), 'plans', productId ?? 'all'] as const,
  warehouses: () => [...root(), 'warehouses'] as const,
  /** Anonymous: the storefront is the same for everyone, so it is not scoped. */
  storefront: () => ['dealflow', 'anonymous', 'storefront'] as const,

  // ----------------------------------------------------------------- portal
  portalQuotes: () => [...root(), 'portal', 'quotes'] as const,
  portalQuote: (id: UUID) => [...root(), 'portal', 'quotes', id] as const,
  portalQuoteRecommendations: (id: UUID) =>
    [...root(), 'portal', 'quotes', id, 'recommendations'] as const,
  portalInvoices: () => [...root(), 'portal', 'invoices'] as const,
  portalInvoice: (id: UUID) => [...root(), 'portal', 'invoices', id] as const,
  portalAccount: () => [...root(), 'portal', 'account'] as const,

  // ----------------------------------------------------- health and inbox
  alerts: (params: object) => [...root(), 'alerts', stable(params)] as const,
  notifications: (params: object) => [...root(), 'notifications', stable(params)] as const,

  // ------------------------------------------------------- admin and misc
  profiles: (params: object) => [...root(), 'profiles', stable(params)] as const,
  teams: () => [...root(), 'teams'] as const,
  delegations: () => [...root(), 'delegations'] as const,
  policyCurrent: () => [...root(), 'policy', 'current'] as const,
  policyHistory: () => [...root(), 'policy', 'history'] as const,
  jobRuns: () => [...root(), 'job-runs'] as const,
  report: (filter: ReportFilter) => [...root(), 'reports', 'sales', stable(filter)] as const,
  assistantStatus: () => [...root(), 'assistant', 'status'] as const,
}
