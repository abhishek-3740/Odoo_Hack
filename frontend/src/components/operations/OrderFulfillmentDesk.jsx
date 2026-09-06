import { useCallback, useEffect, useState } from 'react';
import { api, formatINR, formatDate } from '../../services/api';
import { Modal } from '../common/Modal';
import { StatusBadge } from '../common/StatusBadge';

export function OrderFulfillmentDesk({ orderId, warehouses, onChanged }) {
  const [data, setData] = useState(null);
  const [lines, setLines] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [reason, setReason] = useState('');
  const [dispatch, setDispatch] = useState(null);
  const [tracking, setTracking] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const result = await api.get(`/orders/${orderId}/fulfillment`);
      setData(result);
      const rows = result.shipments.filter(s => s.status !== 'DISPATCHED').flatMap(s => s.lines.map(l => ({ orderLineId: l.orderLineId, description: l.description, warehouseId: s.warehouseId, quantity: l.quantity })));
      result.backorders.filter(b => b.status === 'OPEN').forEach(b => rows.push({ orderLineId: b.orderLineId, description: b.description, warehouseId: warehouses[0]?.id || '', quantity: b.quantity }));
      setLines(rows);
    } catch (e) { setError(e.message); }
  }, [orderId, warehouses]);
  useEffect(() => { load(); }, [load]);
  async function mutate(path, body) {
    setBusy(true); setError('');
    try { await api.post(path, body); setEdit(false); setDispatch(null); await load(); await onChanged(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4">
    {error && <p role="alert" className="error-notice">{error} <button onClick={load}>Reload</button></p>}
    {!data && !error && <p role="status">Loading fulfillment…</p>}
    {data && <><div className="flex flex-wrap gap-3 items-center"><StatusBadge status={data.fulfillmentStatus} /><span className="text-xs">{data.backorderTerms.replaceAll('_', ' ')}</span></div>
      {data.replanSuggested && <p className="notice">New stock is available. Replan to consolidate outstanding backorders.</p>}
      <div className="flex flex-wrap gap-2"><button className="button-primary" disabled={busy} onClick={() => mutate(`/orders/${orderId}/replans`, {})}>Replan unshipped stock</button><button className="button-secondary" disabled={busy || !lines.length} onClick={() => setEdit(v => !v)}>Manual warehouse split</button></div>
      {edit && <form className="workspace-form" onSubmit={e => { e.preventDefault(); mutate(`/orders/${orderId}/allocations`, { allocations: lines.map(({ orderLineId, warehouseId, quantity }) => ({ orderLineId, warehouseId, quantity })), reason }); }}>
        <p className="panel-caption">Enter exact allocations. Omitted quantities remain backordered only when agreed terms allow it. The server validates stock under locks.</p>
        {lines.map((l,i) => <div className="border p-3 rounded-lg space-y-2" key={i}><p className="text-xs font-semibold">{l.description}</p><label>Warehouse<select value={l.warehouseId} onChange={e => setLines(old => old.map((r,n) => n === i ? { ...r, warehouseId: e.target.value } : r))}>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label>Quantity<input required type="number" min="0.001" step="any" value={l.quantity} onChange={e => setLines(old => old.map((r,n) => n === i ? { ...r, quantity: e.target.value } : r))} /></label><div className="flex gap-2"><button type="button" className="button-secondary" onClick={() => setLines(old => [...old, { ...l }])}>Add another split</button><button type="button" className="button-secondary" onClick={() => setLines(old => old.filter((_,n) => n !== i))}>Remove split</button></div></div>)}
        <label>Reason<input required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label><button className="button-primary" disabled={busy || !lines.length}>Validate & save split</button>
      </form>}
      <h3 className="font-semibold text-sm">Shipments</h3>
      {!data.shipments.length && <p className="panel-caption">No reserved shipments. Review the backorders below.</p>}
      {data.shipments.map(s => <article className="border border-slate-200 rounded-lg p-4 space-y-2" key={s.id}><div className="flex justify-between gap-2"><strong className="text-sm">{s.warehouseName}</strong><StatusBadge status={s.status} /></div><ul className="text-xs space-y-1">{s.lines.map(l => <li key={l.id}>{l.description} × {l.quantity}</li>)}</ul><p className="panel-caption">Estimated shipping: {formatINR(s.estimatedCost)}{s.trackingReference && ` · Tracking: ${s.trackingReference}`}</p>{s.status === 'RESERVED' && <button className="button-primary" disabled={busy} onClick={() => { setTracking(''); setDispatch(s); }}>Dispatch shipment</button>}</article>)}
      <h3 className="font-semibold text-sm">Backorders</h3>{!data.backorders.length && <p className="panel-caption">No backorders.</p>}{data.backorders.map(b => <p className="notice" key={b.id}>{b.description} × {b.quantity} · {b.status} · {b.expectedDate ? formatDate(b.expectedDate) : 'Delivery date unconfirmed'}</p>)}
    </>}
    <Modal isOpen={!!dispatch} onClose={() => setDispatch(null)} title="Confirm shipment dispatch"><form className="workspace-form" onSubmit={e => { e.preventDefault(); mutate(`/shipments/${dispatch.id}/dispatches`, { trackingReference: tracking, note: 'Dispatched from operations workspace' }); }}><p className="panel-caption">Dispatch records these goods leaving {dispatch?.warehouseName} and reduces physical stock.</p><label>Tracking reference<input required maxLength={120} value={tracking} onChange={e => setTracking(e.target.value)} /></label>{error && <p role="alert" className="error-notice">{error}</p>}<button className="button-primary" disabled={busy}>Confirm dispatch</button></form></Modal>
  </div>;
}
