import { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api'

/**
 * Cache and retry policy.
 *
 * TanStack Query's defaults are tuned for content, not for a workflow where
 * another person's decision changes what the current user may do. Three
 * deliberate departures:
 *
 *  - **Retries are narrow.** A 401, 403, 404, 400 or 422 will fail identically
 *    the second time; retrying only delays the message and, on a mutation,
 *    risks repeating an action. Only genuinely transient failures are retried.
 *  - **Nothing is stale-forever.** Workflow reads go stale quickly because an
 *    approval can land at any moment; catalogue data is allowed to live longer
 *    because a price rule does not change while someone builds one quotation.
 *  - **Mutations never retry automatically.** Where an operation is idempotent
 *    the caller reuses its key deliberately; where it is not, a silent retry
 *    could record a payment twice.
 */

/** Fifteen seconds: long enough to avoid churn, short enough to feel live. */
const WORKFLOW_STALE_MS = 15_000

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false
  if (error instanceof ApiError) {
    if (error.isPermanent) return false
    if (error.status === 404 || error.status === 409) return false
    if (error.code === 'CONTRACT_ERROR') return false
  }
  return true
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: WORKFLOW_STALE_MS,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
        // Coming back to the tab is exactly when a decision may have landed.
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        // Previous figures stay on screen during a background refresh; the
        // screens show a small "refreshing" marker instead of blanking.
        placeholderData: (previous: unknown) => previous,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

/** Catalogue-shaped reads: they change rarely and are read on nearly every screen. */
export const CATALOG_QUERY_OPTIONS = {
  staleTime: 5 * 60_000,
  gcTime: 30 * 60_000,
} as const

/** Reference data that is effectively static for a session. */
export const REFERENCE_QUERY_OPTIONS = {
  staleTime: 15 * 60_000,
  gcTime: 60 * 60_000,
} as const
