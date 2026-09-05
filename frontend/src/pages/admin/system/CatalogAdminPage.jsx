import React, { useState, useEffect } from 'react';
import { api, formatINR } from '../../../services/api';
import { LoadingSpinner } from '../../../components/common/LoadingState';
import {
  Layers,
  Box,
  FolderTree,
  CreditCard,
  Building,
  RefreshCw,
  Search,
} from 'lucide-react';

export function CatalogAdminPage() {
  const [activeTab, setActiveTab] = useState('products');
  const [products, setProducts] = useState([]);
  const [variants, setVariants] = useState([]);
  const [categories, setCategories] = useState([]);
  const [plans, setPlans] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const loadData = async () => {
    try {
      setRefreshing(true);
      const [prod, vars, cats, pln, wh] = await Promise.all([
        api.get('/products').catch(() => []),
        api.get('/variants').catch(() => []),
        api.get('/categories').catch(() => []),
        api.get('/subscription-plans').catch(() => []),
        api.get('/warehouses').catch(() => []),
      ]);

      setProducts(Array.isArray(prod) ? prod : []);
      setVariants(Array.isArray(vars) ? vars : []);
      setCategories(Array.isArray(cats) ? cats : []);
      setPlans(Array.isArray(pln) ? pln : []);
      setWarehouses(Array.isArray(wh) ? wh : []);
    } catch (err) {
      console.error('Failed to load catalog data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Master Catalog Management</h2>
            <span className="text-xs bg-purple-50 text-purple-700 font-semibold px-2.5 py-0.5 rounded-full border border-purple-200">
              System Admin
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure product SKUs, variant pricing, categories, subscription plans, and fulfillment nodes.
          </p>
        </div>

        <button
          onClick={loadData}
          disabled={refreshing}
          className="p-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors self-start"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 space-x-4">
        {[
          { id: 'products', label: `Products (${products.length})`, icon: Box },
          { id: 'variants', label: `Variants (${variants.length})`, icon: Layers },
          { id: 'categories', label: `Categories (${categories.length})`, icon: FolderTree },
          { id: 'plans', label: `SaaS Plans (${plans.length})`, icon: CreditCard },
          { id: 'warehouses', label: `Warehouses (${warehouses.length})`, icon: Building },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 text-xs font-semibold flex items-center space-x-2 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {activeTab === 'products' && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase font-semibold">
                <tr>
                  <th className="px-5 py-3">Product Name</th>
                  <th className="px-5 py-3">Category Code</th>
                  <th className="px-5 py-3">SKU Prefix</th>
                  <th className="px-5 py-3">Created / Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3.5 font-semibold text-slate-900">{p.name}</td>
                    <td className="px-5 py-3.5">
                      <span className="font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200">
                        {p.categoryCode}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-slate-600">{p.skuPrefix}</td>
                    <td className="px-5 py-3.5">
                      <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-medium">Active</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'variants' && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase font-semibold">
                <tr>
                  <th className="px-5 py-3">Variant SKU</th>
                  <th className="px-5 py-3">Variant Title</th>
                  <th className="px-5 py-3">Base Unit Price</th>
                  <th className="px-5 py-3">Standard Unit Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {variants.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3.5 font-mono font-semibold text-slate-900">{v.sku}</td>
                    <td className="px-5 py-3.5 font-medium text-slate-800">{v.name || 'Variant Unit'}</td>
                    <td className="px-5 py-3.5 font-semibold text-slate-900 tabular-nums">
                      {formatINR(v.basePrice)}
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 tabular-nums">{formatINR(v.baseCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'categories' && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase font-semibold">
                <tr>
                  <th className="px-5 py-3">Category Code</th>
                  <th className="px-5 py-3">Category Title</th>
                  <th className="px-5 py-3">Tax Rate Bp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.map((c) => (
                  <tr key={c.code} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3.5 font-mono font-bold text-slate-900">{c.code}</td>
                    <td className="px-5 py-3.5 font-semibold text-slate-800">{c.name}</td>
                    <td className="px-5 py-3.5 text-slate-600">{c.taxRateBp || 1800} bp (18%)</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'plans' && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase font-semibold">
                <tr>
                  <th className="px-5 py-3">Plan Name & Code</th>
                  <th className="px-5 py-3">Cadence Interval</th>
                  <th className="px-5 py-3">Cycle Price</th>
                  <th className="px-5 py-3">Cycle Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plans.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3.5 font-semibold text-slate-900">{p.name} ({p.code})</td>
                    <td className="px-5 py-3.5 text-slate-600">
                      {p.intervalMonths === 1 ? 'Monthly' : 'Annual'}
                    </td>
                    <td className="px-5 py-3.5 font-bold text-slate-900 tabular-nums">
                      {formatINR(p.pricePerCycle)}
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 tabular-nums">{formatINR(p.costPerCycle)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'warehouses' && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase font-semibold">
                <tr>
                  <th className="px-5 py-3">Warehouse Code</th>
                  <th className="px-5 py-3">Facility Name</th>
                  <th className="px-5 py-3">City / Region</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {warehouses.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3.5 font-mono font-bold text-slate-900">{w.code}</td>
                    <td className="px-5 py-3.5 font-semibold text-slate-800">{w.name}</td>
                    <td className="px-5 py-3.5 text-slate-600">{w.city || 'India Central'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
