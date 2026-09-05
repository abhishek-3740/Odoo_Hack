import React from 'react';
import { formatINR } from '../../services/api';
import { Cpu, Wrench, RefreshCw, Plus, Sparkles, Check, Clock } from 'lucide-react';

const KIND_STYLES = {
  HARDWARE: { icon: Cpu, tile: 'from-slate-800 to-slate-600', chip: 'text-indigo-700 bg-indigo-50 border-indigo-100', label: 'Hardware' },
  SERVICE: { icon: Wrench, tile: 'from-amber-500 to-orange-400', chip: 'text-amber-800 bg-amber-50 border-amber-200', label: 'Service' },
  SUBSCRIPTION: { icon: RefreshCw, tile: 'from-indigo-600 to-violet-500', chip: 'text-emerald-700 bg-emerald-50 border-emerald-200', label: 'Subscription' },
};

export function kindStyle(kind) {
  return KIND_STYLES[kind] || KIND_STYLES.HARDWARE;
}

export function CategoryTile({ kind, className = '' }) {
  const style = kindStyle(kind);
  const Icon = style.icon;
  return (
    <div
      aria-hidden="true"
      className={`rounded-xl bg-linear-to-br ${style.tile} flex items-center justify-center text-white shadow-xs ${className}`}
    >
      <Icon className="w-6 h-6" />
    </div>
  );
}

/**
 * One product with its purchasable variants. `onAdd(variant, product)` is
 * present for a signed-in customer; guests get `onGuestAdd()` instead.
 */
export function ProductCard({ product, variants, onAdd, onGuestAdd }) {
  const style = kindStyle(product.categoryKind);
  const isService = product.categoryKind === 'SERVICE';
  const first = variants[0];

  const handleAdd = (variant) => {
    if (onAdd) onAdd(variant, product);
    else if (onGuestAdd) onGuestAdd(variant, product);
  };

  return (
    <article className="bg-white rounded-xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow flex flex-col overflow-hidden">
      <div className="p-5 flex-1">
        <div className="flex items-start justify-between gap-3">
          <CategoryTile kind={product.categoryKind} className="w-11 h-11 shrink-0" />
          <div className="flex flex-col items-end gap-1">
            <span className={`text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded border ${style.chip}`}>
              {style.label}
            </span>
            {product.promoted && (
              <span className="inline-flex items-center space-x-1 text-[10px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded">
                <Sparkles className="w-3 h-3" />
                <span>Popular</span>
              </span>
            )}
          </div>
        </div>

        <h3 className="font-semibold text-slate-900 text-base mt-3 leading-snug">{product.name}</h3>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-3">
          {product.description || 'Enterprise-grade item with certified warranty and tracked delivery.'}
        </p>

        <div className="mt-3 flex items-baseline space-x-1">
          <span className="text-[11px] text-slate-500">From</span>
          <span className="text-lg font-bold text-slate-900 tabular-nums">
            {formatINR(first ? first.listPrice : product.basePrice)}
          </span>
          {isService && <span className="text-[11px] text-slate-500">/ {product.unit || 'unit'}</span>}
        </div>

        {variants.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="text-[11px] font-medium text-slate-500 mb-2">
              {variants.length === 1 ? 'Configuration' : 'Configurations'}
            </div>
            <ul className="space-y-1.5">
              {variants.slice(0, 4).map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-50 border border-slate-100 gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 truncate">{v.name || v.sku}</div>
                    <div className="flex items-center space-x-1.5 mt-0.5">
                      <span className="text-[10px] text-slate-400 font-mono">{v.sku}</span>
                      {v.inStock ? (
                        <span className="inline-flex items-center text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 rounded">
                          <Check className="w-2.5 h-2.5 mr-0.5" /> In stock
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-[10px] text-amber-800 bg-amber-50 border border-amber-200 px-1.5 rounded">
                          <Clock className="w-2.5 h-2.5 mr-0.5" /> Lead time
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold text-slate-900 tabular-nums">{formatINR(v.listPrice)}</div>
                    <button
                      type="button"
                      onClick={() => handleAdd(v)}
                      className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 inline-flex items-center space-x-0.5 mt-0.5 rounded focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="p-4 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between">
        <span className="text-[11px] text-slate-500">
          {isService ? 'Scheduled with your account manager' : 'Tier pricing applied on quotation'}
        </span>
        {first && (
          <button
            type="button"
            onClick={() => handleAdd(first)}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold inline-flex items-center space-x-1.5 transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Request quote</span>
          </button>
        )}
      </div>
    </article>
  );
}
