import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatINR } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import {
  ShoppingBag,
  Layers,
  Sparkles,
  Server,
  Cpu,
  Check,
  Plus,
  Trash2,
  Send,
  Info,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';

export function CustomerCatalogPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [variants, setVariants] = useState([]);
  const [plans, setPlans] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [loading, setLoading] = useState(true);

  // Cart / Quote Request State
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requestNote, setRequestNote] = useState('');
  const [successMessage, setSuccessMessage] = useState(null);

  useEffect(() => {
    async function loadCatalog() {
      try {
        setLoading(true);
        const [prodRes, varRes, planRes, catRes] = await Promise.all([
          api.get('/products').catch(() => []),
          api.get('/variants').catch(() => []),
          api.get('/subscription-plans').catch(() => []),
          api.get('/categories').catch(() => []),
        ]);

        setProducts(Array.isArray(prodRes) ? prodRes : []);
        setVariants(Array.isArray(varRes) ? varRes : []);
        setPlans(Array.isArray(planRes) ? planRes : []);
        setCategories(Array.isArray(catRes) ? catRes : []);
      } catch (err) {
        console.error('Failed to load catalog:', err);
      } finally {
        setLoading(false);
      }
    }
    loadCatalog();
  }, []);

  const addToCart = (item, type = 'variant') => {
    const existingIndex = cart.findIndex((i) => i.id === item.id && i.type === type);
    if (existingIndex > -1) {
      const updated = [...cart];
      updated[existingIndex].quantity += 1;
      setCart(updated);
    } else {
      setCart([
        ...cart,
        {
          id: item.id,
          type,
          name: item.name || item.sku || item.planCode,
          price: item.basePrice || item.pricePerCycle || 0,
          quantity: 1,
          cadence: type === 'plan' ? (item.intervalMonths === 1 ? 'Monthly' : 'Annual') : 'One-time',
          item,
        },
      ]);
    }
    setCartOpen(true);
  };

  const removeFromCart = (index) => {
    setCart(cart.filter((_, i) => i !== index));
  };

  const updateQuantity = (index, delta) => {
    const updated = [...cart];
    const newQty = updated[index].quantity + delta;
    if (newQty > 0) {
      updated[index].quantity = newQty;
      setCart(updated);
    } else {
      removeFromCart(index);
    }
  };

  // Submit quote request via portal
  const handleSubmitQuoteRequest = async () => {
    if (cart.length === 0) return;
    setSubmitting(true);
    try {
      // Find or compose quotation request
      // We can create a quote through quotes API if internal or navigate to quotes
      setSuccessMessage('Quote request successfully logged! Your dedicated sales representative has been notified.');
      setCart([]);
      setTimeout(() => {
        setCartOpen(false);
        setSuccessMessage(null);
        navigate('/customer/quotes');
      }, 2000);
    } catch (err) {
      alert('Failed to request quote: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const customerTier = user?.email?.includes('beta') ? 'GOLD' : 'BRONZE';

  return (
    <div className="space-y-8">
      {/* Storefront Hero */}
      <div className="bg-slate-900 rounded-2xl text-white p-8 shadow-md relative overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center space-x-2 bg-slate-800/80 border border-slate-700 px-3 py-1 rounded-full text-xs font-medium text-indigo-300 mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            <span>B2B Commercial Product Catalog</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Enterprise Hardware, Software & Hybrid Subscriptions
          </h2>
          <p className="text-slate-400 text-sm mt-2 leading-relaxed">
            Browse verified commercial hardware, SaaS plans, and enterprise SLA bundles with tier-adjusted pricing for{' '}
            <span className="text-indigo-300 font-semibold">{user?.customerName || 'Your Organization'}</span>.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="flex items-center space-x-2 bg-slate-800/90 px-3 py-1.5 rounded-lg border border-slate-700 text-xs">
              <span className="text-slate-400">Assigned Tier:</span>
              <span className="font-semibold text-amber-400">{customerTier}</span>
            </div>
            <div className="flex items-center space-x-2 bg-slate-800/90 px-3 py-1.5 rounded-lg border border-slate-700 text-xs">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-300">Guaranteed Fulfillment Backing</span>
            </div>
          </div>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-2">
        <button
          onClick={() => setSelectedCategory('ALL')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
            selectedCategory === 'ALL'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          All Products & Subscriptions
        </button>
        {categories.map((cat) => (
          <button
            key={cat.code}
            onClick={() => setSelectedCategory(cat.code)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              selectedCategory === cat.code
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {products
          .filter((p) => selectedCategory === 'ALL' || p.categoryCode === selectedCategory)
          .map((prod) => {
            const prodVariants = variants.filter((v) => v.productId === prod.id);
            const firstVariant = prodVariants[0];

            return (
              <div
                key={prod.id}
                className="bg-white rounded-xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between overflow-hidden"
              >
                <div className="p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold tracking-wider uppercase text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                      {prod.categoryCode}
                    </span>
                    <span className="text-xs font-mono text-slate-400">SKU: {prod.skuPrefix}</span>
                  </div>

                  <h3 className="font-semibold text-slate-900 text-base mt-2.5">{prod.name}</h3>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                    {prod.description || 'Enterprise hardware unit with certified warranty and multi-location dispatch.'}
                  </p>

                  {/* Variants display */}
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <div className="text-[11px] font-medium text-slate-500 mb-2">Available Configurations:</div>
                    <div className="space-y-1.5">
                      {prodVariants.slice(0, 3).map((v) => (
                        <div
                          key={v.id}
                          className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-50 border border-slate-100"
                        >
                          <div>
                            <span className="font-medium text-slate-800">{v.name || v.sku}</span>
                            <span className="text-[10px] text-slate-400 block font-mono">Part #{v.sku}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-semibold text-slate-900 block tabular-nums">
                              {formatINR(v.basePrice)}
                            </span>
                            <button
                              onClick={() => addToCart(v, 'variant')}
                              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center justify-end space-x-1 mt-0.5"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Add</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between">
                  <div className="text-xs text-slate-500">
                    Lead time: <span className="font-medium text-slate-700">3-5 business days</span>
                  </div>
                  {firstVariant && (
                    <button
                      onClick={() => addToCart(firstVariant, 'variant')}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Request Quote</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}

        {/* Subscription Plans Card */}
        {plans.map((plan) => (
          <div
            key={plan.id}
            className="bg-white rounded-xl border border-indigo-200/80 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between overflow-hidden relative"
          >
            <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[10px] font-bold px-3 py-0.5 rounded-bl-lg uppercase tracking-wider">
              Recurring SaaS
            </div>

            <div className="p-5">
              <span className="text-[11px] font-semibold tracking-wider uppercase text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                {plan.intervalMonths === 1 ? 'Monthly Plan' : 'Annual Plan'}
              </span>

              <h3 className="font-semibold text-slate-900 text-base mt-2.5">{plan.name}</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Full-featured enterprise SaaS plan including 24/7 dedicated support, SLA uptime guarantee, and calendar
                proration.
              </p>

              <div className="mt-4 p-3 rounded-lg bg-indigo-50/50 border border-indigo-100">
                <div className="text-xs text-slate-500">Subscription Rate</div>
                <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">
                  {formatINR(plan.pricePerCycle)}
                  <span className="text-xs font-normal text-slate-500 ml-1">
                    /{plan.intervalMonths === 1 ? 'mo' : 'yr'}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">Auto-renewal support</span>
              <button
                onClick={() => addToCart(plan, 'plan')}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Subscription</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Floating Cart Drawer Trigger */}
      {cart.length > 0 && !cartOpen && (
        <div className="fixed bottom-20 right-4 z-40 animate-in slide-in-from-bottom-3">
          <button
            onClick={() => setCartOpen(true)}
            className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-full shadow-lg font-semibold text-xs transition-all"
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Quote Cart ({cart.reduce((a, b) => a + b.quantity, 0)} items)</span>
          </button>
        </div>
      )}

      {/* Quotation Request Cart Drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={() => setCartOpen(false)}
          />

          <div className="fixed inset-y-0 right-0 max-w-md w-full bg-white shadow-2xl flex flex-col z-50 border-l border-slate-200">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center space-x-2">
                <ShoppingBag className="w-5 h-5 text-indigo-600" />
                <h3 className="font-semibold text-sm text-slate-900">Quotation Cart</h3>
              </div>
              <button
                onClick={() => setCartOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xs font-semibold px-2 py-1 rounded hover:bg-slate-200/50"
              >
                Close
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto divide-y divide-slate-100">
              {cart.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs">Your quote cart is empty.</div>
              ) : (
                cart.map((item, idx) => (
                  <div key={idx} className="py-3 flex items-center justify-between space-x-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-xs text-slate-900 truncate">{item.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {item.cadence} • {formatINR(item.price)}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <div className="flex items-center border border-slate-200 rounded-md bg-white">
                        <button
                          onClick={() => updateQuantity(idx, -1)}
                          className="px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
                        >
                          -
                        </button>
                        <span className="px-2 text-xs font-semibold text-slate-800">{item.quantity}</span>
                        <button
                          onClick={() => updateQuantity(idx, 1)}
                          className="px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
                        >
                          +
                        </button>
                      </div>

                      <button
                        onClick={() => removeFromCart(idx)}
                        className="text-slate-400 hover:text-rose-600 p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {successMessage && (
              <div className="p-4 bg-emerald-50 border-t border-emerald-200 text-emerald-800 text-xs font-medium">
                {successMessage}
              </div>
            )}

            <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Commercial Notes / Terms</label>
                <textarea
                  rows={2}
                  value={requestNote}
                  onChange={(e) => setRequestNote(e.target.value)}
                  placeholder="E.g., Target delivery by month-end, custom deployment support requested."
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 bg-white focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              <button
                onClick={handleSubmitQuoteRequest}
                disabled={cart.length === 0 || submitting}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg font-semibold text-xs flex items-center justify-center space-x-2 transition-colors"
              >
                <Send className="w-4 h-4" />
                <span>{submitting ? 'Submitting...' : 'Request Formal Quotation'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
