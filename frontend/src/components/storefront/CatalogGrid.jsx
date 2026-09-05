import React, { useEffect, useMemo, useState } from 'react';
import { catalog as catalogApi } from '../../services/api';
import { LoadingSpinner } from '../common/LoadingState';
import { ProductCard } from './ProductCard';
import { PlanCard, cadenceLabel } from './PlanCard';
import { Search, PackageOpen, AlertCircle } from 'lucide-react';

const KIND_TABS = [
  { id: 'ALL', label: 'All' },
  { id: 'HARDWARE', label: 'Hardware' },
  { id: 'SERVICE', label: 'Services' },
  { id: 'SUBSCRIPTION', label: 'Subscriptions' },
];

/** Loads the public catalogue once; shares it with any grid on the page. */
export function usePublicCatalog() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    catalogApi
      .getPublic()
      .then((res) => {
        if (!cancelled) setData(res || { categories: [], products: [], variants: [], plans: [] });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Catalogue unavailable');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, error, loading };
}

/**
 * Category tabs + search + product/plan grid. `onAddVariant(variant, product)`
 * and `onAddPlan(plan, product)` are used for a signed-in customer; when they
 * are absent `onGuestAdd()` is called instead (typically to route to sign-up).
 */
export function CatalogGrid({ data, loading, error, onAddVariant, onAddPlan, onGuestAdd, initialKind = 'ALL' }) {
  const [kind, setKind] = useState(initialKind);
  const [search, setSearch] = useState('');

  const products = useMemo(() => data?.products || [], [data]);
  const variants = useMemo(() => data?.variants || [], [data]);
  const plans = useMemo(() => data?.plans || [], [data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      if (kind !== 'ALL' && p.categoryKind !== kind) return false;
      if (!term) return true;
      const haystack = [p.name, p.code, p.description, ...variants.filter((v) => v.productId === p.id).map((v) => v.sku)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [products, variants, kind, search]);

  const counts = useMemo(() => {
    const result = { ALL: products.length };
    products.forEach((p) => {
      result[p.categoryKind] = (result[p.categoryKind] || 0) + 1;
    });
    return result;
  }, [products]);

  const addVariant = onAddVariant
    ? (variant, product) =>
        onAddVariant(
          {
            type: 'variant',
            id: variant.id,
            name: variant.name || variant.sku,
            subtitle: product.name,
            price: variant.listPrice,
            cadence: 'One-time',
          },
          variant,
          product
        )
    : null;

  const addPlan = onAddPlan
    ? (plan, product) =>
        onAddPlan(
          {
            type: 'plan',
            id: plan.id,
            name: plan.name,
            subtitle: product.name,
            price: plan.intervalPrice,
            cadence: cadenceLabel(plan.intervalMonths),
          },
          plan,
          product
        )
    : null;

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div role="tablist" aria-label="Catalogue category" className="flex items-center gap-2 overflow-x-auto pb-1">
          {KIND_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={kind === tab.id}
              onClick={() => setKind(tab.id)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60 ${
                kind === tab.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {tab.label}
              {counts[tab.id] !== undefined && (
                <span className={`ml-1.5 text-[10px] ${kind === tab.id ? 'text-slate-300' : 'text-slate-400'}`}>
                  {counts[tab.id] || 0}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="relative md:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
          <label htmlFor="catalog-search" className="sr-only">
            Search catalogue
          </label>
          <input
            id="catalog-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products, SKUs, services…"
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
          />
        </div>
      </div>

      {/* States */}
      {loading && (
        <div className="flex justify-center items-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {!loading && error && (
        <div role="alert" className="bg-white rounded-xl border border-rose-200 p-8 text-center">
          <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-slate-900">Catalogue unavailable</h3>
          <p className="text-xs text-slate-500 mt-1">{error}</p>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <PackageOpen className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-900">Nothing matches</h3>
          <p className="text-xs text-slate-500 mt-1">Try another category or clear the search.</p>
        </div>
      )}

      {/* Grid */}
      {!loading && !error && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((product) => {
            const productPlans = plans.filter((p) => p.productId === product.id);
            if (product.chargeKind === 'RECURRING') {
              // A recurring product is only quotable through a plan; its
              // variants are licence rows the engine refuses as one-time lines.
              if (productPlans.length === 0) return null;
              return (
                <PlanCard
                  key={product.id}
                  product={product}
                  plans={productPlans}
                  onAdd={addPlan}
                  onGuestAdd={onGuestAdd}
                />
              );
            }
            return (
              <ProductCard
                key={product.id}
                product={product}
                variants={variants.filter((v) => v.productId === product.id)}
                onAdd={addVariant}
                onGuestAdd={onGuestAdd}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
