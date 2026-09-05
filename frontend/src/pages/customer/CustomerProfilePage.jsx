import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDate } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { LoadingSpinner } from '../../components/common/LoadingState';
import { User, Building2, Mail, Phone, MapPin, Headset, Calendar, ShieldCheck, Pencil, Check, X, Settings } from 'lucide-react';

const TIER_STYLES = {
  GOLD: 'text-amber-700 bg-amber-50 border-amber-200',
  SILVER: 'text-slate-600 bg-slate-100 border-slate-300',
  BRONZE: 'text-orange-800 bg-orange-50 border-orange-200',
};

const PROVIDER_LABEL = { LOCAL: 'Email & password', DEMO: 'Demo persona', SUPABASE: 'Single sign-on' };

const inputClass =
  'w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60 disabled:bg-slate-50 disabled:text-slate-500';

function Field({ id, label, icon: Icon, value, onChange, editing, type = 'text', readOnly, multiline }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[11px] font-medium text-slate-500 mb-1">
        {label}
      </label>
      {editing && !readOnly ? (
        multiline ? (
          <textarea id={id} rows={3} value={value || ''} onChange={onChange} className={inputClass} />
        ) : (
          <input id={id} type={type} value={value || ''} onChange={onChange} className={inputClass} />
        )
      ) : (
        <div className="flex items-start space-x-2 text-xs text-slate-800 min-h-8 py-1.5">
          {Icon && <Icon className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />}
          <span className={value ? '' : 'text-slate-400'}>{value || 'Not set'}</span>
        </div>
      )}
    </div>
  );
}

export function CustomerProfilePage() {
  const { refreshUser } = useAuth();
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({});

  const load = async () => {
    try {
      setLoading(true);
      const data = await api.get('/portal/account');
      setAccount(data);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load your profile.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const startEdit = () => {
    setForm({
      fullName: account.fullName || '',
      phone: account.phone || '',
      contactEmail: account.organisation?.contactEmail || '',
      contactPhone: account.organisation?.contactPhone || '',
      billingAddress: account.organisation?.billingAddress || '',
    });
    setSaved(false);
    setError('');
    setEditing(true);
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const updated = await api.patch('/portal/account', form);
      setAccount(updated);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
      refreshUser();
    } catch (err) {
      setError(err.message || 'Could not save your changes.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!account) {
    return (
      <div role="alert" className="bg-white rounded-xl border border-rose-200 p-8 text-center text-xs text-slate-600">
        {error || 'Profile unavailable.'}
      </div>
    );
  }

  const org = account.organisation || {};
  const tierClass = TIER_STYLES[org.tier] || TIER_STYLES.BRONZE;
  const initial = (account.fullName || account.email || 'C').charAt(0).toUpperCase();

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-xl font-bold shadow-xs">{initial}</div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">{account.fullName || 'Your profile'}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {org.name} · <span className={`text-[10px] font-medium px-1.5 rounded border ${tierClass}`}>{(org.tier || 'BRONZE').toLowerCase()} tier</span>
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {saved && (
            <span role="status" className="inline-flex items-center space-x-1 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
              <Check className="w-3.5 h-3.5" />
              <span>Saved</span>
            </span>
          )}
          {editing ? (
            <>
              <button type="button" onClick={() => setEditing(false)} disabled={saving} className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-slate-200 text-xs font-medium text-slate-600 rounded-lg hover:bg-slate-50">
                <X className="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>
              <button type="submit" disabled={saving} className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg">
                <Check className="w-3.5 h-3.5" />
                <span>{saving ? 'Saving…' : 'Save changes'}</span>
              </button>
            </>
          ) : (
            <button type="button" onClick={startEdit} className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg">
              <Pencil className="w-3.5 h-3.5" />
              <span>Edit profile</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">{error}</div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <section className="bg-white rounded-xl border border-slate-200 shadow-xs p-5">
            <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider flex items-center space-x-1.5 mb-4">
              <User className="w-4 h-4 text-indigo-600" />
              <span>Personal</span>
            </h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field id="pf-name" label="Full name" icon={User} value={editing ? form.fullName : account.fullName} onChange={set('fullName')} editing={editing} />
              <Field id="pf-phone" label="Phone" icon={Phone} type="tel" value={editing ? form.phone : account.phone} onChange={set('phone')} editing={editing} />
              <Field id="pf-email" label="Sign-in email" icon={Mail} value={account.email} editing={editing} readOnly />
            </div>
          </section>

          <section className="bg-white rounded-xl border border-slate-200 shadow-xs p-5">
            <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider flex items-center space-x-1.5 mb-4">
              <Building2 className="w-4 h-4 text-indigo-600" />
              <span>Organisation</span>
            </h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field id="org-name" label="Company" icon={Building2} value={org.name} editing={editing} readOnly />
              <div>
                <span className="block text-[11px] font-medium text-slate-500 mb-1">Pricing tier</span>
                <span className={`inline-flex text-xs font-semibold px-2 py-1 rounded border ${tierClass}`}>{org.tier}</span>
                <span className="text-[11px] text-slate-400 ml-2">{org.currency}</span>
              </div>
              <Field id="org-email" label="Billing contact email" icon={Mail} type="email" value={editing ? form.contactEmail : org.contactEmail} onChange={set('contactEmail')} editing={editing} />
              <Field id="org-phone" label="Billing contact phone" icon={Phone} type="tel" value={editing ? form.contactPhone : org.contactPhone} onChange={set('contactPhone')} editing={editing} />
              <div className="sm:col-span-2">
                <Field id="org-address" label="Billing address" icon={MapPin} value={editing ? form.billingAddress : org.billingAddress} onChange={set('billingAddress')} editing={editing} multiline />
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="bg-slate-900 text-white rounded-xl p-5">
            <h3 className="font-semibold text-xs uppercase tracking-wider flex items-center space-x-1.5 text-slate-300">
              <Headset className="w-4 h-4 text-indigo-300" />
              <span>Account manager</span>
            </h3>
            {account.accountManager ? (
              <div className="mt-3">
                <div className="text-sm font-semibold">{account.accountManager.name}</div>
                <a href={`mailto:${account.accountManager.email}`} className="text-xs text-indigo-300 hover:text-white break-all">
                  {account.accountManager.email}
                </a>
                <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">Answers your deal-room messages and prepares every quotation for {org.name}.</p>
              </div>
            ) : (
              <p className="text-xs text-slate-400 mt-3">A representative will be assigned when your first quotation is requested.</p>
            )}
          </section>

          <section className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center space-x-1.5 text-slate-500"><Calendar className="w-4 h-4 text-slate-400" /><span>Member since</span></span>
              <span className="font-medium text-slate-800">{formatDate(account.memberSince)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center space-x-1.5 text-slate-500"><ShieldCheck className="w-4 h-4 text-slate-400" /><span>Sign-in method</span></span>
              <span className="font-medium text-slate-800">{PROVIDER_LABEL[account.authProvider] || account.authProvider}</span>
            </div>
            <div className="pt-3 border-t border-slate-100">
              <Link to="/customer/settings" className="inline-flex items-center space-x-1.5 text-indigo-600 hover:text-indigo-800 font-semibold">
                <Settings className="w-3.5 h-3.5" />
                <span>Notifications, display &amp; password</span>
              </Link>
            </div>
          </section>
        </div>
      </div>
    </form>
  );
}
