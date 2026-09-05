import React, { useState } from 'react';
import { formatINR } from '../../services/api';
import { ShoppingBag, Trash2, Send, X, Minus, Plus, AlertCircle } from 'lucide-react';

/**
 * Floating trigger + slide-over drawer for the quotation cart.
 * `onSubmit({ title, note })` returns a promise; errors are shown inline.
 */
export function QuoteCartDrawer({ cart, open, onOpen, onClose, onSubmit, submitting, error }) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');

  const recurring = cart.items.filter((i) => i.type === 'plan');

  return (
    <>
      {cart.count > 0 && !open && (
        <div className="fixed bottom-20 right-4 z-40">
          <button
            type="button"
            onClick={onOpen}
            className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-full shadow-lg font-semibold text-xs transition-all focus:outline-hidden focus:ring-2 focus:ring-indigo-300"
          >
            <ShoppingBag className="w-4 h-4" />
            <span>
              Quote cart · {cart.count} {cart.count === 1 ? 'item' : 'items'}
            </span>
          </button>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true" aria-label="Quotation cart">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity" onClick={onClose} />

          <div className="fixed inset-y-0 right-0 max-w-md w-full bg-white shadow-2xl flex flex-col z-50 border-l border-slate-200">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center space-x-2">
                <ShoppingBag className="w-5 h-5 text-indigo-600" />
                <h3 className="font-semibold text-sm text-slate-900">Quotation cart</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close cart"
                className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-200/50 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto divide-y divide-slate-100">
              {cart.items.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs">Your cart is empty.</div>
              ) : (
                cart.items.map((item) => (
                  <div key={item.key} className="py-3 flex items-center justify-between space-x-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-xs text-slate-900 truncate">{item.name}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {item.subtitle ? `${item.subtitle} · ` : ''}
                        {item.cadence} · {formatINR(item.price)}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <div className="flex items-center border border-slate-200 rounded-md bg-white">
                        <button
                          type="button"
                          aria-label={`Decrease quantity of ${item.name}`}
                          onClick={() => cart.setQuantity(item.key, item.quantity - 1)}
                          className="px-2 py-1 text-slate-600 hover:bg-slate-100 rounded-l-md focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="px-2 text-xs font-semibold text-slate-800 tabular-nums" aria-live="polite">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label={`Increase quantity of ${item.name}`}
                          onClick={() => cart.setQuantity(item.key, item.quantity + 1)}
                          className="px-2 py-1 text-slate-600 hover:bg-slate-100 rounded-r-md focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      <button
                        type="button"
                        aria-label={`Remove ${item.name}`}
                        onClick={() => cart.removeItem(item.key)}
                        className="text-slate-400 hover:text-rose-600 p-1 rounded focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-3">
              {cart.items.length > 0 && (
                <div className="text-xs space-y-1">
                  <div className="flex justify-between text-slate-600">
                    <span>One-time list total</span>
                    <span className="font-semibold text-slate-900 tabular-nums">{formatINR(cart.oneTimeTotal)}</span>
                  </div>
                  {recurring.length > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>Recurring lines</span>
                      <span className="font-semibold text-slate-900">{recurring.length}</span>
                    </div>
                  )}
                  <p className="text-[10px] text-slate-400 pt-1">
                    List prices shown. Your tier pricing and any concessions are applied on the quotation.
                  </p>
                </div>
              )}

              {error && (
                <div role="alert" className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label htmlFor="cart-title" className="block text-xs font-medium text-slate-700 mb-1">
                  Title <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  id="cart-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder="E.g. Q4 office refresh"
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500/60 focus:outline-hidden"
                />
              </div>
              <div>
                <label htmlFor="cart-note" className="block text-xs font-medium text-slate-700 mb-1">
                  Notes for your account manager
                </label>
                <textarea
                  id="cart-note"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={2000}
                  placeholder="Target delivery by month-end, deployment support requested…"
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500/60 focus:outline-hidden"
                />
              </div>

              <button
                type="button"
                onClick={() => onSubmit({ title: title.trim() || null, note: note.trim() || null })}
                disabled={cart.items.length === 0 || submitting}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg font-semibold text-xs flex items-center justify-center space-x-2 transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
              >
                <Send className="w-4 h-4" />
                <span>{submitting ? 'Sending…' : 'Request formal quotation'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
