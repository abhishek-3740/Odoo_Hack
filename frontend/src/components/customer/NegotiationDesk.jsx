import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, ArrowUpRight, TrendingDown, Package } from 'lucide-react';
import { api, formatDateTime, bpToPercent } from '../../services/api';
import { useDealEvents } from '../../hooks/useDealEvents';

const STATUS_STYLE = {
  OPEN: 'bg-amber-50 text-amber-800 border-amber-200',
  ANSWERED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ADOPTED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  DECLINED: 'bg-rose-50 text-rose-700 border-rose-200',
  SUPERSEDED: 'bg-slate-100 text-slate-600 border-slate-200',
};

/** The numbers a customer actually proposed, in the units they proposed them. */
function ProposedTerms({ payload, isLive }) {
  const orderBp = Number(payload?.requestedOrderDiscountBp) || 0;
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  if (!orderBp && lines.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-900">Proposed terms</span>
        {isLive && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-900 bg-white border border-amber-200 rounded px-1.5 py-0.5">
            On screen now
          </span>
        )}
      </div>
      {orderBp > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-amber-900">
          <TrendingDown className="w-3.5 h-3.5 shrink-0" />
          <span>
            Asked for <strong className="tabular-nums">{bpToPercent(orderBp)}%</strong> off the whole quotation
          </span>
        </p>
      )}
      {lines.map((line) => (
        <p key={line.lineKey} className="flex items-center gap-1.5 text-xs text-amber-900">
          <Package className="w-3.5 h-3.5 shrink-0" />
          <span>
            Line <span className="font-mono">{line.lineKey}</span>:{' '}
            {line.requestedDiscountBp != null && (
              <>
                <strong className="tabular-nums">{bpToPercent(line.requestedDiscountBp)}%</strong> off
              </>
            )}
            {line.quantity != null && <> at quantity <strong className="tabular-nums">{line.quantity}</strong></>}
          </span>
        </p>
      ))}
    </div>
  );
}

/**
 * The seller's side of the deal room.
 *
 * A refetch keeps the messages already on screen. The socket fallback polls
 * while disconnected, and blanking the thread on every tick made a live
 * conversation look like it was reloading under the reader.
 */
export function NegotiationDesk({ quoteId, refreshKey, currentRevisionId, canReply = true }) {
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const [messages, setMessages] = useState({});
  const [busy, setBusy] = useState('');
  const loadedRef = useRef(false);

  const bump = useCallback(() => setReload((n) => n + 1), []);
  useDealEvents((e) => !e.entityId || e.entityId === quoteId, bump);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api
      .get(`/quotes/${quoteId}/requests`, { signal: controller.signal })
      .then((rows) => {
        setRequests(Array.isArray(rows) ? rows : []);
        loadedRef.current = true;
        setLoaded(true);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
        // A failed refresh must not erase a thread that is already readable.
        if (!loadedRef.current) setLoaded(true);
      });
    return () => controller.abort();
  }, [quoteId, refreshKey, reload]);

  async function reply(id, decision) {
    const message = messages[id]?.trim();
    if (!message) return;
    setBusy(id);
    setError('');
    try {
      await api.post(`/quotes/${quoteId}/requests/${id}/responses`, { message, decision });
      setMessages((old) => ({ ...old, [id]: '' }));
      bump();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="insight-panel" aria-labelledby="negotiation-heading">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">DEAL ROOM</span>
          <h2 id="negotiation-heading">Keep the conversation moving</h2>
        </div>
        <MessageSquare size={20} />
      </div>
      <Link className="review-link" to={`/admin/reviews?quoteId=${quoteId}`}>
        Need a decision? Raise an internal review <ArrowUpRight size={15} />
      </Link>

      {error && (
        <p role="alert" className="error-notice">
          {error}
          <button type="button" onClick={bump}>
            Retry
          </button>
        </p>
      )}

      {!loaded ? (
        <div className="space-y-3 py-2" aria-busy="true" aria-label="Loading conversation">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <p className="panel-empty">Customer questions and counteroffers will appear here after sharing.</p>
      ) : (
        requests.map((r) => {
          const isLive = !!r.candidateRevisionId && r.candidateRevisionId === currentRevisionId;
          return (
            <article className="negotiation-entry" key={r.id}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <span className="flex items-center gap-2">
                  <span>
                    {r.raisedBy || 'Customer'} · {r.requestType}
                  </span>
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                      STATUS_STYLE[r.status] || STATUS_STYLE.OPEN
                    }`}
                  >
                    {r.status}
                  </span>
                </span>
                <span>{formatDateTime(r.createdAt)}</span>
              </div>

              <p className="whitespace-pre-wrap mt-2 text-sm">{r.message || 'Commercial change requested.'}</p>
              <ProposedTerms payload={r.payload} isLive={isLive} />

              {isLive && (
                <p className="mt-2 text-xs text-slate-600">
                  These terms are the current revision. Adopt or counter them from the panel at the top of this
                  quotation.
                </p>
              )}

              {r.responseMessage && (
                <blockquote>
                  <strong>Sales response{r.respondedBy ? ` · ${r.respondedBy}` : ''}</strong>
                  <p>{r.responseMessage}</p>
                </blockquote>
              )}

              {canReply && ['OPEN', 'ANSWERED'].includes(r.status) && (
                <form
                  className="workspace-form mt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    reply(r.id, 'ANSWERED');
                  }}
                >
                  <label className="sr-only" htmlFor={`reply-${r.id}`}>
                    Reply to customer
                  </label>
                  <textarea
                    id={`reply-${r.id}`}
                    rows={2}
                    maxLength={2000}
                    required
                    placeholder="Write a reply. Price changes must be saved as revised terms."
                    value={messages[r.id] || ''}
                    onChange={(e) => setMessages((old) => ({ ...old, [r.id]: e.target.value }))}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button className="button-secondary" disabled={!!busy || !messages[r.id]?.trim()}>
                      {busy === r.id ? 'Sending…' : 'Send reply'}
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={!!busy || !messages[r.id]?.trim()}
                      onClick={() => reply(r.id, 'DECLINED')}
                    >
                      Decline with reason
                    </button>
                  </div>
                </form>
              )}
            </article>
          );
        })
      )}
    </section>
  );
}
