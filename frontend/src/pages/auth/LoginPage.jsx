import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, landingPathFor } from '../../context/AuthContext';
import { authOptions } from '../../services/api';
import { AuthShell, ErrorBanner, inputClass, labelClass } from './AuthShell';
import { Lock, Mail, ArrowRight, Users, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';

function safeNext(value) {
  // Only same-origin paths; never an absolute URL.
  return value && value.startsWith('/') && !value.startsWith('//') ? value : null;
}

export function LoginPage() {
  const { user, login, demoAccounts, switchPersona } = useAuth();
  const [searchParams] = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [options, setOptions] = useState({ passwordLogin: true, selfRegistration: true, demoPersonas: false });
  const [demoOpen, setDemoOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    authOptions()
      .then((opts) => opts && setOptions((prev) => ({ ...prev, ...opts })))
      .catch(() => {});
  }, []);

  // Already signed in: go where you belong.
  useEffect(() => {
    if (user) {
      navigate(next || landingPathFor(user), { replace: true });
    }
  }, [user, next, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await login(email.trim(), password);
    setLoading(false);
    if (res.success) {
      navigate(next || res.targetPath || '/customer', { replace: true });
    } else {
      setError(res.status === 401 ? 'Invalid email or password.' : res.error || 'Sign-in failed. Try again.');
    }
  };

  const handleQuickSelect = async (account) => {
    setError('');
    const res = await switchPersona(account);
    if (res.success && res.targetPath) {
      navigate(res.role === 'CUSTOMER' && next ? next : res.targetPath, { replace: true });
    } else if (res.error) {
      setError(res.error);
    }
  };

  const personas =
    demoAccounts.length > 0
      ? demoAccounts
      : [
          { email: 'alpha@customer.demo', role: 'CUSTOMER', fullName: 'Customer Alpha' },
          { email: 'beta@customer.demo', role: 'CUSTOMER', fullName: 'Customer Beta' },
          { email: 'rep.a@dealflow.demo', role: 'REP', fullName: 'Sales Rep A' },
          { email: 'admin@dealflow.demo', role: 'ADMIN', fullName: 'System Admin' },
        ];

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your customer portal or internal workspace."
      footer={
        options.selfRegistration ? (
          <>
            New to DealFlow360?{' '}
            <Link
              to={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}
              className="font-semibold text-indigo-600 hover:text-indigo-800"
            >
              Create a customer account
            </Link>
          </>
        ) : null
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <ErrorBanner>{error}</ErrorBanner>

        <div>
          <label htmlFor="login-email" className={labelClass}>
            Email address
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className={`${inputClass} pl-9`}
            />
          </div>
        </div>

        <div>
          <label htmlFor="login-password" className={labelClass}>
            Password
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              className={`${inputClass} pl-9 pr-9`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-2 top-1.5 p-1 rounded text-slate-400 hover:text-slate-600 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !email || !password}
          className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-xs font-semibold rounded-lg flex items-center justify-center space-x-2 transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
        >
          <span>{loading ? 'Signing in…' : 'Sign in'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>

      {options.demoPersonas && (
        <div className="mt-6 pt-5 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setDemoOpen((v) => !v)}
            aria-expanded={demoOpen}
            className="w-full flex items-center justify-between text-xs text-slate-500 font-semibold hover:text-slate-800 rounded focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
          >
            <span className="flex items-center space-x-1.5">
              <Users className="w-3.5 h-3.5 text-indigo-600" />
              <span>1-click demo personas</span>
            </span>
            {demoOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {demoOpen && (
            <div className="grid grid-cols-2 gap-2 text-xs mt-3">
              {personas.slice(0, 8).map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => handleQuickSelect(acc)}
                  className="p-2 text-left bg-slate-50 hover:bg-indigo-50 border border-slate-200 rounded-lg transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
                >
                  <div className="font-semibold text-slate-900 truncate text-[11px]">{acc.fullName || acc.email}</div>
                  <div className="text-[10px] text-indigo-600 font-medium">{acc.role}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </AuthShell>
  );
}
