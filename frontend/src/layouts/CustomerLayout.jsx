import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import { DemoPersonaSwitcher } from '../components/common/DemoPersonaSwitcher';
import { ToastContainer } from '../components/common/ToastContainer';
import { LoadingScreen } from '../components/common/LoadingState';
import {
  ShoppingBag,
  FileText,
  CreditCard,
  Building2,
  LogOut,
  Layers,
  ExternalLink,
  Home,
  LayoutDashboard,
  User,
  Settings,
  Menu,
  X,
  ChevronDown,
} from 'lucide-react';

const TIER_STYLES = {
  GOLD: 'text-amber-700 bg-amber-50 border-amber-200',
  SILVER: 'text-slate-600 bg-slate-100 border-slate-300',
  BRONZE: 'text-orange-800 bg-orange-50 border-orange-200',
};

function tierLabel(tier) {
  if (!tier) return 'Customer';
  return tier.charAt(0) + tier.slice(1).toLowerCase() + ' tier';
}

function ConnectionDot() {
  const status = useConnectionStatus();
  const map = {
    connected: { color: 'bg-emerald-500', label: 'Live updates on' },
    connecting: { color: 'bg-amber-400 animate-pulse', label: 'Reconnecting…' },
    disconnected: { color: 'bg-slate-300', label: 'Live updates off' },
  };
  const s = map[status] || map.disconnected;
  return (
    <span
      className="hidden sm:inline-flex items-center space-x-1.5 text-[11px] text-slate-500"
      role="status"
      aria-live="polite"
      title={s.label}
    >
      <span className={`w-2 h-2 rounded-full ${s.color}`} aria-hidden="true" />
      <span>{status === 'connected' ? 'Live' : status === 'connecting' ? 'Reconnecting' : 'Offline'}</span>
    </span>
  );
}

function CustomerGuard({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  // Every /portal/* endpoint is CUSTOMER-only (403 for staff), so internal
  // roles are sent to their workspace instead of a portal full of errors.
  if (user.role !== 'CUSTOMER') {
    return <Navigate to="/admin" replace />;
  }
  return children;
}

function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = user?.fullName?.charAt(0) || user?.email?.charAt(0)?.toUpperCase() || 'C';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center space-x-2 pl-2 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
      >
        <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-semibold text-xs">
          {initial}
        </div>
        <div className="hidden lg:block text-left">
          <div className="text-xs font-semibold text-slate-900">{user?.fullName || 'Client contact'}</div>
          <div className="text-[10px] text-slate-500">{user?.email}</div>
        </div>
        <ChevronDown className="w-4 h-4 text-slate-400" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-52 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-50"
        >
          <div className="px-3 py-2.5 border-b border-slate-100 lg:hidden">
            <div className="text-xs font-semibold text-slate-900 truncate">{user?.fullName || 'Client contact'}</div>
            <div className="text-[10px] text-slate-500 truncate">{user?.email}</div>
          </div>
          {[
            { to: '/customer/profile', label: 'Profile', icon: User },
            { to: '/customer/settings', label: 'Settings', icon: Settings },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center space-x-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 focus:outline-hidden focus:bg-slate-50"
              >
                <Icon className="w-4 h-4 text-slate-400" />
                <span>{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            role="menuitem"
            onClick={onLogout}
            className="w-full flex items-center space-x-2 px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 border-t border-slate-100 focus:outline-hidden focus:bg-rose-50"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function CustomerLayout() {
  return (
    <CustomerGuard>
      <CustomerShell />
    </CustomerGuard>
  );
}

function CustomerShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const navItems = [
    { label: 'Home', path: '/', icon: Home, exact: true },
    { label: 'Dashboard', path: '/customer', icon: LayoutDashboard, exact: true },
    { label: 'Catalogue', path: '/customer/catalog', icon: ShoppingBag },
    { label: 'Quotations', path: '/customer/quotes', icon: FileText },
    { label: 'Invoices', path: '/customer/invoices', icon: CreditCard },
  ];

  const isActive = (item) =>
    item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const tierClass = TIER_STYLES[user?.customerTier] || TIER_STYLES.BRONZE;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <ToastContainer />
      <DemoPersonaSwitcher />

      <header className="sticky top-0 z-40 bg-white border-b border-slate-200/80 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-6">
              <Link to="/customer" className="flex items-center space-x-2.5 group">
                <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold shadow-xs">
                  <Layers className="w-5 h-5" />
                </div>
                <div className="flex items-center">
                  <span className="font-bold text-base text-slate-900 tracking-tight">DealFlow360</span>
                  <span className="hidden sm:inline ml-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200/80 px-2 py-0.5 rounded-full">
                    Customer Portal
                  </span>
                </div>
              </Link>

              <nav aria-label="Portal" className="hidden md:flex space-x-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item);
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60 ${
                        active
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

            <div className="flex items-center space-x-3">
              <ConnectionDot />

              {user?.customerName && (
                <div className="hidden sm:flex items-center space-x-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
                  <Building2 className="w-4 h-4 text-slate-500" />
                  <div className="text-left">
                    <div className="text-xs font-semibold text-slate-800 truncate max-w-40">{user.customerName}</div>
                    <span className={`text-[10px] font-medium px-1.5 rounded border ${tierClass}`}>
                      {tierLabel(user.customerTier)}
                    </span>
                  </div>
                </div>
              )}

              {user?.role !== 'CUSTOMER' && (
                <Link
                  to="/admin"
                  className="hidden sm:flex items-center space-x-1 text-xs text-slate-600 hover:text-indigo-600 font-medium px-2.5 py-1.5 rounded-md hover:bg-slate-100 transition-colors"
                >
                  <span>Go to Admin</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              )}

              <div className="pl-2 border-l border-slate-200">
                <UserMenu user={user} onLogout={handleLogout} />
              </div>

              <button
                type="button"
                onClick={() => setMobileOpen((v) => !v)}
                aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileOpen}
                className="md:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
              >
                {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {mobileOpen && (
          <nav aria-label="Portal (mobile)" className="md:hidden border-t border-slate-200 bg-white px-4 py-2 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center space-x-2 px-3 py-2.5 rounded-lg text-xs font-medium ${
                    active ? 'bg-slate-100 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
            {user?.customerName && (
              <div className="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-100 mt-1">
                {user.customerName} · {tierLabel(user.customerTier)}
              </div>
            )}
          </nav>
        )}
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between">
          <span>&copy; 2026 DealFlow360 Inc. All commercial terms securely bound.</span>
          <span className="mt-2 sm:mt-0 text-slate-500">Your quotes, conversations and next steps. All in one place.</span>
        </div>
      </footer>
    </div>
  );
}
