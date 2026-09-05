import React, { useState, useEffect } from 'react';
import { api, formatINR, formatDate } from '../../services/api';
import { StatusBadge } from '../../components/common/StatusBadge';
import { LoadingSpinner } from '../../components/common/LoadingState';
import { InvoicePreviewModal } from '../../components/common/InvoicePreviewModal';
import { useDealEvents } from '../../hooks/useDealEvents';
import { Receipt, RefreshCw, CheckCircle2, Eye, Download, FileText, FileSpreadsheet } from 'lucide-react';

export function CustomerInvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [previewInvoiceId, setPreviewInvoiceId] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);

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

  const handleOpenPreview = (invId) => {
    setPreviewInvoiceId(invId);
    setPreviewOpen(true);
  };

  const handleQuickDownload = async (inv, format = 'pdf') => {
    try {
      setDownloadingId(`${inv.id}-${format}`);
      const ext = format === 'xlsx' ? 'xlsx' : format === 'doc' ? 'doc' : 'pdf';
      const ref = inv.reference || inv.id.slice(0, 8);
      await api.download(`/portal/invoices/${inv.id}/export?format=${format}`, `invoice-${ref}.${ext}`);
    } catch (err) {
      console.error('Download failed:', err);
      alert('Failed to download invoice document: ' + err.message);
    } finally {
      setDownloadingId(null);
    }
  };

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
            Review commercial settlement statements, preview official tax documents, and download in PDF, Excel, or Word.
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
                  <th className="px-6 py-3.5">Outstanding</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
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
                    <td className="px-6 py-4 font-semibold tabular-nums">
                      {parseFloat(inv.outstanding) > 0 ? (
                        <span className="text-rose-600">{formatINR(inv.outstanding)}</span>
                      ) : (
                        <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-[11px]">
                          Settled
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex items-center space-x-1.5">
                        <button
                          onClick={() => handleOpenPreview(inv.id)}
                          className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg text-xs transition-colors"
                          title="Preview Full Invoice"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Preview</span>
                        </button>
                        <button
                          onClick={() => handleQuickDownload(inv, 'pdf')}
                          disabled={downloadingId === `${inv.id}-pdf`}
                          className="inline-flex items-center space-x-1 px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg text-xs transition-colors"
                          title="Quick PDF Download"
                        >
                          <Download className={`w-3.5 h-3.5 ${downloadingId === `${inv.id}-pdf` ? 'animate-bounce' : ''}`} />
                          <span>PDF</span>
                        </button>
                        <button
                          onClick={() => handleQuickDownload(inv, 'xlsx')}
                          disabled={downloadingId === `${inv.id}-xlsx`}
                          className="inline-flex items-center space-x-1 px-2 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-medium rounded-lg text-xs transition-colors"
                          title="Quick Excel Download"
                        >
                          <FileSpreadsheet className={`w-3.5 h-3.5 ${downloadingId === `${inv.id}-xlsx` ? 'animate-bounce' : ''}`} />
                          <span>Excel</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invoice Preview & Download Modal */}
      <InvoicePreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        invoiceId={previewInvoiceId}
        initialInvoice={invoices.find((i) => i.id === previewInvoiceId)}
        portalMode={true}
      />
    </div>
  );
}
