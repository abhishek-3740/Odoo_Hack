import React, { useState, useEffect } from 'react';
import { api, formatDate, formatDateTime } from '../../../services/api';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { LoadingSpinner } from '../../../components/common/LoadingState';
import {
  Activity,
  AlertTriangle,
  Send,
  RefreshCw,
  Bell,
  Clock,
  CheckCircle2,
  TrendingDown,
  ShieldAlert,
} from 'lucide-react';

export function ManagerHealthPage() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sweeping, setSweeping] = useState(false);
  const [nudgingId, setNudgingId] = useState(null);

  const loadAlerts = async () => {
    try {
      setLoading(true);
      const data = await api.get('/alerts');
      setAlerts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load alerts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, []);

  const handleTriggerSweep = async () => {
    setSweeping(true);
    try {
      await api.post('/alerts/sweeps', {});
      alert('Manual Deal Health Sweep completed successfully!');
      loadAlerts();
    } catch (err) {
      alert('Health sweep failed: ' + err.message);
    } finally {
      setSweeping(false);
    }
  };

  const handleNudgeRep = async (alertId) => {
    setNudgingId(alertId);
    try {
      await api.post(`/alerts/${alertId}/nudges`, {});
      alert('Nudge notification dispatched to sales representative!');
      loadAlerts();
    } catch (err) {
      alert('Failed to nudge sales rep: ' + err.message);
    } finally {
      setNudgingId(null);
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
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Deal Health & Anomaly Center</h2>
            <span className="text-xs bg-rose-50 text-rose-700 font-semibold px-2.5 py-0.5 rounded-full border border-rose-200">
              Active Monitoring
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Automated detection of stalled deals, approval slippages, and statistical discount outliers.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={loadAlerts}
            className="p-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <button
            onClick={handleTriggerSweep}
            disabled={sweeping}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-xs"
          >
            <Activity className="w-4 h-4" />
            <span>{sweeping ? 'Sweeping Pipeline...' : 'Run Health Sweep Now'}</span>
          </button>
        </div>
      </div>

      {/* Alerts Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
            Flagged Pipeline Anomalies ({alerts.length})
          </h3>
          <span className="text-xs text-slate-500">Auto-refreshed via health engine</span>
        </div>

        <div className="divide-y divide-slate-100 text-xs">
          {alerts.length === 0 ? (
            <div className="p-10 text-center text-slate-400">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <div className="font-semibold text-slate-800">Pipeline In Optimal Health</div>
              <div className="text-xs text-slate-500 mt-0.5">No stalled proposals or policy outliers detected.</div>
            </div>
          ) : (
            alerts.map((alt) => (
              <div
                key={alt.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-slate-900 text-sm">{alt.title || alt.alertType}</span>
                    <span className="text-[10px] bg-rose-50 text-rose-700 font-bold px-2 py-0.5 rounded border border-rose-200">
                      {alt.severity || 'WARNING'}
                    </span>
                  </div>
                  <p className="text-slate-600 leading-relaxed max-w-2xl">{alt.message || alt.description}</p>
                  <div className="flex items-center space-x-3 text-[11px] text-slate-400 pt-1">
                    <span>Target: {alt.entityReference || alt.entityId?.slice(0, 8)}</span>
                    <span>•</span>
                    <span>Detected: {formatDateTime(alt.createdAt)}</span>
                  </div>
                </div>

                <div className="shrink-0 flex items-center space-x-2">
                  <button
                    onClick={() => handleNudgeRep(alt.id)}
                    disabled={nudgingId === alt.id}
                    className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
                  >
                    <Bell className="w-3.5 h-3.5" />
                    <span>{nudgingId === alt.id ? 'Nudging...' : 'Nudge Sales Rep'}</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
