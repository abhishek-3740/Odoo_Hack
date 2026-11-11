import { api, download, fetchDocumentUrl, type Page } from '../client'
import {
  assertInvoice,
  assertPortalQuote,
  type AcceptanceRequest,
  type AcceptanceResponse,
  type Invoice,
  type InvoiceFormat,
  type PortalAccount,
  type PortalAccountUpdate,
  type PortalInvoiceSummary,
  type PortalQuoteDetail,
  type PortalQuoteRequest,
  type PortalQuoteSummary,
  type PortalRecommendationRequest,
  type PortalRecommendationResult,
  type PortalRequestBody,
  type UUID,
} from '../contracts'

/**
 * The customer portal.
 *
 * Kept in its own module with its own types so that a customer screen cannot
 * reach an internal endpoint by autocomplete. Nothing here returns cost, margin
 * or another customer's data — not because it is filtered, but because the
 * server's portal types have no field for it.
 */
export const portal = {
  quotes: (signal?: AbortSignal) => api.get<PortalQuoteSummary[]>('/portal/quotes', { signal }),

  quote: (quoteId: UUID, signal?: AbortSignal) =>
    api.get<PortalQuoteDetail>(`/portal/quotes/${quoteId}`, { signal }).then(assertPortalQuote),

  /** Asks for a quotation from the catalogue. Creates a real, list-priced quotation. */
  requestQuote: (body: PortalQuoteRequest, idempotencyKey: string) =>
    api.post<PortalQuoteDetail>('/portal/quote-requests', body, { idempotencyKey }),

  /**
   * A comment, change request or counteroffer.
   *
   * The key belongs to one intent: a triple-click on a slow connection produces
   * one request, one candidate revision and one approval chain.
   */
  submitRequest: (quoteId: UUID, body: PortalRequestBody, idempotencyKey: string) =>
    api
      .post<PortalQuoteDetail>(`/portal/quotes/${quoteId}/requests`, body, { idempotencyKey })
      .then(assertPortalQuote),

  /**
   * Accepts one exact version.
   *
   * Sends both the revision id and the commercial hash the customer was shown.
   * If the terms moved underneath them the server refuses with
   * ACCEPTANCE_HASH_MISMATCH rather than binding them to a price they never saw.
   */
  accept: (quoteId: UUID, body: AcceptanceRequest, idempotencyKey: string) =>
    api.post<AcceptanceResponse>(`/portal/quotes/${quoteId}/acceptances`, body, {
      idempotencyKey,
    }),

  invoices: (signal?: AbortSignal) =>
    api.get<PortalInvoiceSummary[]>('/portal/invoices', { signal }),

  invoice: (invoiceId: UUID, signal?: AbortSignal) =>
    api.get<Invoice>(`/portal/invoices/${invoiceId}`, { signal }).then(assertInvoice),

  downloadInvoice: (invoiceId: UUID, reference: string, format: InvoiceFormat = 'pdf') =>
    download(`/portal/invoices/${invoiceId}/export`, `invoice-${reference}.${format}`, { format }),

  previewInvoice: (invoiceId: UUID) =>
    fetchDocumentUrl(`/portal/invoices/${invoiceId}/export`, { format: 'pdf' }),

  recommendations: (quoteId: UUID, signal?: AbortSignal) =>
    api.get<PortalRecommendationResult>(`/portal/quotes/${quoteId}/recommendations`, { signal }),

  /** Asks the salesperson to consider an item. Not a price agreement. */
  requestRecommendation: (
    quoteId: UUID,
    body: PortalRecommendationRequest,
    idempotencyKey: string,
  ) =>
    api
      .post<PortalQuoteDetail>(`/portal/quotes/${quoteId}/recommendation-requests`, body, {
        idempotencyKey,
      })
      .then(assertPortalQuote),
}

export const portalAccount = {
  get: (signal?: AbortSignal) => api.get<PortalAccount>('/portal/account', { signal }),

  update: (body: PortalAccountUpdate) => api.patch<PortalAccount>('/portal/account', body),

  savePreferences: (preferences: Record<string, unknown>) =>
    api.put<PortalAccount>('/portal/account/preferences', { preferences }),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ changed: boolean }>('/portal/account/password', { currentPassword, newPassword }),
}

/** Re-exported so a portal screen never has to import the paged type separately. */
export type PortalPage<T> = Page<T>
