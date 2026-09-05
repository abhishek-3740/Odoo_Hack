import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { PublicHeader } from '../../components/storefront/PublicHeader';
import { CatalogGrid, usePublicCatalog } from '../../components/storefront/CatalogGrid';
import { PlanCard } from '../../components/storefront/PlanCard';
import { cadenceLabel } from '../../components/storefront/PlanCard';
import { QuoteCartDrawer } from '../../components/storefront/QuoteCartDrawer';
import { useQuoteCart } from '../../components/storefront/useQuoteCart';
import { ToastContainer } from '../../components/common/ToastContainer';
import {
  Sparkles,
  ShieldCheck,
  MessageSquare,
  FileCheck,
  ShoppingBag,
  ArrowRight,
  Zap,
  Layers,
} from 'lucide-react';

const STEPS = [
  { icon: ShoppingBag, title: 'Browse & request', text: 'Pick hardware, services and subscriptions from the live catalogue and ask for a formal quotation.' },
  { icon: MessageSquare, title: 'Negotiate live', text: 'Comment on any line or counter a discount. Your account manager answers in the same deal room, in real time.' },
  { icon: FileCheck, title: 'Accept with confidence', text: 'You accept the exact version you reviewed — hash-verified — and your order is confirmed instantly.' },
];

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error } = usePublicCatalog();
  const cart = useQuoteCart();
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [guestHint, setGuestHint] = useState(false);

  const isCustomer = user?.role === 'CUSTOMER';

  const handleGuestAdd = () => {
    setGuestHint(true);
    navigate('/signup?next=%2Fcustomer%2Fcatalog');
  };

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
      setSubmitError(err.message || 'Could not send the request.');
    } finally {
      setSubmitting(false);
    }
  };

  const subscriptionProducts = useMemo(
    () => (data?.products || []).filter((p) => p.chargeKind === 'RECURRING'),
    [data]
  );
  const stats = useMemo(() => {
    const products = data?.products || [];
    return {
      hardware: products.filter((p) => p.categoryKind === 'HARDWARE').length,
      services: products.filter((p) => p.categoryKind === 'SERVICE').length,
      plans: (data?.plans || []).length,
    };
  }, [data]);

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex flex-col">
      {isCustomer && <ToastContainer />}
      <PublicHeader />

      {/* Hero */}
      <section className="bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24 grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <div className="inline-flex items-center space-x-2 bg-slate-800/80 border border-slate-700 px-3 py-1 rounded-full text-xs font-medium text-indigo-300 mb-5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>B2B catalogue · live negotiation · one-click acceptance</span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-tight">
              Enterprise hardware, services and subscriptions — quoted on your terms.
            </h1>
            <p className="text-slate-400 text-sm sm:text-base mt-4 leading-relaxed max-w-xl">
              Browse verified products with list pricing, request a formal quotation in seconds, then negotiate
              line by line with a named account manager. Tier pricing, stock and approvals are handled for you.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#catalog"
                className="inline-flex items-center space-x-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                <span>Browse the catalogue</span>
                <ArrowRight className="w-4 h-4" />
              </a>
              {!user && (
                <Link
                  to="/signup"
                  className="inline-flex items-center space-x-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  <span>Create a customer account</span>
                </Link>
              )}
              {isCustomer && (
                <Link
                  to="/customer"
                  className="inline-flex items-center space-x-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  <span>Open my portal</span>
                </Link>
              )}
            </div>
            <dl className="mt-10 grid grid-cols-3 gap-4 max-w-md">
              {[
                ['Hardware lines', stats.hardware],
                ['Services', stats.services],
                ['Subscription plans', stats.plans],
              ].map(([label, value]) => (
                <div key={label} className="bg-slate-800/60 border border-slate-700 rounded-lg p-3">
                  <dt className="text-[10px] uppercase tracking-wider text-slate-400">{label}</dt>
                  <dd className="text-xl font-bold tabular-nums mt-0.5">{loading ? '—' : value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="hidden lg:block">
            <div className="bg-slate-800/70 border border-slate-700 rounded-2xl p-5 space-y-3 shadow-md">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="inline-flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>Deal room · live</span>
                </span>
                <span className="font-mono">Q-1042 · Rev #3</span>
              </div>
              <div className="ml-8 bg-indigo-600 text-white text-xs rounded-xl rounded-tr-sm p-3">
                Can we do 8% on the 27&quot; monitors if we take 12 instead of 10?
              </div>
              <div className="mr-8 bg-slate-700 text-slate-100 text-xs rounded-xl rounded-tl-sm p-3">
                Yes — revised to 12 units at 8%. Terms are re-priced and ready for your acceptance.
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-700">
                <div className="text-xs text-slate-400">
                  One-time total <span className="text-white font-semibold tabular-nums">₹2,76,000.00</span>
                </div>
                <span className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-semibold">
                  <FileCheck className="w-3.5 h-3.5" />
                  <span>Accept &amp; confirm</span>
                </span>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-3 text-center">Illustrative deal room — every number on a real quotation comes from the server.</p>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 grid sm:grid-cols-3 gap-3 text-xs text-slate-600">
          {[
            [ShieldCheck, 'Private to your organisation — no internal costs, ever'],
            [Zap, 'Real-time updates over an authenticated socket'],
            [Layers, 'Tiered pricing and approvals applied server-side'],
          ].map(([Icon, text]) => (
            <div key={text} className="flex items-center space-x-2">
              <Icon className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>{text}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Catalogue */}
      <main className="flex-1">
        <section id="catalog" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 scroll-mt-20">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">Catalogue</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {user
                  ? isCustomer
                    ? 'Add items to your quote cart and request a formal quotation.'
                    : 'You are signed in as internal staff; quotations are built from the workspace.'
                  : 'List prices shown. Create an account to request a quotation with your tier pricing.'}
              </p>
            </div>
            {guestHint && !user && (
              <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                Sign up to add items to a quotation.
              </span>
            )}
          </div>

          <CatalogGrid
            data={data}
            loading={loading}
            error={error}
            onAddVariant={isCustomer ? handleAdd : null}
            onAddPlan={isCustomer ? handleAdd : null}
            onGuestAdd={user ? undefined : handleGuestAdd}
          />
        </section>

        {/* How it works */}
        <section id="how-it-works" className="bg-white border-y border-slate-200 scroll-mt-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">How it works</h2>
            <p className="text-xs text-slate-500 mt-0.5">From catalogue to confirmed order, without email ping-pong.</p>
            <ol className="mt-8 grid md:grid-cols-3 gap-5">
              {STEPS.map((step, i) => {
                const Icon = step.icon;
                return (
                  <li key={step.title} className="relative bg-slate-50 border border-slate-200 rounded-xl p-5">
                    <span className="absolute top-4 right-4 text-[10px] font-bold text-slate-400">0{i + 1}</span>
                    <div className="w-10 h-10 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                      <Icon className="w-5 h-5" />
                    </div>
                    <h3 className="font-semibold text-sm text-slate-900 mt-4">{step.title}</h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{step.text}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* Subscriptions spotlight */}
        {subscriptionProducts.length > 0 && (
          <section id="subscriptions" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 scroll-mt-20">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">Subscriptions</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Monthly, quarterly or yearly. Calendar-month proration, cancel at period end, invoiced per period.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {subscriptionProducts.map((product) => (
                <PlanCard
                  key={product.id}
                  product={product}
                  plans={(data?.plans || []).filter((p) => p.productId === product.id)}
                  onAdd={
                    isCustomer
                      ? (plan) =>
                          handleAdd({
                            type: 'plan',
                            id: plan.id,
                            name: plan.name,
                            subtitle: product.name,
                            price: plan.intervalPrice,
                            cadence: cadenceLabel(plan.intervalMonths),
                          })
                      : null
                  }
                  onGuestAdd={user ? undefined : handleGuestAdd}
                />
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>&copy; 2026 DealFlow360 Inc. All commercial terms securely bound.</span>
          <div className="flex items-center space-x-4">
            <Link to="/login" className="hover:text-slate-800">
              Sign in
            </Link>
            <Link to="/signup" className="hover:text-slate-800">
              Create account
            </Link>
          </div>
        </div>
      </footer>

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
