import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Users, Check, ChevronUp, ChevronDown, Shield, Briefcase, UserCheck, CreditCard, ShoppingBag } from 'lucide-react';

export function DemoPersonaSwitcher() {
  const { user, demoAccounts, switchPersona } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [switchingEmail, setSwitchingEmail] = useState(null);
  const navigate = useNavigate();

  const handleSelectAccount = async (account) => {
    setSwitchingEmail(account.email);
    const result = await switchPersona(account);
    setSwitchingEmail(null);
    setIsOpen(false);
    if (result.success && result.targetPath) {
      navigate(result.targetPath);
    }
  };

  // Fallback demo accounts list if API is fetching or cold
  const fallbackAccounts = [
    { email: 'admin@dealflow.demo', fullName: 'System Admin', role: 'ADMIN', description: 'Master administrator with universal access' },
    { email: 'rep.a@dealflow.demo', fullName: 'Sales Rep A', role: 'REP', description: 'Primary sales rep building quotes and tracking pipeline' },
    { email: 'rep.b@dealflow.demo', fullName: 'Sales Rep B', role: 'REP', description: 'Sales rep managing enterprise deals' },
    { email: 'manager.a@dealflow.demo', fullName: 'Sales Manager A', role: 'MANAGER', description: 'Step 1 discount authorizer with anomaly sweep tools' },
    { email: 'manager.backup@dealflow.demo', fullName: 'Backup Manager', role: 'MANAGER', description: 'Delegated approver covering sales queue' },
    { email: 'finance@dealflow.demo', fullName: 'Finance & Ops', role: 'FINANCE', description: 'Step 2 sign-off, warehouse allocations, billing & refunds' },
    { email: 'alpha@customer.demo', fullName: 'Customer Alpha', role: 'CUSTOMER', description: 'Client buyer for Alpha Traders (Bronze Tier)' },
    { email: 'beta@customer.demo', fullName: 'Customer Beta', role: 'CUSTOMER', description: 'Client buyer for Beta Systems (Gold Tier)' },
  ];

  const accounts = demoAccounts && demoAccounts.length > 0 ? demoAccounts : fallbackAccounts;

  const getRoleIcon = (role) => {
    switch (role?.toUpperCase()) {
      case 'ADMIN':
        return <Shield className="w-4 h-4 text-purple-600" />;
      case 'MANAGER':
        return <UserCheck className="w-4 h-4 text-blue-600" />;
      case 'REP':
        return <Briefcase className="w-4 h-4 text-indigo-600" />;
      case 'FINANCE':
        return <CreditCard className="w-4 h-4 text-emerald-600" />;
      case 'CUSTOMER':
        return <ShoppingBag className="w-4 h-4 text-amber-600" />;
      default:
        return <Users className="w-4 h-4 text-slate-600" />;
    }
  };

  const getRoleBadgeClass = (role) => {
    switch (role?.toUpperCase()) {
      case 'ADMIN':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'MANAGER':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'REP':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'FINANCE':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'CUSTOMER':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {/* Popover Panel */}
      {isOpen && (
        <div className="mb-2 w-96 max-h-[520px] bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="p-3.5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center space-x-2">
              <Users className="w-4 h-4 text-indigo-400" />
              <span className="font-semibold text-sm">Demo Persona Switcher</span>
            </div>
            <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded">1-Click Live Switch</span>
          </div>

          <div className="p-2 overflow-y-auto divide-y divide-slate-100 flex-1">
            {accounts.map((acc) => {
              const isActive = user?.email === acc.email;
              const isSwitching = switchingEmail === acc.email;

              return (
                <button
                  key={acc.email}
                  onClick={() => handleSelectAccount(acc)}
                  disabled={isSwitching}
                  className={`w-full text-left p-2.5 rounded-lg transition-all flex items-start justify-between space-x-3 hover:bg-slate-50 ${
                    isActive ? 'bg-indigo-50/70 border border-indigo-100' : ''
                  }`}
                >
                  <div className="flex items-start space-x-2.5">
                    <div className="mt-0.5 p-1.5 bg-white rounded-md border border-slate-200 shadow-xs">
                      {getRoleIcon(acc.role)}
                    </div>
                    <div>
                      <div className="flex items-center space-x-1.5">
                        <span className="font-semibold text-xs text-slate-900">{acc.fullName || acc.email}</span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.2 rounded border ${getRoleBadgeClass(acc.role)}`}>
                          {acc.role}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">{acc.email}</div>
                      {acc.customerName && (
                        <div className="text-[11px] text-slate-600 font-medium mt-0.5">Org: {acc.customerName}</div>
                      )}
                      {acc.teamName && (
                        <div className="text-[11px] text-slate-600 font-medium mt-0.5">Team: {acc.teamName}</div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center pt-1">
                    {isSwitching ? (
                      <span className="text-[11px] text-indigo-600 font-medium animate-pulse">Switching...</span>
                    ) : isActive ? (
                      <span className="flex items-center text-xs font-semibold text-indigo-600 bg-indigo-100/70 px-2 py-0.5 rounded-md">
                        <Check className="w-3 h-3 mr-1" /> Active
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400 hover:text-indigo-600 font-medium">Select</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="p-2.5 bg-slate-50 border-t border-slate-200 text-center text-xs text-slate-500">
            Switching auto-updates credentials & workspace landing.
          </div>
        </div>
      )}

      {/* Floating Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2.5 bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-2.5 rounded-full shadow-lg border border-slate-700/80 transition-all hover:scale-105 active:scale-95"
      >
        <div className="p-1 bg-indigo-600 rounded-full text-white">
          {getRoleIcon(user?.role)}
        </div>
        <div className="text-left leading-tight pr-1">
          <div className="text-[11px] text-slate-400 font-normal">Active Persona</div>
          <div className="text-xs font-semibold text-white flex items-center space-x-1.5">
            <span>{user ? user.email.split('@')[0] : 'Demo Switcher'}</span>
            <span className="text-[10px] bg-slate-800 text-indigo-300 px-1.5 py-0.2 rounded border border-slate-700">
              {user?.role || 'Guest'}
            </span>
          </div>
        </div>
        {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
      </button>
    </div>
  );
}
