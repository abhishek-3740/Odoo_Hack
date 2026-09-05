import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { CatalogGrid, usePublicCatalog } from '../../components/storefront/CatalogGrid';
import { QuoteCartDrawer } from '../../components/storefront/QuoteCartDrawer';
import { useQuoteCart } from '../../components/storefront/useQuoteCart';
import { Sparkles, ShieldCheck, ShoppingBag } from 'lucide-react';

export function CustomerCatalogPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error } = usePublicCatalog();
  const cart = useQuoteCart();
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const isCustomer = user?.role === 'CUSTOMER';

  const handleAdd = (entry) => {
    cart.addItem(entry);
    setCartOpen(true);
  };

  const submitCart = async ({ title, note }) => {
    setSubmitting(true);
    setSubmitError('');
    try {
      const detail = await api.postWithIdempotency('/portal/quote-requests', {
        title,
        note,
        lines: cart.items.map((i) => ({
          variantId: i.type === 'variant' ? i.id : null,
          planId: i.type === 'plan' ? i.id : null,
          quantity: i.quantity,
        })),
      });
      cart.clear();
      setCartOpen(false);
      navigate(`/customer/quotes/${detail.id}`);
    } catch (err) {
      setSubmitError(err.message || 'Could not send the request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const tier = user?.customerTier ? user.customerTier.charAt(0) + user.customerTier.slice(1).toLowerCase() : null;

  return (
    <div className="space-y-8">
      <div className="bg-slate-900 rounded-2xl text-white p-8 shadow-md relative overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center space-x-2 bg-slate-800/80 border border-slate-700 px-3 py-1 rounded-full text-xs font-medium text-indigo-300 mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            <span>B2B commercial catalogue</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Hardware, services &amp; subscriptions</h2>
          <p className="text-slate-400 text-sm mt-2 leading-relaxed">
            Add what you need to a quotation cart. We price it for{' '}
            <span className="text-indigo-300 font-semibold">{user?.customerName || 'your organisation'}</span> and your
            account manager picks it up in a live deal room.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {tier && (
              <div className="flex items-center space-x-2 bg-slate-800/90 px-3 py-1.5 rounded-lg border border-slate-700 text-xs">
                <span className="text-slate-400">Pricing tier</span>
                <span className="font-semibold text-amber-400">{tier}</span>
              </div>
            )}
            <div className="flex items-center space-x-2 bg-slate-800/90 px-3 py-1.5 rounded-lg border border-slate-700 text-xs">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-300">Stock-backed fulfilment</span>
            </div>
            {cart.count > 0 && (
              <button
                type="button"
                onClick={() => setCartOpen(true)}
                className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg text-xs font-semibold"
              >
                <ShoppingBag className="w-4 h-4" />
                <span>Open cart ({cart.count})</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {!isCustomer && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl p-3">
          You are viewing the catalogue as internal staff. Quotations for customers are created from the workspace.
        </div>
      )}

      <CatalogGrid
        data={data}
        loading={loading}
        error={error}
        onAddVariant={isCustomer ? handleAdd : null}
        onAddPlan={isCustomer ? handleAdd : null}
      />

      {isCustomer && (
        <QuoteCartDrawer
          cart={cart}
          open={cartOpen}
          onOpen={() => setCartOpen(true)}
          onClose={() => setCartOpen(false)}
          onSubmit={submitCart}
          submitting={submitting}
          error={submitError}
        />
      )}
    </div>
  );
}
