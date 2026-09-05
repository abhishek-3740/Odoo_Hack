import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api, formatINR } from '../../services/api';
import { StatusBadge } from '../../components/common/StatusBadge';
import { LoadingSpinner } from '../../components/common/LoadingState';
import {
  TrendingUp,
  FileSpreadsheet,
  CheckSquare,
  Activity,
  PackageCheck,
  Receipt,
  Layers,
  ArrowRight,
  ShieldCheck,
  Briefcase,
  AlertTriangle,
  PlayCircle,
} from 'lucide-react';

export function AdminOverviewPage() {
  const { user, hasRole } = useAuth();
  const [stats, setStats] = useState({
    totalPipeline: 0,
    quoteCount: 0,
    pendingApprovals: 0,
    activeAlerts: 0,
    recentQuotes: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboard() {
      try {
        setLoading(true);
        const [quotesRes, approvalsRes, alertsRes] = await Promise.all([
          api.get('/quotes').catch(() => ({ content: [] })),
          api.get('/approval-requests?status=PENDING').catch(() => ({ content: [] })),
          api.get('/alerts').catch(() => []),
        ]);

        const quotesList = quotesRes?.items || quotesRes?.content || (Array.isArray(quotesRes) ? quotesRes : []);
        const approvalsList = approvalsRes?.items || approvalsRes?.content || (Array.isArray(approvalsRes) ? approvalsRes : []);
        const alertsList = Array.isArray(alertsRes) ? alertsRes : [];

        const pipelineVal = quotesList.filter(q => ['DRAFT','REVIEW','SENT','UNDER_NEGOTIATION'].includes(q.stage)).reduce((acc, q) => acc + (parseFloat(q.oneTimeNet) || 0), 0);

        setStats({
          totalPipeline: pipelineVal,
          quoteCount: quotesRes.totalItems ?? quotesList.length,
          pendingApprovals: approvalsList.length,
          activeAlerts: alertsList.length,
          recentQuotes: quotesList.slice(0, 5),
        });
      } catch (err) {
        console.error('Failed to load dashboard metrics:', err);
      } finally {
        setLoading(false);
      }
    }
    loadDashboard();
  }, []);

  const canSales = hasRole('REP', 'ADMIN');
  const canManager = hasRole('MANAGER', 'ADMIN');
  const canFinance = hasRole('FINANCE', 'ADMIN');
  const canAdmin = hasRole('ADMIN');

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Welcome Banner */}
      <div className="bg-white rounded-xl border border-slate-200/80 p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Executive Deal Switchboard</h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
              {user?.role} Mode
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time pipeline analytics, governed discount controls, and cross-warehouse operations.
          </p>
        </div>

        {canSales && (
          <Link
            to="/admin/sales/quotes/new"
            className="inline-flex items-center space-x-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs self-start"
          >
            <span>+ Build New Quotation</span>
          </Link>
        )}
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Recent open value</span>
            <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums mt-3">
            {formatINR(stats.totalPipeline)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">One-time net in the latest quotations</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Quotations</span>
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-3">{stats.quoteCount}</div>
          <div className="text-[11px] text-slate-500 mt-1">All quotations you can access</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pending Approvals</span>
            <div className="p-2 bg-amber-50 rounded-lg text-amber-600">
              <CheckSquare className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-amber-600 mt-3">{stats.pendingApprovals}</div>
          <div className="text-[11px] text-slate-500 mt-1">Step 1 & Step 2 requests</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Health Anomalies</span>
            <div className="p-2 bg-rose-50 rounded-lg text-rose-600">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-rose-600 mt-3">{stats.activeAlerts}</div>
          <div className="text-[11px] text-slate-500 mt-1">Stalled deals or discount spikes</div>
        </div>
      </div>

      {/* Role Launchpad Quick Action Cards */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Domain Workspaces</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {canSales && (
            <Link
              to="/admin/sales/quotes"
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:border-indigo-300 hover:shadow-md transition-all group"
            >
              <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold mb-3 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <Briefcase className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-sm text-slate-900">Sales Representative</h4>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Build quotes with live margin bars, risk checks, co-purchase suggestions, and customer portal links.
              </p>
              <div className="mt-4 flex items-center text-xs font-semibold text-indigo-600 space-x-1">
                <span>Enter Workspace</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          )}

          {canManager && (
            <Link
              to="/admin/manager/approvals"
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:border-blue-300 hover:shadow-md transition-all group"
            >
              <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold mb-3 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                <CheckSquare className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-sm text-slate-900">Sales Management</h4>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Review Step 1 discount authorization requests, side-by-side deal inspection, sweeps, and nudges.
              </p>
              <div className="mt-4 flex items-center text-xs font-semibold text-blue-600 space-x-1">
                <span>View Inbox</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          )}

          {canFinance && (
            <Link
              to="/admin/finance/fulfillment"
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:border-emerald-300 hover:shadow-md transition-all group"
            >
              <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold mb-3 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                <PackageCheck className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-sm text-slate-900">Finance & Operations</h4>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Step 2 sign-off, multi-warehouse allocations, dispatches, stock movement receipts, and recurring billing.
              </p>
              <div className="mt-4 flex items-center text-xs font-semibold text-emerald-600 space-x-1">
                <span>Open Operations</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          )}

          {canAdmin && (
            <Link
              to="/admin/system/catalog"
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:border-purple-300 hover:shadow-md transition-all group"
            >
              <div className="w-9 h-9 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center font-bold mb-3 group-hover:bg-purple-600 group-hover:text-white transition-colors">
                <Layers className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-sm text-slate-900">System Governance</h4>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Versioned discount policy publisher, master catalog editor, automated background jobs, and sales reports.
              </p>
              <div className="mt-4 flex items-center text-xs font-semibold text-purple-600 space-x-1">
                <span>Manage System</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          )}
        </div>
      </div>

      {/* Recent Quotes Feed */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wider">Active Deals in Pipeline</h3>
          {canSales && (
            <Link to="/admin/sales/quotes" className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold">
              View All Pipeline &rarr;
            </Link>
          )}
        </div>

        <div className="divide-y divide-slate-100 text-xs">
          {stats.recentQuotes.length === 0 ? (
            <div className="p-6 text-center text-slate-400">No quotation records found.</div>
          ) : (
            stats.recentQuotes.map((q) => (
              <div key={q.id} className="p-4 flex items-center justify-between hover:bg-slate-50/70 transition-colors">
                <div className="flex items-center space-x-3">
                  <div className="font-semibold text-slate-900">{q.reference}</div>
                  <span className="text-slate-500 font-medium">{q.customerName || 'Customer'}</span>
                  <StatusBadge status={q.stage || q.approvalStatus} />
                </div>

                <div className="flex items-center space-x-4">
                  <span className="font-semibold text-slate-900 tabular-nums">{formatINR(q.oneTimeNet)}</span>
                  {canSales && (
                    <Link
                      to={`/admin/sales/quotes/${q.id}`}
                      className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded text-xs transition-colors"
                    >
                      Open
                    </Link>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
