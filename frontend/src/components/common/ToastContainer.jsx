import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { subscribeToDealEvents } from '../../services/websocket';
import { useAuth } from '../../context/AuthContext';
import { Bell, CheckCircle2, AlertTriangle, MessageSquare, FileText, Receipt, PackageCheck, X } from 'lucide-react';

const EVENT_META = {
  NEGOTIATION_UPDATED: { title: 'Deal room update', message: 'New activity on a quotation you are negotiating.', icon: MessageSquare, tone: 'info' },
  QUOTE_REVISED: { title: 'Quotation revised', message: 'The terms of a quotation changed.', icon: FileText, tone: 'info' },
  QUOTE_SUBMITTED: { title: 'Quotation submitted', message: 'A new version is under internal review.', icon: FileText, tone: 'info' },
  APPROVAL_UPDATED: { title: 'Approval progress', message: 'An internal approval step was decided.', icon: CheckCircle2, tone: 'success' },
  ORDER_CREATED: { title: 'Order confirmed', message: 'Your order has been created.', icon: PackageCheck, tone: 'success' },
  INVOICE_UPDATED: { title: 'Invoice update', message: 'An invoice was issued or updated.', icon: Receipt, tone: 'info' },
  SUBSCRIPTION_UPDATED: { title: 'Subscription update', message: 'A subscription changed.', icon: Receipt, tone: 'info' },
  BACKORDER_UPDATED: { title: 'Delivery update', message: 'Backorder status changed on an order.', icon: PackageCheck, tone: 'warning' },
  ALLOCATION_UPDATED: { title: 'Fulfilment update', message: 'Warehouse allocation changed.', icon: PackageCheck, tone: 'info' },
  ALERT_UPDATED: { title: 'Alert', message: 'A deal health alert was raised.', icon: AlertTriangle, tone: 'warning' },
  STOCK_UPDATED: { title: 'Stock update', message: 'Stock levels changed.', icon: PackageCheck, tone: 'info' },
};

function describe(event) {
  const meta = EVENT_META[event.type] || {
    title: (event.type || 'Update').split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' '),
    message: `${event.entityType || 'Record'} updated.`,
    icon: Bell,
    tone: 'info',
  };
  const payload = event.payload || {};
  const reference = payload.reference || payload.orderReference || payload.invoiceReference;
  const status = payload.approvalStatus === 'REJECTED' ? 'error' : meta.tone;
  return {
    ...meta,
    tone: status,
    message: reference ? `${reference}: ${meta.message}` : meta.message,
  };
}

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const unsubscribe = subscribeToDealEvents((event) => {
      const id = 'toast-' + (event.eventId || Date.now() + '-' + Math.random().toString(36).slice(2, 7));
      const meta = describe(event);
      const link = user?.role === 'CUSTOMER' && event.entityType === 'Quote' && event.entityId ? `/customer/quotes/${event.entityId}` : null;

      setToasts((prev) => [{ id, ...meta, link, timestamp: new Date() }, ...prev.slice(0, 4)]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 7000);
    });
    return unsubscribe;
  }, [user?.role]);

  const removeToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col space-y-2 max-w-sm w-full pointer-events-none" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = toast.icon || Bell;
        const iconTone =
          toast.tone === 'success' ? 'text-emerald-600' : toast.tone === 'error' ? 'text-rose-600' : toast.tone === 'warning' ? 'text-amber-600' : 'text-indigo-600';
        const body = (
          <>
            <div className="mt-0.5 shrink-0">
              <Icon className={`w-5 h-5 ${iconTone}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-semibold text-slate-900">{toast.title}</h4>
              <p className="text-xs text-slate-500 mt-0.5">{toast.message}</p>
              {toast.link && <span className="text-[11px] font-semibold text-indigo-600 mt-1 inline-block">Open deal room →</span>}
            </div>
          </>
        );
        return (
          <div
            key={toast.id}
            className="pointer-events-auto bg-white border border-slate-200 rounded-lg shadow-lg p-3.5 flex items-start space-x-3 animate-in fade-in slide-in-from-top-2 duration-200"
          >
            {toast.link ? (
              <button
                type="button"
                onClick={() => {
                  removeToast(toast.id);
                  navigate(toast.link);
                }}
                className="flex items-start space-x-3 flex-1 min-w-0 text-left rounded focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
              >
                {body}
              </button>
            ) : (
              <div className="flex items-start space-x-3 flex-1 min-w-0">{body}</div>
            )}
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              aria-label="Dismiss notification"
              className="text-slate-400 hover:text-slate-600 p-0.5 rounded-md hover:bg-slate-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
