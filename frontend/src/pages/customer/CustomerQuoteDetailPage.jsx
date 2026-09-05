import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, formatINR, formatDate, formatDateTime, bpToPercent } from '../../services/api';
import { StatusBadge } from '../../components/common/StatusBadge';
import { LoadingSpinner } from '../../components/common/LoadingState';
import { Modal } from '../../components/common/Modal';
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  Send,
  FileCheck,
  ShieldCheck,
  Calendar,
  Layers,
  Clock,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';

export function CustomerQuoteDetailPage() {
  const { id } = useParams();
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Negotiation Request Modal State
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestType, setRequestType] = useState('COUNTER'); // COMMENT | CHANGE | COUNTER
  const [requestMessage, setRequestMessage] = useState('');
  const [selectedLineKey, setSelectedLineKey] = useState('');
  const [counterDiscountBp, setCounterDiscountBp] = useState(0);
  const [counterQuantity, setCounterQuantity] = useState(1);
  const [submittingRequest, setSubmittingRequest] = useState(false);

  // Acceptance Modal State
  const [acceptModalOpen, setAcceptModalOpen] = useState(false);
  const [acceptanceNote, setAcceptanceNote] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [acceptanceResult, setAcceptanceResult] = useState(null);

  const loadQuote = async () => {
    try {
      setLoading(true);
      const data = await api.get(`/portal/quotes/${id}`);
      setQuote(data);
      setError(null);
    } catch (err) {
      console.error('Failed to load quote details:', err);
      setError(err.message || 'Quotation not accessible or session expired');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQuote();
  }, [id]);

  const handleOpenCounterForLine = (line) => {
    setSelectedLineKey(line.lineKey);
    setCounterDiscountBp(line.discountPercentBp || 0);
    setCounterQuantity(line.quantity || 1);
    setRequestType('COUNTER');
    setRequestMessage(`We would like to request an updated discount on ${line.description}.`);
    setRequestModalOpen(true);
  };

  const handleSubmitRequest = async (e) => {
    e.preventDefault();
    if (!requestMessage.trim()) return;

    setSubmittingRequest(true);
    try {
      const payload = {
        requestType,
        expectedRevisionId: quote.revisionId,
        message: requestMessage.trim(),
        lineKey: selectedLineKey || null,
        lines:
          requestType === 'COUNTER' && selectedLineKey
            ? [
                {
                  lineKey: selectedLineKey,
                  quantity: counterQuantity,
                  requestedDiscountBp: parseInt(counterDiscountBp, 10),
                },
              ]
            : null,
      };

      await api.postWithIdempotency(`/portal/quotes/${id}/requests`, payload);
      setRequestModalOpen(false);
      setRequestMessage('');
      await loadQuote();
    } catch (err) {
      alert('Failed to submit request: ' + err.message);
    } finally {
      setSubmittingRequest(false);
    }
  };

  const handleAcceptQuote = async () => {
    setAccepting(true);
    try {
      const payload = {
        revisionId: quote.revisionId,
        commercialHash: quote.commercialHash,
        note: acceptanceNote.trim() || 'Accepted via Customer Portal Room',
      };

      const res = await api.postWithIdempotency(`/portal/quotes/${id}/acceptances`, payload);
      setAcceptanceResult(res);
      await loadQuote();
    } catch (err) {
      alert('Acceptance failed: ' + err.message);
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center max-w-lg mx-auto">
        <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
        <h3 className="text-base font-semibold text-slate-900">Quotation Inaccessible</h3>
        <p className="text-xs text-slate-500 mt-1">{error || 'Unable to retrieve proposal details.'}</p>
        <Link
          to="/customer/quotes"
          className="inline-flex items-center space-x-1.5 mt-4 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Quotations</span>
        </Link>
      </div>
    );
  }

  const totals = quote.totals || {};
  const recurring = totals.recurring || [];

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex items-center space-x-3">
          <Link
            to="/customer/quotes"
            className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-white"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-bold text-slate-900">{quote.reference}</h2>
              <StatusBadge status={quote.status} />
              <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                Rev #{quote.versionNumber}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{quote.title || 'Commercial Agreement Proposal'}</p>
          </div>
        </div>

        {/* Customer Actions */}
        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => {
              setSelectedLineKey('');
              setRequestType('COMMENT');
              setRequestMessage('');
              setRequestModalOpen(true);
            }}
            className="px-3.5 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors shadow-xs"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Negotiate / Comment</span>
          </button>

          {quote.acceptable && !quote.orderPlaced && (
            <button
              onClick={() => setAcceptModalOpen(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors shadow-xs"
            >
              <FileCheck className="w-4 h-4" />
              <span>Accept & Confirm Deal</span>
            </button>
          )}
        </div>
      </div>

      {/* Acceptance or Confirmation Banner */}
      {quote.orderPlaced && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start space-x-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-emerald-900">Proposal Formally Executed & Order Confirmed</h4>
            <p className="text-xs text-emerald-700 mt-0.5">
              Sales order reference <span className="font-mono font-bold">{quote.orderReference}</span> has been created
              and assigned to warehouse fulfillment.
            </p>
          </div>
        </div>
      )}

      {/* Awaiting Internal Approval Banner */}
      {quote.awaitingInternalApproval && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start space-x-3">
          <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-amber-900">Awaiting Seller Discount Authorization</h4>
            <p className="text-xs text-amber-700 mt-0.5">
              {quote.statusMessage ||
                'This proposal is currently in internal deal desk review for requested concessions. It will become acceptable once authorized.'}
            </p>
          </div>
        </div>
      )}

      {/* Main Grid: Itemized Proposal Lines + Totals Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Itemized Line Items */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider">Itemized Line Terms</h3>
              <span className="text-xs text-slate-500">Commercial hash verified</span>
            </div>

            <div className="divide-y divide-slate-100">
              {(quote.lines || []).map((line, idx) => (
                <div key={idx} className="p-4 hover:bg-slate-50/50 transition-colors flex flex-col sm:flex-row justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-xs text-slate-900">{line.description}</span>
                      {line.billingCadence && line.billingCadence !== 'ONE_TIME' && (
                        <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.2 rounded border border-indigo-100 uppercase">
                          {line.billingCadence}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1.5">
                      <span>
                        Qty: <strong className="text-slate-800">{line.quantity}</strong>
                      </span>
                      <span>•</span>
                      <span>
                        Unit: <strong className="text-slate-800 tabular-nums">{formatINR(line.unitPrice)}</strong>
                      </span>
                      {line.discountPercentBp > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded">
                            Discount: {bpToPercent(line.discountPercentBp)}%
                          </span>
                        </>
                      )}
                      {line.promisedDate && (
                        <>
                          <span>•</span>
                          <span>Est. Delivery: {formatDate(line.promisedDate)}</span>
                        </>
                      )}
                    </div>

                    {line.availabilityNote && (
                      <div className="mt-2 text-[11px] text-slate-600 bg-slate-50 px-2.5 py-1 rounded border border-slate-100 inline-block">
                        {line.availabilityNote}
                      </div>
                    )}
                  </div>

                  <div className="text-right flex flex-col justify-between items-end shrink-0">
                    <div className="font-bold text-sm text-slate-900 tabular-nums">
                      {formatINR(line.lineTotal)}
                    </div>
                    {line.tax && (
                      <div className="text-[11px] text-slate-400">
                        +Tax: {formatINR(line.tax)}
                      </div>
                    )}

                    {!quote.orderPlaced && (
                      <button
                        onClick={() => handleOpenCounterForLine(line)}
                        className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold mt-2"
                      >
                        Counter Discount &rarr;
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Activity / Negotiation History */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4">
            <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider">
              Negotiation & Discussion Trail
            </h3>

            {(!quote.activity || quote.activity.length === 0) ? (
              <div className="text-center py-6 text-slate-400 text-xs">
                No counteroffers or messages recorded for this proposal revision.
              </div>
            ) : (
              <div className="space-y-3">
                {quote.activity.map((act) => (
                  <div
                    key={act.id}
                    className={`p-3 rounded-lg border text-xs ${
                      act.fromCustomer
                        ? 'bg-slate-50 border-slate-200 ml-4'
                        : 'bg-indigo-50/50 border-indigo-100 mr-4'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                      <span className="font-semibold text-slate-700">
                        {act.fromCustomer ? 'You (Customer)' : 'Deal Desk Representative'}
                      </span>
                      <span>{formatDateTime(act.createdAt)}</span>
                    </div>
                    <div className="text-slate-800 leading-relaxed">{act.message}</div>
                    {act.responseMessage && (
                      <div className="mt-2 pt-2 border-t border-slate-200/80 text-indigo-900 font-medium">
                        Rep Response: {act.responseMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Financial Summary & Verification */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4">
            <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider pb-2 border-b border-slate-100">
              Commercial Totals
            </h3>

            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>One-Time Subtotal</span>
                <span className="tabular-nums font-medium text-slate-800">{formatINR(totals.oneTimeSubtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Applicable Tax</span>
                <span className="tabular-nums font-medium text-slate-800">{formatINR(totals.oneTimeTax)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-100 text-sm font-bold text-slate-900">
                <span>One-Time Total</span>
                <span className="tabular-nums text-indigo-600">{formatINR(totals.oneTimeTotal)}</span>
              </div>
            </div>

            {/* Recurring Breakdown if any */}
            {recurring.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">Recurring Cadence</div>
                {recurring.map((rec, i) => (
                  <div key={i} className="flex justify-between text-xs bg-slate-50 p-2 rounded-lg">
                    <span className="text-slate-700 font-medium">{rec.cadence}</span>
                    <span className="font-bold text-slate-900 tabular-nums">
                      {formatINR(rec.amount)} <span className="font-normal text-slate-500">/period</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {totals.dueOnConfirmation && (
              <div className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-100 text-xs">
                <div className="text-emerald-800 font-semibold">Due on Confirmation:</div>
                <div className="text-base font-bold text-emerald-950 tabular-nums mt-0.5">
                  {formatINR(totals.dueOnConfirmation)}
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 space-y-2 text-xs text-slate-500">
              <div className="flex items-center space-x-1.5">
                <ShieldCheck className="w-4 h-4 text-slate-400" />
                <span>Enforced cryptographic quote hash</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <Calendar className="w-4 h-4 text-slate-400" />
                <span>Terms valid through: {formatDate(quote.validUntil)}</span>
              </div>
            </div>
          </div>

          {/* Legal / Policy Note */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-xs text-slate-500 leading-relaxed">
            <h4 className="font-semibold text-slate-700 mb-1">Contract Execution Rules</h4>
            {quote.backorderTerms && <p>Backorders: {quote.backorderTerms}.</p>}
            {quote.invoicingNote && <p className="mt-1">Billing: {quote.invoicingNote}.</p>}
            <p className="mt-1 text-[11px] text-slate-400">
              Acceptance binds the precise revision and totals shown above without discrepancy.
            </p>
          </div>
        </div>
      </div>

      {/* Negotiation / Counteroffer Modal */}
      <Modal
        isOpen={requestModalOpen}
        onClose={() => setRequestModalOpen(false)}
        title="Submit Commercial Request / Counteroffer"
        subtitle={`Proposal Reference: ${quote.reference}`}
      >
        <form onSubmit={handleSubmitRequest} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Request Action</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'COUNTER', label: 'Counteroffer' },
                { id: 'CHANGE', label: 'Item Change' },
                { id: 'COMMENT', label: 'General Comment' },
              ].map((type) => (
                <button
                  type="button"
                  key={type.id}
                  onClick={() => setRequestType(type.id)}
                  className={`py-2 text-center rounded-lg font-semibold border ${
                    requestType === type.id
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {selectedLineKey && (
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
              <div className="font-semibold text-slate-800">Target Line Item: {selectedLineKey}</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">Requested Discount (Basis Points)</label>
                  <input
                    type="number"
                    min="0"
                    max="9999"
                    value={counterDiscountBp}
                    onChange={(e) => setCounterDiscountBp(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    {bpToPercent(counterDiscountBp)}% concession
                  </span>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">Desired Quantity</label>
                  <input
                    type="number"
                    min="1"
                    value={counterQuantity}
                    onChange={(e) => setCounterQuantity(parseInt(e.target.value, 10))}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                  />
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block font-medium text-slate-700 mb-1">Message to Sales Representative</label>
            <textarea
              rows={3}
              required
              value={requestMessage}
              onChange={(e) => setRequestMessage(e.target.value)}
              placeholder="Detail your request, target pricing, or schedule requirements..."
              className="w-full p-2 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={() => setRequestModalOpen(false)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingRequest}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold rounded-lg flex items-center space-x-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submittingRequest ? 'Sending...' : 'Send Request'}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* 1-Click Acceptance Modal */}
      <Modal
        isOpen={acceptModalOpen}
        onClose={() => setAcceptModalOpen(false)}
        title="Execute Agreement & Confirm Order"
        subtitle={`Proposal Reference: ${quote.reference}`}
      >
        {acceptanceResult ? (
          <div className="space-y-4 text-xs">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
              <h4 className="font-bold text-sm text-emerald-900">Agreement Confirmed!</h4>
              <p className="text-emerald-700 mt-1">{acceptanceResult.message}</p>
              {acceptanceResult.orderReference && (
                <div className="mt-3 font-mono font-bold text-sm bg-white border border-emerald-200 py-1.5 px-3 rounded-lg inline-block text-slate-800">
                  Order Reference: {acceptanceResult.orderReference}
                </div>
              )}
            </div>

            <button
              onClick={() => {
                setAcceptModalOpen(false);
                setAcceptanceResult(null);
                loadQuote();
              }}
              className="w-full py-2.5 bg-slate-900 text-white font-semibold rounded-lg hover:bg-slate-800"
            >
              Return to Deal Room
            </button>
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
              <div className="flex justify-between font-semibold text-slate-800">
                <span>Total Execution Value:</span>
                <span className="text-indigo-600 tabular-nums">{formatINR(totals.oneTimeTotal)}</span>
              </div>
              <div className="text-[11px] text-slate-500">
                Revision #{quote.versionNumber} terms will be locked, and commercial order fulfillment will commence.
              </div>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Execution Note (Optional)</label>
              <textarea
                rows={2}
                value={acceptanceNote}
                onChange={(e) => setAcceptanceNote(e.target.value)}
                placeholder="E.g., Approved by Procurement Department PO #9401"
                className="w-full p-2 border border-slate-200 rounded-lg bg-white"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setAcceptModalOpen(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAcceptQuote}
                disabled={accepting}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold rounded-lg flex items-center space-x-1.5"
              >
                <FileCheck className="w-3.5 h-3.5" />
                <span>{accepting ? 'Confirming...' : 'I Accept & Sign Proposal'}</span>
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
