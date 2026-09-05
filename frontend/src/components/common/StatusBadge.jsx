import React from 'react';

export function StatusBadge({ status, className = '' }) {
  if (!status) return null;
  const s = String(status).toUpperCase();

  let colorClasses = 'bg-slate-100 text-slate-700 border-slate-200';

  if (['APPROVED', 'CONFIRMED', 'PAID', 'IN_STOCK', 'ACTIVE', 'ACCEPTED'].includes(s)) {
    colorClasses = 'bg-emerald-50 text-emerald-700 border-emerald-200/80';
  } else if (['SUBMITTED', 'PENDING', 'IN_REVIEW', 'AWAITING_CUSTOMER', 'REVIEW', 'UNDER_NEGOTIATION'].includes(s)) {
    colorClasses = 'bg-amber-50 text-amber-800 border-amber-200/80';
  } else if (['REJECTED', 'CANCELED', 'CANCELLED', 'LOST', 'EXPIRED', 'BACKORDER', 'SHORTFALL', 'UNPAID', 'OVERDUE'].includes(s)) {
    colorClasses = 'bg-rose-50 text-rose-700 border-rose-200/80';
  } else if (['SENT', 'PARTIALLY_PAID', 'DISPATCHED', 'SHIPPED'].includes(s)) {
    colorClasses = 'bg-indigo-50 text-indigo-700 border-indigo-200/80';
  } else if (['DRAFT'].includes(s)) {
    colorClasses = 'bg-slate-100 text-slate-700 border-slate-300';
  }

  // Format label: e.g. SHARED_WITH_CUSTOMER -> Shared With Customer
  const label = s
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${colorClasses} ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full mr-1.5 currentColor" style={{ backgroundColor: 'currentColor' }}></span>
      {label}
    </span>
  );
}
