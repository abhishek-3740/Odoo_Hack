import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatINR, formatDateTime } from '../../services/api';

const initial = { from:'', to:'', customerId:'', stage:'', categoryId:'', ownerProfileId:'' };
export function SalesReportPage() {
  const [filters,setFilters] = useState(initial);
  const [applied,setApplied] = useState('');
  const [data,setData] = useState(null);
  const [customers,setCustomers] = useState([]);
  const [categories,setCategories] = useState([]);
  const [reps,setReps] = useState([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function load(query = '') { setBusy(true);setError('');try { const r = await api.get(`/reports/sales?${query}`);setData(r);setApplied(query);if(!query) setReps(r.byRep); } catch(e) {setError(e.message);} finally {setBusy(false);} }
  useEffect(() => { load(); Promise.all([api.get('/customers?pageSize=100'),api.get('/categories')]).then(([c,g]) => {setCustomers(c.items);setCategories(g);}).catch(e => setError(e.message)); }, []);
  async function download(format) { setBusy(true);setError(''); try {await api.download(`/reports/sales/export?${applied}&format=${format}`,`dealflow-sales.${format}`);} catch(e) {setError(e.message);} finally{setBusy(false);} }
  return <div className="workspace-page"><div className="workspace-page-header"><div><span className="eyebrow">PERFORMANCE WITH CONTEXT</span><h1>Sales reports</h1><p>Separate sales, recurring value, invoices and recorded cash.</p></div></div>
    <form className="workspace-form insight-panel" onSubmit={e => {e.preventDefault();load(new URLSearchParams(Object.entries(filters).filter(([,v]) => v)).toString());}}><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <label>From date<input type="date" value={filters.from} onChange={e => setFilters(f => ({...f,from:e.target.value}))} /></label><label>To date (inclusive)<input type="date" min={filters.from} value={filters.to} onChange={e => setFilters(f => ({...f,to:e.target.value}))} /></label>
      {[["customerId","Customer",customers.map(c => [c.id,c.name])],["stage","Quotation stage",['DRAFT','REVIEW','SENT','UNDER_NEGOTIATION','CONFIRMED','LOST','EXPIRED','CANCELED'].map(v => [v,v])],["categoryId","Sales category",categories.map(c => [c.id,c.name])],["ownerProfileId","Salesperson",reps.map(r => [r.ownerProfileId,r.ownerName])]].map(([key,label,options]) => <label key={key}>{label}<select aria-label={label} value={filters[key]} onChange={e => setFilters(f => ({...f,[key]:e.target.value}))}><option value="">All within your access</option>{options.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>)}
    </div><p className="panel-caption">Dates: quote creation, order confirmation, invoice issue, payment recording. Category filters sales line breakdowns. Role/team access remains enforced by the server.</p><div className="flex flex-wrap gap-2"><button className="button-primary" disabled={busy}>Apply filters</button><button type="button" className="button-secondary" disabled={busy} onClick={() => {setFilters(initial);load();}}>Reset filters</button></div></form>
    {error && <p role="alert" className="error-notice">{error}</p>}{busy && <p role="status">Loading report…</p>}
    {data && <><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">{[['One-time sales',data.oneTimeSales],['Monthly recurring value',data.monthlyRecurringRevenue],['Invoiced revenue',data.invoicedRevenue],['Cash collected',data.cashCollected]].map(([label,value]) => <div className="insight-panel" key={label}><span className="panel-caption">{label}</span><strong className="block mt-2 text-xl">{formatINR(value)}</strong></div>)}</div>
      <section className="insight-panel"><div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">Current quotation revisions</h2><div className="flex gap-2">{['pdf','xlsx','xls'].map(f => <button key={f} className="button-secondary" disabled={busy} onClick={() => download(f)}>Export {f.toUpperCase()}</button>)}</div></div><p className="panel-caption">Generated {formatDateTime(data.generatedAt)} · {data.quotationCount} quotes · Outstanding {formatINR(data.outstandingReceivables)}</p>
      <div className="overflow-x-auto mt-4"><table className="min-w-full text-xs text-left"><thead><tr>{['Quotation','Customer','Stage','Approval','One-time net','Recurring first cycle'].map(h => <th className="py-3 pr-4" key={h}>{h}</th>)}</tr></thead><tbody>{data.quotations.map(q => <tr className="border-t" key={q.quoteId}><td className="py-3 pr-4"><Link className="underline" to={`/admin/sales/quotes/${q.quoteId}`}>{q.reference}</Link></td><td>{q.customerName}</td><td>{q.stage}</td><td>{q.approvalStatus}</td><td>{formatINR(q.oneTimeNet)}</td><td>{formatINR(q.recurringFirstCycleNet)}</td></tr>)}</tbody></table>{!data.quotations.length && <p className="panel-empty">No quotations match these filters.</p>}</div></section>
      <section className="insight-panel"><h2 className="font-semibold">Top products</h2>{data.topProducts.map(p => <div className="flex justify-between gap-4 border-b py-3 text-xs" key={p.productId}><span>{p.productName} · {p.quantity} units</span><strong>{formatINR(p.net)}</strong></div>)}</section>
    </>}
  </div>;
}
