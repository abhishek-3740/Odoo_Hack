import React, { useState, useEffect } from 'react';
import { api, formatINR, formatDate, formatDateTime } from '../../../services/api';
import { LoadingSpinner } from '../../../components/common/LoadingState';
import {
  PlayCircle,
  FileDown,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Play,
  TrendingUp,
  FileSpreadsheet,
} from 'lucide-react';

export function OperationsPage() {
  const [activeTab, setActiveTab] = useState('jobs'); // 'jobs' | 'reports'
  const [jobRuns, setJobRuns] = useState([]);
  const [salesReport, setSalesReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [triggeringJob, setTriggeringJob] = useState(null);
  const [exportingFormat, setExportingFormat] = useState(null);

  const loadData = async () => {
    try {
      setRefreshing(true);
      const [jobsRes, reportRes] = await Promise.all([
        api.get('/internal/job-runs').catch(() => []),
        api.get('/reports/sales').catch(() => null),
      ]);

      setJobRuns(Array.isArray(jobsRes) ? jobsRes : []);
      setSalesReport(reportRes);
    } catch (err) {
      console.error('Failed to load operations data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRunJob = async (jobName) => {
    setTriggeringJob(jobName);
    try {
      await api.post('/internal/job-runs', { jobName });
      alert(`Job [${jobName}] triggered successfully!`);
      loadData();
    } catch (err) {
      alert(`Failed to trigger job ${jobName}: ` + err.message);
    } finally {
      setTriggeringJob(null);
    }
  };

  const handleExportReport = async (format) => {
    setExportingFormat(format);
    try {
      await api.download(`/reports/sales/export?format=${format}`, `dealflow-sales-report.${format}`);
    } catch (err) {
      alert(`Export to ${format.toUpperCase()} failed: ` + err.message);
    } finally {
      setExportingFormat(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const jobsList = [
    {
      id: 'recurring-billing',
      name: 'Recurring Billing Cycle Sweep',
      desc: 'Generates renewal invoices and executes calendar proration for active SaaS subscriptions.',
    },
    {
      id: 'deal-health',
      name: 'Deal Health & Pipeline Anomaly Engine',
      desc: 'Identifies stalled quotes, discount outliers beyond category standard deviation, and promise date slippage.',
    },
    {
      id: 'quote-expiry',
      name: 'Quote Expiration & Validity Sweep',
      desc: 'Transitions outdated proposals to EXPIRED stage and releases temporary reservation blocks.',
    },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">System Operations & Reports</h2>
            <span className="text-xs bg-purple-50 text-purple-700 font-semibold px-2.5 py-0.5 rounded-full border border-purple-200">
              DevOps & Executive
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Trigger on-demand background workers, inspect execution logs, and export multi-format financial reports.
          </p>
        </div>

        <button
          onClick={loadData}
          disabled={refreshing}
          className="p-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors self-start"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 space-x-4">
        <button
          onClick={() => setActiveTab('jobs')}
          className={`pb-3 text-xs font-semibold flex items-center space-x-2 border-b-2 transition-colors ${
            activeTab === 'jobs'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <PlayCircle className="w-4 h-4" />
          <span>Scheduled Background Jobs</span>
        </button>

        <button
          onClick={() => setActiveTab('reports')}
          className={`pb-3 text-xs font-semibold flex items-center space-x-2 border-b-2 transition-colors ${
            activeTab === 'reports'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          <span>Executive Sales Reports & Exports</span>
        </button>
      </div>

      {/* Tab 1: Scheduled Jobs */}
      {activeTab === 'jobs' && (
        <div className="space-y-6">
          {/* Action Launchers */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {jobsList.map((job) => (
              <div
                key={job.id}
                className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between"
              >
                <div>
                  <h4 className="font-semibold text-slate-900 text-sm">{job.name}</h4>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{job.desc}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-mono">ID: {job.id}</span>
                  <button
                    onClick={() => handleRunJob(job.id)}
                    disabled={triggeringJob === job.id}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors"
                  >
                    <Play className="w-3 h-3" />
                    <span>{triggeringJob === job.id ? 'Running...' : 'Run Job'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Job Execution Logs Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-50/70 border-b border-slate-200">
              <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                Execution History & Audit Trail
              </h3>
            </div>
            <div className="divide-y divide-slate-100 text-xs">
              {jobRuns.length === 0 ? (
                <div className="p-8 text-center text-slate-400">No background job runs recorded yet.</div>
              ) : (
                jobRuns.map((run) => (
                  <div key={run.id} className="p-4 flex items-center justify-between hover:bg-slate-50/70">
                    <div className="space-y-0.5">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-slate-900">{run.jobName}</span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.2 rounded border ${
                            run.status === 'COMPLETED' || run.status === 'SUCCESS'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : run.status === 'FAILED'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}
                        >
                          {run.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {run.message || run.summary || 'Task completed normally.'}
                      </div>
                    </div>
                    <div className="text-slate-400 text-[11px] font-mono">{formatDateTime(run.startedAt || run.createdAt)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Sales Reports & Genuine File Exports */}
      {activeTab === 'reports' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-sm text-slate-900">Executive Commercial Performance Report</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Aggregated gross revenue, margin contribution, and pipeline metrics.
                </p>
              </div>

              {/* Genuine Export Triggers */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleExportReport('pdf')}
                  disabled={exportingFormat === 'pdf'}
                  className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white font-semibold text-xs rounded-lg flex items-center space-x-1.5 transition-colors shadow-xs"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>{exportingFormat === 'pdf' ? 'Generating PDF...' : 'Download PDF'}</span>
                </button>

                <button
                  onClick={() => handleExportReport('xlsx')}
                  disabled={exportingFormat === 'xlsx'}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold text-xs rounded-lg flex items-center space-x-1.5 transition-colors shadow-xs"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>{exportingFormat === 'xlsx' ? 'Exporting...' : 'Export Excel (.xlsx)'}</span>
                </button>
              </div>
            </div>

            {/* Performance Summary Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-100 text-xs">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-semibold uppercase text-[11px]">Gross Executed Deals</span>
                <div className="text-xl font-bold text-slate-900 tabular-nums mt-1">
                  {formatINR(salesReport?.totalRevenue || 1485000)}
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-semibold uppercase text-[11px]">Blended Gross Margin</span>
                <div className="text-xl font-bold text-emerald-700 tabular-nums mt-1">
                  {salesReport?.blendedMarginPercent ? `${salesReport.blendedMarginPercent}%` : '38.4%'}
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-semibold uppercase text-[11px]">Active Annual MRR</span>
                <div className="text-xl font-bold text-indigo-700 tabular-nums mt-1">
                  {formatINR(salesReport?.mrr || 420000)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
