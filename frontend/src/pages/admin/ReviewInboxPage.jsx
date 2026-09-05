import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, CheckCircle2, Plus, RefreshCw, Inbox } from 'lucide-react';
import { api, formatDateTime, generateIdempotencyKey } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../../components/common/Modal';

const categories = { DISCOUNT: 'Discount or pricing ambiguity → Finance', POLICY: 'Policy exception or unclear rule → Admin', REVIEW: 'Sales review or commercial question → Manager' };
export function ReviewInboxPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [items, setItems] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('OPEN');
  const [open, setOpen] = useState(false);
  const [quoteId, setQuoteId] = useState(params.get('quoteId') || '');
  const [quote, setQuote] = useState(null);
  const [category, setCategory] = useState('DISCOUNT');
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState(null);
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const requestKey = useRef(generateIdempotencyKey());
  const load = useCallback(async () => {
    setError(''); setLoading(true);
    try {
      const [cases, quotationPage] = await Promise.all([api.get('/escalations'), api.get('/quotes?pageSize=100')]);
      setItems(cases); setQuotes(quotationPage.items || quotationPage.content || []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setQuote(null);
    if (!quoteId) return;
    const controller = new AbortController();
    api.get(`/quotes/${quoteId}`, { signal: controller.signal }).then(setQuote)
      .catch(err => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [quoteId, open]);
  useEffect(() => { requestKey.current = generateIdempotencyKey(); }, [quoteId, category, reason]);
  async function create(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api.post('/escalations', { quoteId, expectedRevisionId: quote.revisionId, requestKey: requestKey.current, category, reason });
      setOpen(false); setReason(''); await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function resolve(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api.post(`/escalations/${selected.id}/resolutions`, { resolution });
      setSelected(null); setResolution(''); await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const visible = items.filter(i => filter === 'ALL' || i.status === filter);
  return <div className="workspace-page">
    <header className="workspace-page-header"><div><span className="eyebrow">COMMERCIAL COLLABORATION</span><h1>Review inbox</h1><p>Bring the right people into the conversation. Keep every decision traceable.</p></div><button type="button" className="button-primary" onClick={() => setOpen(true)}><Plus size={16} />Raise a review</button></header>
    <div className="review-summary"><Inbox size={20} /><strong>{items.filter(i => i.status === 'OPEN').length}</strong><span>open cases in your accessible inbox</span><button type="button" className="icon-button" aria-label="Refresh review inbox" onClick={load}><RefreshCw size={16} /></button></div>
    {error && <p className="error-notice" role="alert">{error}</p>}
    <div className="segmented-control">{['OPEN', 'RESOLVED', 'ALL'].map(status => <button key={status} type="button" aria-pressed={filter === status} onClick={() => setFilter(status)}>{status === 'ALL' ? 'All cases' : status === 'OPEN' ? 'Needs review' : 'Resolved'}</button>)}</div>
    <section className="review-list" aria-label="Review cases" aria-busy={loading}>
      {loading ? <p className="panel-empty" role="status">Loading review cases…</p> : !visible.length ? <div className="panel-empty"><CheckCircle2 size={28} /><h2>Nothing waiting here</h2><p>New review requests will appear here with their assigned team.</p></div> : visible.map(item => <article key={item.id} className="review-case">
        <div className="review-case-top"><Link to={`/admin/sales/quotes/${item.quoteId}`}>{item.reference}<ArrowUpRight size={15} /></Link><span className="evidence-tag">{item.targetRole}</span><span className="text-xs text-slate-500">{item.status}</span></div>
        <h2>{categories[item.category]?.split(' → ')[0]}</h2><p className="whitespace-pre-wrap">{item.reason}</p>
        {item.resolution && <blockquote><strong>Resolution</strong><p>{item.resolution}</p></blockquote>}
        <div className="opportunity-footer"><small>Raised {formatDateTime(item.createdAt)}</small>{item.status === 'OPEN' && (user.role === 'ADMIN' || user.role === item.targetRole) && <button type="button" className="button-secondary" onClick={() => { setSelected(item); setResolution(''); }}>Record resolution</button>}</div>
      </article>)}
    </section>
    <p className="panel-caption">Review resolutions are guidance. Commercial changes still require a revised quote and the applicable approval sequence.</p>
    <Modal isOpen={open} onClose={() => { if (!busy) setOpen(false); }} title="Bring in a reviewer" subtitle="Route an unclear commercial decision to the right team.">
      <form className="workspace-form" onSubmit={create}>
        <label>Quotation<select required value={quoteId} onChange={e => setQuoteId(e.target.value)}><option value="">Choose a quotation</option>{quotes.map(q => <option key={q.id} value={q.id}>{q.reference} · {q.customerName}</option>)}</select></label>
        <label>What needs attention?<select value={category} onChange={e => setCategory(e.target.value)}>{Object.entries(categories).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <label>Context for your reviewer<textarea required maxLength={2000} rows={4} value={reason} onChange={e => setReason(e.target.value)} placeholder="Describe the request, what is unclear, and the decision you need." /></label>
        {error && <p className="error-notice" role="alert">{error}</p>}
        <button className="button-primary" disabled={busy || !quote || !reason.trim()}>{busy ? 'Submitting…' : 'Send for review'}</button>
      </form>
    </Modal>
    <Modal isOpen={!!selected} onClose={() => { if (!busy) setSelected(null); }} title={`Resolve ${selected?.reference || 'case'}`} subtitle="Record clear advice for the salesperson. This does not approve a discount.">
      <form className="workspace-form" onSubmit={resolve}><label>Resolution<textarea required rows={4} maxLength={2000} value={resolution} onChange={e => setResolution(e.target.value)} /></label>{error && <p className="error-notice" role="alert">{error}</p>}<button className="button-primary" disabled={busy || !resolution.trim()}>{busy ? 'Saving…' : 'Resolve case'}</button></form>
    </Modal>
  </div>;
}
