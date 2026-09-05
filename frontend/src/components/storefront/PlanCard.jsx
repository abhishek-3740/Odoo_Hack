import React, { useState } from 'react';
import { formatINR } from '../../services/api';
import { CategoryTile } from './ProductCard';
import { Plus, Check } from 'lucide-react';

export function cadenceLabel(months) {
  if (months === 1) return 'Monthly';
  if (months === 3) return 'Quarterly';
  if (months === 12) return 'Yearly';
  return `${months}-month`;
}

export function cadenceSuffix(months) {
  if (months === 1) return '/mo';
  if (months === 3) return '/qtr';
  if (months === 12) return '/yr';
  return `/${months}mo`;
}

/** A recurring product with a cadence toggle across its plans. */
export function PlanCard({ product, plans, onAdd, onGuestAdd }) {
  const sorted = [...plans].sort((a, b) => a.intervalMonths - b.intervalMonths);
  const [selectedId, setSelectedId] = useState(sorted[0]?.id);
  const selected = sorted.find((p) => p.id === selectedId) || sorted[0];
  if (!selected) return null;

  const monthlyEquivalent = selected.intervalPrice / selected.intervalMonths;
  const base = sorted.find((p) => p.intervalMonths === 1);
  const saving =
    base && selected.intervalMonths > 1
      ? Math.max(0, Math.round((1 - monthlyEquivalent / base.intervalPrice) * 100))
      : 0;

  const handleAdd = () => {
    if (onAdd) onAdd(selected, product);
    else if (onGuestAdd) onGuestAdd(selected, product);
  };

  const perks = ['Cancel at period end', 'Calendar-month proration', 'Invoiced per period'];

  return (
    <article className="bg-white rounded-xl border border-indigo-200/80 shadow-xs hover:shadow-md transition-shadow flex flex-col overflow-hidden relative">
      <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[10px] font-bold px-3 py-0.5 rounded-bl-lg uppercase tracking-wider">
        Subscription
      </div>

      <div className="p-5 flex-1">
        <CategoryTile kind="SUBSCRIPTION" className="w-11 h-11" />
        <h3 className="font-semibold text-slate-900 text-base mt-3 leading-snug">{product.name}</h3>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-3">
          {product.description || 'Recurring enterprise service with SLA-backed support.'}
        </p>

        {sorted.length > 1 && (
          <div role="radiogroup" aria-label="Billing cadence" className="mt-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {sorted.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={p.id === selected.id}
                onClick={() => setSelectedId(p.id)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60 ${
                  p.id === selected.id ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {cadenceLabel(p.intervalMonths)}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 p-3 rounded-lg bg-indigo-50/50 border border-indigo-100">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-500">{selected.name}</div>
            {saving > 0 && (
              <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                Save {saving}%
              </span>
            )}
          </div>
          <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">
            {formatINR(selected.intervalPrice)}
            <span className="text-xs font-normal text-slate-500 ml-1">{cadenceSuffix(selected.intervalMonths)}</span>
          </div>
          {selected.intervalMonths > 1 && (
            <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
              ≈ {formatINR(monthlyEquivalent)} per month
            </div>
          )}
        </div>

        <ul className="mt-3 space-y-1">
          {perks.map((perk) => (
            <li key={perk} className="flex items-center space-x-1.5 text-[11px] text-slate-600">
              <Check className="w-3 h-3 text-emerald-600 shrink-0" />
              <span>{perk}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="p-4 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between">
        <span className="text-[11px] text-slate-500">Seats and sites adjustable later</span>
        <button
          type="button"
          onClick={handleAdd}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold inline-flex items-center space-x-1.5 transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add subscription</span>
        </button>
      </div>
    </article>
  );
}
