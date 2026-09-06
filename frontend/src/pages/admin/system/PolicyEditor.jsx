import { useEffect, useState } from 'react';
import { api, formatDateTime } from '../../../services/api';

const labels = { aggregateDiscountPercentAbove: 'Aggregate discount above (%)', aggregateMarginPercentBelow: 'Aggregate margin below (%)', worstLineExcessPpAtLeast: 'Worst line excess at least (percentage points)', weightedExcessPpAtLeast: 'Weighted excess at least (percentage points)', excessValueMinorAtLeast: 'Excess concession at least (paise)', anyPositiveExcess: 'Require manager for any positive excess', nonPositiveLineContribution: 'Require finance for non-positive line contribution' };
export function PolicyEditor() {
  const [definition,setDefinition] = useState(null);
  const [history,setHistory] = useState([]);
  const [note,setNote] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');
  async function load() { setError(''); try { const [c,h] = await Promise.all([api.get('/discount-policies/current'), api.get('/discount-policies')]); setDefinition(c.definition); setHistory(h); } catch(e) { setError(e.message); } }
  useEffect(() => { load(); }, []);
  async function publish(e) { e.preventDefault(); setBusy(true);setError(''); try { const result = await api.post('/discount-policies', { definition,note }); setNotice(`Published policy version ${result.versionNo}. Existing submitted revisions retain their snapshots.`);setNote('');await load(); } catch(e) { setError(e.message); } finally { setBusy(false); } }
  return <div className="workspace-page"><div className="workspace-page-header"><div><span className="eyebrow">COMMERCIAL GOVERNANCE</span><h1>Discount policy</h1><p>Versioned ceilings and explicit approval thresholds.</p></div><button className="button-secondary" onClick={load}>Reload policy</button></div>
    {error && <p role="alert" className="error-notice">{error}</p>}{notice && <p role="status" className="notice">{notice}</p>}
    {!definition && !error && <p role="status">Loading policy…</p>}
    {definition && <form className="workspace-form insight-panel" onSubmit={publish}>
      {[['tierCeilingPercent','Customer tier ceilings (%)'],['categoryCeilingPercent','Category ceilings (%)'],['manager','Manager triggers'],['finance','Finance triggers']].map(([section,title]) => <fieldset key={section}><legend className="font-semibold text-sm mb-3">{title}</legend><div className="grid sm:grid-cols-2 gap-4 mb-5">{Object.entries(definition[section]).map(([key,value]) => <label key={key}>{labels[key] || key}{typeof value === 'boolean' ? <input type="checkbox" checked={value} onChange={e => setDefinition(d => ({ ...d,[section]:{ ...d[section],[key]:e.target.checked } }))} /> : <input type="number" required min="0" max={key === 'excessValueMinorAtLeast' ? undefined : 100} step={key === 'excessValueMinorAtLeast' ? '1' : '.01'} value={value} onChange={e => setDefinition(d => ({ ...d,[section]:{ ...d[section],[key]:e.target.value === '' ? '' : Number(e.target.value) } }))} />}</label>)}</div></fieldset>)}
      <p className="panel-caption">Manager percentage limits are strict: above discount or below margin. Finance excess thresholds are inclusive (at least); margin is strictly below. Finance follows manager approval.</p>
      <label>Reason for the new version<textarea required maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label><button className="button-primary" disabled={busy}>Publish new policy version</button>
    </form>}
    <section className="insight-panel"><h2 className="font-semibold">Policy history</h2>{history.map(h => <p className="border-b py-3 text-xs" key={h.id}>Version {h.versionNo} · {formatDateTime(h.effectiveAt)} · {h.note || 'No note'} {h.current && '· Current'}</p>)}</section>
  </div>;
}
