import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { LoadingSpinner } from '../../components/common/LoadingState';
import { Bell, Monitor, Lock, LogOut, Check, AlertCircle } from 'lucide-react';

const NOTIFICATION_PREFS = [
  { key: 'emailNotifications', label: 'Email notifications', hint: 'A copy of important portal events by email.' },
  { key: 'dealUpdates', label: 'Deal room updates', hint: 'Replies, revised terms and approvals on your quotations.' },
  { key: 'invoiceReminders', label: 'Invoice reminders', hint: 'Due-date and payment confirmations.' },
  { key: 'marketingUpdates', label: 'Product news', hint: 'New catalogue items and offers. Off by default.' },
];

const DISPLAY_PREFS = [
  { key: 'compactTables', label: 'Compact tables', hint: 'Tighter rows in quotation and invoice lists.' },
  { key: 'showPricesWithTax', label: 'Show prices with tax', hint: 'Where a tax rate applies, show tax-inclusive totals.' },
];

const DEFAULTS = {
  emailNotifications: true,
  dealUpdates: true,
  invoiceReminders: true,
  marketingUpdates: false,
  compactTables: false,
  showPricesWithTax: false,
  defaultLanding: 'dashboard',
};

function Switch({ id, checked, onChange, label, hint }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <label htmlFor={id} className="cursor-pointer">
        <span className="block text-xs font-semibold text-slate-900">{label}</span>
        {hint && <span className="block text-[11px] text-slate-500 mt-0.5">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60 ${checked ? 'bg-indigo-600' : 'bg-slate-300'}`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

function Notice({ tone, children }) {
  if (!children) return null;
  const cls = tone === 'error' ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700';
  const Icon = tone === 'error' ? AlertCircle : Check;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`p-2.5 border rounded-lg text-xs flex items-center space-x-2 ${cls}`}>
      <Icon className="w-4 h-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function CustomerSettingsPage() {
  const { logout, updateUserLocal } = useAuth();
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsNotice, setPrefsNotice] = useState(null);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);
  const [pwNotice, setPwNotice] = useState(null);

  useEffect(() => {
    api
      .get('/portal/account')
      .then((data) => {
        setAccount(data);
        setPrefs({ ...DEFAULTS, ...(data?.preferences || {}) });
      })
      .catch((err) => setPrefsNotice({ tone: 'error', text: err.message || 'Could not load settings.' }))
      .finally(() => setLoading(false));
  }, []);

  const savePrefs = async (next) => {
    setPrefs(next);
    setSavingPrefs(true);
    setPrefsNotice(null);
    try {
      const updated = await api.put('/portal/account/preferences', { preferences: next });
      const merged = { ...DEFAULTS, ...(updated?.preferences || next) };
      setPrefs(merged);
      updateUserLocal({ preferences: merged });
      setPrefsNotice({ tone: 'ok', text: 'Preferences saved.' });
      setTimeout(() => setPrefsNotice(null), 3000);
    } catch (err) {
      setPrefsNotice({ tone: 'error', text: err.message || 'Could not save preferences.' });
    } finally {
      setSavingPrefs(false);
    }
  };

  const toggle = (key) => (value) => savePrefs({ ...prefs, [key]: value });

  const changePassword = async (e) => {
    e.preventDefault();
    setPwNotice(null);
    if (pw.next.length < 8) {
      setPwNotice({ tone: 'error', text: 'The new password needs at least 8 characters.' });
      return;
    }
    if (pw.next !== pw.confirm) {
      setPwNotice({ tone: 'error', text: 'The new passwords do not match.' });
      return;
    }
    setSavingPw(true);
    try {
      await api.post('/portal/account/password', { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      setPwNotice({ tone: 'ok', text: 'Password changed.' });
    } catch (err) {
      setPwNotice({ tone: 'error', text: err.message || 'Could not change the password.' });
    } finally {
      setSavingPw(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const pwInput =
    'w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60';

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Settings</h2>
        <p className="text-xs text-slate-500 mt-0.5">Notifications, display preferences and account security. Changes save automatically.</p>
      </div>

      <Notice tone={prefsNotice?.tone === 'error' ? 'error' : 'ok'}>{prefsNotice?.text}</Notice>

      <section className="bg-white rounded-xl border border-slate-200 shadow-xs p-5" aria-busy={savingPrefs}>
        <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
          <Bell className="w-4 h-4 text-indigo-600" />
          <span>Notifications</span>
        </h3>
        <div className="divide-y divide-slate-100 mt-2">
          {NOTIFICATION_PREFS.map((p) => (
            <Switch key={p.key} id={`pref-${p.key}`} checked={!!prefs[p.key]} onChange={toggle(p.key)} label={p.label} hint={p.hint} />
          ))}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 shadow-xs p-5" aria-busy={savingPrefs}>
        <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
          <Monitor className="w-4 h-4 text-indigo-600" />
          <span>Display</span>
        </h3>
        <div className="divide-y divide-slate-100 mt-2">
          {DISPLAY_PREFS.map((p) => (
            <Switch key={p.key} id={`pref-${p.key}`} checked={!!prefs[p.key]} onChange={toggle(p.key)} label={p.label} hint={p.hint} />
          ))}
          <div className="flex items-center justify-between gap-4 py-3">
            <label htmlFor="pref-landing">
              <span className="block text-xs font-semibold text-slate-900">Default landing page</span>
              <span className="block text-[11px] text-slate-500 mt-0.5">Where you arrive after signing in.</span>
            </label>
            <select
              id="pref-landing"
              value={prefs.defaultLanding || 'dashboard'}
              onChange={(e) => savePrefs({ ...prefs, defaultLanding: e.target.value })}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
            >
              <option value="dashboard">Dashboard</option>
              <option value="catalog">Catalogue</option>
              <option value="quotes">Quotations</option>
            </select>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 shadow-xs p-5">
        <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
          <Lock className="w-4 h-4 text-indigo-600" />
          <span>Security</span>
        </h3>
        {account?.canChangePassword ? (
          <form onSubmit={changePassword} className="mt-4 space-y-3 max-w-sm">
            <Notice tone={pwNotice?.tone === 'error' ? 'error' : 'ok'}>{pwNotice?.text}</Notice>
            <div>
              <label htmlFor="pw-current" className="block text-[11px] font-medium text-slate-600 mb-1">Current password</label>
              <input id="pw-current" type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} className={pwInput} />
            </div>
            <div>
              <label htmlFor="pw-next" className="block text-[11px] font-medium text-slate-600 mb-1">New password</label>
              <input id="pw-next" type="password" autoComplete="new-password" required minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} className={pwInput} />
            </div>
            <div>
              <label htmlFor="pw-confirm" className="block text-[11px] font-medium text-slate-600 mb-1">Confirm new password</label>
              <input id="pw-confirm" type="password" autoComplete="new-password" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} className={pwInput} />
            </div>
            <button type="submit" disabled={savingPw} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-xs font-semibold rounded-lg">
              {savingPw ? 'Updating…' : 'Update password'}
            </button>
          </form>
        ) : (
          <p className="text-xs text-slate-500 mt-3 leading-relaxed">
            This account signs in through {account?.authProvider === 'DEMO' ? 'a demo persona' : 'an external identity provider'}; its
            password is managed there, not in the portal.
          </p>
        )}
      </section>

      <section className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
            <LogOut className="w-4 h-4 text-slate-500" />
            <span>Session</span>
          </h3>
          <p className="text-[11px] text-slate-500 mt-1">Signs you out on this device and closes the live-updates connection.</p>
        </div>
        <button type="button" onClick={handleLogout} className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg">
          Sign out
        </button>
      </section>
    </div>
  );
}
