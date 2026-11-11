import type { Me, Role } from '@/api'

/**
 * What the signed-in identity may do.
 *
 * `/me` computes these server-side from the database role, and every endpoint
 * re-checks its own rules regardless. They are used here for one purpose only:
 * to avoid offering a control that would certainly fail, and to say *why* when
 * a control is disabled. They are never the only thing between a user and a
 * mutation.
 *
 * Two rules the plan calls out and this module enforces:
 *  - Check the specific capability, not a broad role wrapper. A Manager allowed
 *    to publish policy must not be blocked by an Admin-only screen guard.
 *  - Ownership and endpoint rules still apply on top. A rep holding
 *    `quotes:edit-own` may still not edit someone else's quotation.
 */

export type Capability =
  | 'quotes:create'
  | 'quotes:edit-own'
  | 'quotes:submit'
  | 'quotes:share'
  | 'quotes:adopt'
  | 'quotes:read-team'
  | 'quotes:read-all'
  | 'recommendations:read'
  | 'approvals:manager'
  | 'approvals:finance'
  | 'approvals:reassign'
  | 'policy:read'
  | 'allocations:override'
  | 'stock:receive'
  | 'shipments:dispatch'
  | 'payments:record'
  | 'refunds:record'
  | 'subscriptions:change'
  | 'reports:own'
  | 'reports:team'
  | 'reports:all'
  | 'alerts:own'
  | 'alerts:team'
  | 'alerts:all'
  | 'alerts:nudge'
  | 'jobs:run'
  | 'admin:catalog'
  | 'admin:policy'
  | 'admin:warehouses'
  | 'admin:plans'
  | 'admin:profiles'
  | 'portal:quotes'
  | 'portal:negotiate'
  | 'portal:accept'
  | 'portal:invoices'

export function can(me: Me | null, capability: Capability): boolean {
  return Boolean(me?.capabilities?.includes(capability))
}

export function canAny(me: Me | null, ...capabilities: Capability[]): boolean {
  return capabilities.some((capability) => can(me, capability))
}

export function hasRole(me: Me | null, ...roles: Role[]): boolean {
  return me != null && roles.includes(me.role)
}

/**
 * Where a role lands after signing in.
 *
 * Each is the screen that answers "what needs me right now" for that role,
 * rather than a generic dashboard everyone has to navigate away from.
 */
export const ROLE_HOME: Record<Role, string> = {
  REP: '/admin',
  MANAGER: '/admin',
  FINANCE: '/admin',
  ADMIN: '/admin',
  CUSTOMER: '/customer',
}

/**
 * Publishing discount policy.
 *
 * The server allows ADMIN and MANAGER (`@PreAuthorize` on the publish endpoint),
 * which is exactly why this is a named predicate rather than an inline
 * `role === 'ADMIN'` scattered through the governance screen.
 */
export function canPublishPolicy(me: Me | null): boolean {
  return hasRole(me, 'ADMIN', 'MANAGER')
}

/** Reading the policy is open to every internal role. */
export function canReadPolicy(me: Me | null): boolean {
  return me != null && me.role !== 'CUSTOMER'
}

/** Running a manual job: finance and administrators. */
export function canRunJobs(me: Me | null): boolean {
  return can(me, 'jobs:run')
}

/** Only managers, finance and administrators may run a health sweep. */
export function canSweepAlerts(me: Me | null): boolean {
  return hasRole(me, 'MANAGER', 'FINANCE', 'ADMIN')
}
