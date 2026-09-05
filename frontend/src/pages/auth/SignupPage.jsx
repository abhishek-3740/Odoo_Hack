import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, landingPathFor } from '../../context/AuthContext';
import { authOptions } from '../../services/api';
import { AuthShell, ErrorBanner, inputClass, labelClass } from './AuthShell';
import { ArrowRight, Building2, Mail, Phone, User, Lock, CheckCircle2 } from 'lucide-react';

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

export function SignupPage() {
  const { user, register } = useAuth();
  const [searchParams] = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const navigate = useNavigate();

  const [form, setForm] = useState({
    fullName: '',
    companyName: '',
    email: '',
    phone: '',
    password: '',
    confirm: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [options, setOptions] = useState({ selfRegistration: true });

  useEffect(() => {
    authOptions()
      .then((opts) => opts && setOptions((prev) => ({ ...prev, ...opts })))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (user) navigate(next || landingPathFor(user), { replace: true });
  }, [user, next, navigate]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const strength = passwordStrength(form.password);
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;
  const canSubmit =
    form.fullName.trim() &&
    form.companyName.trim() &&
    form.email.trim() &&
    form.password.length >= 8 &&
    !mismatch &&
    !loading;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError('');
    setConflict(false);
    const res = await register({
      fullName: form.fullName.trim(),
      companyName: form.companyName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      password: form.password,
    });
    setLoading(false);
    if (res.success) {
      navigate(next || res.targetPath || '/customer', { replace: true });
    } else if (res.status === 409) {
      setConflict(true);
    } else {
      setError(res.error || 'We could not create your account. Please try again.');
    }
  };

  if (!options.selfRegistration) {
    return (
      <AuthShell title="Sign-up is not available" subtitle="This server does not accept self-registration.">
        <p className="text-xs text-slate-600 leading-relaxed">
          Ask your DealFlow360 account manager to provision a portal login for you, then{' '}
          <Link to="/login" className="font-semibold text-indigo-600 hover:text-indigo-800">
            sign in
          </Link>
          .
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your customer account"
      subtitle="Browse the catalogue, request pricing and negotiate live with your account manager."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
            className="font-semibold text-indigo-600 hover:text-indigo-800"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        {/* Navigation pill toggle */}
        <div className="flex bg-slate-100 p-1 rounded-xl mb-4 border border-slate-200">
          <div className="flex-1 py-1.5 text-center text-xs font-bold text-indigo-700 bg-white rounded-lg shadow-xs border border-indigo-100">
            Customer Account
          </div>
          <Link
            to={next ? `/signup/staff?next=${encodeURIComponent(next)}` : '/signup/staff'}
            className="flex-1 py-1.5 text-center text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-lg transition-colors"
          >
            Enterprise Staff
          </Link>
        </div>

        <ErrorBanner>{error}</ErrorBanner>
        {conflict && (
          <div role="alert" className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs">
            An account already exists for <strong>{form.email}</strong>.{' '}
            <Link
              to={`/login?next=${encodeURIComponent(next || '/customer')}`}
              className="font-semibold underline underline-offset-2"
            >
              Sign in instead
            </Link>
            .
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="su-name" className={labelClass}>
              Your name
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
              <input
                id="su-name"
                autoComplete="name"
                required
                value={form.fullName}
                onChange={set('fullName')}
                placeholder="Priya Sharma"
                className={`${inputClass} pl-9`}
              />
            </div>
          </div>
          <div>
            <label htmlFor="su-company" className={labelClass}>
              Company
            </label>
            <div className="relative">
              <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
              <input
                id="su-company"
                autoComplete="organization"
                required
                value={form.companyName}
                onChange={set('companyName')}
                placeholder="Acme Traders Pvt Ltd"
                className={`${inputClass} pl-9`}
              />
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="su-email" className={labelClass}>
            Work email
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
            <input
              id="su-email"
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={set('email')}
              placeholder="you@company.com"
              className={`${inputClass} pl-9`}
            />
          </div>
        </div>

        <div>
          <label htmlFor="su-phone" className={labelClass}>
            Phone <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <div className="relative">
            <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
            <input
              id="su-phone"
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={set('phone')}
              placeholder="+91 98765 43210"
              className={`${inputClass} pl-9`}
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="su-password" className={labelClass}>
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
              <input
                id="su-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={form.password}
                onChange={set('password')}
                placeholder="At least 8 characters"
                aria-describedby="su-password-hint"
                className={`${inputClass} pl-9`}
              />
            </div>
            <div id="su-password-hint" className="mt-1.5 flex items-center space-x-2" aria-live="polite">
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
            <label htmlFor="su-confirm" className={labelClass}>
              Confirm password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
              <input
                id="su-confirm"
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

        <p className="text-[11px] text-slate-500 leading-relaxed">
          By creating an account you agree that quotations, acceptances and messages exchanged in the portal form
          part of the commercial record for your organisation.
        </p>

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg flex items-center justify-center space-x-2 transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
        >
          <span>{loading ? 'Creating account…' : 'Create account'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>

        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[10px] text-slate-500">
          {['Instant portal access', 'Assigned account manager', 'No card required'].map((t) => (
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
