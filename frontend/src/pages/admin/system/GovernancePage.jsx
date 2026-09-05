import React, { useState, useEffect } from 'react';
import { api, formatDate, formatDateTime, bpToPercent } from '../../../services/api';
import { LoadingSpinner } from '../../../components/common/LoadingState';
import { Modal } from '../../../components/common/Modal';
import {
  Sliders,
  ShieldCheck,
  Users,
  UserCheck,
  Plus,
  RefreshCw,
  Clock,
  Layers,
  CheckCircle2,
} from 'lucide-react';

export function GovernancePage() {
  const [activeTab, setActiveTab] = useState('policy'); // 'policy' | 'profiles'
  const [currentPolicy, setCurrentPolicy] = useState(null);
  const [policyHistory, setPolicyHistory] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // New Policy Version Modal
  const [newPolicyModalOpen, setNewPolicyModalOpen] = useState(false);
  const [hwCeiling, setHwCeiling] = useState(10);
  const [swCeiling, setSwCeiling] = useState(15);
  const [svcsCeiling, setSvcsCeiling] = useState(12);
  const [cloudCeiling, setCloudCeiling] = useState(8);
  const [submittingPolicy, setSubmittingPolicy] = useState(false);

  const loadData = async () => {
    try {
      setRefreshing(true);
      const [curPol, polHist, profs] = await Promise.all([
        api.get('/discount-policies/current').catch(() => null),
        api.get('/discount-policies').catch(() => []),
        api.get('/admin/profiles').catch(() => []),
      ]);

      setCurrentPolicy(curPol);
      setPolicyHistory(Array.isArray(polHist) ? polHist : []);
      setProfiles(Array.isArray(profs) ? profs : []);
    } catch (err) {
      console.error('Failed to load governance data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handlePublishPolicy = async (e) => {
    e.preventDefault();
    setSubmittingPolicy(true);
    try {
      const payload = {
        categoryCeilings: {
          HW: hwCeiling * 100,
          SW: swCeiling * 100,
          SVCS: svcsCeiling * 100,
          CLOUD: cloudCeiling * 100,
        },
        step1MaxConcessionValue: 50000,
        step2MaxConcessionValue: 200000,
        effectiveDate: new Date().toISOString().split('T')[0],
      };

      await api.post('/discount-policies', payload);
      setNewPolicyModalOpen(false);
      alert('New immutable Discount Policy published successfully!');
      loadData();
    } catch (err) {
      alert('Failed to publish policy: ' + err.message);
    } finally {
      setSubmittingPolicy(false);
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
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Governance & Risk Policies</h2>
            <span className="text-xs bg-purple-50 text-purple-700 font-semibold px-2.5 py-0.5 rounded-full border border-purple-200">
              Regulatory Desk
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Immutable discount policy versioning, approval limits, user role provisioning, and delegations.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={loadData}
            disabled={refreshing}
            className="p-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>

          {activeTab === 'policy' && (
            <button
              onClick={() => setNewPolicyModalOpen(true)}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Publish New Policy Version</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 space-x-4">
        <button
          onClick={() => setActiveTab('policy')}
          className={`pb-3 text-xs font-semibold flex items-center space-x-2 border-b-2 transition-colors ${
            activeTab === 'policy'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Discount Policy Engine</span>
        </button>

        <button
          onClick={() => setActiveTab('profiles')}
          className={`pb-3 text-xs font-semibold flex items-center space-x-2 border-b-2 transition-colors ${
            activeTab === 'profiles'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>User Profiles & Roles ({profiles.length})</span>
        </button>
      </div>

      {/* Tab 1: Policy Engine */}
      {activeTab === 'policy' && (
        <div className="space-y-6">
          {/* Current Policy Banner */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    Active Governance Policy v{currentPolicy?.versionNumber || 1}
                  </h3>
                  <div className="text-xs text-slate-500">
                    Effective From: {formatDate(currentPolicy?.effectiveDate || currentPolicy?.createdAt)}
                  </div>
                </div>
              </div>

              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                Active & Enforced
              </span>
            </div>

            {/* Matrix of Category Ceilings */}
            <div className="pt-3 border-t border-slate-100">
              <div className="text-xs font-semibold text-slate-700 mb-3">Pre-Approved Category Ceilings</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { cat: 'HW (Hardware)', ceiling: '10.0%', desc: 'Base unit discounts' },
                  { cat: 'SW (Software)', ceiling: '15.0%', desc: 'Perpetual licenses' },
                  { cat: 'SVCS (Services)', ceiling: '12.0%', desc: 'Implementation & training' },
                  { cat: 'CLOUD (Subscriptions)', ceiling: '8.0%', desc: 'Monthly/annual SaaS' },
                ].map((item, i) => (
                  <div key={i} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="text-[11px] font-semibold text-slate-500">{item.cat}</div>
                    <div className="text-lg font-bold text-slate-900 mt-1">{item.ceiling}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{item.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Approval Routing Tiers */}
            <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-3 bg-blue-50/60 rounded-lg border border-blue-100">
                <span className="font-bold text-blue-900 block">Step 1: Sales Manager Review</span>
                <span className="text-slate-600 mt-0.5 block">
                  Triggered when any line exceeds category ceiling, or order discount exceeds 5.0%.
                </span>
              </div>
              <div className="p-3 bg-purple-50/60 rounded-lg border border-purple-100">
                <span className="font-bold text-purple-900 block">Step 2: Finance Controller Sign-off</span>
                <span className="text-slate-600 mt-0.5 block">
                  Mandatory when deal blended margin drops below 25.0%, or excess concessions exceed INR 50,000.
                </span>
              </div>
            </div>
          </div>

          {/* Historical Versions */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-50/70 border-b border-slate-200">
              <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                Immutable Policy Audit History
              </h3>
            </div>
            <div className="divide-y divide-slate-100 text-xs">
              {policyHistory.length === 0 ? (
                <div className="p-4 text-slate-400 text-center">No prior policy versions archived.</div>
              ) : (
                policyHistory.map((p) => (
                  <div key={p.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
                    <div>
                      <div className="font-semibold text-slate-900">Policy Version #{p.versionNumber}</div>
                      <div className="text-[11px] text-slate-500 font-mono">ID: {p.id}</div>
                    </div>
                    <div className="text-slate-500">{formatDate(p.createdAt)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: User Profiles */}
      {activeTab === 'profiles' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase font-semibold">
                <tr>
                  <th className="px-5 py-3">Full Name & Email</th>
                  <th className="px-5 py-3">Assigned Role</th>
                  <th className="px-5 py-3">Assigned Team</th>
                  <th className="px-5 py-3">Capabilities Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {profiles.map((pr) => (
                  <tr key={pr.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-slate-900">{pr.fullName || 'User'}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{pr.email}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="bg-indigo-50 text-indigo-700 font-semibold px-2 py-0.5 rounded border border-indigo-200 text-[11px]">
                        {pr.role}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">{pr.teamName || '—'}</td>
                    <td className="px-5 py-3.5 text-slate-500">{pr.capabilities?.length || 0} permissions</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Publish Policy Modal */}
      <Modal
        isOpen={newPolicyModalOpen}
        onClose={() => setNewPolicyModalOpen(false)}
        title="Publish Immutable Policy Version"
        subtitle="Creating a new version updates category ceiling rules for all subsequent quotation revisions."
      >
        <form onSubmit={handlePublishPolicy} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Hardware Ceiling %</label>
              <input
                type="number"
                step="0.5"
                value={hwCeiling}
                onChange={(e) => setHwCeiling(parseFloat(e.target.value) || 0)}
                className="w-full p-2 border border-slate-200 rounded-lg bg-white"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Software Ceiling %</label>
              <input
                type="number"
                step="0.5"
                value={swCeiling}
                onChange={(e) => setSwCeiling(parseFloat(e.target.value) || 0)}
                className="w-full p-2 border border-slate-200 rounded-lg bg-white"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Services Ceiling %</label>
              <input
                type="number"
                step="0.5"
                value={svcsCeiling}
                onChange={(e) => setSvcsCeiling(parseFloat(e.target.value) || 0)}
                className="w-full p-2 border border-slate-200 rounded-lg bg-white"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Cloud SaaS Ceiling %</label>
              <input
                type="number"
                step="0.5"
                value={cloudCeiling}
                onChange={(e) => setCloudCeiling(parseFloat(e.target.value) || 0)}
                className="w-full p-2 border border-slate-200 rounded-lg bg-white"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setNewPolicyModalOpen(false)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingPolicy}
              className="px-4 py-2 bg-slate-900 text-white font-semibold rounded-lg hover:bg-slate-800"
            >
              <span>{submittingPolicy ? 'Publishing...' : 'Publish Version'}</span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
