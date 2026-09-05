import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatINR, formatDate } from '../../services/api';
import { useDealEvents } from '../../hooks/useDealEvents';
import { StatusBadge } from '../../components/common/StatusBadge';
import { LoadingSpinner } from '../../components/common/LoadingState';
import { FileText, ArrowRight, Clock, RefreshCw, ShoppingBag } from 'lucide-react';

const FILTERS = [
  { id: 'ALL', label: 'All' },
  { id: 'ACTION', label: 'Needs your review', statuses: ['AWAITING_YOUR_REVIEW', 'UNDER_DISCUSSION'] },
  { id: 'PREP', label: 'In preparation', statuses: ['IN_PREPARATION', 'ACCEPTED_PENDING_CONFIRMATION'] },
  { id: 'DONE', label: 'Confirmed', statuses: ['CONFIRMED'] },
  { id: 'CLOSED', label: 'Closed', statuses: ['WITHDRAWN', 'CLOSED', 'EXPIRED'] },
];

const REFRESH_EVENTS = new Set(['QUOTE_REVISED', 'NEGOTIATION_UPDATED', 'APPROVAL_UPDATED', 'ORDER_CREATED']);

export function CustomerQuotesPage() {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const [flash, setFlash] = useState(false);

  const loadQuotes = useCallback(async () => {
    try {
      setRefreshing(true);
      const data = await api.get('/portal/quotes');
      setQuotes(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load customer quotes:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadQuotes();
  }, [loadQuotes]);

  useDealEvents(
    (e) => REFRESH_EVENTS.has(e.type),
    () => {
      loadQuotes();
      setFlash(true);
      setTimeout(() => setFlash(false), 2500);
    }
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const active = FILTERS.find((f) => f.id === filter) || FILTERS[0];
  const visible = active.statuses ? quotes.filter((q) => active.statuses.includes(q.status)) : quotes;
  const countFor = (f) => (f.statuses ? quotes.filter((q) => f.statuses.includes(q.status)).length : quotes.length);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Your quotations</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Review live proposals, negotiate line-item discounts, and formally execute agreements.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {flash && (
            <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg" role="status">
              Updated just now
            </span>
          )}
          <button
            type="button"
            onClick={loadQuotes}
            disabled={refreshing}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-slate-200 text-xs font-medium text-slate-600 rounded-lg hover:bg-slate-50 transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="Filter quotations" className="flex items-center gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60 ${
              filter === f.id ? 'bg-slate-900 text-white shadow-xs' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {f.label}
            <span className={`ml-1.5 text-[10px] ${filter === f.id ? 'text-slate-300' : 'text-slate-400'}`}>{countFor(f)}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
            <FileText className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900">
            {quotes.length === 0 ? 'No quotations yet' : 'Nothing in this view'}
          </h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {quotes.length === 0
              ? 'Request pricing from the catalogue and your account manager will prepare a proposal.'
              : 'Try another filter.'}
          </p>
          {quotes.length === 0 && (
            <Link
              to="/customer/catalog"
              className="inline-flex items-center space-x-1.5 mt-4 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Browse catalogue</span>
            </Link>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th scope="col" className="px-6 py-3.5">Reference &amp; proposal</th>
                  <th scope="col" className="px-6 py-3.5">Status</th>
                  <th scope="col" className="px-6 py-3.5">One-time total</th>
                  <th scope="col" className="px-6 py-3.5">Valid until</th>
                  <th scope="col" className="px-6 py-3.5">Last updated</th>
                  <th scope="col" className="px-6 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((quote) => (
                  <tr key={quote.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">{quote.reference || 'Proposal'}</div>
                      <div className="text-slate-500 text-[11px] mt-0.5">{quote.title || 'Standard commercial terms'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={quote.status} />
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-900 tabular-nums">{formatINR(quote.oneTimeTotal)}</td>
                    <td className="px-6 py-4 text-slate-600">
                      <div className="flex items-center space-x-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>{formatDate(quote.validUntil)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-500">{formatDate(quote.updatedAt)}</td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        to={`/customer/quotes/${quote.id}`}
                        className="inline-flex items-center space-x-1 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg text-xs transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
                      >
                        <span>Open deal room</span>
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
