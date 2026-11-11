import { api, download, fetchDocumentUrl, type Page } from '../client'
import {
  assertInvoice,
  type CancelSubscriptionRequest,
  type CreditNote,
  type Invoice,
  type InvoiceFormat,
  type Payment,
  type PlanChangePreview,
  type PlanChangeRequest,
  type RecordPaymentRequest,
  type RecordRefundRequest,
  type Refund,
  type Subscription,
  type SubscriptionChangePreview,
  type SubscriptionChangeRequest,
  type UUID,
} from '../contracts'

/**
 * Invoices, subscriptions, payments, credits and refunds.
 *
 * Note the shapes the server actually uses: `/invoices` requires either a
 * customer or an order filter and answers with a page; `/subscriptions` answers
 * with a plain array; `/payments` and `/credit-notes` require a customer. Each
 * is respected here rather than smoothed into one imaginary list convention.
 */

export const billing = {
  /** Requires `customerId` or `orderId`. The server rejects an unfiltered call. */
  invoices: (
    params: { customerId?: UUID; orderId?: UUID; page?: number; pageSize?: number; sort?: string },
    signal?: AbortSignal,
  ) => api.get<Page<Invoice>>('/invoices', { query: params, signal }),

  invoice: (invoiceId: UUID, signal?: AbortSignal) =>
    api.get<Invoice>(`/invoices/${invoiceId}`, { signal }).then(assertInvoice),

  downloadInvoice: (invoiceId: UUID, reference: string, format: InvoiceFormat = 'pdf') =>
    download(`/invoices/${invoiceId}/export`, `invoice-${reference}.${format}`, { format }),

  previewInvoice: (invoiceId: UUID) =>
    fetchDocumentUrl(`/invoices/${invoiceId}/export`, { format: 'pdf' }),

  /** A plain array, not a page. Filter by customer or by order. */
  subscriptions: (params: { customerId?: UUID; orderId?: UUID }, signal?: AbortSignal) =>
    api.get<Subscription[]>('/subscriptions', { query: params, signal }),

  subscription: (subscriptionId: UUID, signal?: AbortSignal) =>
    api.get<Subscription>(`/subscriptions/${subscriptionId}`, { signal }),

  /**
   * Shows the arithmetic before committing. Persists nothing.
   *
   * The confirmation below must send the identical body: a preview computed from
   * different inputs than the change that follows it is worse than no preview.
   */
  previewQuantityChange: (
    subscriptionId: UUID,
    body: SubscriptionChangeRequest,
    signal?: AbortSignal,
  ) =>
    api.post<SubscriptionChangePreview>(
      `/subscriptions/${subscriptionId}/change-previews`,
      body,
      { signal },
    ),

  applyQuantityChange: (
    subscriptionId: UUID,
    body: SubscriptionChangeRequest,
    idempotencyKey: string,
  ) =>
    api.post<SubscriptionChangePreview>(`/subscriptions/${subscriptionId}/changes`, body, {
      idempotencyKey,
    }),

  cancelSubscription: (
    subscriptionId: UUID,
    body: CancelSubscriptionRequest,
    idempotencyKey: string,
  ) =>
    api.post<SubscriptionChangePreview>(`/subscriptions/${subscriptionId}/cancellations`, body, {
      idempotencyKey,
    }),

  previewPlanChange: (subscriptionId: UUID, body: PlanChangeRequest, signal?: AbortSignal) =>
    api.post<PlanChangePreview>(`/subscriptions/${subscriptionId}/plan-change-previews`, body, {
      signal,
    }),

  applyPlanChange: (subscriptionId: UUID, body: PlanChangeRequest, idempotencyKey: string) =>
    api.post<PlanChangePreview>(`/subscriptions/${subscriptionId}/plan-changes`, body, {
      idempotencyKey,
    }),

  /**
   * Records a receipt that already happened elsewhere.
   *
   * With no allocations the server applies it oldest-due first and keeps any
   * surplus as customer credit. This is bookkeeping, not a payment gateway.
   */
  recordPayment: (body: RecordPaymentRequest, idempotencyKey: string) =>
    api.post<Payment>('/payments', body, { idempotencyKey }),

  payments: (
    params: { customerId: UUID; page?: number; pageSize?: number },
    signal?: AbortSignal,
  ) => api.get<Page<Payment>>('/payments', { query: params, signal }),

  recordRefund: (body: RecordRefundRequest, idempotencyKey: string) =>
    api.post<Refund>('/refunds', body, { idempotencyKey }),

  creditNotes: (
    params: { customerId: UUID; page?: number; pageSize?: number },
    signal?: AbortSignal,
  ) => api.get<Page<CreditNote>>('/credit-notes', { query: params, signal }),
}
