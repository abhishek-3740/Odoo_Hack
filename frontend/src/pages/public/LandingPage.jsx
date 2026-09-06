import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check, GitBranch, Layers, Menu, X, ShieldCheck, Sparkles, MessageSquare, PackageCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { WorkflowCanvas } from '../../components/landing/WorkflowCanvas';
import './landing.css';

const roles = [
  { name: 'Sales', heading: 'Spend less time chasing. More time closing.', text: 'Build mixed quotes, explain every concession, and discover the right add-on while the conversation is still moving.', tasks: ['Customer-specific quotes', 'Cross-sell and compatible upgrades', 'Finance and policy escalation'] },
  { name: 'Managers', heading: 'The context behind every decision.', text: 'See the rule that triggered a review, understand the concession, and keep your team’s stalled deals moving.', tasks: ['Sequential approval queue', 'Discount and margin reasons', 'Deal health and nudges'] },
  { name: 'Finance', heading: 'Keep the promise. Keep the numbers right.', text: 'Move from approved terms to invoices, prorated adjustments, recorded payments and a clear outstanding balance.', tasks: ['One-time and recurring invoices', 'Calendar-based quantity changes', 'Credits and recorded settlements'] },
  { name: 'Customers', heading: 'A conversation, with everything in view.', text: 'Browse the catalog, request a quote, explore upgrades and discuss your terms in one private deal room.', tasks: ['Product and plan catalog', 'Line-level negotiation', 'Accept the exact terms you reviewed'] },
  { name: 'Admin', heading: 'Set the rules. Give your team room to work.', text: 'Keep products, pricing and approval policies consistent, with traceable reviews and role-aware assistance.', tasks: ['Catalog and policy configuration', 'Compatible upgrade groups', 'Reporting and operational visibility'] },
];

function LandingNav() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const workspace = user?.role === 'CUSTOMER' ? '/customer' : '/admin';
  return <header className="landing-nav"><Link className="landing-logo" to="/" aria-label="DealFlow360 home"><span><GitBranch size={20} /></span>DealFlow<span className="logo-360">360</span></Link>
    <button type="button" className="landing-menu" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="landing-navigation" onClick={() => setOpen(v => !v)}>{open ? <X /> : <Menu />}</button>
    <nav id="landing-navigation" aria-label="Main navigation" className={open ? 'is-open' : ''} onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}>
      <a href="#product" onClick={() => setOpen(false)}>Product</a><a href="#how-it-works" onClick={() => setOpen(false)}>How it works</a><a href="#teams" onClick={() => setOpen(false)}>For your team</a><Link to="/catalog">Catalogue</Link>
      {user ? <Link className="landing-button dark small" to={workspace}>Open workspace <ArrowUpRight size={15} /></Link> : <><Link to="/login">Sign in</Link><Link className="landing-button dark small" to="/signup">Get started <ArrowUpRight size={15} /></Link></>}
    </nav></header>;
}

export function LandingPage() {
  const [role, setRole] = useState(0);
  return <div className="landing-page"><a href="#landing-main" className="skip-link">Skip to content</a><LandingNav />
    <main id="landing-main">
      <section className="landing-hero landing-section" id="product">
        <div className="hero-copy"><span className="landing-kicker"><span className="landing-dot" /> THE CONNECTED DEAL WORKSPACE</span>
          <h1>Good deals deserve<br />a better <em>flow.</em></h1>
          <p>From the first quote to the final payment. Bring sales, approvals, fulfillment and billing into one clear conversation.</p>
          <div className="landing-actions"><Link to="/login" className="landing-button dark">Explore the workspace <ArrowUpRight size={17} /></Link><a href="#how-it-works" className="landing-button outline">Follow a deal <ArrowRight size={17} /></a></div>
          <div className="hero-proof"><span><Check size={14} />Hardware</span><span><Check size={14} />Services</span><span><Check size={14} />Subscriptions</span></div>
        </div>
        <div className="hero-deal" aria-label="Illustrative DealFlow quotation">
          <div className="hero-deal-top"><span><Layers size={16} /> DEAL OVERVIEW</span><span className="sample-label">Sample deal</span></div>
          <div className="hero-deal-heading"><span className="company-avatar">A</span><div><h2>Acme workspace refresh</h2><p>Hardware, setup & ongoing support</p></div><span className="hero-status">In review</span></div>
          <div className="hero-line"><span><span className="mini-device">▰</span>Business laptops</span><strong>10 units</strong></div>
          <div className="hero-line"><span><PackageCheck size={18} />Team onboarding</span><strong>1 service</strong></div>
          <div className="hero-line"><span><MessageSquare size={18} />Priority support</span><strong>Monthly</strong></div>
          <div className="hero-recommendation"><span className="hero-recommendation-icon"><Sparkles size={19} /></span><div><strong>A more complete setup</strong><p>Add compatible docks to this workspace.</p></div><ArrowUpRight size={18} /></div>
          <div className="hero-handoff"><span className="avatar-stack"><i>S</i><i>M</i><i>F</i></span><span>One deal. Everyone in sync.</span><ShieldCheck size={17} /></div>
          <div className="hero-note"><span><Check size={16} /></span><div><strong>Every change, accounted for.</strong><small>Versioned terms. Clear decisions.</small></div></div>
        </div>
      </section>
      <div className="landing-ribbon"><span>LESS FOLLOW-UP. MORE FORWARD.</span><p>Quote <ArrowRight /> Approve <ArrowRight /> Fulfill <ArrowRight /> Invoice <ArrowRight /> Settle</p></div>
      <WorkflowCanvas />
      <section className="landing-section landing-principles"><div><span className="landing-kicker">BUILT AROUND THE DEAL</span><h2>Complex behind the scenes.<br /><em>Clear at every step.</em></h2></div><div className="principle-list">
        {[['01', 'Better suggestions. Clear reasons.', 'Useful add-ons and compatible upgrades, explained through purchase patterns and catalog rules. No mystery score.'], ['02', 'Room to negotiate. Rules that hold.', 'Customer conversations stay connected to exact quote versions. Every changed term follows the right approval path.'], ['03', 'One promise, through to payment.', 'Accepted terms carry into stock reservations, recurring schedules and invoices. Your team works from the same record.']].map(([n,h,p]) => <article key={n}><span>{n}</span><div><h3>{h}</h3><p>{p}</p></div></article>)}
      </div></section>
      <section id="teams" className="landing-section landing-teams"><div className="landing-section-heading"><div><span className="landing-kicker">ONE WORKSPACE. DIFFERENT PERSPECTIVES.</span><h2>A shared deal.<br />A focused view for everyone.</h2></div><p>Each role gets the context and controls it needs, including an assistant to help explain the next step.</p></div>
        <div className="role-buttons" aria-label="Explore team roles">{roles.map((r,i) => <button key={r.name} type="button" aria-pressed={role === i} onClick={() => setRole(i)}>{r.name}</button>)}</div>
        <div className="role-content" aria-live="polite"><div><span className="landing-kicker">FOR {roles[role].name.toUpperCase()}</span><h3>{roles[role].heading}</h3><p>{roles[role].text}</p><Link to="/login">Step into your workspace <ArrowUpRight size={16} /></Link></div><ul>{roles[role].tasks.map((t,i) => <li key={t}><span>0{i + 1}</span>{t}<Check size={17} /></li>)}</ul></div>
      </section>
      <section className="landing-section landing-cta"><GitBranch size={30} /><h2>Keep your next deal moving.</h2><p>Your catalog, your team, one connected flow.</p><Link to="/catalog" className="landing-button light">Explore the catalogue <ArrowUpRight size={18} /></Link></section>
    </main><footer className="landing-footer"><Link to="/" className="landing-logo"><GitBranch size={19} />DealFlow360</Link><span>From quote to cash, with clarity.</span><Link to="/login">Sign in <ArrowUpRight size={13} /></Link><small>© 2026 DealFlow360</small></footer>
  </div>;
}
