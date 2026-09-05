import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, formatINR, formatDate } from '../../services/api';
import { StatusBadge } from '../../components/common/StatusBadge';
import { LoadingSpinner } from '../../components/common/LoadingState';
import { FileText, ArrowRight, Clock, ShieldCheck, RefreshCw } from 'lucide-react';

export function CustomerQuotesPage() {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadQuotes = async () => {
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
  };

  useEffect(() => {
    loadQuotes();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Your Quotations Hub</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Review live proposals, negotiate line-item discounts, and formally execute agreements.
          </p>
        </div>
        <button
          onClick={loadQuotes}
          disabled={refreshing}
          className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-slate-200 text-xs font-medium text-slate-600 rounded-lg hover:bg-slate-50 self-start transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Quotes List Table / Cards */}
      {quotes.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
            <FileText className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900">No Quotations Found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Your sales representative has not shared any proposals yet, or your previous agreements have concluded.
          </p>
          <Link
            to="/customer"
            className="inline-flex items-center space-x-1.5 mt-4 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors"
          >
            <span>Browse Catalog</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-6 py-3.5">Reference & Proposal</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5">One-Time Total</th>
                  <th className="px-6 py-3.5">Valid Until</th>
                  <th className="px-6 py-3.5">Last Updated</th>
                  <th className="px-6 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {quotes.map((quote) => (
                  <tr key={quote.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">{quote.reference || 'Proposal'}</div>
                      <div className="text-slate-500 text-[11px] mt-0.5">{quote.title || 'Standard Commercial Terms'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={quote.status} />
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-900 tabular-nums">
                      {formatINR(quote.oneTimeTotal)}
                    </td>
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
                        className="inline-flex items-center space-x-1 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg text-xs transition-colors"
                      >
                        <span>Open Room</span>
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
