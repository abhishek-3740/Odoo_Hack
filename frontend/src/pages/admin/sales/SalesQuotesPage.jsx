import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatINR, formatDate } from '../../../services/api';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { LoadingSpinner } from '../../../components/common/LoadingState';
import { Modal } from '../../../components/common/Modal';
import {
  FileSpreadsheet,
  Plus,
  Search,
  Filter,
  Kanban,
  Table,
  ArrowRight,
  Clock,
  User,
  Building2,
  RefreshCw,
} from 'lucide-react';
import { useDealEvents } from '../../../hooks/useDealEvents';

export function SalesQuotesPage() {
  const [quotes, setQuotes] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'kanban'
  const [stageFilter, setStageFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Quick Create Modal
  const [createModalOpen, setCreateModalOpen] = useState(window.location.pathname.endsWith('/new'));
  const [newCustomerId, setNewCustomerId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newValidUntil, setNewValidUntil] = useState('');
  const [creating, setCreating] = useState(false);

  const navigate = useNavigate();

  const loadQuotes = useCallback(async () => {
    try {
      setRefreshing(true);
      const [quoteData, customerData] = await Promise.all([
        api.get('/quotes').catch(() => ({ content: [] })),
        api.get('/customers').catch(() => []),
      ]);

      const list = quoteData?.items || quoteData?.content || (Array.isArray(quoteData) ? quoteData : []);
      const customerList = customerData?.items || customerData?.content || (Array.isArray(customerData) ? customerData : []);
      setQuotes(list);
      setCustomers(customerList);
      if (customerList.length > 0 && !newCustomerId) {
        setNewCustomerId(customerList[0].id);
      }
    } catch (err) {
      console.error('Failed to load quotes:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadQuotes();
  }, [loadQuotes]);

  // Auto-refresh the quotes list when relevant deal events arrive over WebSocket.
  const SALES_EVENTS = new Set(['QUOTE_REVISED', 'QUOTE_SUBMITTED', 'APPROVAL_UPDATED', 'ORDER_CREATED']);
  useDealEvents(
    (e) => SALES_EVENTS.has(e.type),
    loadQuotes
  );

  const handleCreateQuote = async (e) => {
    e.preventDefault();
    if (!newCustomerId) return;

    setCreating(true);
    try {
      const payload = {
        customerId: newCustomerId,
        title: newTitle.trim() || 'New Commercial Proposal',
        validUntil: newValidUntil || null,
      };

      const res = await api.post('/quotes', payload);
      setCreateModalOpen(false);
      navigate(`/admin/sales/quotes/${res.id || res.quoteId}`);
    } catch (err) {
      alert('Failed to create quotation: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  const stages = [
    'ALL',
    'DRAFT',
    'REVIEW',
    'SENT',
    'UNDER_NEGOTIATION',
    'CONFIRMED',
    'LOST',
    'EXPIRED',
    'CANCELED',
  ];

  const filteredQuotes = quotes.filter((q) => {
    const matchesStage = stageFilter === 'ALL' || q.stage === stageFilter;
    const matchesSearch =
      !searchQuery ||
      q.reference?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.customerName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.title?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStage && matchesSearch;
  });

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
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Quotation Pipeline</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage deal negotiations, real-time discount limits, and customer approvals.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={loadQuotes}
            disabled={refreshing}
            className="p-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
            title="Refresh pipeline"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>

          {/* View Toggle */}
          <div className="bg-slate-200/80 p-0.5 rounded-lg flex items-center">
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-md text-xs font-semibold ${
                viewMode === 'table' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              <Table className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`p-1.5 rounded-md text-xs font-semibold ${
                viewMode === 'kanban' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              <Kanban className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => setCreateModalOpen(true)}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Create Quote</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by reference or customer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center space-x-1.5 overflow-x-auto w-full sm:w-auto">
          {stages.map((stage) => (
            <button
              key={stage}
              onClick={() => setStageFilter(stage)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                stageFilter === stage
                  ? 'bg-slate-900 text-white font-semibold'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200/60'
              }`}
            >
              {stage.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* View: Tabular View */}
      {viewMode === 'table' ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-5 py-3.5">Reference & Proposal</th>
                  <th className="px-5 py-3.5">Customer</th>
                  <th className="px-5 py-3.5">Stage</th>
                  <th className="px-5 py-3.5">Approval Status</th>
                  <th className="px-5 py-3.5">One-Time Value</th>
                  <th className="px-5 py-3.5">Margin %</th>
                  <th className="px-5 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredQuotes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                      No quotations match the filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredQuotes.map((q) => (
                    <tr key={q.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="font-semibold text-slate-900">{q.reference}</div>
                        <div className="text-slate-500 text-[11px] truncate max-w-xs">{q.title || 'Proposal'}</div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center space-x-1.5 font-medium text-slate-800">
                          <Building2 className="w-3.5 h-3.5 text-slate-400" />
                          <span>{q.customerName || 'Customer'}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={q.stage} />
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          {q.approvalStatus || 'Not evaluated'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-semibold text-slate-900 tabular-nums">
                        {formatINR(q.oneTimeNet)}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`font-semibold tabular-nums text-xs ${
                            parseFloat(q.contributionPercent) < 20
                              ? 'text-rose-600'
                              : parseFloat(q.contributionPercent) < 35
                              ? 'text-amber-600'
                              : 'text-emerald-700'
                          }`}
                        >
                          {q.contributionPercent ? `${parseFloat(q.contributionPercent).toFixed(1)}%` : '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Link
                          to={`/admin/sales/quotes/${q.id}`}
                          className="inline-flex items-center space-x-1 px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded text-xs transition-colors"
                        >
                          <span>Open Builder</span>
                          <ArrowRight className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* View: Kanban Board */
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {['DRAFT', 'REVIEW', 'SENT', 'CONFIRMED'].map((stage) => {
            const colQuotes = filteredQuotes.filter((q) => q.stage === stage);
            return (
              <div key={stage} className="bg-slate-100/70 rounded-xl p-3.5 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between px-1">
                  <span className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                    {stage.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs bg-slate-200 text-slate-700 font-semibold px-2 py-0.5 rounded-full">
                    {colQuotes.length}
                  </span>
                </div>

                <div className="space-y-2.5 min-h-[300px]">
                  {colQuotes.map((q) => (
                    <Link
                      key={q.id}
                      to={`/admin/sales/quotes/${q.id}`}
                      className="block p-3.5 bg-white rounded-lg border border-slate-200 shadow-xs hover:border-indigo-300 hover:shadow-md transition-all text-xs"
                    >
                      <div className="flex items-center justify-between font-semibold text-slate-900">
                        <span>{q.reference}</span>
                        <span className="tabular-nums text-indigo-600">{formatINR(q.oneTimeNet)}</span>
                      </div>
                      <div className="text-slate-600 font-medium mt-1 truncate">{q.customerName || 'Customer'}</div>
                      <div className="text-slate-400 text-[11px] mt-0.5 truncate">{q.title}</div>
                      <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                        <span>Rev #{q.revisionNo || 1}</span>
                        <span>{formatDate(q.validUntil)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New Quote Creation Dialog */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Initialize New Quotation"
        subtitle="Select customer account and proposal title to launch quotation builder."
      >
        <form onSubmit={handleCreateQuote} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Target Customer Organization</label>
            <select
              value={newCustomerId}
              onChange={(e) => setNewCustomerId(e.target.value)}
              className="w-full p-2.5 border border-slate-200 rounded-lg bg-white font-medium"
              required
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.tierCode || 'STANDARD'} Tier)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Proposal Title / Deal Name</label>
            <input
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="E.g., FY26 Infrastructure Modernization Bundle"
              className="w-full p-2.5 border border-slate-200 rounded-lg bg-white"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Offer Validity Expiration</label>
            <input
              type="date"
              value={newValidUntil}
              onChange={(e) => setNewValidUntil(e.target.value)}
              className="w-full p-2.5 border border-slate-200 rounded-lg bg-white"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setCreateModalOpen(false)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-semibold rounded-lg flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>{creating ? 'Initializing...' : 'Launch Quote Builder'}</span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
