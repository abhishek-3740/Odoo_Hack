import React, { useState, useEffect } from 'react';
import { subscribeToDealEvents } from '../../services/websocket';
import { Bell, CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const unsubscribe = subscribeToDealEvents((event) => {
      // Map STOMP deal event into a toast notification
      const id = 'toast-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
      const title = formatEventTitle(event.type);
      const message = `${event.entityType || 'Record'} ${event.entityId ? event.entityId.slice(0, 8) : ''} (v${event.version || 1}) updated.`;

      const newToast = {
        id,
        title,
        message,
        type: event.type?.includes('REJECT') ? 'error' : event.type?.includes('APPROV') ? 'success' : 'info',
        timestamp: new Date(),
      };

      setToasts((prev) => [newToast, ...prev.slice(0, 4)]);

      // Auto dismiss after 6 seconds
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 6000);
    });

    return unsubscribe;
  }, []);

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const formatEventTitle = (type) => {
    if (!type) return 'System Notification';
    return type
      .split('_')
      .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
      .join(' ');
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col space-y-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto bg-white border border-slate-200 rounded-lg shadow-lg p-3.5 flex items-start space-x-3 animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <div className="mt-0.5 shrink-0">
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            ) : toast.type === 'error' ? (
              <AlertTriangle className="w-5 h-5 text-rose-600" />
            ) : (
              <Bell className="w-5 h-5 text-indigo-600" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-xs font-semibold text-slate-900">{toast.title}</h4>
            <p className="text-xs text-slate-500 mt-0.5">{toast.message}</p>
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            className="text-slate-400 hover:text-slate-600 p-0.5 rounded-md hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
