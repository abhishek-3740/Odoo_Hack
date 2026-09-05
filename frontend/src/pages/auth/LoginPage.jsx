import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Layers, Lock, Mail, ArrowRight, Shield, Users } from 'lucide-react';

export function LoginPage() {
  const { login, demoAccounts, switchPersona } = useAuth();
  const [email, setEmail] = useState('admin@dealflow.demo');
  const [password, setPassword] = useState('demo');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await login(email, password);
    setLoading(false);
    if (res.success) {
      if (res.role === 'CUSTOMER') {
        navigate('/customer');
      } else {
        navigate('/admin');
      }
    } else {
      setError(res.error || 'Invalid credentials');
    }
  };

  const handleQuickSelect = async (account) => {
    const res = await switchPersona(account);
    if (res.success && res.targetPath) {
      navigate(res.targetPath);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold mx-auto shadow-md">
          <Layers className="w-6 h-6" />
        </div>
        <h2 className="mt-4 text-2xl font-extrabold text-white tracking-tight">DealFlow360</h2>
        <p className="mt-1 text-xs text-slate-400">Enterprise Deal Desk, CPQ & Billing Platform</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-xl rounded-2xl sm:px-10 border border-slate-200">
          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-medium">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Corporate Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-xs font-semibold rounded-lg flex items-center justify-center space-x-2 transition-colors"
            >
              <span>{loading ? 'Authenticating...' : 'Sign In'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* 1-Click Demo Personas Shortcut */}
          <div className="mt-6 pt-6 border-t border-slate-100">
            <div className="flex items-center justify-between text-xs mb-3 text-slate-500 font-semibold">
              <span className="flex items-center space-x-1">
                <Users className="w-3.5 h-3.5 text-indigo-600" />
                <span>1-Click Demo Personas:</span>
              </span>
              <span className="text-[10px] text-slate-400">Pre-seeded</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              {(demoAccounts.length > 0
                ? demoAccounts.slice(0, 6)
                : [
                    { email: 'admin@dealflow.demo', role: 'ADMIN', fullName: 'System Admin' },
                    { email: 'rep.a@dealflow.demo', role: 'REP', fullName: 'Sales Rep A' },
                    { email: 'manager.a@dealflow.demo', role: 'MANAGER', fullName: 'Sales Manager' },
                    { email: 'finance@dealflow.demo', role: 'FINANCE', fullName: 'Finance Ops' },
                    { email: 'alpha@customer.demo', role: 'CUSTOMER', fullName: 'Customer Alpha' },
                    { email: 'beta@customer.demo', role: 'CUSTOMER', fullName: 'Customer Beta' },
                  ]
              ).map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => handleQuickSelect(acc)}
                  className="p-2 text-left bg-slate-50 hover:bg-indigo-50 border border-slate-200 rounded-lg transition-colors"
                >
                  <div className="font-semibold text-slate-900 truncate text-[11px]">{acc.fullName || acc.email}</div>
                  <div className="text-[10px] text-indigo-600 font-medium">{acc.role}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
