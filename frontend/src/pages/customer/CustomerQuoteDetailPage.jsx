import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, formatINR, formatDate, bpToPercent } from '../../services/api';
import { useDealEvents } from '../../hooks/useDealEvents';
import { useConnectionStatus } from '../../hooks/useConnectionStatus';
import { StatusBadge } from '../../components/common/StatusBadge';
import { LoadingSpinner } from '../../components/common/LoadingState';
import { DealRoomTimeline } from '../../components/customer/DealRoomTimeline';
import { NegotiationModal, AcceptanceModal } from '../../components/customer/QuoteActionModals';
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  FileCheck,
  ShieldCheck,
  Calendar,
  Clock,
  Radio,
  RefreshCw,
} from 'lucide-react';

const EVENT_WORDS = {
  QUOTE_REVISED: 'Your account manager revised the terms',
  NEGOTIATION_UPDATED: 'New activity in the deal room',
  APPROVAL_UPDATED: 'Internal approval progressed',
  ORDER_CREATED: 'Your order was created',
  QUOTE_SUBMITTED: 'A new version was submitted',
};

const STALE_CODES = new Set(['STALE_QUOTE_VERSION', 'ACCEPTANCE_HASH_MISMATCH']);

const emptyForm = { requestType: 'COMMENT', message: '', lineKey: '', lineDescription: '', discountBp: 0, quantity: 1 };

export function CustomerQuoteDetailPage() {
  const { id } = useParams();
  const status = useConnectionStatus();
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [liveNote, setLiveNote] = useState(null);
  const [staleNotice, setStaleNotice] = useState('');
  const liveTimer = useRef(null);

  const [requestOpen, setRequestOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [requestError, setRequestError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [quickSending, setQuickSending] = useState(false);
  const [quickError, setQuickError] = useState('');

  const [acceptOpen, setAcceptOpen] = useState(false);
  const [acceptNote, setAcceptNote] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState('');
  const [acceptResult, setAcceptResult] = useState(null);

  const loadQuote = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const data = await api.get(`/portal/quotes/${id}`);
        setQuote(data);
        setError(null);
      } catch (err) {
        setError(err.message || 'Quotation not accessible or session expired');
      } finally {
        setLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    loadQuote();
  }, [loadQuote]);

  useEffect(() => () => clearTimeout(liveTimer.current), []);

  useDealEvents(
    (e) => e.entityType === 'Quote' && e.entityId === id,
    (e) => {
      loadQuote(true);
      setLiveNote(EVENT_WORDS[e.type] || 'This quotation was updated');
      clearTimeout(liveTimer.current);
      liveTimer.current = setTimeout(() => setLiveNote(null), 6000);
    }
  );

  const handleStale = (err, fallbackSetter) => {
    if (STALE_CODES.has(err.code) || err.status === 409) {
      setStaleNotice('Terms changed — review the latest version before continuing.');
      loadQuote(true);
      return true;
    }
    fallbackSetter(err.message || 'Something went wrong.');
    return false;
  };

  const openCounterForLine = (line) => {
    setForm({
      requestType: 'COUNTER',
      message: `We would like to request an updated discount on ${line.description}.`,
      lineKey: line.lineKey,
      lineDescription: line.description,
      discountBp: line.discountPercentBp || 0,
      quantity: line.quantity || 1,
    });
    setRequestError('');
    setRequestOpen(true);
  };

  const openGeneralRequest = () => {
    setForm(emptyForm);
    setRequestError('');
    setRequestOpen(true);
  };

  const postRequest = async (payload) => {
    return api.postWithIdempotency(`/portal/quotes/${id}/requests`, {
      expectedRevisionId: quote.revisionId,
      ...payload,
    });
  };

  const handleSubmitRequest = async (e) => {
    e.preventDefault();
    if (!form.message.trim()) return;
    setSubmitting(true);
    setRequestError('');
    try {
      const isCounter = form.requestType !== 'COMMENT' && form.lineKey;
      await postRequest({
        requestType: form.requestType,
        message: form.message.trim(),
        lineKey: form.lineKey || null,
        lines: isCounter
          ? [{ lineKey: form.lineKey, quantity: Number(form.quantity) || 1, requestedDiscountBp: parseInt(form.discountBp, 10) || 0 }]
          : null,
      });
      setRequestOpen(false);
      setForm(emptyForm);
      await loadQuote(true);
    } catch (err) {
      if (handleStale(err, setRequestError)) setRequestOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickComment = async (message) => {
    setQuickSending(true);
    setQuickError('');
    try {
      await postRequest({ requestType: 'COMMENT', message, lineKey: null, lines: null });
      await loadQuote(true);
      return true;
    } catch (err) {
      handleStale(err, setQuickError);
      return false;
    } finally {
      setQuickSending(false);
    }
  };

  const handleAccept = async () => {
    setAccepting(true);
    setAcceptError('');
    try {
      const res = await api.postWithIdempotency(`/portal/quotes/${id}/acceptances`, {
        revisionId: quote.revisionId,
        commercialHash: quote.commercialHash,
        note: acceptNote.trim() || 'Accepted via customer portal',
      });
      setAcceptResult(res);
      await loadQuote(true);
    } catch (err) {
      if (handleStale(err, setAcceptError)) setAcceptOpen(false);
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
        <h3 className="text-base font-semibold text-slate-900">Quotation inaccessible</h3>
        <p className="text-xs text-slate-500 mt-1">{error || 'Unable to retrieve proposal details.'}</p>
        <Link to="/customer/quotes" className="inline-flex items-center space-x-1.5 mt-4 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800">
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to quotations</span>
        </Link>
      </div>
    );
  }

  const totals = quote.totals || {};
  const recurring = totals.recurring || [];
  const closed = quote.orderPlaced || ['WITHDRAWN', 'CLOSED', 'EXPIRED', 'CONFIRMED'].includes(quote.status);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex items-center space-x-3">
          <Link to="/customer/quotes" aria-label="Back to quotations" className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-white">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">{quote.reference}</h2>
              <StatusBadge status={quote.status} />
              <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">Rev #{quote.versionNumber}</span>
              <span
                role="status"
                className={`inline-flex items-center space-x-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                  status === 'connected' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-800 bg-amber-50 border-amber-200'
                }`}
              >
                <Radio className="w-3 h-3" />
                <span>{status === 'connected' ? 'Live' : 'Reconnecting'}</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{quote.title || 'Commercial agreement proposal'}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            type="button"
            onClick={() => loadQuote(true)}
            aria-label="Refresh"
            className="p-2 bg-white border border-slate-200 text-slate-500 hover:text-slate-900 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {!closed && (
            <button
              type="button"
              onClick={openGeneralRequest}
              className="px-3.5 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors shadow-xs"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Negotiate</span>
            </button>
          )}
          {quote.acceptable && !quote.orderPlaced && (
            <button
              type="button"
              onClick={() => {
                setAcceptError('');
                setAcceptResult(null);
                setAcceptOpen(true);
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors shadow-xs"
            >
              <FileCheck className="w-4 h-4" />
              <span>Accept &amp; confirm</span>
            </button>
          )}
        </div>
      </div>

      {/* Live / stale notices */}
      {liveNote && (
        <div role="status" className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs rounded-xl px-4 py-2.5 flex items-center space-x-2">
          <Radio className="w-4 h-4 text-indigo-600" />
          <span>
            <strong>Updated just now.</strong> {liveNote}.
          </span>
        </div>
      )}
      {staleNotice && (
        <div role="alert" className="bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl px-4 py-2.5 flex items-center justify-between">
          <span className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <span>{staleNotice}</span>
          </span>
          <button type="button" onClick={() => setStaleNotice('')} className="text-[11px] font-semibold underline underline-offset-2">
            Dismiss
          </button>
        </div>
      )}

      {quote.orderPlaced && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start space-x-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-emerald-900">Proposal executed &amp; order confirmed</h4>
            <p className="text-xs text-emerald-700 mt-0.5">
              Sales order <span className="font-mono font-bold">{quote.orderReference}</span> has been created and assigned to fulfilment.
            </p>
          </div>
        </div>
      )}

      {!quote.orderPlaced && quote.statusMessage && (
        <div className={`rounded-xl p-4 flex items-start space-x-3 border ${quote.awaitingInternalApproval ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
          <Clock className={`w-5 h-5 shrink-0 mt-0.5 ${quote.awaitingInternalApproval ? 'text-amber-600' : 'text-indigo-600'}`} />
          <div>
            <h4 className={`text-xs font-bold ${quote.awaitingInternalApproval ? 'text-amber-900' : 'text-slate-900'}`}>
              {quote.awaitingInternalApproval ? 'Awaiting seller authorisation' : 'Status'}
            </h4>
            <p className={`text-xs mt-0.5 ${quote.awaitingInternalApproval ? 'text-amber-700' : 'text-slate-600'}`}>{quote.statusMessage}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Lines */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider">Itemised terms</h3>
              <span className="text-[11px] text-slate-500 font-mono" title="Commercial hash">
                {String(quote.commercialHash || '').slice(0, 10)}…
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {(quote.lines || []).map((line) => (
                <div key={line.lineKey} className="p-4 hover:bg-slate-50/50 transition-colors flex flex-col sm:flex-row justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-xs text-slate-900">{line.description}</span>
                      {line.billingCadence && line.billingCadence !== 'one-time' && (
                        <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded border border-indigo-100 uppercase">{line.billingCadence}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 mt-1.5">
                      <span>Qty <strong className="text-slate-800">{line.quantity}</strong></span>
                      <span>Unit <strong className="text-slate-800 tabular-nums">{formatINR(line.unitPrice)}</strong></span>
                      {line.discountPercentBp > 0 && (
                        <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">Discount {bpToPercent(line.discountPercentBp)}%</span>
                      )}
                      {line.promisedDate && <span>Est. delivery {formatDate(line.promisedDate)}</span>}
                    </div>
                    {line.availabilityNote && (
                      <div className="mt-2 text-[11px] text-slate-600 bg-slate-50 px-2.5 py-1 rounded border border-slate-100 inline-block">{line.availabilityNote}</div>
                    )}
                  </div>
                  <div className="text-right flex flex-col justify-between items-end shrink-0">
                    <div className="font-bold text-sm text-slate-900 tabular-nums">{formatINR(line.lineTotal)}</div>
                    {line.tax && parseFloat(line.tax) > 0 && <div className="text-[11px] text-slate-400">+ tax {formatINR(line.tax)}</div>}
                    {!closed && (
                      <button type="button" onClick={() => openCounterForLine(line)} className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold mt-2 rounded focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60">
                        Counter discount →
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DealRoomTimeline
            activity={quote.activity}
            onQuickComment={handleQuickComment}
            sending={quickSending}
            disabled={closed}
            error={quickError}
          />
        </div>

        {/* Totals */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4">
            <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider pb-2 border-b border-slate-100">Commercial totals</h3>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between text-slate-600"><span>One-time subtotal</span><span className="tabular-nums font-medium text-slate-800">{formatINR(totals.oneTimeSubtotal)}</span></div>
              <div className="flex justify-between text-slate-600"><span>Applicable tax</span><span className="tabular-nums font-medium text-slate-800">{formatINR(totals.oneTimeTax)}</span></div>
              <div className="flex justify-between pt-2 border-t border-slate-100 text-sm font-bold text-slate-900"><span>One-time total</span><span className="tabular-nums text-indigo-600">{formatINR(totals.oneTimeTotal)}</span></div>
            </div>
            {recurring.length > 0 && (
              <div className="pt-4 border-t border-slate-100 space-y-2">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">Recurring</div>
                {recurring.map((rec) => (
                  <div key={rec.cadence} className="flex justify-between text-xs bg-slate-50 p-2 rounded-lg">
                    <span className="text-slate-700 font-medium">{rec.cadence}</span>
                    <span className="font-bold text-slate-900 tabular-nums">{formatINR(rec.amount)} <span className="font-normal text-slate-500">/period</span></span>
                  </div>
                ))}
              </div>
            )}
            {totals.dueOnConfirmation && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100 text-xs">
                <div className="text-emerald-800 font-semibold">Due on confirmation</div>
                <div className="text-base font-bold text-emerald-950 tabular-nums mt-0.5">{formatINR(totals.dueOnConfirmation)}</div>
              </div>
            )}
            <div className="pt-3 border-t border-slate-100 space-y-2 text-xs text-slate-500">
              <div className="flex items-center space-x-1.5"><ShieldCheck className="w-4 h-4 text-slate-400" /><span>Hash-verified acceptance</span></div>
              <div className="flex items-center space-x-1.5"><Calendar className="w-4 h-4 text-slate-400" /><span>Valid through {formatDate(quote.validUntil)}</span></div>
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-xs text-slate-500 leading-relaxed">
            <h4 className="font-semibold text-slate-700 mb-1">Execution rules</h4>
            {quote.backorderTerms && <p>Backorders: {quote.backorderTerms.replace(/_/g, ' ').toLowerCase()}.</p>}
            {quote.invoicingNote && <p className="mt-1">{quote.invoicingNote}</p>}
            <p className="mt-1 text-[11px] text-slate-400">Acceptance binds the exact revision and totals shown above.</p>
          </div>
        </div>
      </div>

      <NegotiationModal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        quote={quote}
        form={form}
        setForm={setForm}
        onSubmit={handleSubmitRequest}
        submitting={submitting}
        error={requestError}
      />
      <AcceptanceModal
        open={acceptOpen}
        onClose={() => setAcceptOpen(false)}
        quote={quote}
        note={acceptNote}
        setNote={setAcceptNote}
        onAccept={handleAccept}
        accepting={accepting}
        result={acceptResult}
        error={acceptError}
        onDone={() => {
          setAcceptOpen(false);
          setAcceptResult(null);
          loadQuote(true);
        }}
      />
    </div>
  );
}
