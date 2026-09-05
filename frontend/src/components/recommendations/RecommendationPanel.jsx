import { useEffect, useState } from 'react';
import { ArrowUpRight, Plus, RefreshCw, X, TrendingUp } from 'lucide-react';
import { api, formatINR } from '../../services/api';

export function RecommendationPanel({ quoteId, refreshKey, dirty, readOnly = false, onApplied }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState('CROSS_SELL');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api.get(`/quotes/${quoteId}/recommendations`, { signal: controller.signal })
      .then(setResult).catch(err => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [quoteId, refreshKey, reload]);
  async function apply(offer) {
    setBusy(offer.variantId); setError('');
    try {
      await api.post(`/quotes/${quoteId}/recommendation-applications`, {
        variantId: offer.variantId, replaceLineKey: offer.replaceLineKey,
        expectedRevisionId: result.revisionId, expectedRowVersion: result.rowVersion,
      });
      await onApplied();
      setReload(n => n + 1);
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  async function dismiss(offer) {
    setBusy(offer.variantId); setError('');
    try {
      await api.post(`/quotes/${quoteId}/recommendation-dismissals`, { variantId: offer.variantId });
      setResult(old => ({ ...old, suggestions: old.suggestions.filter(o => o.variantId !== offer.variantId) }));
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  const offers = (result?.suggestions || []).filter(o => o.type === tab);
  const delta = value => `${Number(value) > 0 ? '+' : ''}${formatINR(value)}`;
  return <section className="insight-panel" aria-labelledby="recommendations-title">
    <div className="panel-heading"><div><span className="eyebrow">DEAL OPPORTUNITIES</span><h2 id="recommendations-title">Make this deal work harder</h2></div><TrendingUp size={22} className="text-teal-700" /></div>
    <div className="segmented-control" aria-label="Recommendation type">
      <button type="button" aria-pressed={tab === 'CROSS_SELL'} onClick={() => setTab('CROSS_SELL')}>Cross-sell · Add an item</button>
      <button type="button" aria-pressed={tab === 'UPSELL'} onClick={() => setTab('UPSELL')}>Upsell · Upgrade an item</button>
    </div>
    <p className="panel-caption">{tab === 'CROSS_SELL' ? 'Purchase patterns and catalog promotions, repriced for this customer.' : 'Higher-priced variants in an explicitly configured compatibility group.'}</p>
    {readOnly && <p className="notice">Viewing saved opportunities. Only the quote owner or admin can apply changes to an open deal.</p>}
    {dirty && <p className="notice">Save your current edits to refresh opportunities and apply an exact preview.</p>}
    {error && <p className="error-notice" role="alert">{error} <button type="button" onClick={() => setReload(n => n + 1)}>Retry</button></p>}
    {loading ? <div role="status" aria-label="Loading recommendations" className="space-y-3 py-4"><div className="h-16 bg-slate-100 rounded animate-pulse" /><div className="h-16 bg-slate-100 rounded animate-pulse" /></div> : <>
      {tab === 'CROSS_SELL' && result?.note && <p className="notice">{result.note}</p>}
      {!offers.length && <div className="panel-empty"><p>No eligible {tab === 'UPSELL' ? 'upgrades' : 'add-ons'} for this saved quote.</p><small>{tab === 'UPSELL' ? 'Admin can assign compatible variants to the same substitution group in the catalog.' : 'Add and save a product to start exploring relevant opportunities.'}</small></div>}
      <div className="opportunity-list">{offers.map(o => <article key={`${o.variantId}:${o.replaceLineKey || ''}`} className="opportunity">
        <div className="flex justify-between gap-3"><div><span className="evidence-tag">{o.basis === 'CO_PURCHASE' ? 'Purchase evidence' : o.basis === 'COMPATIBLE_UPGRADE' ? 'Compatible upgrade' : 'Catalog discovery'}</span><h3>{o.name}</h3></div><button type="button" aria-label={`Dismiss ${o.name}`} disabled={!!busy || dirty || readOnly} onClick={() => dismiss(o)} className="icon-button"><X size={16} /></button></div>
        <p>{o.reason}</p><div className="opportunity-metrics"><div><span>Unit price</span><strong>{formatINR(o.unitPrice)}</strong></div><div><span>Deal net change</span><strong>{delta(o.netDelta)}</strong></div><div><span>Contribution change</span><strong>{delta(o.contributionDelta)}</strong></div></div>
        <div className="opportunity-footer"><div><span className={o.inStock ? 'text-teal-700' : 'text-amber-700'}>{o.availabilityNote}</span><small>Margin {o.marginPercentDelta == null ? 'not available' : `${Number(o.marginPercentDelta).toFixed(2)} pp`} · Approval: {o.requiredApproval}</small></div><button type="button" className="button-primary" disabled={dirty || !!busy || readOnly} onClick={() => apply(o)}>{busy === o.variantId ? <RefreshCw size={14} className="animate-spin" /> : o.type === 'UPSELL' ? <ArrowUpRight size={14} /> : <Plus size={14} />}{o.type === 'UPSELL' ? 'Apply upgrade' : 'Add & save'}</button></div>
      </article>)}</div>
      {offers.length > 0 && <p className="panel-caption">Preview keeps existing quantities and discounts. Applying saves terms; normal approval and acceptance gates still apply.</p>}
    </>}
  </section>;
}
