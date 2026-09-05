import React from 'react';
import { Link } from 'react-router-dom';
import { Layers, ShieldCheck, MessageSquare, FileCheck } from 'lucide-react';

/**
 * Split layout shared by sign-in and sign-up: brand panel on the left, form on
 * the right. On small screens the brand panel collapses to a compact header.
 */
export function AuthShell({ title, subtitle, children, footer }) {
  const points = [
    { icon: MessageSquare, text: 'Negotiate line by line, live with your account manager.' },
    { icon: FileCheck, text: 'Accept the exact version you reviewed — never a moved price.' },
    { icon: ShieldCheck, text: 'Your quotations, invoices and terms stay private to your organisation.' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 grid lg:grid-cols-[5fr_7fr] font-sans">
      {/* Brand panel */}
      <aside className="bg-slate-900 text-white p-8 lg:p-12 flex flex-col justify-between">
        <Link to="/" className="flex items-center space-x-2.5 group w-fit">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center shadow-xs">
            <Layers className="w-5 h-5" />
          </div>
          <span className="font-bold text-base tracking-tight">DealFlow360</span>
        </Link>

        <div className="hidden lg:block max-w-md">
          <h1 className="text-3xl font-bold tracking-tight leading-tight">
            Quotes you can question. Terms you can trust.
          </h1>
          <p className="text-slate-400 text-sm mt-3 leading-relaxed">
            The customer portal for DealFlow360 — request pricing from the catalogue, discuss it in a live deal
            room, and confirm with one click.
          </p>
          <ul className="mt-8 space-y-4">
            {points.map((p) => {
              const Icon = p.icon;
              return (
                <li key={p.text} className="flex items-start space-x-3 text-sm text-slate-300">
                  <span className="mt-0.5 w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-indigo-300" />
                  </span>
                  <span>{p.text}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="hidden lg:block text-[11px] text-slate-500">
          &copy; 2026 DealFlow360 Inc. Enterprise deal desk, CPQ &amp; billing.
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 sm:p-8">{children}</div>
          {footer && <div className="mt-5 text-center text-xs text-slate-500">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

export const inputClass =
  'w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-400 disabled:bg-slate-50';

export const labelClass = 'block text-xs font-medium text-slate-700 mb-1';

export function ErrorBanner({ children }) {
  if (!children) return null;
  return (
    <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-medium">
      {children}
    </div>
  );
}
