import React from 'react';
import { Modal } from '../common/Modal';
import { formatINR, bpToPercent } from '../../services/api';
import { Send, FileCheck, CheckCircle2, AlertCircle } from 'lucide-react';

function InlineError({ children }) {
  if (!children) return null;
  return (
    <div role="alert" className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-start space-x-2">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

/** Counteroffer / change / comment form. State is owned by the page. */
export function NegotiationModal({ open, onClose, quote, form, setForm, onSubmit, submitting, error }) {
  if (!quote) return null;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Modal isOpen={open} onClose={onClose} title="Submit a request or counteroffer" subtitle={`Proposal ${quote.reference} · Rev #${quote.versionNumber}`}>
      <form onSubmit={onSubmit} className="space-y-4 text-xs">
        <InlineError>{error}</InlineError>

        <div>
          <span className="block font-medium text-slate-700 mb-1">Request type</span>
          <div role="radiogroup" className="grid grid-cols-3 gap-2">
            {[
              { id: 'COUNTER', label: 'Counteroffer' },
              { id: 'CHANGE', label: 'Item change' },
              { id: 'COMMENT', label: 'Comment' },
            ].map((type) => (
              <button
                type="button"
                key={type.id}
                role="radio"
                aria-checked={form.requestType === type.id}
                onClick={() => setForm((f) => ({ ...f, requestType: type.id }))}
                className={`py-2 text-center rounded-lg font-semibold border focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60 ${
                  form.requestType === type.id
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {form.lineKey && form.requestType !== 'COMMENT' && (
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
            <div className="font-semibold text-slate-800">Target line: {form.lineDescription || form.lineKey}</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="neg-discount" className="block text-[11px] text-slate-600 mb-1">
                  Requested discount (basis points)
                </label>
                <input
                  id="neg-discount"
                  type="number"
                  min="0"
                  max="9999"
                  value={form.discountBp}
                  onChange={set('discountBp')}
                  className="w-full p-2 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">{bpToPercent(form.discountBp)}% concession</span>
              </div>
              <div>
                <label htmlFor="neg-qty" className="block text-[11px] text-slate-600 mb-1">
                  Desired quantity
                </label>
                <input
                  id="neg-qty"
                  type="number"
                  min="1"
                  value={form.quantity}
                  onChange={set('quantity')}
                  className="w-full p-2 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
                />
              </div>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="neg-message" className="block font-medium text-slate-700 mb-1">
            Message to your account manager
          </label>
          <textarea
            id="neg-message"
            rows={3}
            required
            value={form.message}
            onChange={set('message')}
            maxLength={2000}
            placeholder="Detail your request, target pricing, or schedule requirements…"
            className="w-full p-2 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
          />
        </div>

        <div className="flex justify-end space-x-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !form.message.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold rounded-lg flex items-center space-x-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{submitting ? 'Sending…' : 'Send request'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Exact-version acceptance. */
export function AcceptanceModal({ open, onClose, quote, note, setNote, onAccept, accepting, result, onDone, error }) {
  if (!quote) return null;
  const totals = quote.totals || {};

  return (
    <Modal isOpen={open} onClose={onClose} title="Execute agreement & confirm order" subtitle={`Proposal ${quote.reference} · Rev #${quote.versionNumber}`}>
      {result ? (
        <div className="space-y-4 text-xs">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
            <h4 className="font-bold text-sm text-emerald-900">{result.conditional ? 'Acceptance recorded' : 'Agreement confirmed'}</h4>
            <p className="text-emerald-700 mt-1">{result.message}</p>
            {result.orderReference && (
              <div className="mt-3 font-mono font-bold text-sm bg-white border border-emerald-200 py-1.5 px-3 rounded-lg inline-block text-slate-800">
                Order {result.orderReference}
              </div>
            )}
            {Array.isArray(result.remainingSteps) && result.remainingSteps.length > 0 && (
              <ul className="mt-3 text-left text-[11px] text-emerald-800 space-y-1">
                {result.remainingSteps.map((s) => (
                  <li key={s}>• {s}</li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" onClick={onDone} className="w-full py-2.5 bg-slate-900 text-white font-semibold rounded-lg hover:bg-slate-800">
            Return to deal room
          </button>
        </div>
      ) : (
        <div className="space-y-4 text-xs">
          <InlineError>{error}</InlineError>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
            <div className="flex justify-between font-semibold text-slate-800">
              <span>One-time total</span>
              <span className="text-indigo-600 tabular-nums">{formatINR(totals.oneTimeTotal)}</span>
            </div>
            {(totals.recurring || []).map((r) => (
              <div key={r.cadence} className="flex justify-between text-slate-600">
                <span>{r.cadence} recurring</span>
                <span className="tabular-nums">{formatINR(r.amount)}</span>
              </div>
            ))}
            <div className="text-[11px] text-slate-500 pt-1">
              Revision #{quote.versionNumber} will be locked. Hash <span className="font-mono">{String(quote.commercialHash || '').slice(0, 12)}…</span>
            </div>
          </div>

          <div>
            <label htmlFor="accept-note" className="block font-medium text-slate-700 mb-1">
              Execution note <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="accept-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="E.g. Approved by Procurement, PO #9401"
              className="w-full p-2 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50">
              Cancel
            </button>
            <button
              type="button"
              onClick={onAccept}
              disabled={accepting}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold rounded-lg flex items-center space-x-1.5"
            >
              <FileCheck className="w-3.5 h-3.5" />
              <span>{accepting ? 'Confirming…' : 'I accept & sign'}</span>
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
