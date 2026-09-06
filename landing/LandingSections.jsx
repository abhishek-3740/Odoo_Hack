import React from 'react';
import {
  ShoppingBag,
  MessageSquare,
  FileCheck,
  Zap,
  ShieldCheck,
  Coins,
  Boxes,
  Fingerprint,
  Scale,
} from 'lucide-react';
import { useReveal, trackCardPointer } from './useReveal';

function Eyebrow({ children }) {
  return (
    <p className="mb-4 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-400">
      {children}
    </p>
  );
}

function SectionHeading({ eyebrow, title, blurb }) {
  return (
    <>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="max-w-2xl text-[2.1rem] font-bold leading-[1.1] tracking-[-0.03em] text-white sm:text-5xl">
        {title}
      </h2>
      {blurb ? (
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-slate-400">{blurb}</p>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Product value                                                              */
/* -------------------------------------------------------------------------- */
const VALUES = [
  {
    icon: ShoppingBag,
    title: 'One catalogue, no price ping-pong',
    text: 'Hardware, services and subscriptions live in a single catalogue. Tier pricing is resolved server-side, so a buyer sees their terms and never your cost.',
  },
  {
    icon: MessageSquare,
    title: 'Negotiation happens on the line',
    text: 'Customers comment on individual lines and counter discounts in the deal room. Every counter-offer becomes a versioned revision that is re-evaluated against current policy.',
  },
  {
    icon: Scale,
    title: 'Approval that explains itself',
    text: 'Each required approval names the rule, the line it came from, the number observed and the ceiling it crossed — so a reviewer acts on evidence, not a red badge.',
  },
  {
    icon: Coins,
    title: 'Billing that matches the deal',
    text: 'Calendar-month subscriptions, prorated mid-cycle changes, and cancellation credits capped at money actually received. No clawback on bundled hardware.',
  },
];

export function ProductValue() {
  const [ref, visible] = useReveal();

  return (
    <section id="product" className="relative scroll-mt-20 py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div
          ref={ref}
          className={`transition-all duration-700 ${
            visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
          }`}
        >
          <SectionHeading
            eyebrow="Product"
            title="Built for the way enterprise deals actually close."
            blurb="A quotation is not a PDF. It is a governed object that survives pricing, negotiation, approval, stock and billing without being retyped once."
          />
        </div>

        <div className="mt-16 grid gap-x-12 gap-y-14 md:grid-cols-2">
          {VALUES.map((v, i) => {
            const Icon = v.icon;
            return (
              <div
                key={v.title}
                className="group"
                style={{
                  transitionDelay: `${i * 70}ms`,
                  opacity: visible ? 1 : 0,
                  transform: visible ? 'translateY(0)' : 'translateY(22px)',
                  transition: 'opacity 0.7s ease, transform 0.7s ease',
                }}
              >
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg border border-indigo-500/25 bg-indigo-500/10 text-indigo-300 transition-colors group-hover:border-indigo-400/50 group-hover:bg-indigo-500/20">
                  <Icon className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <h3 className="mb-3 text-xl font-semibold leading-snug text-white">
                  {v.title}
                </h3>
                <p className="text-[15px] leading-relaxed text-slate-400">{v.text}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* How it works                                                               */
/* -------------------------------------------------------------------------- */
const STEPS = [
  {
    num: '01',
    title: 'Browse',
    text: 'Pick hardware, services and subscriptions from the live catalogue and request a formal quotation in seconds.',
    icon: ShoppingBag,
  },
  {
    num: '02',
    title: 'Negotiate',
    text: 'Comment on any line or counter a discount. The rep answers in the same deal room; every counter-offer is a re-evaluated revision.',
    icon: MessageSquare,
  },
  {
    num: '03',
    title: 'Approve',
    text: 'A blended risk score routes the deal to Manager, then Finance, with an audit trail of who decided what and why.',
    icon: ShieldCheck,
  },
  {
    num: '04',
    title: 'Confirm',
    text: 'The customer accepts the exact version they reviewed. One transaction finalises order, stock reservation and first invoice.',
    icon: FileCheck,
  },
];

export function HowItWorks() {
  const [ref, visible] = useReveal();

  return (
    <section id="how-it-works" className="relative scroll-mt-20 py-24 lg:py-32">
      <hr className="ld-rule absolute inset-x-0 top-0" />
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div
          ref={ref}
          className={`transition-all duration-700 ${
            visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
          }`}
        >
          <SectionHeading
            eyebrow="How it works"
            title="Four steps, one chain of custody."
            blurb="From first browse to a booked order, nothing leaves the system — and nothing is re-keyed."
          />
        </div>

        <ol className="relative mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <li
                key={step.num}
                className="ld-card group p-7" onMouseMove={trackCardPointer}
                style={{
                  transitionDelay: `${i * 90}ms`,
                  opacity: visible ? 1 : 0,
                  transform: visible ? 'translateY(0)' : 'translateY(24px)',
                }}
              >
                <div className="mb-8 flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-500/25 bg-indigo-500/10 text-indigo-300">
                    <Icon className="h-4 w-4" strokeWidth={1.9} />
                  </span>
                  <span className="font-mono text-3xl font-bold tabular-nums text-white/[0.07] transition-colors group-hover:text-indigo-400/20">
                    {step.num}
                  </span>
                </div>
                <h3 className="mb-2.5 text-lg font-semibold text-white">{step.title}</h3>
                <p className="text-sm leading-relaxed text-slate-400">{step.text}</p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Capabilities — bento                                                       */
/* -------------------------------------------------------------------------- */

/** The four risk inputs, exactly as RiskModel computes them. */
const RISK_INPUTS = [
  { key: 'M', name: 'Worst line excess', value: '4.0 pp', note: 'single line over its ceiling' },
  { key: 'W', name: 'Value-weighted excess', value: '0.18', note: 'concession share, not a probability' },
  { key: 'E', name: 'Excess money', value: '₹23,520', note: 'conceded beyond ceilings' },
  { key: 'D', name: 'Aggregate discount', value: '11.4%', note: 'across the whole quotation' },
];

export function FeatureShowcase() {
  const [ref, visible] = useReveal();

  return (
    <section id="capabilities" className="relative scroll-mt-20 py-24 lg:py-32">
      <hr className="ld-rule absolute inset-x-0 top-0" />
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div
          ref={ref}
          className={`transition-all duration-700 ${
            visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
          }`}
        >
          <SectionHeading
            eyebrow="Capabilities"
            title="The hard parts, built properly."
            blurb="Discount governance, allocation, hybrid billing and audit are enforced in the backend — not approximated in the browser."
          />
        </div>

        <div
          className="mt-16 grid gap-5 lg:grid-cols-3"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(24px)',
            transition: 'opacity 0.8s ease 0.1s, transform 0.8s ease 0.1s',
          }}
        >
          {/* Risk engine — hero tile */}
          <div className="ld-card ld-grid flex flex-col p-8 lg:col-span-2 lg:row-span-2" onMouseMove={trackCardPointer}>
            <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-lg border border-indigo-500/25 bg-indigo-500/10 text-indigo-300">
              <ShieldCheck className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <h3 className="text-2xl font-bold leading-tight tracking-[-0.02em] text-white">
              A risk engine that shows its working.
            </h3>
            <p className="mt-4 max-w-lg leading-relaxed text-slate-400">
              Every quotation is scored on four independent measures, and the
              strictest one decides the route. A compliant line contributes zero —
              it can never quietly offset another line&apos;s breach.
            </p>

            {/* Live-looking evaluation panel — illustrative sample data */}
            <div className="mt-8 rounded-xl border border-white/[0.07] bg-[#070810]/80 p-6">
              <div className="mb-5 flex items-center justify-between">
                <span className="font-mono text-[11px] tracking-wider text-slate-500">
                  SAMPLE · Q-1042 · REV 3
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                  Awaiting finance
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {RISK_INPUTS.map((r) => (
                  <div
                    key={r.key}
                    className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
                  >
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                      {r.key} · {r.name}
                    </dt>
                    <dd className="mt-1.5 text-lg font-semibold tabular-nums text-white">
                      {r.value}
                    </dd>
                    <p className="mt-1 text-[10.5px] leading-snug text-slate-600">{r.note}</p>
                  </div>
                ))}
              </dl>

              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/[0.06] pt-4 font-mono text-[11px]">
                <span className="text-slate-500">
                  Route: <span className="text-indigo-300">MANAGER → FINANCE</span>
                </span>
                <span className="text-slate-500">
                  Policy: <span className="text-slate-300">v3</span>
                </span>
              </div>
            </div>

            <ul className="mt-6 space-y-2.5 text-sm text-slate-400">
              {[
                'Sequential steps — Finance never acts before Manager',
                'Delegated reassignment when an approver is unavailable',
                'Approvals invalidate the moment terms change',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-indigo-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Commercial hash */}
          <div className="ld-card flex flex-col p-7" onMouseMove={trackCardPointer}>
            <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/25 bg-cyan-500/10 text-cyan-300">
              <Fingerprint className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </div>
            <h3 className="text-lg font-semibold text-white">Acceptance, fingerprinted</h3>
            <p className="mt-2.5 flex-1 text-sm leading-relaxed text-slate-400">
              Acceptance is recorded against a SHA-256 fingerprint of the offer —
              currency, terms, and every line&apos;s price and cadence. Change
              anything and the customer&apos;s click is refused with a diff, not
              silently reinterpreted as consent.
            </p>
            <p className="mt-5 border-t border-white/[0.06] pt-4 font-mono text-[10.5px] leading-relaxed text-slate-600">
              Unit cost is deliberately excluded — a corrected cost changes the
              margin, not the deal the buyer said yes to.
            </p>
          </div>

          {/* Stock */}
          <div className="ld-card flex flex-col p-7" onMouseMove={trackCardPointer}>
            <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg border border-violet-500/25 bg-violet-500/10 text-violet-300">
              <Boxes className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </div>
            <h3 className="text-lg font-semibold text-white">Reserved under row locks</h3>
            <p className="mt-2.5 flex-1 text-sm leading-relaxed text-slate-400">
              Finalisation re-reads stock under ordered row locks. A shortage rolls
              back the order, the reservation and the invoice together — stock
              cannot go negative and nothing is left half-booked.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
              {['Multi-warehouse split', 'Backorder policy', 'Cost-aware shipping'].map((t) => (
                <span
                  key={t}
                  className="rounded border border-white/[0.07] bg-white/[0.02] px-2 py-1 font-mono text-[10px] text-slate-500"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Outbox */}
          <div className="ld-card p-7 lg:col-span-2" onMouseMove={trackCardPointer}>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
                <Zap className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-white">
                  Live updates that are never the source of truth
                </h3>
                <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-slate-400">
                  Every mutation writes to a transactional outbox. A dispatcher
                  pushes minimal frames to per-user STOMP queues; clients then
                  refetch over REST. A dropped frame is an inconvenience, never a
                  wrong number.
                </p>
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3 overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <span className="ld-dot h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
              <code className="truncate font-mono text-[11px] text-slate-500">
                commit → outbox → STOMP frame → REST refetch → reconciled
              </code>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
