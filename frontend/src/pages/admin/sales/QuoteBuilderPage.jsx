import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, formatINR, formatPercent, formatDate, formatDateTime, bpToPercent, percentToBp } from '../../../services/api';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { LoadingSpinner } from '../../../components/common/LoadingState';
import { Modal } from '../../../components/common/Modal';
import {
  ArrowLeft,
  Save,
  Send,
  Share2,
  Check,
  Plus,
  Trash2,
  AlertTriangle,
  ShieldCheck,
  Sparkles,
  History,
  Layers,
  Package,
  Clock,
  ExternalLink,
  ChevronDown,
  Info,
  Building2,
} from 'lucide-react';

export function QuoteBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  // Quote Data
  const [evaluation, setEvaluation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState(null);

  // Editable Draft Terms
  const [draftLines, setDraftLines] = useState([]);
  const [orderDiscountBp, setOrderDiscountBp] = useState(0);
  const [backorderTerms, setBackorderTerms] = useState('SPLIT_ALLOWED');

  // Catalog Reference for Adding Items
  const [products, setProducts] = useState([]);
  const [variants, setVariants] = useState([]);
  const [plans, setPlans] = useState([]);

  // Modals & Panels
  const [addItemModalOpen, setAddItemModalOpen] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [itemType, setItemType] = useState('variant'); // 'variant' | 'plan'
  const [itemQuantity, setItemQuantity] = useState(1);
  const [itemDiscountPercent, setItemDiscountPercent] = useState(0);

  // Submit Modal
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [submitNote, setSubmitNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Share Modal
  const [shareResult, setShareResult] = useState(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  // History Drawer
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [historyLogs, setHistoryLogs] = useState([]);

  // Smart Recommendations
  const [recommendations, setRecommendations] = useState([]);
  const [recsLoading, setRecsLoading] = useState(false);

  // Load catalog items for dropdowns
  useEffect(() => {
    async function loadCatalog() {
      try {
        const [prodRes, varRes, planRes] = await Promise.all([
          api.get('/products').catch(() => []),
          api.get('/variants').catch(() => []),
          api.get('/subscription-plans').catch(() => []),
        ]);
        setProducts(Array.isArray(prodRes) ? prodRes : []);
        setVariants(Array.isArray(varRes) ? varRes : []);
        setPlans(Array.isArray(planRes) ? planRes : []);
      } catch (err) {
        console.error('Failed to load catalog:', err);
      }
    }
    loadCatalog();
  }, []);

  // Initial load of quote
  const loadQuoteEvaluation = async () => {
    try {
      setLoading(true);
      // Run evaluation with empty body to evaluate current state
      const evalRes = await api.post(`/quotes/${id}/evaluations`, {
        lines: [],
        orderDiscountBp: 0,
      }).catch(async () => {
        // Fallback: evaluate existing state
        return await api.get(`/quotes/${id}`);
      });

      setEvaluation(evalRes);
      if (evalRes?.lines) {
        setDraftLines(
          evalRes.lines.map((l) => ({
            lineKey: l.lineKey,
            variantId: l.variantId,
            planId: l.planId,
            description: l.description,
            quantity: l.quantity || 1,
            lineDiscountBp: l.lineDiscountBp || 0,
            promisedDate: l.promisedDate || null,
            unitPrice: l.unitPrice,
            lineTotal: l.net || l.base,
            marginPercent: l.marginPercent,
            source: l.source || 'MANUAL',
          }))
        );
        setOrderDiscountBp(evalRes.orderDiscountBp || 0);
        setBackorderTerms(evalRes.backorderTerms || 'SPLIT_ALLOWED');
      }
    } catch (err) {
      console.error('Failed to load quote evaluation:', err);
      setError(err.message || 'Quotation not found');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQuoteEvaluation();
    loadRecommendations();
  }, [id]);

  // Load smart recommendations
  const loadRecommendations = async () => {
    try {
      setRecsLoading(true);
      const data = await api.get(`/quotes/${id}/recommendations`).catch(() => []);
      setRecommendations(Array.isArray(data) ? data : []);
    } catch {
      // Recommendations may be empty if not enough history
    } finally {
      setRecsLoading(false);
    }
  };

  // Real-time evaluation recalculation when lines or discount change
  const triggerReEvaluation = async (linesToEval = draftLines, discountBp = orderDiscountBp) => {
    if (linesToEval.length === 0) return;
    setEvaluating(true);
    try {
      const payload = {
        lines: linesToEval.map((l) => ({
          lineKey: l.lineKey || null,
          variantId: l.variantId || null,
          planId: l.planId || null,
          quantity: l.quantity,
          lineDiscountBp: parseInt(l.lineDiscountBp || 0, 10),
          promisedDate: l.promisedDate || null,
          source: l.source || 'MANUAL',
        })),
        orderDiscountBp: parseInt(discountBp || 0, 10),
        backorderTerms,
        expectedRowVersion: evaluation?.rowVersion,
      };

      const res = await api.post(`/quotes/${id}/evaluations`, payload);
      setEvaluation(res);
      // Sync lines with evaluated output (prices, margins, etc.)
      if (res.lines) {
        setDraftLines(
          res.lines.map((l) => ({
            lineKey: l.lineKey,
            variantId: l.variantId,
            planId: l.planId,
            description: l.description,
            quantity: l.quantity,
            lineDiscountBp: l.lineDiscountBp,
            promisedDate: l.promisedDate,
            unitPrice: l.unitPrice,
            lineTotal: l.net,
            marginPercent: l.marginPercent,
            source: l.source,
          }))
        );
      }
    } catch (err) {
      console.warn('Re-evaluation error:', err);
    } finally {
      setEvaluating(false);
    }
  };

  // Add line item
  const handleAddLineItem = () => {
    let newItem = null;
    if (itemType === 'variant') {
      const v = variants.find((x) => x.id === selectedVariantId);
      if (!v) return;
      newItem = {
        lineKey: 'line-' + Math.random().toString(36).substring(2, 7),
        variantId: v.id,
        planId: null,
        description: v.name || v.sku,
        quantity: itemQuantity,
        lineDiscountBp: percentToBp(itemDiscountPercent),
        unitPrice: v.basePrice,
        source: 'MANUAL',
      };
    } else {
      const p = plans.find((x) => x.id === selectedPlanId);
      if (!p) return;
      newItem = {
        lineKey: 'line-' + Math.random().toString(36).substring(2, 7),
        variantId: null,
        planId: p.id,
        description: p.name,
        quantity: itemQuantity,
        lineDiscountBp: percentToBp(itemDiscountPercent),
        unitPrice: p.pricePerCycle,
        source: 'MANUAL',
      };
    }

    const updated = [...draftLines, newItem];
    setDraftLines(updated);
    setAddItemModalOpen(false);
    triggerReEvaluation(updated, orderDiscountBp);
  };

  // Remove line item
  const handleRemoveLine = (index) => {
    const updated = draftLines.filter((_, idx) => idx !== index);
    setDraftLines(updated);
    triggerReEvaluation(updated, orderDiscountBp);
  };

  // Update line discount or quantity
  const handleLineChange = (index, field, value) => {
    const updated = [...draftLines];
    updated[index][field] = value;
    setDraftLines(updated);
    // Debounce re-eval
    triggerReEvaluation(updated, orderDiscountBp);
  };

  // Save Revision
  const handleSaveRevision = async () => {
    try {
      const payload = {
        lines: draftLines.map((l) => ({
          lineKey: l.lineKey,
          variantId: l.variantId,
          planId: l.planId,
          quantity: l.quantity,
          lineDiscountBp: parseInt(l.lineDiscountBp || 0, 10),
          promisedDate: l.promisedDate || null,
          source: l.source || 'MANUAL',
        })),
        orderDiscountBp: parseInt(orderDiscountBp || 0, 10),
        backorderTerms,
        expectedRowVersion: evaluation?.rowVersion,
      };

      const res = await api.post(`/quotes/${id}/revisions`, payload);
      setEvaluation(res);
      alert(`Revision #${res.revisionNo} successfully saved!`);
      loadQuoteEvaluation();
    } catch (err) {
      alert('Failed to save revision: ' + err.message);
    }
  };

  // Submit for Approval
  const handleSubmitForApproval = async () => {
    setSubmitting(true);
    try {
      const payload = {
        expectedRevisionId: evaluation?.revisionId,
        expectedRowVersion: evaluation?.rowVersion,
        note: submitNote.trim() || 'Submitted for deal desk approval',
      };
      await api.post(`/quotes/${id}/submissions`, payload);
      setSubmitModalOpen(false);
      setSubmitNote('');
      alert('Quotation submitted for approval!');
      loadQuoteEvaluation();
    } catch (err) {
      alert('Submission failed: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Share with Customer
  const handleShareQuote = async () => {
    try {
      const res = await api.post(`/quotes/${id}/shares`, {});
      setShareResult(res);
      setShareModalOpen(true);
      loadQuoteEvaluation();
    } catch (err) {
      alert('Failed to share quote: ' + err.message);
    }
  };

  // Adopt Customer Counteroffer
  const handleAdoptCounteroffer = async () => {
    if (!evaluation?.revisionId) return;
    try {
      await api.post(`/quotes/${id}/adoptions`, {
        revisionId: evaluation.revisionId,
        expectedRowVersion: evaluation.rowVersion,
        note: 'Adopted customer proposal terms',
      });
      alert('Customer counteroffer successfully adopted!');
      loadQuoteEvaluation();
    } catch (err) {
      alert('Failed to adopt counteroffer: ' + err.message);
    }
  };

  // Load History
  const handleOpenHistory = async () => {
    try {
      const history = await api.get(`/quotes/${id}/history`).catch(() => []);
      setHistoryLogs(Array.isArray(history) ? history : []);
      setHistoryDrawerOpen(true);
    } catch (err) {
      alert('Failed to load history: ' + err.message);
    }
  };

  // Add Recommended Item
  const handleAddRecommendation = (rec) => {
    const v = variants.find((x) => x.id === rec.candidateVariantId);
    if (!v) return;
    const newItem = {
      lineKey: 'rec-' + Math.random().toString(36).substring(2, 7),
      variantId: v.id,
      planId: null,
      description: v.name || v.sku,
      quantity: 1,
      lineDiscountBp: 0,
      unitPrice: v.basePrice,
      source: 'RECOMMENDED',
    };
    const updated = [...draftLines, newItem];
    setDraftLines(updated);
    triggerReEvaluation(updated, orderDiscountBp);
    // Dismiss recommendation from list
    setRecommendations(recommendations.filter((r) => r.candidateVariantId !== rec.candidateVariantId));
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const totals = evaluation?.totals || {};
  const risk = evaluation?.risk || {};
  const stockPreview = evaluation?.stockPreview || [];
  const gates = evaluation?.gates || {};

  // Blended Margin Calculation
  const contributionPercent = parseFloat(totals.contributionPercent) || 0;
  const marginColor =
    contributionPercent < 20
      ? 'bg-rose-500'
      : contributionPercent < 35
      ? 'bg-amber-500'
      : 'bg-emerald-500';

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header & Deal Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex items-center space-x-3">
          <Link
            to="/admin/sales/quotes"
            className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-white"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center space-x-2.5">
              <h2 className="text-xl font-bold text-slate-900">{evaluation?.reference || 'Quotation Builder'}</h2>
              <StatusBadge status={evaluation?.stage} />
              <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                Rev #{evaluation?.revisionNo || 1}
              </span>
              {evaluating && (
                <span className="text-xs text-indigo-600 font-medium flex items-center space-x-1">
                  <LoadingSpinner size="sm" />
                  <span>Evaluating live...</span>
                </span>
              )}
            </div>
            <div className="flex items-center space-x-2 text-xs text-slate-500 mt-1">
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-semibold text-slate-700">{evaluation?.customerName || 'Customer Org'}</span>
              <span>•</span>
              <span className="bg-slate-100 px-1.5 py-0.2 rounded text-[11px] font-medium">
                Tier: {evaluation?.customerTier || 'BRONZE'}
              </span>
              <span>•</span>
              <span>Valid Until: {formatDate(evaluation?.validUntil)}</span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleOpenHistory}
            className="px-3 py-2 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold rounded-lg flex items-center space-x-1.5 shadow-xs"
          >
            <History className="w-3.5 h-3.5" />
            <span>Audit Trail</span>
          </button>

          <button
            onClick={handleSaveRevision}
            className="px-3.5 py-2 bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 text-xs font-semibold rounded-lg flex items-center space-x-1.5 shadow-xs"
          >
            <Save className="w-3.5 h-3.5 text-slate-600" />
            <span>Save Revision</span>
          </button>

          <button
            onClick={() => setSubmitModalOpen(true)}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Submit for Approval</span>
          </button>

          <button
            onClick={handleShareQuote}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 shadow-xs"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Share Customer Portal</span>
          </button>

          {evaluation?.stage === 'SHARED_WITH_CUSTOMER' && (
            <button
              onClick={handleAdoptCounteroffer}
              className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 shadow-xs"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Adopt Counteroffer</span>
            </button>
          )}
        </div>
      </div>

      {/* Governance & Risk Summary Banner */}
      {risk && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-5 h-5 text-indigo-600" />
              <div>
                <span className="font-bold text-xs text-slate-900 uppercase tracking-wider">
                  Discount Policy Evaluation
                </span>
                <span className="ml-2 text-xs text-slate-500 font-mono">Policy v{risk.policyVersionNo || 1}</span>
              </div>
            </div>

            {/* Required Approval Level Chip */}
            <div className="flex items-center space-x-2">
              <span className="text-xs text-slate-500">Approval Requirement:</span>
              <span
                className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                  risk.requiredLevel === 'STEP_2_FINANCE'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : risk.requiredLevel === 'STEP_1_MANAGER'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}
              >
                {risk.requiredLevel === 'STEP_2_FINANCE'
                  ? 'Step 2: Finance Approval Required'
                  : risk.requiredLevel === 'STEP_1_MANAGER'
                  ? 'Step 1: Manager Approval Required'
                  : 'Pre-Approved (Within Ceilings)'}
              </span>
            </div>
          </div>

          {/* Margin Bar */}
          <div>
            <div className="flex justify-between text-xs font-semibold mb-1">
              <span className="text-slate-700">Blended Deal Contribution Margin:</span>
              <span className="tabular-nums text-slate-900">{formatPercent(contributionPercent)}</span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full ${marginColor} transition-all duration-300`}
                style={{ width: `${Math.min(Math.max(contributionPercent, 0), 100)}%` }}
              />
            </div>
          </div>

          {/* Risk Reasons List if breaches exist */}
          {risk.reasons && risk.reasons.length > 0 && (
            <div className="pt-2 border-t border-slate-100 space-y-1.5">
              {risk.reasons.map((r, i) => (
                <div key={i} className="flex items-center space-x-2 text-xs text-amber-800 bg-amber-50/70 px-2.5 py-1 rounded">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>{r.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main Grid: Cart Lines & Financial Context */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Cart Lines Editor */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Package className="w-4 h-4 text-slate-600" />
                <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider">
                  Line Items Cart ({draftLines.length})
                </h3>
              </div>
              <button
                onClick={() => setAddItemModalOpen(true)}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Item to Deal</span>
              </button>
            </div>

            {/* Line items table */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="px-4 py-3">Description & Type</th>
                    <th className="px-4 py-3">Qty</th>
                    <th className="px-4 py-3">Unit Price</th>
                    <th className="px-4 py-3">Line Discount %</th>
                    <th className="px-4 py-3">Net Total</th>
                    <th className="px-4 py-3">Margin %</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {draftLines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                        No items added to quotation yet. Click &quot;Add Item to Deal&quot; to begin.
                      </td>
                    </tr>
                  ) : (
                    draftLines.map((line, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{line.description}</div>
                          <span className="text-[10px] text-slate-400 font-mono">Key: {line.lineKey}</span>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min="1"
                            value={line.quantity}
                            onChange={(e) => handleLineChange(idx, 'quantity', parseInt(e.target.value, 10) || 1)}
                            className="w-16 p-1 border border-slate-200 rounded text-xs bg-white text-center font-medium"
                          />
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-800 tabular-nums">
                          {formatINR(line.unitPrice)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center space-x-1">
                            <input
                              type="number"
                              min="0"
                              max="99"
                              value={bpToPercent(line.lineDiscountBp)}
                              onChange={(e) =>
                                handleLineChange(idx, 'lineDiscountBp', percentToBp(e.target.value))
                              }
                              className="w-16 p-1 border border-slate-200 rounded text-xs bg-white text-center font-medium"
                            />
                            <span className="text-slate-400">%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-900 tabular-nums">
                          {formatINR(line.lineTotal)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`font-semibold tabular-nums ${
                              parseFloat(line.marginPercent) < 20
                                ? 'text-rose-600'
                                : parseFloat(line.marginPercent) < 35
                                ? 'text-amber-600'
                                : 'text-emerald-700'
                            }`}
                          >
                            {line.marginPercent ? formatPercent(line.marginPercent) : '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleRemoveLine(idx)}
                            className="text-slate-400 hover:text-rose-600 p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Stock Availability Preview per Line */}
          {stockPreview.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-3">
              <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider">
                Multi-Warehouse Stock Feasibility Preview
              </h3>

              <div className="divide-y divide-slate-100 text-xs">
                {stockPreview.map((sp, i) => (
                  <div key={i} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900">{sp.description}</div>
                      <div className="text-[11px] text-slate-500">
                        Requested: <strong>{sp.requested}</strong> • Available across warehouses:{' '}
                        <strong className="text-emerald-700">{sp.available}</strong>
                      </div>
                    </div>

                    <div>
                      {parseFloat(sp.shortfall) > 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                          Shortfall: {sp.shortfall} units
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          100% In Stock
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Smart Co-Purchase Recommendations */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider">
                  Smart Co-Purchase Recommendations
                </h3>
              </div>
              <span className="text-[11px] text-slate-400">Collaborative filtering model</span>
            </div>

            {recsLoading ? (
              <div className="py-4 text-center">
                <LoadingSpinner size="sm" />
              </div>
            ) : recommendations.length === 0 ? (
              <div className="text-slate-400 text-xs text-center py-4">
                No co-purchase recommendations triggered for current deal lines.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {recommendations.map((rec, i) => (
                  <div
                    key={i}
                    className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-slate-900">{rec.candidateName || rec.reason}</span>
                        <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded">
                          {Math.round((rec.confidence || 0.85) * 100)}% Match
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        Frequently purchased alongside selected hardware packages with positive contribution.
                      </p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-200 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800 tabular-nums">
                        {formatINR(rec.price)}
                      </span>
                      <button
                        onClick={() => handleAddRecommendation(rec)}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center space-x-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add to Deal</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Financials, Gate Checks & Deal Terms */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4">
            <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider pb-2 border-b border-slate-100">
              Commercial Breakdown
            </h3>

            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>One-Time Net</span>
                <span className="tabular-nums font-semibold text-slate-900">{formatINR(totals.oneTimeNet)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>One-Time Tax</span>
                <span className="tabular-nums font-semibold text-slate-900">{formatINR(totals.oneTimeTax)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-100 text-sm font-bold text-slate-900">
                <span>One-Time Total</span>
                <span className="tabular-nums text-indigo-600">{formatINR(totals.oneTimeTotal)}</span>
              </div>

              {totals.monthlyRecurringRevenue && (
                <div className="pt-2 border-t border-slate-100 flex justify-between text-xs font-semibold text-emerald-800">
                  <span>Monthly Recurring (MRR)</span>
                  <span className="tabular-nums">{formatINR(totals.monthlyRecurringRevenue)}</span>
                </div>
              )}
            </div>

            {/* Order Discount Input */}
            <div className="pt-3 border-t border-slate-100">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Header Order Discount (Basis Points)
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="0"
                  max="9999"
                  value={orderDiscountBp}
                  onChange={(e) => {
                    const bp = parseInt(e.target.value, 10) || 0;
                    setOrderDiscountBp(bp);
                    triggerReEvaluation(draftLines, bp);
                  }}
                  className="w-24 p-2 border border-slate-200 rounded-lg text-xs bg-white font-medium"
                />
                <span className="text-xs text-slate-500 font-medium">
                  = {bpToPercent(orderDiscountBp)}% overall
                </span>
              </div>
            </div>

            {/* Execution Gate Check Status */}
            {gates && (
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">Execution Gates</div>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Approval Cleared:</span>
                    <span className={gates.approvalCleared ? 'text-emerald-700 font-semibold' : 'text-amber-600 font-semibold'}>
                      {gates.approvalCleared ? 'Cleared' : 'Pending'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Customer Accepted:</span>
                    <span className={gates.customerAccepted ? 'text-emerald-700 font-semibold' : 'text-slate-500 font-semibold'}>
                      {gates.customerAccepted ? 'Accepted' : 'Not Yet'}
                    </span>
                  </div>
                </div>

                {gates.blockingReasons && gates.blockingReasons.length > 0 && (
                  <div className="mt-2 p-2.5 rounded-lg bg-amber-50 text-amber-800 text-[11px] space-y-1">
                    <div className="font-semibold">Remaining Conditions:</div>
                    {gates.blockingReasons.map((r, i) => (
                      <div key={i}>• {r}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Item Modal */}
      <Modal
        isOpen={addItemModalOpen}
        onClose={() => setAddItemModalOpen(false)}
        title="Add Catalog Item to Deal"
        subtitle="Choose between one-time hardware/software variant or recurring SaaS subscription plan."
      >
        <div className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Item Category</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setItemType('variant')}
                className={`py-2 text-center rounded-lg font-semibold border ${
                  itemType === 'variant'
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                Hardware / One-Time Variant
              </button>
              <button
                type="button"
                onClick={() => setItemType('plan')}
                className={`py-2 text-center rounded-lg font-semibold border ${
                  itemType === 'plan'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                Recurring Subscription Plan
              </button>
            </div>
          </div>

          {itemType === 'variant' ? (
            <div>
              <label className="block font-medium text-slate-700 mb-1">Select Product Variant</label>
              <select
                value={selectedVariantId}
                onChange={(e) => setSelectedVariantId(e.target.value)}
                className="w-full p-2.5 border border-slate-200 rounded-lg bg-white font-medium"
              >
                <option value="">-- Choose Variant --</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name || v.sku} — {formatINR(v.basePrice)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block font-medium text-slate-700 mb-1">Select Subscription Plan</label>
              <select
                value={selectedPlanId}
                onChange={(e) => setSelectedPlanId(e.target.value)}
                className="w-full p-2.5 border border-slate-200 rounded-lg bg-white font-medium"
              >
                <option value="">-- Choose Plan --</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.intervalMonths === 1 ? 'Monthly' : 'Annual'}) — {formatINR(p.pricePerCycle)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Quantity</label>
              <input
                type="number"
                min="1"
                value={itemQuantity}
                onChange={(e) => setItemQuantity(parseInt(e.target.value, 10) || 1)}
                className="w-full p-2.5 border border-slate-200 rounded-lg bg-white"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Proposed Line Discount %</label>
              <input
                type="number"
                min="0"
                max="99"
                value={itemDiscountPercent}
                onChange={(e) => setItemDiscountPercent(parseFloat(e.target.value) || 0)}
                className="w-full p-2.5 border border-slate-200 rounded-lg bg-white"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setAddItemModalOpen(false)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddLineItem}
              className="px-4 py-2 bg-slate-900 text-white font-semibold rounded-lg hover:bg-slate-800"
            >
              Insert into Quotation
            </button>
          </div>
        </div>
      </Modal>

      {/* Submit for Approval Modal */}
      <Modal
        isOpen={submitModalOpen}
        onClose={() => setSubmitModalOpen(false)}
        title="Submit Deal for Internal Authorization"
        subtitle="Quotation will enter sequential approval chain based on discount thresholds."
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <div className="font-semibold text-slate-800">
              Required Level: {risk.requiredLevel || 'PRE-APPROVED'}
            </div>
            <div className="text-[11px] text-slate-500">
              Revision #{evaluation?.revisionNo} terms will be locked for review.
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Submission / Justification Notes</label>
            <textarea
              rows={3}
              value={submitNote}
              onChange={(e) => setSubmitNote(e.target.value)}
              placeholder="Explain rationale for requested discount concessions or payment terms..."
              className="w-full p-2 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={() => setSubmitModalOpen(false)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmitForApproval}
              disabled={submitting}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold rounded-lg flex items-center space-x-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submitting ? 'Submitting...' : 'Submit to Approvers'}</span>
            </button>
          </div>
        </div>
      </Modal>

      {/* Share Modal */}
      <Modal
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        title="Customer Portal Link Generated"
        subtitle="This revision is now live and visible in the customer deal room."
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg space-y-2">
            <div className="font-semibold text-indigo-900">Portal Access URL:</div>
            <div className="font-mono text-[11px] bg-white p-2 rounded border border-indigo-200 break-all text-slate-800">
              {window.location.origin}/customer/quotes/{id}
            </div>
            <div className="text-[11px] text-indigo-700">
              The customer can now inspect lines, propose counteroffers, or execute 1-click acceptance.
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <a
              href={`/customer/quotes/${id}`}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 bg-slate-900 text-white font-semibold rounded-lg flex items-center space-x-1.5 hover:bg-slate-800"
            >
              <span>Open Customer Deal Room</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </Modal>

      {/* Audit History Drawer */}
      <Modal
        isOpen={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
        title="Deal Audit Trail & Revision History"
        subtitle={`Complete immutable event log for Quote ${evaluation?.reference}`}
      >
        <div className="space-y-3 max-h-96 overflow-y-auto text-xs divide-y divide-slate-100">
          {historyLogs.length === 0 ? (
            <div className="py-6 text-center text-slate-400">No prior revisions recorded.</div>
          ) : (
            historyLogs.map((log, i) => (
              <div key={i} className="pt-2 pb-2 space-y-1">
                <div className="flex justify-between font-semibold text-slate-800">
                  <span>Rev #{log.revisionNo || 1} • {log.action || 'REVISION_SAVED'}</span>
                  <span className="text-[11px] text-slate-400">{formatDateTime(log.occurredAt || log.createdAt)}</span>
                </div>
                <div className="text-slate-600">{log.note || log.description || 'Terms saved.'}</div>
                {log.authorName && (
                  <div className="text-[11px] text-slate-400">By: {log.authorName}</div>
                )}
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
