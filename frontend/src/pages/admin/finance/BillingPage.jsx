import React, { useState, useEffect } from 'react';
import { api, formatINR, formatDate, formatDateTime } from '../../../services/api';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { LoadingSpinner } from '../../../components/common/LoadingState';
import { Modal } from '../../../components/common/Modal';
import {
  Receipt,
  CreditCard,
  RotateCcw,
  SlidersHorizontal,
  Plus,
  RefreshCw,
  Building2,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react';

export function BillingPage() {
  const [activeTab, setActiveTab] = useState('invoices'); // 'invoices' | 'subscriptions'
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [invoices, setInvoices] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Record Payment Modal State
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('WIRE_TRANSFER');
  const [paymentRef, setPaymentRef] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // Subscription Change & Proration Preview Modal State
  const [changeModalOpen, setChangeModalOpen] = useState(false);
  const [selectedSub, setSelectedSub] = useState(null);
  const [newQuantity, setNewQuantity] = useState(1);
  const [changePreview, setChangePreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submittingChange, setSubmittingChange] = useState(false);

  // Load Customers first
  useEffect(() => {
    async function loadCustomers() {
      try {
        setLoading(true);
        const data = await api.get('/customers?pageSize=100');
        const list = data.items || (Array.isArray(data) ? data : []);
        setCustomers(list);
        if (list.length > 0) {
          setSelectedCustomerId(list[0].id);
        }
      } catch (err) {
        console.error('Failed to load customers:', err);
      } finally {
        setLoading(false);
      }
    }
    loadCustomers();
  }, []);

  // Load Invoices and Subscriptions for selected customer
  const loadBillingData = async (custId = selectedCustomerId) => {
    if (!custId) return;
    try {
      setRefreshing(true);
      const [invRes, subRes] = await Promise.all([
        api.get(`/invoices?customerId=${custId}`).catch(() => ({ content: [] })),
        api.get(`/subscriptions?customerId=${custId}`).catch(() => []),
      ]);

      const invList = invRes?.items || invRes?.content || (Array.isArray(invRes) ? invRes : []);
      setInvoices(invList);
      setSubscriptions(Array.isArray(subRes) ? subRes : []);
    } catch (err) {
      console.error('Failed to load customer billing data:', err);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (selectedCustomerId) {
      loadBillingData(selectedCustomerId);
    }
  }, [selectedCustomerId]);

  const handleOpenPayment = (inv) => {
    setSelectedInvoice(inv);
    setPaymentAmount(inv.outstanding || inv.total);
    setPaymentRef(`Wire transfer receipt ref #${Math.random().toString(36).substring(2, 8).toUpperCase()}`);
    setPaymentModalOpen(true);
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    if (!selectedInvoice) return;

    setSubmittingPayment(true);
    try {
      const payload = {
        invoiceId: selectedInvoice.id,
        amount: parseFloat(paymentAmount),
        paymentMethod,
        reference: paymentRef.trim(),
      };

      await api.postWithIdempotency('/payments', payload);
      setPaymentModalOpen(false);
      alert('Payment settlement recorded successfully!');
      loadBillingData();
    } catch (err) {
      alert('Failed to record payment: ' + err.message);
    } finally {
      setSubmittingPayment(false);
    }
  };

  // Mid-cycle Proration Preview
  const handleOpenSubChange = async (sub) => {
    setSelectedSub(sub);
    setNewQuantity((sub.quantity || 1) + 2);
    setChangePreview(null);
    setChangeModalOpen(true);
    // Preview immediate change
    previewQuantityChange(sub.id, (sub.quantity || 1) + 2);
  };

  const previewQuantityChange = async (subId, qty) => {
    try {
      setLoadingPreview(true);
      const payload = {
        newQuantity: parseInt(qty, 10),
      };
      const res = await api.post(`/subscriptions/${subId}/change-previews`, payload);
      setChangePreview(res);
    } catch (err) {
      console.warn('Change preview failed:', err);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleCommitSubChange = async () => {
    if (!selectedSub) return;
    setSubmittingChange(true);
    try {
      const payload = {
        newQuantity: parseInt(newQuantity, 10),
      };
      await api.postWithIdempotency(`/subscriptions/${selectedSub.id}/changes`, payload);
      setChangeModalOpen(false);
      alert('Mid-cycle subscription modification committed with calendar proration!');
      loadBillingData();
    } catch (err) {
      alert('Failed to commit subscription change: ' + err.message);
    } finally {
      setSubmittingChange(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Hybrid Billing & Subscriptions</h2>
            <span className="text-xs bg-emerald-50 text-emerald-700 font-semibold px-2.5 py-0.5 rounded-full border border-emerald-200">
              Finance Hub
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage customer settlements, record payments, and execute mid-cycle prorated SaaS changes.
          </p>
        </div>

        {/* Customer Organization Selector */}
        <div className="flex items-center space-x-2.5">
          <div className="flex items-center space-x-2 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-xs">
            <Building2 className="w-4 h-4 text-slate-500" />
            <select
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              className="text-xs font-semibold text-slate-800 bg-transparent focus:outline-hidden"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.tierCode || 'STANDARD'})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => loadBillingData()}
            disabled={refreshing}
            className="p-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 space-x-4">
        <button
          onClick={() => setActiveTab('invoices')}
          className={`pb-3 text-xs font-semibold flex items-center space-x-2 border-b-2 transition-colors ${
            activeTab === 'invoices'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>Invoices & Payments ({invoices.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('subscriptions')}
          className={`pb-3 text-xs font-semibold flex items-center space-x-2 border-b-2 transition-colors ${
            activeTab === 'subscriptions'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>Active Subscriptions & Proration ({subscriptions.length})</span>
        </button>
      </div>

      {/* Tab 1: Invoices */}
      {activeTab === 'invoices' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-5 py-3.5">Invoice Reference</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5">Issue Date</th>
                  <th className="px-5 py-3.5">Due Date</th>
                  <th className="px-5 py-3.5">Total Amount</th>
                  <th className="px-5 py-3.5">Outstanding Due</th>
                  <th className="px-5 py-3.5 text-right">Settlement Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                      No invoices recorded for selected customer.
                    </td>
                  </tr>
                ) : (
                  invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="font-semibold text-slate-900">{inv.reference}</div>
                        <div className="text-[11px] text-slate-400 font-mono">ID: {inv.id.slice(0, 8)}</div>
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className="px-5 py-3.5 text-slate-600">{formatDate(inv.issueDate)}</td>
                      <td className="px-5 py-3.5 text-slate-600">{formatDate(inv.dueDate)}</td>
                      <td className="px-5 py-3.5 font-semibold text-slate-900 tabular-nums">
                        {formatINR(inv.total)}
                      </td>
                      <td className="px-5 py-3.5 font-bold tabular-nums">
                        {parseFloat(inv.outstanding) > 0 ? (
                          <span className="text-rose-600">{formatINR(inv.outstanding)}</span>
                        ) : (
                          <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-[11px]">
                            Fully Settled
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {parseFloat(inv.outstanding) > 0 && (
                          <button
                            onClick={() => handleOpenPayment(inv)}
                            className="px-3 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded text-xs transition-colors"
                          >
                            Record Payment &rarr;
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Subscriptions */}
      {activeTab === 'subscriptions' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-5 py-3.5">Plan & Code</th>
                  <th className="px-5 py-3.5">Seats / Qty</th>
                  <th className="px-5 py-3.5">Rate / Cycle</th>
                  <th className="px-5 py-3.5">Current Period</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Proration Management</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {subscriptions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                      No active recurring subscriptions found for selected customer.
                    </td>
                  </tr>
                ) : (
                  subscriptions.map((sub) => (
                    <tr key={sub.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="font-semibold text-slate-900">{sub.planName || sub.planCode || 'SaaS Plan'}</div>
                        <div className="text-[11px] text-slate-500 font-mono">Cadence: {sub.cadence || 'Monthly'}</div>
                      </td>
                      <td className="px-5 py-3.5 font-bold text-slate-800 tabular-nums">{sub.quantity} units</td>
                      <td className="px-5 py-3.5 font-semibold text-slate-900 tabular-nums">
                        {formatINR(sub.pricePerCycle || sub.cycleAmount)}
                      </td>
                      <td className="px-5 py-3.5 text-slate-600">
                        {formatDate(sub.currentPeriodStart)} &rarr; {formatDate(sub.currentPeriodEnd)}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={sub.status || 'ACTIVE'} />
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => handleOpenSubChange(sub)}
                          className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded text-xs inline-flex items-center space-x-1 transition-colors"
                        >
                          <SlidersHorizontal className="w-3 h-3" />
                          <span>Prorated Change &rarr;</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      <Modal
        isOpen={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        title="Record Customer Payment Receipt"
        subtitle={`Settling Invoice ${selectedInvoice?.reference}`}
      >
        <form onSubmit={handleRecordPayment} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Payment Method</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full p-2.5 border border-slate-200 rounded-lg bg-white font-medium"
            >
              <option value="WIRE_TRANSFER">Direct Wire Transfer (NEFT/RTGS)</option>
              <option value="CORPORATE_CARD">Corporate Credit Card</option>
              <option value="ACH">ACH Direct Debit</option>
              <option value="CHEQUE">Banker's Cheque</option>
            </select>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Payment Amount (INR)</label>
            <input
              type="number"
              step="0.01"
              required
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              className="w-full p-2.5 border border-slate-200 rounded-lg bg-white tabular-nums font-semibold"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Bank Reference / Transaction ID</label>
            <input
              type="text"
              required
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
              className="w-full p-2.5 border border-slate-200 rounded-lg bg-white"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setPaymentModalOpen(false)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingPayment}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold rounded-lg"
            >
              <span>{submittingPayment ? 'Settling...' : 'Confirm Payment'}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Mid-Cycle Proration Preview Modal */}
      <Modal
        isOpen={changeModalOpen}
        onClose={() => setChangeModalOpen(false)}
        title="Mid-Cycle Subscription Proration"
        subtitle={`Adjusting Seat Count for ${selectedSub?.planName || 'Plan'}`}
      >
        <div className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Target Seat Count / Quantity</label>
            <input
              type="number"
              min="1"
              value={newQuantity}
              onChange={(e) => {
                const q = parseInt(e.target.value, 10) || 1;
                setNewQuantity(q);
                if (selectedSub) previewQuantityChange(selectedSub.id, q);
              }}
              className="w-full p-2.5 border border-slate-200 rounded-lg bg-white font-semibold"
            />
          </div>

          {/* Proration Preview Arithmetic */}
          {loadingPreview ? (
            <div className="py-4 text-center">
              <LoadingSpinner size="sm" />
            </div>
          ) : changePreview ? (
            <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl space-y-2">
              <div className="font-bold text-indigo-950 text-xs uppercase tracking-wider">
                Calendar Proration Breakdown
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Unused Cycle Days Credit:</span>
                <span className="tabular-nums text-slate-800 font-medium">
                  {formatINR(changePreview.creditAmount || 0)}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>New Quantity Prorated Charge:</span>
                <span className="tabular-nums text-slate-800 font-medium">
                  {formatINR(changePreview.newChargeAmount || 0)}
                </span>
              </div>
              <div className="pt-2 border-t border-indigo-200/80 flex justify-between font-bold text-indigo-900 text-sm">
                <span>Immediate Net Adjustment:</span>
                <span className="tabular-nums">{formatINR(changePreview.netAdjustment || 0)}</span>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setChangeModalOpen(false)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCommitSubChange}
              disabled={submittingChange}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold rounded-lg"
            >
              <span>{submittingChange ? 'Committing...' : 'Commit Prorated Change'}</span>
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
