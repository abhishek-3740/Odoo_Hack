import { api, requestEnvelope, type Page } from '../client'
import type {
  Alert,
  AllocationPlan,
  ApprovalQueueItem,
  DecisionRequest,
  DecisionResponse,
  DispatchRequest,
  JobName,
  JobRun,
  Notification,
  Order,
  OrderFulfillment,
  OverrideAllocationRequest,
  ReassignRequest,
  Shipment,
  StockLevel,
  StockLevelUpdateRequest,
  StockMovement,
  StockMovementRequest,
  UUID,
} from '../contracts'

/* ---------------------------------------------------------------- approvals */

export const approvals = {
  /**
   * This approver's own queue.
   *
   * The server decides scope from the caller's role — a manager sees their team,
   * finance sees finance steps, a rep sees steps on their own quotations. The
   * client does not filter by role and must not pretend to.
   */
  queue: (
    params: { status?: string; page?: number; pageSize?: number; sort?: string } = {},
    signal?: AbortSignal,
  ) => api.get<Page<ApprovalQueueItem>>('/approval-requests', { query: params, signal }),

  get: (approvalRequestId: UUID, signal?: AbortSignal) =>
    api.get<ApprovalQueueItem>(`/approval-requests/${approvalRequestId}`, { signal }),

  /** Records a decision. The key makes a double-clicked approve one decision. */
  decide: (approvalRequestId: UUID, body: DecisionRequest, idempotencyKey: string) =>
    api.post<DecisionResponse>(`/approval-requests/${approvalRequestId}/decisions`, body, {
      idempotencyKey,
    }),

  reassign: (approvalRequestId: UUID, body: ReassignRequest) =>
    api.post<ApprovalQueueItem>(`/approval-requests/${approvalRequestId}/reassignments`, body),
}

/* ------------------------------------------------------------------- orders */

export const orders = {
  list: (
    params: { customerId?: UUID; page?: number; pageSize?: number; sort?: string } = {},
    signal?: AbortSignal,
  ) => api.get<Page<Order>>('/orders', { query: params, signal }),

  get: (orderId: UUID, signal?: AbortSignal) => api.get<Order>(`/orders/${orderId}`, { signal }),
}

/* -------------------------------------------------------------- fulfilment */

export const fulfillment = {
  /** The current plan: a preview before reservation, the real split after. */
  allocation: (orderId: UUID, signal?: AbortSignal) =>
    api.get<AllocationPlan>(`/orders/${orderId}/allocation`, { signal }),

  status: (orderId: UUID, signal?: AbortSignal) =>
    api.get<OrderFulfillment>(`/orders/${orderId}/fulfillment`, { signal }),

  /** A manual split, validated under locks and refused outright if infeasible. */
  override: (orderId: UUID, body: OverrideAllocationRequest) =>
    api.post<AllocationPlan>(`/orders/${orderId}/allocations`, body),

  /** Re-plans the unshipped remainder after a receipt. */
  replan: (orderId: UUID) => api.post<OrderFulfillment>(`/orders/${orderId}/replans`),

  dispatch: (shipmentId: UUID, body: DispatchRequest) =>
    api.post<Shipment>(`/shipments/${shipmentId}/dispatches`, body),
}

export const stock = {
  levels: (params: { warehouseId?: UUID; variantId?: UUID } = {}, signal?: AbortSignal) =>
    api.get<StockLevel[]>('/stock-levels', { query: params, signal }),

  /** Replenishment thresholds and expected receipts. Working configuration. */
  updateLevel: (body: StockLevelUpdateRequest) => api.patch<StockLevel>('/stock-levels', body),

  /**
   * A goods receipt or correction.
   *
   * Returns the movement plus, in `meta.consolidatableOrderIds`, the orders whose
   * backorders this receipt could now close — which is the whole reason the
   * receipt screen can offer "re-plan these orders" straight afterwards.
   */
  recordMovement: async (body: StockMovementRequest, idempotencyKey: string) => {
    const envelope = await requestEnvelope<StockMovement>('/stock-movements', {
      method: 'POST',
      body,
      idempotencyKey,
    })
    const ids = envelope.meta.consolidatableOrderIds
    return {
      movement: envelope.data,
      consolidatableOrderIds: Array.isArray(ids) ? (ids as UUID[]) : [],
    }
  },
}

/* --------------------------------------------------- health and notifications */

export const health = {
  alerts: (
    params: {
      status?: string
      type?: string
      page?: number
      pageSize?: number
      sort?: string
    } = {},
    signal?: AbortSignal,
  ) => api.get<Page<Alert>>('/alerts', { query: params, signal }),

  /** Sends the owner a real notification about a real alert. */
  nudge: (alertId: UUID, message?: string) =>
    api.post<Notification>(`/alerts/${alertId}/nudges`, { message }),

  /** Runs the health sweep now. Manager, finance and administrators only. */
  sweep: () => api.post<{ open: number; resolved: number }>('/alerts/sweeps'),
}

export const notifications = {
  /**
   * The durable inbox. The envelope's `meta.unread` is the real unread count —
   * the badge uses that and never a length of the first page.
   */
  inbox: async (params: { page?: number; pageSize?: number } = {}, signal?: AbortSignal) => {
    const envelope = await requestEnvelope<Page<Notification>>('/notifications', {
      query: params,
      signal,
    })
    return {
      page: envelope.data,
      unread: typeof envelope.meta.unread === 'number' ? envelope.meta.unread : 0,
    }
  },

  markRead: (notificationId: UUID) =>
    api.post<Notification>(`/notifications/${notificationId}/reads`),
}

/* --------------------------------------------------------------- operations */

export const operations = {
  runs: (signal?: AbortSignal) => api.get<JobRun[]>('/internal/job-runs', { signal }),

  /** Runs the same implementation the scheduler runs, idempotency included. */
  run: (jobName: JobName) => api.post<Record<string, unknown>>('/internal/job-runs', { jobName }),
}
