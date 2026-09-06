import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, PackagePlus } from 'lucide-react';
import { api, formatINR } from '../../services/api';

export function CustomerRecommendations({ quoteId, revisionId, onRequested }) {
  const [result, setResult] = useState(null);
  const [type, setType] = useState('CROSS_SELL');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState([]);
  const [reload, setReload] = useState(0);
  const keys = useRef(new Map());
  useEffect(() => {
    const abort = new AbortController();
    setResult(null); setError(''); setSent([]); keys.current.clear();
    api.get(`/portal/quotes/${quoteId}/recommendations`, { signal: abort.signal })
      .then(setResult).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [quoteId, revisionId, reload]);
  async function request(offer) {
    const id = `${offer.variantId}:${offer.replaceLineKey || ''}`;
    if (!keys.current.has(id)) keys.current.set(id, crypto.randomUUID());
    setBusy(true); setError('');
    try {
      await api.postWithIdempotency(`/portal/quotes/${quoteId}/recommendation-requests`, {
        variantId: offer.variantId, replaceLineKey: offer.replaceLineKey, expectedRevisionId: result.revisionId,
      }, { headers: { 'Idempotency-Key': keys.current.get(id) } });
      setSent(old => [...old, id]); await onRequested();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section className="insight-panel" aria-labelledby="customer-offers-title">
    <div className="panel-heading"><div><span className="eyebrow">TAILORED TO YOUR QUOTE</span><h2 id="customer-offers-title">A better fit for your team</h2></div><PackagePlus className="text-teal-700" /></div>
    <div className="segmented-control" aria-label="Customer recommendations">
      <button type="button" aria-pressed={type === 'CROSS_SELL'} onClick={() => setType('CROSS_SELL')}>Cross-sell · Add-ons</button>
      <button type="button" aria-pressed={type === 'UPSELL'} onClick={() => setType('UPSELL')}>Upsell · Upgrades</button>
    </div>
    <p className="panel-caption">Request an option for your salesperson to review. Your quote stays unchanged until revised terms are shared and accepted. Price changes below exclude tax.</p>
    {error && <p role="alert" className="error-notice">{error} <button type="button" onClick={() => setReload(n => n + 1)}>Refresh offers</button></p>}
    {!result && !error && <p role="status" className="notice">Finding options for your quotation…</p>}
    {result?.limitedHistory && <p className="panel-caption">Catalog suggestions based on limited purchase history.</p>}
    {result && !result.suggestions.some(o => o.type === type) && <p className="panel-empty">No eligible {type === 'UPSELL' ? 'upgrades' : 'add-ons'} for this quotation.</p>}
    <div className="opportunity-list">{result?.suggestions.filter(o => o.type === type).map(o => {
      const id = `${o.variantId}:${o.replaceLineKey || ''}`;
      return <article className="opportunity" key={id}><h3>{o.name}</h3>
        <div className="opportunity-metrics"><div><span>Unit price</span><strong>{formatINR(o.unitPrice)}</strong></div><div><span>Quote net change</span><strong>{formatINR(o.netDelta)}</strong></div></div>
        <div className="opportunity-footer"><span>{o.availabilityNote}</span><button type="button" className="button-primary" disabled={busy || sent.includes(id)} onClick={() => request(o)}><ArrowUpRight size={15} />{sent.includes(id) ? 'Request sent' : o.type === 'UPSELL' ? 'Request upgrade' : 'Request add-on'}</button></div>
      </article>;
    })}</div>
    {sent.length > 0 && <p className="notice" role="status">Request sent to your salesperson. Follow the discussion in your deal room.</p>}
  </section>;
}
