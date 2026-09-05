import React, { useState, useEffect } from 'react';
import { api, formatINR, formatDate } from '../../services/api';
import { StatusBadge } from './StatusBadge';
import { LoadingSpinner } from './LoadingState';
import {
  FileText,
  Download,
  Printer,
  X,
  FileSpreadsheet,
  FileCode,
  Building2,
  Calendar,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';

export function InvoicePreviewModal({
  isOpen,
  onClose,
  invoiceId,
  portalMode = false,
  initialInvoice = null,
}) {
  const [invoice, setInvoice] = useState(initialInvoice);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [downloadingFormat, setDownloadingFormat] = useState(null);

  useEffect(() => {
    if (!isOpen || !invoiceId) {
      setInvoice(null);
      setError(null);
      return;
    }

    const fetchInvoice = async () => {
      setLoading(true);
      setError(null);
      try {
        const endpoint = portalMode
          ? `/portal/invoices/${invoiceId}`
          : `/invoices/${invoiceId}`;
        const data = await api.get(endpoint);
        setInvoice(data);
      } catch (err) {
        console.error('Failed to fetch invoice details:', err);
        setError(err.message || 'Failed to load invoice details');
        // Fallback to initialInvoice if available
        if (initialInvoice) {
          setInvoice(initialInvoice);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchInvoice();
  }, [isOpen, invoiceId, portalMode, initialInvoice]);

  if (!isOpen) return null;

  const handleDownload = async (format) => {
    if (!invoiceId) return;
    try {
      setDownloadingFormat(format);
      const endpoint = portalMode
        ? `/portal/invoices/${invoiceId}/export?format=${format}`
        : `/invoices/${invoiceId}/export?format=${format}`;
      const ext = format === 'xlsx' ? 'xlsx' : format === 'doc' ? 'doc' : 'pdf';
      const ref = invoice?.reference || invoiceId.slice(0, 8);
      const filename = `invoice-${ref}.${ext}`;
      await api.download(endpoint, filename);
    } catch (err) {
      console.error(`Export ${format} failed:`, err);
      alert(`Export failed: ${err.message || 'Could not generate document.'}`);
    } finally {
      setDownloadingFormat(null);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const lines = invoice?.lines || [];
  const outstanding = parseFloat(invoice?.outstanding || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 sm:p-6 overflow-y-auto print:p-0 print:bg-white print:static">
      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[92vh] print:max-h-none print:shadow-none print:border-none">
        {/* Modal Top Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-200 bg-slate-50/90 print:hidden">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-2xs">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-slate-900">
                  Tax Invoice {invoice?.reference ? `— ${invoice.reference}` : ''}
                </h3>
                {invoice?.status && <StatusBadge status={invoice.status} />}
              </div>
              <p className="text-xs text-slate-500">
                Official commercial billing document & tax settlement breakdown
              </p>
            </div>
          </div>

          {/* Export & Actions Toolbar */}
          <div className="flex items-center space-x-2">
            {/* PDF Export */}
            <button
              onClick={() => handleDownload('pdf')}
              disabled={downloadingFormat !== null || loading}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-2xs transition-colors"
              title="Download official PDF Tax Invoice"
            >
              <Download className={`w-3.5 h-3.5 ${downloadingFormat === 'pdf' ? 'animate-bounce' : ''}`} />
              <span>{downloadingFormat === 'pdf' ? 'Exporting...' : 'PDF'}</span>
            </button>

            {/* Excel Export */}
            <button
              onClick={() => handleDownload('xlsx')}
              disabled={downloadingFormat !== null || loading}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-2xs transition-colors"
              title="Download Excel Workbook (.xlsx)"
            >
              <FileSpreadsheet className={`w-3.5 h-3.5 ${downloadingFormat === 'xlsx' ? 'animate-bounce' : ''}`} />
              <span>{downloadingFormat === 'xlsx' ? 'Exporting...' : 'Excel'}</span>
            </button>

            {/* Word / Doc Export */}
            <button
              onClick={() => handleDownload('doc')}
              disabled={downloadingFormat !== null || loading}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-2xs transition-colors"
              title="Download Microsoft Word Document (.doc)"
            >
              <FileCode className={`w-3.5 h-3.5 ${downloadingFormat === 'doc' ? 'animate-bounce' : ''}`} />
              <span>{downloadingFormat === 'doc' ? 'Exporting...' : 'Word'}</span>
            </button>

            {/* Print Button */}
            <button
              onClick={handlePrint}
              disabled={loading}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg shadow-2xs transition-colors"
              title="Print Document"
            >
              <Printer className="w-3.5 h-3.5 text-slate-600" />
              <span>Print</span>
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors ml-1"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Printable Invoice Sheet */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-10 bg-slate-100/50 print:p-0 print:bg-white print:overflow-visible">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-3">
              <LoadingSpinner size="lg" />
              <p className="text-xs text-slate-500 font-medium">Loading invoice statement...</p>
            </div>
          ) : error && !invoice ? (
            <div className="p-8 text-center bg-rose-50 border border-rose-200 rounded-xl">
              <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-rose-800">Unable to load invoice</p>
              <p className="text-xs text-rose-600 mt-1">{error}</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-xs border border-slate-200/80 p-8 sm:p-10 max-w-3xl mx-auto print:border-none print:shadow-none print:p-0">
              {/* Header: Company & Tax Meta */}
              <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-b border-slate-200 pb-8">
                <div>
                  <div className="flex items-center space-x-2.5">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center text-white font-black text-sm shadow-md">
                      DF
                    </div>
                    <div>
                      <h1 className="text-xl font-black tracking-tight text-slate-900">
                        DEALFLOW 360
                      </h1>
                      <p className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wider">
                        Enterprise Commercial Cloud
                      </p>
                    </div>
                  </div>

                  <div className="text-xs text-slate-500 mt-4 space-y-0.5">
                    <p className="font-medium text-slate-700">DealFlow Technologies Private Limited</p>
                    <p>Tower 4, Level 9, Outer Ring Road Tech District</p>
                    <p>Bengaluru, Karnataka 560103, India</p>
                    <p className="font-mono text-[11px] text-slate-600 mt-1">
                      GSTIN: 29AAFCD1234F1Z8 • PAN: AAFCD1234F
                    </p>
                  </div>
                </div>

                <div className="text-right sm:text-right w-full sm:w-auto">
                  <span className="inline-block px-3 py-1 bg-slate-900 text-white text-[11px] font-bold tracking-widest uppercase rounded-md shadow-xs">
                    TAX INVOICE
                  </span>
                  <div className="mt-3">
                    <div className="text-lg font-black text-slate-900 font-mono tracking-tight">
                      {invoice?.reference || 'INV-PENDING'}
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-0.5">
                      UUID: {invoice?.id}
                    </div>
                  </div>

                  <div className="mt-4 text-xs space-y-1">
                    <div className="flex justify-between sm:justify-end gap-3">
                      <span className="text-slate-500 font-medium">Issue Date:</span>
                      <span className="font-semibold text-slate-800">{formatDate(invoice?.issueDate)}</span>
                    </div>
                    <div className="flex justify-between sm:justify-end gap-3">
                      <span className="text-slate-500 font-medium">Due Date:</span>
                      <span className="font-semibold text-slate-800">{formatDate(invoice?.dueDate)}</span>
                    </div>
                    <div className="flex justify-between sm:justify-end gap-3">
                      <span className="text-slate-500 font-medium">Currency:</span>
                      <span className="font-bold text-slate-900 font-mono">{invoice?.currency || 'INR'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bill-To & Commercial Reference Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-6 border-b border-slate-200">
                <div className="bg-slate-50/70 rounded-xl p-4 border border-slate-100">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Billed To Customer
                  </span>
                  <div className="text-sm font-bold text-slate-900 mt-1">
                    {invoice?.customerName || 'Customer Client'}
                  </div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">
                    Account Ref: {invoice?.customerId || 'N/A'}
                  </div>
                  <p className="text-xs text-slate-600 mt-2">
                    Verified Customer Billing Address on Record
                  </p>
                </div>

                <div className="bg-slate-50/70 rounded-xl p-4 border border-slate-100 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Commercial Reference
                    </span>
                    <div className="mt-1 text-xs space-y-1.5">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Invoice Kind:</span>
                        <span className="font-semibold text-slate-800 uppercase text-[11px] bg-slate-200 px-1.5 py-0.5 rounded">
                          {invoice?.invoiceKind || 'STANDARD'}
                        </span>
                      </div>
                      {invoice?.orderId && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Order Ref:</span>
                          <span className="font-mono text-slate-800 font-semibold">{invoice.orderId.slice(0, 12)}...</span>
                        </div>
                      )}
                      {invoice?.subscriptionId && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Subscription:</span>
                          <span className="font-mono text-slate-800 font-semibold">{invoice.subscriptionId.slice(0, 12)}...</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 mt-2">
                    <span className="text-xs font-semibold text-slate-600">Settlement Status:</span>
                    <StatusBadge status={invoice?.status || 'PENDING'} />
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              <div className="py-6">
                <div className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">
                  Itemized Charges & Services
                </div>
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                    <thead className="bg-slate-50/90 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="px-4 py-3">#</th>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-3 py-3">Type</th>
                        <th className="px-3 py-3 text-right">Qty</th>
                        <th className="px-4 py-3 text-right">Unit Price</th>
                        <th className="px-4 py-3 text-right">Net</th>
                        <th className="px-4 py-3 text-right">Tax</th>
                        <th className="px-4 py-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {lines.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                            Single commercial settlement line (aggregated)
                          </td>
                        </tr>
                      ) : (
                        lines.map((line, idx) => {
                          const netVal = parseFloat(line.net) || 0;
                          const taxVal = parseFloat(line.tax) || 0;
                          const totalVal = netVal + taxVal;
                          return (
                            <tr key={line.id || idx} className="hover:bg-slate-50/60 transition-colors">
                              <td className="px-4 py-3 text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                              <td className="px-4 py-3">
                                <div className="font-semibold text-slate-900">{line.description}</div>
                                {(line.coverageStart || line.coverageEnd) && (
                                  <div className="text-[11px] text-slate-400 mt-0.5">
                                    Period: {formatDate(line.coverageStart)} – {formatDate(line.coverageEnd)}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-3">
                                <span className="text-[10px] font-semibold text-slate-600 uppercase bg-slate-100 px-1.5 py-0.5 rounded">
                                  {line.lineType || 'SERVICE'}
                                </span>
                              </td>
                              <td className="px-3 py-3 text-right font-medium text-slate-700">{line.quantity}</td>
                              <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                                {formatINR(line.unitPrice)}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-800 tabular-nums font-medium">
                                {formatINR(line.net)}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-500 tabular-nums">
                                {formatINR(line.tax)}
                              </td>
                              <td className="px-4 py-3 text-right font-bold text-slate-900 tabular-nums">
                                {formatINR(totalVal)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Financial Totals & Wire Remittance Instructions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2 pb-6">
                {/* Bank / Remittance Wire Details */}
                <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 text-xs">
                  <div className="flex items-center space-x-1.5 font-bold text-indigo-950 mb-2">
                    <CreditCard className="w-4 h-4 text-indigo-600" />
                    <span>Remittance & Wire Instructions</span>
                  </div>
                  <div className="space-y-1 text-slate-600 text-[11px]">
                    <p><strong className="text-slate-700">Account Name:</strong> DealFlow Technologies Pvt Ltd</p>
                    <p><strong className="text-slate-700">Bank:</strong> HDFC Bank Ltd, Indiranagar Branch</p>
                    <p><strong className="text-slate-700">Account No:</strong> 50200088991122</p>
                    <p><strong className="text-slate-700">IFSC / RTGS:</strong> HDFC0000240</p>
                    <p><strong className="text-slate-700">SWIFT Code:</strong> HDFCINBBXXX</p>
                    <p className="text-[10px] text-indigo-700 font-medium mt-2 pt-1 border-t border-indigo-100">
                      * Please quote invoice reference #{invoice?.reference} in remittance narration.
                    </p>
                  </div>
                </div>

                {/* Totals Breakdown */}
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600 py-1">
                    <span>Subtotal (Net Charges):</span>
                    <span className="font-semibold text-slate-900 tabular-nums">
                      {formatINR(invoice?.net)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600 py-1">
                    <span>GST / Taxes (18%):</span>
                    <span className="font-semibold text-slate-900 tabular-nums">
                      {formatINR(invoice?.tax)}
                    </span>
                  </div>
                  {parseFloat(invoice?.credited || 0) > 0 && (
                    <div className="flex justify-between text-emerald-700 py-1">
                      <span>Less Credit Notes:</span>
                      <span className="font-semibold tabular-nums">
                        -{formatINR(invoice.credited)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-slate-900 font-bold text-sm py-2 border-t border-slate-200">
                    <span>Invoice Grand Total:</span>
                    <span className="text-base tabular-nums">{formatINR(invoice?.total)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600 py-1">
                    <span>Amount Paid / Settled:</span>
                    <span className="font-semibold text-emerald-700 tabular-nums">
                      {formatINR(invoice?.paid || 0)}
                    </span>
                  </div>

                  {/* Outstanding Balance Banner */}
                  <div
                    className={`flex items-center justify-between p-3 rounded-xl border font-bold ${
                      outstanding > 0
                        ? 'bg-rose-50 border-rose-200 text-rose-800'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    }`}
                  >
                    <span>Outstanding Due:</span>
                    <span className="text-base tabular-nums">
                      {outstanding > 0 ? formatINR(outstanding) : 'Fully Settled'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Disclaimer / Footer */}
              <div className="border-t border-slate-200 pt-4 mt-4 text-[10px] text-slate-400 text-center">
                This is an electronically generated and certified commercial document pursuant to the Information Technology Act.
                For inquiries regarding this invoice, contact billing@dealflow360.io.
              </div>
            </div>
          )}
        </div>

        {/* Modal Bottom Footer with Close */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between print:hidden">
          <div className="text-xs text-slate-500 font-mono">
            Format options: PDF, XLSX, DOC • Immediate client download
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold text-xs rounded-lg transition-colors"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
}
