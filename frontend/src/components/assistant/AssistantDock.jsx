import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bot, ArrowUp, X, RotateCcw, MessageSquare, ArrowUpRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api, generateIdempotencyKey } from '../../services/api';
import './assistant.css';

const prompts = {
  CUSTOMER: ['Explain my quote in plain language', 'Help me ask for a better price', 'What happens after I accept?'],
  REP: ['What should I do next on this deal?', 'Explain the margin and approval gates', 'When should I escalate a discount question?'],
  MANAGER: ['What is blocking this deal?', 'Explain the approval sequence', 'Help me review a discount exception'],
  FINANCE: ['Explain my outstanding receivables', 'What must happen before finance approval?', 'Explain these commercial terms'],
  ADMIN: ['Summarize my workspace', 'Which review cases need attention?', 'Explain the commercial controls'],
};

// The model sometimes replies with markdown; the dock renders plain text, so strip the markers.
function plainText(content) {
  return String(content ?? '')
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[\s(])[*_](?=\S)([^*_\n]*?\S)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^ {0,3}#{1,6} +/gm, '')
    .replace(/^ {0,3}[*+-] +/gm, '\u2022 ')
    .replace(/^ {0,3}> ?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function AssistantDock() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user || !/^\/(admin|customer)(\/|$)/.test(pathname)) return null;
  const quoteId = pathname.match(/\/quotes\/([0-9a-f-]{36})(?:\/|$)/i)?.[1] || null;
  return <AssistantConversation key={`${user.id || user.email}:${user.role}:${pathname}`} role={user.role} quoteId={quoteId} />;
}

function AssistantConversation({ role, quoteId }) {
  const dialog = useRef(null);
  const input = useRef(null);
  const end = useRef(null);
  const request = useRef(null);
  const handoffKey = useRef(generateIdempotencyKey());
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [handoff, setHandoff] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) { dialog.current?.showModal(); input.current?.focus(); }
    else dialog.current?.close();
  }, [open]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages, busy]);
  useEffect(() => () => request.current?.abort(), []);

  async function send(value = text) {
    const message = value.trim();
    if (!message || busy) return;
    setBusy(true); setError(''); setHandoff(''); setText(message);
    handoffKey.current = generateIdempotencyKey();
    request.current = new AbortController();
    const history = messages.slice(-8).map(m => ({ role: m.role, content: m.content.slice(0, 3000) }));
    try {
      const result = await api.post('/assistant/chat', { message, quoteId, history }, { signal: request.current.signal });
      setMessages(old => [...old, { role: 'user', content: message }, { role: 'assistant', content: result.answer, scope: result.scope, at: result.generatedAt }]);
      setText('');
    } catch (err) { if (err.name !== 'AbortError') setError(err.message); }
    finally { setBusy(false); }
  }

  async function askSalesperson() {
    const question = [...messages].reverse().find(m => m.role === 'user')?.content;
    if (!question || sending || handoff) return;
    setSending(true); setError('');
    try {
      const current = await api.get(`/portal/quotes/${quoteId}`);
      await api.post(`/portal/quotes/${quoteId}/requests`, {
        requestType: 'COMMENT', message: question, expectedRevisionId: current.revisionId,
      }, { headers: { 'Idempotency-Key': handoffKey.current } });
      setHandoff('Your question was sent to your salesperson. It is now in your deal room.');
      window.dispatchEvent(new CustomEvent('dealflow:negotiation-updated', { detail: { quoteId } }));
    } catch (err) { setError(err.message); }
    finally { setSending(false); }
  }

  return <>
    <button type="button" className="assistant-launcher" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <Bot size={20} /><span>Ask DealFlow</span><span className="assistant-key">AI</span>
    </button>
    <dialog ref={dialog} className="assistant-dialog" aria-modal="true" aria-labelledby="assistant-title" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
      <header className="assistant-header">
        <div className="assistant-mark"><Bot size={22} /></div>
        <div><h2 id="assistant-title">Your DealFlow assistant</h2><p>{quoteId ? 'This quotation' : `${role.toLowerCase()} workspace`} · Powered by Sarvam</p></div>
        <button type="button" className="assistant-icon" aria-label="Close assistant" onClick={() => setOpen(false)}><X size={20} /></button>
      </header>
      <div className="assistant-context"><span className="assistant-dot" /> Answers from your authorized workspace <button className="assistant-icon" aria-label="Clear conversation" disabled={busy} onClick={() => { setMessages([]); setError(''); setHandoff(''); }}><RotateCcw size={15} /></button></div>
      <section className="assistant-messages" aria-label="Conversation" aria-live="polite" aria-busy={busy}>
        {!messages.length && <div className="assistant-welcome">
          <span className="eyebrow">A CLEARER NEXT STEP</span><h3>Less searching.<br />More understanding.</h3>
          <p>Ask about your deals, review a decision, or prepare a negotiation. I’ll help explain what comes next.</p>
          <div className="assistant-prompts">{(prompts[role] || prompts.REP).map(prompt => <button type="button" key={prompt} disabled={busy} onClick={() => send(prompt)}>{prompt}<ArrowUpRight size={16} /></button>)}</div>
        </div>}
        {messages.map((m, i) => <article key={i} className={`assistant-message ${m.role}`}>
          <span>{m.role === 'user' ? 'You' : 'DealFlow assistant'}</span><p>{m.role === 'user' ? m.content : plainText(m.content)}</p>
          {m.at && <small>{m.scope} · {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>}
        </article>)}
        {busy && <div className="assistant-thinking" role="status">Reading your workspace…</div>}
        <div ref={end} />
      </section>
      {role === 'CUSTOMER' && quoteId && messages.length > 0 && <div className="assistant-handoff">
        {handoff ? <p role="status">{handoff}</p> : <button type="button" onClick={askSalesperson} disabled={sending || busy}><MessageSquare size={16} />{sending ? 'Sending…' : 'Send my last question to salesperson'}</button>}
      </div>}
      {error && <div className="assistant-error" role="alert">{error}{text.trim() && <button type="button" disabled={busy} onClick={() => send()}>Retry message</button>}</div>}
      <form className="assistant-composer" onSubmit={e => { e.preventDefault(); send(); }}>
        <label className="sr-only" htmlFor="assistant-message">Message your assistant</label>
        <textarea ref={input} id="assistant-message" rows={2} maxLength={2000} value={text} onChange={e => setText(e.target.value)} placeholder="Ask about your deal…" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button type="submit" aria-label="Send message" disabled={busy || !text.trim()}><ArrowUp size={19} /></button>
        <p>AI guidance can be mistaken. Review terms before acting. Chat never changes prices or approvals.</p>
      </form>
    </dialog>
  </>;
}
