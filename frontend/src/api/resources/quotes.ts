import { api, type Page } from '../client'
import {
  assertQuoteEvaluation,
  type AdoptRevisionRequest,
  type ApplyRecommendationRequest,
  type CancelQuoteRequest,
  type CreateEscalationRequest,
  type CreateQuoteRequest,
  type DismissRecommendationRequest,
  type Escalation,
  type NegotiationReplyRequest,
  type NegotiationView,
  type QuoteDraftRequest,
  type QuoteEvaluation,
  type QuoteHistoryEntry,
  type QuoteSummary,
  type ResolveEscalationRequest,
  type RevisionListEntry,
  type SellerRecommendationResult,
  type ShareResponse,
  type SubmitQuoteRequest,
  type UUID,
} from '../contracts'

export interface QuoteListParams {
  stage?: string | null
  customerId?: UUID | null
  ownerProfileId?: UUID | null
  page?: number
  pageSize?: number
  sort?: string
}

/**
 * Internal quotations.
 *
 * Sub-resources are nouns for things that happen to a quotation, so each has its
 * own authorisation and idempotency story. Note what is *not* here: nothing
 * sends a price, a total or a margin. The server resolves those and ignores a
 * client that tries.
 */
export const quotes = {
  list: (params: QuoteListParams = {}, signal?: AbortSignal) =>
    api.get<Page<QuoteSummary>>('/quotes', { query: params as Record<string, string>, signal }),

  create: (body: CreateQuoteRequest) =>
    api.post<QuoteEvaluation>('/quotes', body).then(assertQuoteEvaluation),

  get: (quoteId: UUID, signal?: AbortSignal) =>
    api.get<QuoteEvaluation>(`/quotes/${quoteId}`, { signal }).then(assertQuoteEvaluation),

  /**
   * A read-only re-price of draft terms. Persists nothing.
   *
   * Called on a debounce while the seller edits, and cancelled through `signal`
   * when a later edit supersedes it — so a slow earlier response can never
   * overwrite the figures for terms the user has already moved past.
   */
  evaluate: (quoteId: UUID, body: QuoteDraftRequest, signal?: AbortSignal) =>
    api
      .post<QuoteEvaluation>(`/quotes/${quoteId}/evaluations`, body, { signal })
      .then(assertQuoteEvaluation),

  /** Saves draft terms, or supersedes a submitted version with a new one. */
  saveRevision: (quoteId: UUID, body: QuoteDraftRequest) =>
    api.post<QuoteEvaluation>(`/quotes/${quoteId}/revisions`, body).then(assertQuoteEvaluation),

  revisions: (quoteId: UUID, signal?: AbortSignal) =>
    api.get<RevisionListEntry[]>(`/quotes/${quoteId}/revisions`, { signal }),

  revision: (quoteId: UUID, revisionId: UUID, signal?: AbortSignal) =>
    api
      .get<QuoteEvaluation>(`/quotes/${quoteId}/revisions/${revisionId}`, { signal })
      .then(assertQuoteEvaluation),

  submit: (quoteId: UUID, body: SubmitQuoteRequest) =>
    api.post<QuoteEvaluation>(`/quotes/${quoteId}/submissions`, body).then(assertQuoteEvaluation),

  share: (quoteId: UUID) => api.post<ShareResponse>(`/quotes/${quoteId}/shares`),

  /** Records that the seller stands behind these exact terms. */
  adopt: (quoteId: UUID, body: AdoptRevisionRequest) =>
    api.post<QuoteEvaluation>(`/quotes/${quoteId}/adoptions`, body).then(assertQuoteEvaluation),

  cancel: (quoteId: UUID, body: CancelQuoteRequest) =>
    api.post<QuoteEvaluation>(`/quotes/${quoteId}/cancellations`, body).then(assertQuoteEvaluation),

  history: (quoteId: UUID, signal?: AbortSignal) =>
    api.get<QuoteHistoryEntry[]>(`/quotes/${quoteId}/history`, { signal }),
}

/** The seller's side of the customer conversation. */
export const negotiation = {
  list: (quoteId: UUID, signal?: AbortSignal) =>
    api.get<NegotiationView[]>(`/quotes/${quoteId}/requests`, { signal }),

  /**
   * Replies to one request.
   *
   * A reply is a message. It does not adopt a proposal and does not change a
   * price — adopting the customer's candidate revision is a separate, explicit
   * action through {@link quotes.adopt}.
   */
  reply: (quoteId: UUID, requestId: UUID, body: NegotiationReplyRequest) =>
    api.post<NegotiationView>(`/quotes/${quoteId}/requests/${requestId}/responses`, body),
}

/** Seller recommendations: cross-sell adds a line, upsell replaces one. */
export const recommendations = {
  list: (quoteId: UUID, signal?: AbortSignal) =>
    api.get<SellerRecommendationResult>(`/quotes/${quoteId}/recommendations`, { signal }),

  /** Applies against the exact current revision; the returned quote is authoritative. */
  apply: (quoteId: UUID, body: ApplyRecommendationRequest) =>
    api
      .post<QuoteEvaluation>(`/quotes/${quoteId}/recommendation-applications`, body)
      .then(assertQuoteEvaluation),

  dismiss: (quoteId: UUID, body: DismissRecommendationRequest) =>
    api.post<{ quoteId: UUID; variantId: UUID; dismissed: boolean }>(
      `/quotes/${quoteId}/recommendation-dismissals`,
      body,
    ),
}

/**
 * Questions and escalations.
 *
 * Deliberately separate from approvals: closing one of these never approves a
 * quotation, and the wording in the UI has to keep saying so.
 */
export const escalations = {
  list: (quoteId?: UUID, signal?: AbortSignal) =>
    api.get<Escalation[]>('/escalations', { query: { quoteId }, signal }),

  create: (body: CreateEscalationRequest) => api.post<Escalation>('/escalations', body),

  resolve: (id: UUID, body: ResolveEscalationRequest) =>
    api.post<Escalation>(`/escalations/${id}/resolutions`, body),
}
