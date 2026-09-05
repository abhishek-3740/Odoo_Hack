import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api, formatINR, formatDate } from '../../services/api';
import { useDealEvents } from '../../hooks/useDealEvents';
import { useConnectionStatus } from '../../hooks/useConnectionStatus';
import { StatusBadge } from '../../components/common/StatusBadge';
import { LoadingSpinner } from '../../components/common/LoadingState';
import {
  FileText,
  Clock,
  PackageCheck,
  CreditCard,
  ShoppingBag,
  User,
  ArrowRight,
  Radio,
  MessageSquare,
} from 'lucide-react';

const OPEN = new Set(['IN_PREPARATION', 'AWAITING_YOUR_REVIEW', 'UNDER_DISCUSSION', 'ACCEPTED_PENDING_CONFIRMATION']);

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function CustomerDashboardPage() {
  const { user } = useAuth();
  const status = useConnectionStatus();
  const [quotes, setQuotes] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [q, i] = await Promise.all([
        api.get('/portal/quotes').catch(() => []),
        api.get('/portal/invoices').catch(() => []),
      ]);
      setQuotes(Array.isArray(q) ? q : []);
      setInvoices(Array.isArray(i) ? i : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useDealEvents(
    (e) => ['Quote', 'Invoice', 'Order'].includes(e.entityType),
    () => load()
  );

  const openQuotes = quotes.filter((q) => OPEN.has(q.status));
  const awaiting = quotes.filter((q) => q.status === 'AWAITING_YOUR_REVIEW' || q.status === 'UNDER_DISCUSSION');
  const confirmed = quotes.filter((q) => q.status === 'CONFIRMED');
  const outstanding = invoices.reduce((acc, inv) => acc + (parseFloat(inv.outstanding) || 0), 0);

  const tiles = [
    { label: 'Open quotations', value: openQuotes.length, icon: FileText, tone: 'text-indigo-600 bg-indigo-50', to: '/customer/quotes' },
    { label: 'Awaiting your review', value: awaiting.length, icon: Clock, tone: 'text-amber-700 bg-amber-50', to: '/customer/quotes' },
    { label: 'Confirmed orders', value: confirmed.length, icon: PackageCheck, tone: 'text-emerald-700 bg-emerald-50', to: '/customer/quotes' },
    { label: 'Outstanding balance', value: formatINR(outstanding), icon: CreditCard, tone: 'text-rose-600 bg-rose-50', to: '/customer/invoices', money: true },
  ];

  const firstName = (user?.fullName || '').split(' ')[0] || 'there';
  const recent = [...quotes].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            {greeting()}, {firstName}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Here is where {user?.customerName || 'your organisation'} stands with DealFlow360 today.
          </p>
        </div>
        <div
          className={`inline-flex items-center space-x-1.5 text-[11px] px-2.5 py-1 rounded-lg border ${
            status === 'connected'
              ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
              : 'text-slate-500 bg-slate-50 border-slate-200'
          }`}
          role="status"
        >
          <Radio className="w-3.5 h-3.5" />
          <span>{status === 'connected' ? 'Live updates active' : 'Live updates reconnecting'}</span>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {tiles.map((t) => {
              const Icon = t.icon;
              return (
                <Link
                  key={t.label}
                  to={t.to}
                  className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs hover:shadow-md transition-shadow focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{t.label}</span>
                    <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${t.tone}`}>
                      <Icon className="w-4 h-4" />
                    </span>
                  </div>
                  <div className={`font-bold text-slate-900 mt-2 tabular-nums ${t.money ? 'text-lg' : 'text-2xl'}`}>{t.value}</div>
                </Link>
              );
            })}
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider">Recent quotations</h3>
                <Link to="/customer/quotes" className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 inline-flex items-center space-x-1">
                  <span>View all</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              {recent.length === 0 ? (
                <div className="p-10 text-center">
                  <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs text-slate-500">No quotations yet. Start from the catalogue.</p>
                  <Link
                    to="/customer/catalog"
                    className="inline-flex items-center space-x-1.5 mt-3 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800"
                  >
                    <ShoppingBag className="w-3.5 h-3.5" />
                    <span>Browse catalogue</span>
                  </Link>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {recent.map((q) => (
                    <li key={q.id}>
                      <Link
                        to={`/customer/quotes/${q.id}`}
                        className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50/70 transition-colors focus:outline-hidden focus:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 truncate">
                            {q.reference} <span className="font-normal text-slate-500">· {q.title || 'Commercial proposal'}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Updated {formatDate(q.updatedAt)} · valid until {formatDate(q.validUntil)}
                          </div>
                        </div>
                        <div className="flex items-center space-x-3 shrink-0">
                          <span className="text-xs font-semibold text-slate-900 tabular-nums hidden sm:inline">
                            {formatINR(q.oneTimeTotal)}
                          </span>
                          <StatusBadge status={q.status} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4">
                <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider mb-3">Quick actions</h3>
                <div className="space-y-2">
                  {[
                    { to: '/customer/catalog', icon: ShoppingBag, label: 'Browse the catalogue', hint: 'Request a new quotation' },
                    { to: '/customer/quotes', icon: MessageSquare, label: 'Open a deal room', hint: 'Negotiate live' },
                    { to: '/customer/profile', icon: User, label: 'Your profile', hint: 'Contacts & organisation' },
                  ].map((a) => {
                    const Icon = a.icon;
                    return (
                      <Link
                        key={a.to}
                        to={a.to}
                        className="flex items-center space-x-3 p-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 hover:border-slate-200 transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
                      >
                        <span className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                          <Icon className="w-4 h-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-slate-900">{a.label}</span>
                          <span className="block text-[11px] text-slate-500">{a.hint}</span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="bg-slate-900 text-white rounded-xl p-4">
                <div className="flex items-center space-x-2 text-xs font-semibold">
                  <Radio className="w-4 h-4 text-emerald-400" />
                  <span>Live deal rooms</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                  Replies, revised terms and approvals from your account manager appear here the moment they happen — no
                  refresh needed.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
