import { useEffect, useId, useState } from 'react';
import { api } from '../../services/api';
import { catalogSchemas } from './catalogFields';

export function CatalogEditor({ products, variants, categories, plans, warehouses, onSaved }) {
  const [kind, setKind] = useState('products');
  const [recordId, setRecordId] = useState('');
  const [values, setValues] = useState({});
  const [prices, setPrices] = useState([]);
  const [variantFilter, setVariantFilter] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // A <select> nested inside its <label> pulls every <option> into the label's
  // text, so the control's accessible name came out as "Record type Product
  // Variant Tier price…". htmlFor/id gives an explicit association and the
  // aria-label on each select pins the name to the visible text alone.
  const uid = useId();
  const fieldId = (key) => `${uid}-${key}`;
  const schema = catalogSchemas[kind];
  const lists = { products, variants, categories, plans, warehouses, prices, recurringProducts: products.filter(p => p.chargeKind === 'RECURRING') };
  useEffect(() => {
    if (!variantFilter) { setPrices([]); return; }
    const abort = new AbortController();
    api.get(`/price-rules?variantId=${variantFilter}`, { signal: abort.signal }).then(setPrices).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [variantFilter]);
  function choose(nextKind, id = '') {
    const config = catalogSchemas[nextKind];
    const record = lists[nextKind]?.find(r => r.id === id);
    setKind(nextKind); setRecordId(id); setError(''); setNotice('');
    setValues(Object.fromEntries(config.fields.map(f => [f.key, record?.[f.key] ?? (f.type === 'checkbox' ? true : f.type === 'number' || f.type === 'money' ? '0' : '')])));
  }
  async function save(e) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const body = { currency: 'INR' };
      for (const f of schema.fields) {
        const v = values[f.key];
        body[f.key] = v === '' || v == null ? null : f.type === 'number' || f.key === 'intervalMonths' ? Number(v) : v;
      }
      if (body.attributesJson) { const parsed = JSON.parse(body.attributesJson); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Specifications must be a JSON object.'); }
      if (recordId) await api.patch(`${schema.endpoint}/${recordId}`, body);
      else await api.post(schema.endpoint, body);
      setNotice(`${schema.label} saved. New quote evaluations use the updated configuration.`); await onSaved();
      if (kind === 'prices' && variantFilter) setPrices(await api.get(`/price-rules?variantId=${variantFilter}`));
    } catch(e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <details className="insight-panel"><summary className="font-semibold text-sm cursor-pointer">Create &amp; edit catalog configuration</summary><form className="workspace-form mt-5" onSubmit={save}>
    <div className="grid sm:grid-cols-2 gap-4">
      <label htmlFor={fieldId('kind')}>Record type
        <select id={fieldId('kind')} aria-label="Record type" value={kind} onChange={e => choose(e.target.value)}>{Object.entries(catalogSchemas).map(([id,s]) => <option value={id} key={id}>{s.label}</option>)}</select>
      </label>
      {kind === 'prices' && <label htmlFor={fieldId('variantFilter')}>Load prices for variant
        <select id={fieldId('variantFilter')} aria-label="Load prices for variant" value={variantFilter} onChange={e => { setVariantFilter(e.target.value); setRecordId(''); }}><option value="">Select variant</option>{variants.map(v => <option value={v.id} key={v.id}>{v.name}</option>)}</select>
      </label>}
      <label htmlFor={fieldId('recordId')}>Existing record
        <select id={fieldId('recordId')} aria-label="Existing record" value={recordId} onChange={e => choose(kind,e.target.value)}><option value="">Create new {schema.label.toLowerCase()}</option>{!schema.createOnly && lists[kind]?.map(r => <option key={r.id} value={r.id}>{r.name || `${r.tier} · ${r.unitPrice} INR`}</option>)}</select>
      </label>
    </div>
    <div className="grid sm:grid-cols-2 gap-4">{schema.fields.map(f => {
      const choices = typeof f.options === 'string' ? lists[f.options] : f.options;
      return <label key={f.key} htmlFor={fieldId(f.key)}>{f.label}{f.type === 'select' ? <select id={fieldId(f.key)} aria-label={f.label} required={f.required} value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]:e.target.value }))}><option value="">Select…</option>{choices?.map(o => <option key={o.id || o} value={o.id || o}>{o.name || String(o).replaceAll('_',' ')}</option>)}</select> : <input id={fieldId(f.key)} required={f.required && f.type !== 'checkbox'} type={f.type === 'money' ? 'number' : f.type} min={['number','money'].includes(f.type) ? 0 : undefined} step={f.type === 'money' ? '.01' : undefined} checked={f.type === 'checkbox' ? values[f.key] ?? true : undefined} value={f.type === 'checkbox' ? undefined : values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v,[f.key]:f.type === 'checkbox' ? e.target.checked : e.target.value }))} />}</label>;
    })}</div>{error && <p role="alert" className="error-notice">{error}</p>}{notice && <p role="status" className="notice">{notice}</p>}<button className="button-primary" disabled={busy}>{busy ? 'Saving…' : recordId ? 'Save changes' : 'Create record'}</button>
  </form></details>;
}
