import React, { useState, useEffect } from 'react';
import { api, formatINR, formatPercent, formatDate, formatDateTime } from '../../../services/api';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { LoadingSpinner } from '../../../components/common/LoadingState';
import { Modal } from '../../../components/common/Modal';
import {
  CheckSquare,
  AlertTriangle,
  FileText,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Clock,
  ShieldCheck,
  RefreshCw,
  Eye,
  Building2,
} from 'lucide-react';

export function ManagerApprovalsPage() {
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('PENDING');

  // Decision Modal State
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [decisionType, setDecisionType] = useState('APPROVE'); // APPROVE | REJECT | RETURN_FOR_REVISION
  const [decisionReason, setDecisionReason] = useState('');
  const [submittingDecision, setSubmittingDecision] = useState(false);

  // Side-by-side Inspection Drawer
  const [inspectionData, setInspectionData] = useState(null);
  const [inspectModalOpen, setInspectModalOpen] = useState(false);

  const loadApprovals = async () => {
    try {
      setRefreshing(true);
      const res = await api.get(`/approval-requests?status=${statusFilter}`);
      const list = res?.content || (Array.isArray(res) ? res : []);
      setApprovals(list);
    } catch (err) {
      console.error('Failed to load approval requests:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadApprovals();
  }, [statusFilter]);

  const handleOpenDecision = (item, type) => {
    setSelectedApproval(item);
    setDecisionType(type);
    setDecisionReason('');
    setDecisionModalOpen(true);
  };

  const handleInspectDeal = async (item) => {
    setSelectedApproval(item);
    try {
      // Evaluate quote to get line terms and risk breakdown
      const evalRes = await api.post(`/quotes/${item.quoteId}/evaluations`, {
        lines: [],
        orderDiscountBp: 0,
      }).catch(() => null);
      setInspectionData(evalRes);
      setInspectModalOpen(true);
    } catch (err) {
      alert('Unable to inspect deal: ' + err.message);
    }
  };

  const handleSubmitDecision = async (e) => {
    e.preventDefault();
    if (!selectedApproval) return;

    setSubmittingDecision(true);
    try {
      const payload = {
        decision: decisionType,
        decisionReason: decisionReason.trim() || `Step 1 ${decisionType} decision recorded`,
      };

      await api.postWithIdempotency(`/approval-requests/${selectedApproval.id}/decisions`, payload);
      setDecisionModalOpen(false);
      alert(`Approval decision [${decisionType}] recorded successfully!`);
      loadApprovals();
    } catch (err) {
      alert('Decision submission failed: ' + err.message);
    } finally {
      setSubmittingDecision(false);
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
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Step 1 Approvals Inbox</h2>
            <span className="text-xs bg-indigo-50 text-indigo-700 font-semibold px-2.5 py-0.5 rounded-full border border-indigo-200">
              Sales Management Level
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Authorize quotation concessions, review risk anomalies, or return deals for revision.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={loadApprovals}
            disabled={refreshing}
            className="p-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>

          <div className="bg-slate-100 p-1 rounded-lg flex items-center space-x-1 border border-slate-200">
            {['PENDING', 'APPROVED', 'REJECTED'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Approvals Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold">
              <tr>
                <th className="px-5 py-3.5">Quotation Reference</th>
                <th className="px-5 py-3.5">Customer & Tier</th>
                <th className="px-5 py-3.5">Deal Value</th>
                <th className="px-5 py-3.5">Step / Required Role</th>
                <th className="px-5 py-3.5">Due Time</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Review Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {approvals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                    No {statusFilter.toLowerCase()} approval requests in queue.
                  </td>
                </tr>
              ) : (
                approvals.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-slate-900">{item.quoteReference || 'Quote Deal'}</div>
                      <div className="text-[11px] text-slate-400 font-mono">Step ID: {item.id.slice(0, 8)}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center space-x-1 font-medium text-slate-800">
                        <Building2 className="w-3.5 h-3.5 text-slate-400" />
                        <span>{item.customerName || 'Customer Account'}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-slate-900 tabular-nums">
                      {formatINR(item.oneTimeNet || item.totalAmount)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="bg-slate-100 text-slate-700 font-semibold px-2 py-0.5 rounded text-[11px] border border-slate-200">
                        Step {item.step}: {item.requiredRole}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">
                      <div className="flex items-center space-x-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>{item.dueAt ? formatDateTime(item.dueAt) : 'Immediate'}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-5 py-3.5 text-right space-x-1.5">
                      <button
                        onClick={() => handleInspectDeal(item)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded text-xs inline-flex items-center space-x-1 transition-colors"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Inspect</span>
                      </button>

                      {item.status === 'PENDING' && (
                        <>
                          <button
                            onClick={() => handleOpenDecision(item, 'APPROVE')}
                            className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded text-xs transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleOpenDecision(item, 'RETURN_FOR_REVISION')}
                            className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold rounded text-xs transition-colors"
                          >
                            Return
                          </button>
                          <button
                            onClick={() => handleOpenDecision(item, 'REJECT')}
                            className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold rounded text-xs transition-colors"
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Side-by-side Deal Inspection Modal */}
      <Modal
        isOpen={inspectModalOpen}
        onClose={() => setInspectModalOpen(false)}
        title={`Deal Inspection: ${selectedApproval?.quoteReference || 'Quotation Review'}`}
        subtitle="Examine submitted line items, margin impact, and discount excess before deciding."
        maxWidth="max-w-3xl"
      >
        {inspectionData ? (
          <div className="space-y-4 text-xs">
            {/* Risk & Margin Card */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-700">Blended Contribution Margin:</span>
                <span className="text-base font-bold text-slate-900 tabular-nums">
                  {formatPercent(inspectionData.totals?.contributionPercent || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-600">
                <span>Total One-Time Deal Value:</span>
                <span className="font-semibold text-indigo-700 tabular-nums">
                  {formatINR(inspectionData.totals?.oneTimeTotal)}
                </span>
              </div>
            </div>

            {/* Itemized Lines */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold">
                  <tr>
                    <th className="p-2.5">Item Description</th>
                    <th className="p-2.5">Qty</th>
                    <th className="p-2.5">Unit Price</th>
                    <th className="p-2.5">Line Discount</th>
                    <th className="p-2.5 text-right">Net Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(inspectionData.lines || []).map((l, i) => (
                    <tr key={i}>
                      <td className="p-2.5 font-medium text-slate-900">{l.description}</td>
                      <td className="p-2.5">{l.quantity}</td>
                      <td className="p-2.5 tabular-nums">{formatINR(l.unitPrice)}</td>
                      <td className="p-2.5 text-amber-700 font-semibold">{l.lineDiscountBp / 100}%</td>
                      <td className="p-2.5 text-right font-semibold tabular-nums">{formatINR(l.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setInspectModalOpen(false)}
                className="px-4 py-2 bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-800"
              >
                Close Inspection
              </button>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-slate-400">Loading deal inspection data...</div>
        )}
      </Modal>

      {/* Decision Modal */}
      <Modal
        isOpen={decisionModalOpen}
        onClose={() => setDecisionModalOpen(false)}
        title={`Record Decision: ${decisionType}`}
        subtitle={`Quotation Reference: ${selectedApproval?.quoteReference}`}
      >
        <form onSubmit={handleSubmitDecision} className="space-y-4 text-xs">
          <div
            className={`p-3 rounded-lg border ${
              decisionType === 'APPROVE'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : decisionType === 'REJECT'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            <div className="font-bold">
              Action: {decisionType.replace(/_/g, ' ')}
            </div>
            <p className="text-[11px] mt-0.5">
              {decisionType === 'APPROVE'
                ? 'Clears Step 1 discount authorization. If higher concessions exist, advances to Step 2 Finance.'
                : decisionType === 'RETURN_FOR_REVISION'
                ? 'Returns the proposal to the sales representative with notes to adjust concessions.'
                : 'Rejects the proposal concession. The quote moves to REJECTED stage.'}
            </p>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Decision Reason / Auditable Notes <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={3}
              required
              value={decisionReason}
              onChange={(e) => setDecisionReason(e.target.value)}
              placeholder="Detail your managerial review rationale or requested revisions..."
              className="w-full p-2 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setDecisionModalOpen(false)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingDecision}
              className={`px-4 py-2 text-white font-semibold rounded-lg flex items-center space-x-1.5 ${
                decisionType === 'APPROVE'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : decisionType === 'REJECT'
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : 'bg-amber-600 hover:bg-amber-700'
              }`}
            >
              <span>{submittingDecision ? 'Submitting...' : `Confirm ${decisionType}`}</span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
