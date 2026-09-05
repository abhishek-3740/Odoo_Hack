import React, { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { DemoPersonaSwitcher } from '../components/common/DemoPersonaSwitcher';
import { ToastContainer } from '../components/common/ToastContainer';
import {
  ShoppingBag,
  FileText,
  CreditCard,
  Building2,
  LogOut,
  Sparkles,
  Layers,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';

export function CustomerLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    { label: 'Storefront & Catalog', path: '/customer', icon: ShoppingBag },
    { label: 'My Quotations', path: '/customer/quotes', icon: FileText },
    { label: 'Invoices & Billing', path: '/customer/invoices', icon: CreditCard },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <ToastContainer />
      <DemoPersonaSwitcher />

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200/80 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo and Brand */}
            <div className="flex items-center space-x-6">
              <Link to="/customer" className="flex items-center space-x-2.5 group">
                <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold shadow-xs">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <span className="font-bold text-base text-slate-900 tracking-tight">DealFlow360</span>
                  <span className="ml-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200/80 px-2 py-0.5 rounded-full">
                    Customer Portal
                  </span>
                </div>
              </Link>

              {/* Navigation Links */}
              <nav className="hidden md:flex space-x-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    item.path === '/customer'
                      ? location.pathname === '/customer'
                      : location.pathname.startsWith(item.path);

                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-slate-100 text-indigo-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            {/* Right side: Customer context & Actions */}
            <div className="flex items-center space-x-4">
              {/* Customer org badge */}
              <div className="hidden sm:flex items-center space-x-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
                <Building2 className="w-4 h-4 text-slate-500" />
                <div className="text-left">
                  <div className="text-xs font-semibold text-slate-800">
                    {user?.customerName || (user?.email?.includes('alpha') ? 'Alpha Traders' : 'Beta Systems')}
                  </div>
                  <div className="text-[10px] text-indigo-600 font-medium">
                    Tier: {user?.email?.includes('beta') ? 'Gold' : 'Bronze'} Customer
                  </div>
                </div>
              </div>

              {/* Link to Admin if user has internal access */}
              {user?.role !== 'CUSTOMER' && (
                <Link
                  to="/admin"
                  className="flex items-center space-x-1 text-xs text-slate-600 hover:text-indigo-600 font-medium px-2.5 py-1.5 rounded-md hover:bg-slate-100 transition-colors"
                >
                  <span>Go to Admin</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              )}

              {/* User profile dropdown / logout */}
              <div className="flex items-center space-x-2 pl-2 border-l border-slate-200">
                <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-semibold text-xs">
                  {user?.fullName?.charAt(0) || user?.email?.charAt(0)?.toUpperCase() || 'C'}
                </div>
                <div className="hidden lg:block text-left">
                  <div className="text-xs font-semibold text-slate-900">{user?.fullName || 'Client Contact'}</div>
                  <div className="text-[10px] text-slate-500">{user?.email}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Page Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between">
          <span>&copy; 2026 DealFlow360 Inc. All commercial terms securely bound.</span>
          <span className="mt-2 sm:mt-0 text-slate-400">Strictly Enforced Customer Privacy Layer (Zero internal cost leakage)</span>
        </div>
      </footer>
    </div>
  );
}
