import { useEffect, useRef, useState } from 'react';
import { api, formatINR, formatDate } from '../../services/api';
import { Modal } from '../common/Modal';

export function PlanSwitch({ subscription, onChanged }) {
  const [open,setOpen]=useState(false), [plans,setPlans]=useState([]), [planId,setPlanId]=useState('');
  const [preview,setPreview]=useState(null), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const key=useRef('');
  useEffect(() => {
    if(!open)return;
    const abort=new AbortController();setError('');setPreview(null);setPlanId('');key.current=crypto.randomUUID();
    api.get('/subscription-plans',{signal:abort.signal}).then(all => {
      const current=all.find(p => p.id===subscription.planId);
      setPlans(all.filter(p => p.active && p.productId===current?.productId && p.id!==subscription.planId && p.currency===subscription.currency));
    }).catch(e => {if(!abort.signal.aborted)setError(e.message);});
    return () => abort.abort();
  },[open,subscription.planId,subscription.currency]);
  async function run(commit=false) {
    setError('');setBusy(true);
    try {
      const path=`/subscriptions/${subscription.id}/${commit?'plan-changes':'plan-change-previews'}`;
      const body={newPlanId:planId,expectedRowVersion:preview?.rowVersion,note:'Plan switch confirmed by finance'};
      const result=commit?await api.postWithIdempotency(path,body,{headers:{'Idempotency-Key':key.current}}):await api.post(path,body);
      if(commit){setOpen(false);await onChanged();}else setPreview(result);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <><button className="button-secondary" disabled={subscription.status!=='ACTIVE'} onClick={() => setOpen(true)}>Switch plan</button>
    <Modal isOpen={open} onClose={() => {if(!busy)setOpen(false);}} title="Review a plan switch"><div className="workspace-form">
      <p className="panel-caption">Change the plan for {subscription.planName}. Current catalog pricing applies to the new plan; prior negotiated discounts are not silently carried over.</p>
      <label>New plan<select value={planId} onChange={e => {setPlanId(e.target.value);setPreview(null);key.current=crypto.randomUUID();}}><option value="">Select a compatible plan</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name} · {formatINR(p.intervalPrice)} / {p.intervalMonths} months</option>)}</select></label>
      {!plans.length && <p className="panel-caption">No other active plans for this product and currency.</p>}
      {error && <p role="alert" className="error-notice">{error}</p>}
      <button className="button-secondary" disabled={!planId||busy} onClick={() => run()}>Preview plan switch</button>
      {preview && <div className="notice space-y-2"><p>{preview.explanation}</p><p>Old coverage credit: {formatINR(preview.oldCreditNet)} + {formatINR(preview.oldCreditTax)} tax</p><p>New service charge: {formatINR(preview.newChargeNet)} + {formatINR(preview.newChargeTax)} tax</p><p>New coverage ends {formatDate(preview.coverageEnd)}. No money moves automatically.</p><button className="button-primary" disabled={busy} onClick={() => run(true)}>Confirm plan switch</button></div>}
    </div></Modal></>;
}
