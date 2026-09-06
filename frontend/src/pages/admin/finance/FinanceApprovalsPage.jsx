import React, { useState, useEffect, useCallback } from 'react';
import { api, formatINR, formatPercent, formatDate, formatDateTime } from '../../../services/api';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { LoadingSpinner } from '../../../components/common/LoadingState';
import { Modal } from '../../../components/common/Modal';
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Building2,
  Eye,
  RotateCcw,
} from 'lucide-react';
import { useDealEvents } from '../../../hooks/useDealEvents';

export function FinanceApprovalsPage() {
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('PENDING');

  // Decision Modal State
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [decisionType, setDecisionType] = useState('APPROVE');
  const [decisionReason, setDecisionReason] = useState('');
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [loadError, setLoadError] = useState('');

  const loadApprovals = useCallback(async () => {
    try {
      setRefreshing(true);
      setLoadError('');
      const res = await api.get(`/approval-requests?status=${statusFilter}&pageSize=100`);
      const list = res?.items || res?.content || (Array.isArray(res) ? res : []);
      // Filter for Step 2 or Finance
      setApprovals(list.filter((x) => x.step === 2 || x.requiredRole === 'FINANCE'));
    } catch (err) {
      console.error('Failed to load finance approvals:', err);
      setLoadError('Could not load finance approvals: ' + err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadApprovals();
  }, [loadApprovals]);

  // Auto-refresh when a finance-relevant approval event arrives over WebSocket.
  useDealEvents(
    (e) => e.type === 'APPROVAL_UPDATED' || e.type === 'QUOTE_SUBMITTED',
    loadApprovals
  );

  const handleOpenDecision = (item, type) => {
    setSelectedApproval(item);
    setDecisionType(type);
    setDecisionReason('');
    setDecisionModalOpen(true);
  };

  const handleSubmitDecision = async (e) => {
    e.preventDefault();
    if (!selectedApproval) return;

    setSubmittingDecision(true);
    try {
      const payload = {
        decision: decisionType,
        expectedRevisionId: selectedApproval.revisionId,
        reason: decisionReason.trim() || `Step 2 Finance ${decisionType} sign-off`,
      };

      await api.postWithIdempotency(`/approval-requests/${selectedApproval.id}/decisions`, payload);
      setDecisionModalOpen(false);
      alert(`Finance decision [${decisionType}] recorded successfully!`);
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
      {loadError && <p role="alert" className="error-notice">{loadError}</p>}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Step 2 Finance Sign-Off</h2>
            <span className="text-xs bg-purple-50 text-purple-700 font-semibold px-2.5 py-0.5 rounded-full border border-purple-200">
              Commercial Controller Level
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Final commercial authorization for deep discounts, below-margin exceptions, and extended credit terms.
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

      {/* Approvals List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold">
              <tr>
                <th className="px-5 py-3.5">Quotation Reference</th>
                <th className="px-5 py-3.5">Customer</th>
                <th className="px-5 py-3.5">Deal Value</th>
                <th className="px-5 py-3.5">Step</th>
                <th className="px-5 py-3.5">Due Date</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Finance Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {approvals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                    No Step 2 {statusFilter.toLowerCase()} authorization requests.
                  </td>
                </tr>
              ) : (
                approvals.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-slate-900">{item.quoteReference}</div>
                      <div className="text-[11px] text-slate-400 font-mono">ID: {item.id.slice(0, 8)}</div>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-slate-800">{item.customerName || 'Customer'}</td>
                    <td className="px-5 py-3.5 font-semibold text-slate-900 tabular-nums">
                      {formatINR(item.oneTimeNet || item.totalAmount)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="bg-purple-50 text-purple-700 font-bold px-2 py-0.5 rounded text-[11px] border border-purple-200">
                        Step 2: Finance
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">{formatDate(item.dueAt)}</td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-5 py-3.5 text-right space-x-1.5">
                      {item.status === 'PENDING' && (
                        <>
                          {!item.actionable && <span className="text-xs text-amber-800">{item.blockedReason || 'Waiting for manager approval'}</span>}
                          <button
                            disabled={!item.actionable}
                            onClick={() => handleOpenDecision(item, 'APPROVE')}
                            className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded text-xs transition-colors"
                          >
                            Approve Deal
                          </button>
                          <button
                            disabled={!item.actionable}
                            onClick={() => handleOpenDecision(item, 'RETURN_FOR_REVISION')}
                            className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold rounded text-xs transition-colors"
                          >
                            Return
                          </button>
                          <button
                            disabled={!item.actionable}
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

      {/* Decision Modal */}
      <Modal
        isOpen={decisionModalOpen}
        onClose={() => setDecisionModalOpen(false)}
        title={`Finance Sign-Off: ${decisionType}`}
        subtitle={`Proposal Reference: ${selectedApproval?.quoteReference}`}
      >
        <form onSubmit={handleSubmitDecision} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Controller Decision Reason / Sign-off Notes <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={3}
              required
              value={decisionReason}
              onChange={(e) => setDecisionReason(e.target.value)}
              placeholder="Record financial risk sign-off, margin exception notes, or required contract covenants..."
              className="w-full p-2 border border-slate-200 rounded-lg bg-white"
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
              className={`px-4 py-2 text-white font-semibold rounded-lg ${
                decisionType === 'APPROVE' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
              }`}
            >
              <span>{submittingDecision ? 'Submitting...' : `Execute ${decisionType}`}</span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
