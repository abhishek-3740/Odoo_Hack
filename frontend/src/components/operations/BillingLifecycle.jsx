import { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatDate, formatINR } from '../../services/api';
import { Modal } from '../common/Modal';
import { PlanSwitch } from './PlanSwitch';

export function BillingLifecycle({ customerId, subscriptions, onChanged }) {
  const [credits, setCredits] = useState([]);
  const [payments, setPayments] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [policy, setPolicy] = useState('END_OF_PERIOD');
  const [busy, setBusy] = useState(false);
  const requestKey = useRef('');
  const load = useCallback(async () => {
    setError('');
    try { const [c,p] = await Promise.all([api.get(`/credit-notes?customerId=${customerId}&pageSize=100`), api.get(`/payments?customerId=${customerId}&pageSize=100`)]); setCredits(c.items); setPayments(p.items); }
    catch(e) { setError(e.message); }
  }, [customerId]);
  useEffect(() => { load(); }, [load, subscriptions]);
  function open(kind, item) { setAction({ kind, item }); setError(''); setSuccess(''); setReason(''); setReference(''); setAmount(item.available || ''); setPolicy('END_OF_PERIOD'); requestKey.current = crypto.randomUUID(); }
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const cancel = action.kind === 'cancel';
      const result = await api.postWithIdempotency(cancel ? `/subscriptions/${action.item.id}/cancellations` : '/refunds', cancel ? { policy, reason } : { creditNoteId: action.item.id, amount, method: 'BANK_TRANSFER', externalReference: reference, note: reason }, { headers: { 'Idempotency-Key': requestKey.current } });
      setAction(null); setSuccess(cancel ? `Cancellation recorded. ${result.explanation}` : `Refund ${result.reference} recorded. This action records a completed transfer; it does not send money.`);
      await load(); await onChanged();
    } catch(e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <details className="insight-panel"><summary className="font-semibold text-sm cursor-pointer">Subscription lifecycle, credits & payment history</summary>
    {error && !action && <p role="alert" className="error-notice">{error}</p>}{success && <p role="status" className="notice">{success}</p>}
    <div className="space-y-5 mt-5"><section><h3 className="font-semibold text-sm">Manage subscriptions</h3>{!subscriptions.length && <p className="panel-caption">No subscriptions for this customer.</p>}{subscriptions.map(s => <div className="flex flex-wrap items-center justify-between gap-2 border-b py-3 text-xs" key={s.id}><span>{s.planName} · {s.quantity} seats · {s.status}<small className="block mt-1">Current period ends {formatDate(s.periodEnd)}</small></span><PlanSwitch subscription={s} onChanged={onChanged} /><button className="button-secondary" disabled={busy || s.status !== 'ACTIVE'} onClick={() => open('cancel', s)}>Cancel subscription</button></div>)}</section>
    <section><h3 className="font-semibold text-sm">Credits</h3>{!credits.length && <p className="panel-caption">No credit notes. Credits appear after eligible subscription adjustments.</p>}{credits.map(c => <div className="border-b py-3 space-y-2 text-xs" key={c.id}><strong>{c.reference}</strong><p>{c.reason}</p><p>Total {formatINR(c.total)} · Applied {formatINR(c.applied)} · Refunded {formatINR(c.refunded)} · Available {formatINR(c.available)}</p>{Number(c.available) > 0 && <button className="button-secondary" onClick={() => open('refund', c)}>Record refund</button>}</div>)}</section>
    <section><h3 className="font-semibold text-sm">Recorded payments</h3>{!payments.length && <p className="panel-caption">No payment receipts recorded.</p>}{payments.map(p => <p className="border-b py-3 text-xs" key={p.id}>{p.reference} · Received {formatINR(p.amount)} · Allocated {formatINR(p.allocated)} · Unallocated {formatINR(p.unallocated)}</p>)}</section></div>
    <Modal isOpen={!!action} onClose={() => { if (!busy) setAction(null); }} title={action?.kind === 'cancel' ? 'Confirm subscription cancellation' : 'Record completed refund'}><form className="workspace-form" onSubmit={submit}>
      {error && <p role="alert" className="error-notice">{error}</p>}
      {action?.kind === 'cancel' ? <><p className="panel-caption">End-of-period keeps service through the paid period with no unused-time credit. Immediate cancellation credits eligible unused coverage, applies debt first, and never refunds money automatically.</p><label>Cancellation policy<select value={policy} onChange={e => { setPolicy(e.target.value); requestKey.current = crypto.randomUUID(); }}><option value="END_OF_PERIOD">End of period</option><option value="IMMEDIATE_PRORATED">Immediate with prorated credit</option></select></label></> : <><p className="panel-caption">Record money already returned to the customer. The backend checks paid, unrefunded eligibility.</p><label>Refund amount (INR)<input type="number" min="0.01" max={action?.item.available} step="0.01" required value={amount} onChange={e => { setAmount(e.target.value); requestKey.current = crypto.randomUUID(); }} /></label><label>Bank transfer reference<input required maxLength={120} value={reference} onChange={e => { setReference(e.target.value); requestKey.current = crypto.randomUUID(); }} /></label></>}
      <label>Reason<textarea required maxLength={500} value={reason} onChange={e => { setReason(e.target.value); requestKey.current = crypto.randomUUID(); }} /></label><button className="button-primary" disabled={busy}>{busy ? 'Saving…' : 'Confirm & record'}</button>
    </form></Modal>
  </details>;
}
