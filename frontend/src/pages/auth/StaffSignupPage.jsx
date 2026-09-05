import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, landingPathFor } from '../../context/AuthContext';
import { api } from '../../services/api';
import { AuthShell, ErrorBanner, inputClass, labelClass } from './AuthShell';
import {
  ArrowRight,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  CreditCard,
  Mail,
  Phone,
  User,
  Lock,
  Users,
  CheckCircle2,
  Building,
} from 'lucide-react';

function safeNext(value) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : null;
}

function passwordStrength(pw) {
  if (!pw) return { label: '', score: 0 };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const label = score <= 1 ? 'Weak' : score <= 3 ? 'Fair' : 'Strong';
  return { label, score };
}

const ROLES = [
  {
    id: 'ADMIN',
    name: 'Administrator',
    badge: 'Executive',
    badgeClass: 'bg-rose-500/10 text-rose-600 border-rose-200',
    icon: ShieldCheck,
    description: 'Governance, discount policy editor, executive overrides, audit trail.',
    needsTeam: false,
  },
  {
    id: 'MANAGER',
    name: 'Sales Manager',
    badge: 'Approver',
    badgeClass: 'bg-purple-500/10 text-purple-600 border-purple-200',
    icon: UserCheck,
    description: 'Review quote concession requests, margin thresholds, and team deals.',
    needsTeam: true,
  },
  {
    id: 'REP',
    name: 'Sales Representative',
    badge: 'Field Ops',
    badgeClass: 'bg-indigo-500/10 text-indigo-600 border-indigo-200',
    icon: TrendingUp,
    description: 'Draft quotes, submit for approval, negotiate in real-time deal rooms.',
    needsTeam: true,
  },
  {
    id: 'FINANCE',
    name: 'Finance & Billing',
    badge: 'Audit & Invoicing',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-200',
    icon: CreditCard,
    description: 'Step 2 margin approvals, invoice dispatch, settlement & fulfillment.',
    needsTeam: false,
  },
];

export function StaffSignupPage() {
  const { user, registerInternal } = useAuth();
  const [searchParams] = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const navigate = useNavigate();

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    role: 'MANAGER',
    teamId: '',
    customTeamName: '',
    password: '',
    confirm: '',
  });

  const [teams, setTeams] = useState([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    if (user) {
      navigate(next || landingPathFor(user), { replace: true });
    }
  }, [user, next, navigate]);

  useEffect(() => {
    api
      .get('/auth/teams')
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setTeams(list);
        if (list.length > 0) {
          setForm((f) => ({ ...f, teamId: f.teamId || list[0].id }));
        }
      })
      .catch((err) => {
        console.warn('Could not fetch teams:', err);
      })
      .finally(() => {
        setLoadingTeams(false);
      });
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setRole = (r) => setForm((f) => ({ ...f, role: r }));

  const activeRoleObj = ROLES.find((r) => r.id === form.role) || ROLES[1];
  const strength = passwordStrength(form.password);
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;

  const canSubmit =
    form.fullName.trim() &&
    form.email.trim() &&
    form.password.length >= 8 &&
    !mismatch &&
    !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError('');
    setConflict(false);

    const payload = {
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      role: form.role,
      password: form.password,
    };

    if (activeRoleObj.needsTeam) {
      if (form.teamId === 'CUSTOM' && form.customTeamName.trim()) {
        payload.teamName = form.customTeamName.trim();
      } else if (form.teamId && form.teamId !== 'CUSTOM') {
        payload.teamId = form.teamId;
      }
    }

    const res = await registerInternal(payload);
    setSubmitting(false);

    if (res.success) {
      navigate(next || res.targetPath || '/admin', { replace: true });
    } else if (res.status === 409) {
      setConflict(true);
    } else {
      setError(res.error || 'Unable to register staff account. Please verify details and try again.');
    }
  };

  return (
    <AuthShell
      staff={true}
      maxWidth="max-w-xl"
      title="Create Internal Staff Account"
      subtitle="Register as an Administrator, Sales Manager, Representative, or Finance officer."
      footer={
        <div className="space-y-2">
          <p>
            Already have an enterprise account?{' '}
            <Link
              to={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
              className="font-semibold text-indigo-600 hover:text-indigo-800"
            >
              Sign in
            </Link>
          </p>
          <p className="text-[11px] text-slate-400">
            Customer looking for portal pricing?{' '}
            <Link to="/signup" className="font-semibold text-slate-600 hover:text-slate-900 underline">
              Customer Registration
            </Link>
          </p>
        </div>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        {/* Navigation pill toggle */}
        <div className="flex bg-slate-100 p-1 rounded-xl mb-4 border border-slate-200">
          <Link
            to="/signup"
            className="flex-1 py-1.5 text-center text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-lg transition-colors"
          >
            Customer Account
          </Link>
          <div className="flex-1 py-1.5 text-center text-xs font-bold text-indigo-700 bg-white rounded-lg shadow-xs border border-indigo-100">
            Enterprise Staff
          </div>
        </div>

        <ErrorBanner>{error}</ErrorBanner>

        {conflict && (
          <div role="alert" className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs">
            An account already exists for <strong>{form.email}</strong>.{' '}
            <Link
              to={`/login?next=${encodeURIComponent(next || '/admin')}`}
              className="font-semibold underline underline-offset-2"
            >
              Sign in instead
            </Link>
            .
          </div>
        )}

        {/* Role Selection Grid */}
        <div>
          <label className={labelClass}>Select Staff Role &amp; Workspace</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {ROLES.map((r) => {
              const Icon = r.icon;
              const selected = form.role === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRole(r.id)}
                  className={`p-3 rounded-xl border text-left transition-all relative flex flex-col justify-between ${
                    selected
                      ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500/20 shadow-xs'
                      : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center space-x-2">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                          selected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="font-semibold text-xs text-slate-900">{r.name}</span>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${r.badgeClass}`}>
                      {r.badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug">{r.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Name and Email */}
        <div className="grid sm:grid-cols-2 gap-3.5">
          <div>
            <label htmlFor="staff-name" className={labelClass}>
              Full Name
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
              <input
                id="staff-name"
                autoComplete="name"
                required
                value={form.fullName}
                onChange={set('fullName')}
                placeholder="e.g. Maya Chen"
                className={`${inputClass} pl-9`}
              />
            </div>
          </div>
          <div>
            <label htmlFor="staff-email" className={labelClass}>
              Corporate Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
              <input
                id="staff-email"
                type="email"
                autoComplete="email"
                required
                value={form.email}
                onChange={set('email')}
                placeholder="maya@dealflow.corp"
                className={`${inputClass} pl-9`}
              />
            </div>
          </div>
        </div>

        {/* Team Assignment (For Rep & Manager) */}
        {activeRoleObj.needsTeam && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="staff-team" className="text-xs font-semibold text-slate-800 flex items-center space-x-1.5">
                <Users className="w-4 h-4 text-indigo-600" />
                <span>Sales Team Territory</span>
              </label>
              <span className="text-[10px] text-slate-500">Determines approval routing scope</span>
            </div>

            <div className="grid sm:grid-cols-2 gap-2">
              <select
                id="staff-team"
                value={form.teamId}
                onChange={set('teamId')}
                className={inputClass}
                disabled={loadingTeams}
              >
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                <option value="CUSTOM">+ Add New Territory / Team</option>
              </select>

              {form.teamId === 'CUSTOM' && (
                <div className="relative">
                  <Building className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    placeholder="New Team Name (e.g. Sales North)"
                    value={form.customTeamName}
                    onChange={set('customTeamName')}
                    className={`${inputClass} pl-9`}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Phone */}
        <div>
          <label htmlFor="staff-phone" className={labelClass}>
            Phone <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <div className="relative">
            <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
            <input
              id="staff-phone"
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={set('phone')}
              placeholder="+91 98765 43210"
              className={`${inputClass} pl-9`}
            />
          </div>
        </div>

        {/* Password & Confirm */}
        <div className="grid sm:grid-cols-2 gap-3.5">
          <div>
            <label htmlFor="staff-password" className={labelClass}>
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
              <input
                id="staff-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={form.password}
                onChange={set('password')}
                placeholder="At least 8 characters"
                className={`${inputClass} pl-9`}
              />
            </div>
            <div className="mt-1.5 flex items-center space-x-2" aria-live="polite">
              <div className="flex-1 h-1 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    strength.score <= 1 ? 'bg-rose-400' : strength.score <= 3 ? 'bg-amber-400' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, (strength.score / 5) * 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-slate-500 w-10 text-right">{strength.label}</span>
            </div>
          </div>

          <div>
            <label htmlFor="staff-confirm" className={labelClass}>
              Confirm Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
              <input
                id="staff-confirm"
                type="password"
                autoComplete="new-password"
                required
                value={form.confirm}
                onChange={set('confirm')}
                aria-invalid={mismatch}
                className={`${inputClass} pl-9 ${mismatch ? 'border-rose-300' : ''}`}
              />
            </div>
            {mismatch && <p className="mt-1 text-[10px] text-rose-600">Passwords do not match.</p>}
          </div>
        </div>

        {/* Governance & Audit disclaimer */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600 flex items-start space-x-2">
          <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
          <span>
            Internal actions are bound to <strong>Segregation of Duties</strong> rules. Self-approvals are prohibited,
            and all quotation revisions, discount approvals, and overrides are recorded in the immutable audit log.
          </span>
        </div>

        {/* Submit button */}
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg flex items-center justify-center space-x-2 transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60 shadow-xs"
        >
          <span>{submitting ? 'Creating staff profile…' : `Register as ${activeRoleObj.name}`}</span>
          <ArrowRight className="w-4 h-4" />
        </button>

        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[10px] text-slate-500">
          {['Role-based Access', 'Audit Compliance', 'Zero Setup Delay'].map((t) => (
            <li key={t} className="flex items-center space-x-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </form>
    </AuthShell>
  );
}
