import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, ArrowUpRight } from 'lucide-react';
import { api, formatDateTime } from '../../services/api';
import { useDealEvents } from '../../hooks/useDealEvents';

export function NegotiationDesk({ quoteId, refreshKey, canReply = true }) {
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [messages, setMessages] = useState({});
  const [busy, setBusy] = useState('');
  // Reload when a relevant deal event arrives for this quote.
  // useDealEvents keeps the handler in a ref so changing quoteId
  // or reload does not create a new subscription on every render.
  useDealEvents(
    (e) => e.entityId === quoteId,
    () => setReload((n) => n + 1)
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api.get(`/quotes/${quoteId}/requests`, { signal: controller.signal }).then(setRequests)
      .catch(err => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [quoteId, refreshKey, reload]);
  async function reply(e, id) {
    e.preventDefault(); setBusy(id); setError('');
    try {
      await api.post(`/quotes/${quoteId}/requests/${id}/responses`, { message: messages[id], decision: 'ANSWERED' });
      setMessages(old => ({ ...old, [id]: '' })); setReload(n => n + 1);
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  return <section className="insight-panel" aria-labelledby="negotiation-heading">
    <div className="panel-heading"><div><span className="eyebrow">DEAL ROOM</span><h2 id="negotiation-heading">Keep the conversation moving</h2></div><MessageSquare size={20} /></div>
    <Link className="review-link" to={`/admin/reviews?quoteId=${quoteId}`}>Need a decision? Raise an internal review <ArrowUpRight size={15} /></Link>
    {error && <p role="alert" className="error-notice">{error}<button onClick={() => setReload(n => n + 1)}>Retry</button></p>}
    {loading ? <p role="status" className="panel-empty">Loading conversation…</p> : !requests.length ? <p className="panel-empty">Customer questions and counteroffers will appear here after sharing.</p> : requests.map(r => <article className="negotiation-entry" key={r.id}>
      <div className="flex justify-between text-xs text-slate-500"><span>{r.raisedBy || 'Customer'} · {r.requestType}</span><span>{formatDateTime(r.createdAt)}</span></div>
      <p className="whitespace-pre-wrap mt-2 text-sm">{r.message || 'Commercial change requested.'}</p>
      {r.responseMessage && <blockquote><strong>Sales response</strong><p>{r.responseMessage}</p></blockquote>}
      {canReply && ['OPEN', 'ANSWERED'].includes(r.status) && <form className="workspace-form mt-3" onSubmit={e => reply(e, r.id)}>
        <label className="sr-only" htmlFor={`reply-${r.id}`}>Reply to customer</label><textarea id={`reply-${r.id}`} rows={2} maxLength={2000} required placeholder="Write a reply. Price changes must be saved as revised terms." value={messages[r.id] || ''} onChange={e => setMessages(old => ({ ...old, [r.id]: e.target.value }))} />
        <button className="button-secondary" disabled={!!busy || !messages[r.id]?.trim()}>{busy === r.id ? 'Sending…' : 'Send reply'}</button>
      </form>}
    </article>)}
  </section>;
}
