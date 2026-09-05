import { useState } from 'react';
import { api } from '../../services/api';

export function CompatibilityEditor({ variants, onSaved }) {
  const [selected, setSelected] = useState('');
  const [group, setGroup] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const variant = variants.find(v => v.id === selected);
  async function save(e) {
    e.preventDefault();
    if (!variant || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.patch(`/variants/${variant.id}`, { ...variant, substitutionGroup: group.trim() || null });
      setNotice('Compatibility group saved. Recommendations use it on the next refresh.');
      await onSaved();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="panel p-5 space-y-4" aria-labelledby="compatibility-title">
    <div><span className="eyebrow">RECOMMENDATION SETTINGS</span><h2 id="compatibility-title" className="text-lg font-semibold mt-1">Compatible upgrade groups</h2>
      <p className="text-sm text-slate-600 mt-1">Give interchangeable variants the same group. Higher-priced options can then appear as upgrades. Only group products that meet the same customer need; groups also guide stock substitutions.</p></div>
    <form onSubmit={save} className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
      <label className="field-label">Product variant<select required value={selected} disabled={busy} onChange={e => {
        setSelected(e.target.value); setGroup(variants.find(v => v.id === e.target.value)?.substitutionGroup || ''); setNotice('');
      }}><option value="">Choose a variant</option>{variants.map(v => <option key={v.id} value={v.id}>{v.name} · {v.sku}</option>)}</select></label>
      <label className="field-label">Compatibility group<input maxLength={60} value={group} disabled={!variant || busy} onChange={e => setGroup(e.target.value)} placeholder="e.g. business-laptop" /></label>
      <button type="submit" className="button-primary" disabled={!variant || busy}>{busy ? 'Saving…' : 'Save group'}</button>
    </form>
    {error && <p className="error-notice" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
  </section>;
}
