import { useEffect, useState } from 'react';
import { Check, Play, RotateCcw, ArrowRight, GitBranch } from 'lucide-react';
import { stages } from './workflow';

export function WorkflowCanvas() {
  const [selected, setSelected] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [exception, setException] = useState(true);
  const stage = stages[selected];
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (selected === stages.length - 1) setPlaying(false);
      else setSelected(n => n === 2 && !exception ? 4 : n + 1);
    }, 1800);
    return () => clearTimeout(timer);
  }, [playing, selected, exception]);
  return <section id="how-it-works" className="landing-workflow landing-section" aria-labelledby="workflow-title">
    <div className="landing-section-heading"><div><span className="landing-kicker">THE DEAL, CONNECTED</span><h2 id="workflow-title">Follow the deal.<br />See the whole picture.</h2></div><p>Every handoff has an owner. Every change has a record. Explore the path from a first quote to a settled invoice.</p></div>
    <div className="workflow-shell">
      <div className="workflow-toolbar"><div><GitBranch size={17} /><strong>Quote-to-cash workflow</strong><span className="workflow-example">Interactive example</span></div><button type="button" onClick={() => { setSelected(0); setPlaying(p => !p); }}><Play size={14} />{playing ? 'Pause walkthrough' : 'Play walkthrough'}</button></div>
      <div className="workflow-body"><div className="workflow-main">
        <div className="workflow-scenario"><span>Approval path</span><button type="button" aria-pressed={!exception} onClick={() => { setException(false); setPlaying(false); setSelected(2); }}>Within policy</button><button type="button" aria-pressed={exception} onClick={() => { setException(true); setPlaying(false); setSelected(2); }}>Needs review</button></div>
        <div className="workflow-board" aria-label="Deal workflow stages">
          <svg className="workflow-wires" viewBox="0 0 1000 430" preserveAspectRatio="none" aria-hidden="true">
            <defs><marker id="workflow-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="currentColor" /></marker></defs>
            <path d="M220 120 H270 M460 120 H510 M700 120 H750 M845 155 V298 M750 320 H700 M510 320 H460 M270 320 H220" />
            {!exception && <path className="workflow-bypass" d="M607 152 V218 Q607 238 630 238 H822 Q845 238 845 260 V295" />}
            <path className="workflow-feedback" d="M750 345 H735 Q720 345 720 375 H130 Q110 375 110 345" />
          </svg>
          {stages.map((s, i) => { const Icon = s.icon; const skipped = i === 3 && !exception;
            return <button type="button" key={s.id} className={`workflow-node node-${s.id}${selected === i ? ' is-selected' : ''}${skipped ? ' is-skipped' : ''}`}
              aria-pressed={selected === i} onClick={() => { setSelected(i); setPlaying(false); }}>
              <span className="workflow-node-top"><span className="workflow-node-icon"><Icon size={20} /></span><span className="workflow-node-number">0{i + 1}</span></span>
              <strong>{s.title}</strong><small>{skipped ? 'Skipped when within policy' : s.subtitle}</small>
              <span className="node-port port-left" /><span className="node-port port-right" />
            </button>;
          })}
          <span className="workflow-loop-label">New terms → new revision → fresh approval</span>
        </div>
        <div className="workflow-legend"><span><i />Connected commercial records</span><span><RotateCcw size={12} />Revision loop</span><span>Click any step to inspect</span></div>
      </div><aside className="workflow-inspector" aria-live="polite" aria-atomic="true">
        <span className="landing-kicker">STEP 0{selected + 1} / 08</span><span className="inspector-icon"><stage.icon size={27} /></span>
        <h3>{stage.title}</h3><span className="workflow-owner">{stage.owner}</span><p>{!exception && selected === 3 ? 'This example is within policy, so no exception approval is required. Seller authorization and exact-version customer acceptance still apply.' : stage.detail}</p>
        <ul>{stage.evidence.map(item => <li key={item}><Check size={14} />{item}</li>)}</ul>
        <button type="button" onClick={() => { setPlaying(false); setSelected(n => n === 7 ? 0 : n === 2 && !exception ? 4 : n + 1); }}>Next step <ArrowRight size={15} /></button>
      </aside></div>
    </div>
    <p className="workflow-disclaimer">Illustrative walkthrough. This canvas explains the product; it does not change a quotation or run a payment.</p>
  </section>;
}
