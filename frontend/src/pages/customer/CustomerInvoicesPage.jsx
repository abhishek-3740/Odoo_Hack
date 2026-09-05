import React, { useState, useEffect } from 'react';
import { api, formatINR, formatDate } from '../../services/api';
import { StatusBadge } from '../../components/common/StatusBadge';
import { LoadingSpinner } from '../../components/common/LoadingState';
import { useDealEvents } from '../../hooks/useDealEvents';
import { Receipt, RefreshCw, CheckCircle2 } from 'lucide-react';

export function CustomerInvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadInvoices = async () => {
    try {
      setRefreshing(true);
      const data = await api.get('/portal/invoices');
      setInvoices(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load customer invoices:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadInvoices();
  }, []);

  // Invoices are raised on confirmation and on each billing cycle.
  useDealEvents(
    (e) => e.type === 'INVOICE_UPDATED' || e.type === 'ORDER_CREATED',
    () => loadInvoices()
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const totalOutstanding = invoices.reduce(
    (acc, inv) => acc + (parseFloat(inv.outstanding) || 0),
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Invoices & Billing Records</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Review commercial settlement statements, payment receipts, and outstanding dues.
          </p>
        </div>
        <button
          onClick={loadInvoices}
          disabled={refreshing}
          className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-slate-200 text-xs font-medium text-slate-600 rounded-lg hover:bg-slate-50 self-start transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Invoices</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">{invoices.length}</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Outstanding Balance</span>
          <div className="text-2xl font-bold text-rose-600 tabular-nums mt-1">
            {formatINR(totalOutstanding)}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Payment Status</span>
          <div className="flex items-center space-x-1.5 text-xs text-emerald-700 font-semibold mt-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Direct Bank Transfer / Wire Active</span>
          </div>
        </div>
      </div>

      {/* Invoices Table */}
      {invoices.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Receipt className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-900">No Billing Invoices Issued Yet</h3>
          <p className="text-xs text-slate-500 mt-1">
            Invoices are automatically generated upon quotation confirmation or recurring subscription cycles.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-6 py-3.5">Invoice Reference</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5">Issue Date</th>
                  <th className="px-6 py-3.5">Due Date</th>
                  <th className="px-6 py-3.5">Total Amount</th>
                  <th className="px-6 py-3.5 text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">{inv.reference}</div>
                      <div className="text-[11px] text-slate-400 font-mono">ID: {inv.id.slice(0, 8)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="px-6 py-4 text-slate-600">{formatDate(inv.issueDate)}</td>
                    <td className="px-6 py-4 text-slate-600">{formatDate(inv.dueDate)}</td>
                    <td className="px-6 py-4 font-semibold text-slate-900 tabular-nums">
                      {formatINR(inv.total)}
                    </td>
                    <td className="px-6 py-4 text-right font-semibold tabular-nums">
                      {parseFloat(inv.outstanding) > 0 ? (
                        <span className="text-rose-600">{formatINR(inv.outstanding)}</span>
                      ) : (
                        <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-[11px]">
                          Settled
                        </span>
                      )}
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
