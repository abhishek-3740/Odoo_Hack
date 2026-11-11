import { api, download } from '../client'
import type {
  AssistantAnswer,
  AssistantChatRequest,
  AssistantStatus,
  DiscountPolicy,
  PublishPolicyRequest,
  ReportFilter,
  ReportFormat,
  SalesReport,
} from '../contracts'

/** Report filters go on the query string exactly as the server names them. */
function reportQuery(filter: ReportFilter): Record<string, string | undefined> {
  return {
    from: filter.from ?? undefined,
    to: filter.to ?? undefined,
    ownerProfileId: filter.ownerProfileId ?? undefined,
    teamId: filter.teamId ?? undefined,
    customerId: filter.customerId ?? undefined,
    stage: filter.stage ?? undefined,
    categoryId: filter.categoryId ?? undefined,
  }
}

export const reports = {
  sales: (filter: ReportFilter = {}, signal?: AbortSignal) =>
    api.get<SalesReport>('/reports/sales', { query: reportQuery(filter), signal }),

  /** The same service call, rendered. The file is the screen, not a summary of it. */
  export: (filter: ReportFilter, format: ReportFormat) =>
    download('/reports/sales/export', `dealflow-sales.${format}`, {
      ...reportQuery(filter),
      format,
    }),
}

/**
 * Discount governance.
 *
 * Publishing creates a new immutable version. Revisions already submitted keep
 * the version they were judged against, so a policy change never retroactively
 * approves or rejects a deal.
 */
export const policy = {
  current: (signal?: AbortSignal) => api.get<DiscountPolicy>('/discount-policies/current', { signal }),

  history: (signal?: AbortSignal) => api.get<DiscountPolicy[]>('/discount-policies', { signal }),

  publish: (body: PublishPolicyRequest) => api.post<DiscountPolicy>('/discount-policies', body),
}

/**
 * The workspace assistant.
 *
 * The endpoint returns one complete answer. There is no token stream, so the UI
 * shows an honest pending state rather than animating a fake one.
 */
export const assistant = {
  status: (signal?: AbortSignal) => api.get<AssistantStatus>('/assistant/status', { signal }),

  chat: (body: AssistantChatRequest, signal?: AbortSignal) =>
    api.post<AssistantAnswer>('/assistant/chat', body, { signal }),
}
