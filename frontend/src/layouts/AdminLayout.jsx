import React, { useState, useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { DemoPersonaSwitcher } from '../components/common/DemoPersonaSwitcher';
import { ToastContainer } from '../components/common/ToastContainer';
import {
  LayoutDashboard,
  FileSpreadsheet,
  PlusCircle,
  CheckSquare,
  Activity,
  ShieldAlert,
  PackageCheck,
  Receipt,
  Layers,
  Sliders,
  PlayCircle,
  ExternalLink,
  Bell,
  ChevronDown,
  Menu,
  X,
  User,
  LogOut,
} from 'lucide-react';

export function AdminLayout() {
  const { user, hasRole, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // The header shortcut reflects the commercial review inbox it opens.
  useEffect(() => {
    async function loadNotifications() {
      if (!user) return;
      try {
        const notifications = await api.get('/escalations');
        if (Array.isArray(notifications)) {
          const unread = notifications.filter((n) => n.status === 'OPEN').length;
          setUnreadCount(unread);
        }
      } catch (err) {
        // Silently catch if not supported for current actor
      }
    }
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const canSales = hasRole('REP', 'ADMIN');
  const canManager = hasRole('MANAGER', 'ADMIN');
  const canFinance = hasRole('FINANCE', 'ADMIN');
  const canAdmin = hasRole('ADMIN');

  const navigationSections = [
    {
      title: 'General',
      items: [
        { label: 'Executive Overview', path: '/admin', icon: LayoutDashboard, exact: true },
        { label: 'Review Inbox', path: '/admin/reviews', icon: CheckSquare },
        { label: 'Sales Reports', path: '/admin/reports', icon: FileSpreadsheet },
      ],
    },
    ...(canSales
      ? [
          {
            title: 'Sales Workspace',
            items: [
              { label: 'Quotation Pipeline', path: '/admin/sales/quotes', icon: FileSpreadsheet },
              { label: 'New Quotation', path: '/admin/sales/quotes/new', icon: PlusCircle },
            ],
          },
        ]
      : []),
    ...(canManager
      ? [
          {
            title: 'Sales Management',
            items: [
              { label: 'Approvals (Step 1)', path: '/admin/manager/approvals', icon: CheckSquare },
              { label: 'Deal Health & Alerts', path: '/admin/manager/health', icon: Activity },
            ],
          },
        ]
      : []),
    ...(canFinance
      ? [
          {
            title: 'Finance & Operations',
            items: [
              { label: 'Approvals (Step 2)', path: '/admin/finance/approvals', icon: ShieldAlert },
              { label: 'Stock & Fulfillment', path: '/admin/finance/fulfillment', icon: PackageCheck },
              { label: 'Billing & Subscriptions', path: '/admin/finance/billing', icon: Receipt },
            ],
          },
        ]
      : []),
    ...(canAdmin
      ? [
          {
            title: 'Administration',
            items: [
              { label: 'Master Catalog', path: '/admin/system/catalog', icon: Layers },
              { label: 'Governance & Policy', path: '/admin/system/governance', icon: Sliders },
              { label: 'People & Teams', path: '/admin/system/people', icon: User },
              { label: 'Jobs & Reporting', path: '/admin/system/operations', icon: PlayCircle },
            ],
          },
        ]
      : []),
  ];

  return (
    <div className="workspace-shell min-h-screen bg-canvas flex font-sans">
      <a className="skip-link" href="#workspace-main">Skip to workspace</a>
      <ToastContainer />
      <DemoPersonaSwitcher />

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-xs md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Desktop & Mobile Sidebar */}
      <aside
        className={`fixed md:sticky top-0 left-0 z-40 h-screen w-64 bg-slate-900 text-slate-300 flex flex-col transition-transform duration-200 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-slate-800 bg-slate-950/60">
          <Link to="/admin" className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold shadow-xs">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold text-base text-white tracking-tight">DealFlow360</span>
              <span className="ml-1.5 text-[10px] font-semibold text-indigo-400 bg-indigo-950/80 border border-indigo-800/80 px-1.5 py-0.2 rounded">
                DEAL DESK
              </span>
            </div>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
            className="md:hidden text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User Card */}
        <div className="p-4 border-b border-slate-800/80 bg-slate-900/50">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-white font-semibold text-xs">
              {user?.fullName?.charAt(0) || user?.email?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-white truncate">{user?.fullName || user?.email}</div>
              <div className="flex items-center space-x-1.5 mt-0.5">
                <span className="text-[10px] font-medium text-indigo-400 bg-indigo-950/80 px-1.5 py-0.2 rounded border border-indigo-800/50">
                  {user?.role || 'INTERNAL'}
                </span>
                {user?.teamName && (
                  <span className="text-[10px] text-slate-400 truncate">{user.teamName}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Navigation items */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {navigationSections.map((section, idx) => (
            <div key={idx} className="space-y-1">
              <div className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {section.title}
              </div>
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = item.exact
                  ? location.pathname === item.path
                  : location.pathname.startsWith(item.path);

                return (
                  <Link
                    key={item.path}
                    aria-current={isActive ? 'page' : undefined}
                    to={item.path}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-xs font-semibold'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        {/* Bottom utility links */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/40 space-y-1">
          <Link
            to="/"
            className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <span className="flex items-center space-x-2">
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Customer Storefront</span>
            </span>
            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">Preview</span>
          </Link>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200/80 shadow-xs flex items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
              className="md:hidden text-slate-500 hover:text-slate-800 p-1 rounded-md"
            >
              <Menu className="w-5 h-5" />
            </button>
            <p className="text-sm font-semibold text-slate-800 hidden sm:block">
              {location.pathname.startsWith('/admin/sales')
                ? 'Sales Workspace'
                : location.pathname.startsWith('/admin/manager')
                ? 'Sales Management Workspace'
                : location.pathname.startsWith('/admin/finance')
                ? 'Finance & Fulfillment Workspace'
                : location.pathname.startsWith('/admin/system')
                ? 'System Administration'
                : location.pathname.startsWith('/admin/reviews') ? 'Commercial Review' : 'DealFlow Workspace'}
            </p>
          </div>

          <div className="flex items-center space-x-4">
            {/* Notifications trigger */}
            <div className="relative">
              <button
                onClick={() => navigate('/admin/reviews')}
                aria-label="Open review inbox"
                className="p-2 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors relative"
                title="Open commercial reviews"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full"></span>
                )}
              </button>
            </div>

            {/* Role indicator pill */}
            <div className="hidden sm:flex items-center space-x-2 bg-slate-100 px-3 py-1 rounded-full border border-slate-200 text-xs text-slate-700">
              <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
              <span className="font-semibold">{user?.role || 'REP'}</span>
              <span className="text-slate-400">|</span>
              <span className="text-slate-500 font-mono text-[11px]">{user?.email}</span>
            </div>
          </div>
        </header>

        {/* Routed Page Content */}
        <main id="workspace-main" className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
