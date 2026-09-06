import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useReveal, trackCardPointer } from './useReveal';
import {
  ArrowRight,
  Layers,
  Briefcase,
  UserCheck,
  CreditCard,
  ShoppingBag,
  Check,
  Database,
  Lock,
  Clock,
  EyeOff,
  Fingerprint,
  Copy,
} from 'lucide-react';

function Eyebrow({ children }) {
  return (
    <p className="mb-4 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-400">
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Live system strip — counts pulled from the running API, never hardcoded    */
/* -------------------------------------------------------------------------- */

function useLiveCatalog() {
  const [state, setState] = useState({ loading: true, offline: false, stats: null });

  useEffect(() => {
    let cancelled = false;

    api
      .get('/public/catalog')
      .then((res) => {
        if (cancelled) return;
        // api.get already unwraps `data`; be defensive about either shape.
        const payload = res?.data ?? res ?? {};
        const products = Array.isArray(payload.products) ? payload.products : [];
        const variants = Array.isArray(payload.variants) ? payload.variants : [];
        const plans = Array.isArray(payload.plans) ? payload.plans : [];
        const categories = Array.isArray(payload.categories) ? payload.categories : [];

        setState({
          loading: false,
          offline: false,
          stats: {
            products: products.length,
            categories: categories.length,
            plans: plans.length,
            inStock: variants.filter((v) => v.inStock).length,
            variants: variants.length,
          },
        });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, offline: true, stats: null });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export function LiveSystemStrip() {
  const { loading, offline, stats } = useLiveCatalog();

  const items = [
    { label: 'Live products', value: stats?.products },
    { label: 'Categories', value: stats?.categories },
    { label: 'Subscription plans', value: stats?.plans },
    {
      label: 'Variants in stock',
      value: stats ? `${stats.inStock}/${stats.variants}` : undefined,
    },
  ];

  return (
    <section className="relative border-y border-white/[0.07] bg-[#070810]/60">
      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={`ld-dot h-2 w-2 rounded-full ${
                offline ? 'bg-slate-600' : loading ? 'bg-amber-400' : 'bg-emerald-400'
              }`}
            />
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400">
              {offline
                ? 'API offline — start the Spring service to load live counts'
                : loading
                  ? 'Reading catalogue…'
                  : 'Read live from the running catalogue'}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-4 lg:gap-x-14">
            {items.map((item) => (
              <div key={item.label}>
                <dd className="text-2xl font-bold tabular-nums tracking-tight text-white">
                  {loading ? (
                    <span className="ld-skeleton inline-block h-7 w-12 rounded align-middle" />
                  ) : item.value === undefined ? (
                    <span className="text-slate-600">—</span>
                  ) : (
                    item.value
                  )}
                </dd>
                <dt className="mt-1 text-[12.5px] text-slate-500">{item.label}</dt>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Personas — the real seeded demo accounts                                   */
/* -------------------------------------------------------------------------- */
const PERSONAS = [
  {
    icon: Briefcase,
    role: 'Sales rep',
    email: 'rep.a@dealflow.demo',
    tint: 'indigo',
    text: 'Builds a quotation, sees live margin and recommendations, submits for approval, and answers the customer in the deal room.',
  },
  {
    icon: UserCheck,
    role: 'Manager',
    email: 'manager.a@dealflow.demo',
    tint: 'blue',
    text: 'Reviews step-one discount breaches with the policy reason attached, then approves, rejects or returns for revision.',
  },
  {
    icon: CreditCard,
    role: 'Finance & ops',
    email: 'finance@dealflow.demo',
    tint: 'emerald',
    text: 'Signs off high-concession deals, overrides allocations, records payments, and dispatches shipments.',
  },
  {
    icon: ShoppingBag,
    role: 'Customer buyer',
    email: 'alpha@customer.demo',
    tint: 'amber',
    text: 'Sees only their own quotations and their own prices — counters a line, and accepts the exact version they reviewed.',
  },
];

const TINTS = {
  indigo: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300',
  blue: 'border-blue-500/25 bg-blue-500/10 text-blue-300',
  emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  amber: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
};

export function Personas() {
  const [ref, visible] = useReveal();

  return (
    <section id="personas" className="relative scroll-mt-20 py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div
          ref={ref}
          className={`transition-all duration-700 ${
            visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
          }`}
        >
          <Eyebrow>Personas</Eyebrow>
          <h2 className="max-w-2xl text-[2.1rem] font-bold leading-[1.1] tracking-[-0.03em] text-white sm:text-5xl">
            Four roles, one shared source of truth.
          </h2>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-slate-400">
            Every persona is a real seeded account with server-enforced
            permissions — not a role toggle in the UI. Sign in as any of them.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PERSONAS.map((p, i) => {
            const Icon = p.icon;
            return (
              <div
                key={p.email}
                className="ld-card flex flex-col p-6" onMouseMove={trackCardPointer}
                style={{
                  transitionDelay: `${i * 70}ms`,
                  opacity: visible ? 1 : 0,
                  transform: visible ? 'translateY(0)' : 'translateY(22px)',
                }}
              >
                <div
                  className={`mb-5 flex h-10 w-10 items-center justify-center rounded-lg border ${TINTS[p.tint]}`}
                >
                  <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
                </div>
                <h3 className="text-base font-semibold text-white">{p.role}</h3>
                <p className="mt-2.5 flex-1 text-sm leading-relaxed text-slate-400">
                  {p.text}
                </p>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(p.email)}
                  title="Copy email"
                  className="mt-5 flex items-center justify-between gap-2 rounded-md border border-white/[0.07] bg-white/[0.02] px-2.5 py-2 font-mono text-[10.5px] text-slate-500 transition-colors hover:border-white/15 hover:text-slate-300"
                >
                  <span className="truncate">{p.email}</span>
                  <Copy className="h-3 w-3 shrink-0" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Integrity — what is actually enforced, not claimed                         */
/* -------------------------------------------------------------------------- */
const GUARANTEES = [
  {
    icon: Database,
    title: 'Finalisation is one transaction',
    text: 'Order, stock reservation and first invoice commit together or roll back together. Nothing is left half-booked.',
  },
  {
    icon: Lock,
    title: 'Stock is locked, not guessed',
    text: 'Rows are re-read under ordered locks at finalisation. Concurrent confirmations cannot oversell, and stock never goes negative.',
  },
  {
    icon: Clock,
    title: 'Idempotent writes',
    text: 'Retried actions carry idempotency keys, and recurring charges use unique keys with job locks — no duplicate orders or invoices.',
  },
  {
    icon: EyeOff,
    title: 'Out-of-scope reads return 404',
    text: 'Another customer’s quotation is not forbidden, it is invisible. Ownership is checked on the server, not hidden in the client.',
  },
  {
    icon: Fingerprint,
    title: 'Immutable submitted versions',
    text: 'Decisions and acceptances bind to one revision. Editing terms invalidates pending approvals rather than carrying them forward.',
  },
  {
    icon: Layers,
    title: 'The portal sees a different object',
    text: 'Separate DTOs strip internal cost, margin and thresholds before anything reaches a buyer’s browser.',
  },
];

export function Integrity() {
  const [ref, visible] = useReveal();

  return (
    <section className="relative py-24 lg:py-32">
      <hr className="ld-rule absolute inset-x-0 top-0" />
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div
          ref={ref}
          className={`grid gap-14 transition-all duration-700 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:gap-20 ${
            visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
          }`}
        >
          <div className="lg:sticky lg:top-28 lg:self-start">
            <Eyebrow>Integrity</Eyebrow>
            <h2 className="text-[2.1rem] font-bold leading-[1.1] tracking-[-0.03em] text-white sm:text-[2.6rem]">
              No fake approvals.
              <br />
              <span className="text-slate-500">No fake inventory.</span>
              <br />
              No fake billing.
            </h2>
            <p className="mt-6 leading-relaxed text-slate-400">
              The brief explicitly rejects simulated business logic, so the
              engines are real and the guarantees below are enforced in the
              backend. Every one of them is covered by an automated test.
            </p>
          </div>

          <ul className="grid gap-x-8 gap-y-8 sm:grid-cols-2">
            {GUARANTEES.map((g, i) => {
              const Icon = g.icon;
              return (
                <li
                  key={g.title}
                  style={{
                    transitionDelay: `${i * 60}ms`,
                    opacity: visible ? 1 : 0,
                    transform: visible ? 'translateY(0)' : 'translateY(18px)',
                    transition: 'opacity 0.7s ease, transform 0.7s ease',
                  }}
                >
                  <div className="mb-3 flex items-center gap-2.5">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
                      <Check className="h-3.5 w-3.5 text-emerald-400" strokeWidth={3} />
                    </span>
                    <Icon className="h-4 w-4 text-slate-600" strokeWidth={1.8} />
                  </div>
                  <h3 className="text-[15px] font-semibold text-white">{g.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{g.text}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Stack marquee                                                              */
/* -------------------------------------------------------------------------- */
const STACK = [
  'Java 21',
  'Spring Boot',
  'Spring Security',
  'PostgreSQL',
  'JPA / Hibernate',
  'Flyway',
  'STOMP over WebSocket',
  'Transactional outbox',
  'React 19',
  'Vite',
  'Tailwind CSS',
  'React Router',
  'Three.js / R3F',
  'Apache PDFBox',
  'Apache POI',
];

function StackRow({ ariaHidden }) {
  return (
    <div className="flex shrink-0 items-center" aria-hidden={ariaHidden || undefined}>
      {STACK.map((item) => (
        <span key={item} className="flex items-center">
          <span className="whitespace-nowrap px-6 font-mono text-[12px] uppercase tracking-[0.14em] text-slate-600 transition-colors hover:text-slate-300">
            {item}
          </span>
          <span className="h-1 w-1 rounded-full bg-slate-800" />
        </span>
      ))}
    </div>
  );
}

export function StackStrip() {
  return (
    <section className="relative overflow-hidden border-y border-white/[0.07] bg-[#070810]/40 py-8">
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-[#05060a] to-transparent"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-[#05060a] to-transparent"
        aria-hidden="true"
      />
      <div className="ld-marquee">
        <StackRow />
        <StackRow ariaHidden />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Final CTA                                                                  */
/* -------------------------------------------------------------------------- */
export function FinalCTA() {
  const [ref, visible] = useReveal();

  return (
    <section className="relative overflow-hidden py-28 lg:py-36">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(700px circle at 50% 50%, rgba(99,102,241,0.14), transparent 62%)',
        }}
      />
      <div className="ld-grid pointer-events-none absolute inset-0 opacity-60" />

      <div
        ref={ref}
        className={`relative mx-auto max-w-3xl px-6 text-center transition-all duration-700 lg:px-10 ${
          visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
        }`}
      >
        <h2 className="text-[2.4rem] font-bold leading-[1.08] tracking-[-0.035em] text-white sm:text-5xl lg:text-6xl">
          Start the deal that closes.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-slate-400">
          Open the live catalogue, request a quotation, and watch a governed deal
          desk behave the way it should — from the buyer&apos;s side.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/catalog"
            className="group inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-8 py-4 font-semibold text-white shadow-[0_12px_34px_-12px_rgba(99,102,241,0.9)] transition-all hover:-translate-y-0.5 hover:bg-indigo-400"
          >
            <span>Browse live catalogue</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 rounded-lg border border-white/12 px-8 py-4 font-semibold text-slate-200 transition-all hover:border-white/25 hover:text-white"
          >
            <span>Sign in as a persona</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Footer                                                                     */
/* -------------------------------------------------------------------------- */
const FOOTER_COLS = [
  {
    heading: 'Product',
    links: [
      { label: 'Live catalogue', to: '/catalog' },
      { label: 'Customer portal', to: '/customer' },
      { label: 'Internal workspace', to: '/admin' },
    ],
  },
  {
    heading: 'Account',
    links: [
      { label: 'Sign in', to: '/login' },
      { label: 'Create account', to: '/signup' },
    ],
  },
];

export function LandingFooter() {
  return (
    <footer className="relative border-t border-white/[0.07] bg-[#070810]/50">
      <div className="mx-auto max-w-7xl px-6 py-14 lg:px-10">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-indigo-400 to-violet-600 text-white">
                <Layers className="h-3.5 w-3.5" strokeWidth={2.2} />
              </span>
              <span className="text-sm font-semibold tracking-tight text-white">
                DealFlow<span className="text-indigo-400">360</span>
              </span>
            </div>
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-slate-500">
              A governed quotation-to-cash desk — pricing, negotiation, approval,
              fulfilment and billing on one transaction boundary.
            </p>
          </div>

          {FOOTER_COLS.map((col) => (
            <div key={col.heading}>
              <h3 className="mb-4 font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                {col.heading}
              </h3>
              <ul className="space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      to={l.to}
                      className="text-[13px] text-slate-400 transition-colors hover:text-white"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h3 className="mb-4 font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-600">
              Demo personas
            </h3>
            <ul className="space-y-2.5">
              {PERSONAS.map((p) => (
                <li key={p.email} className="font-mono text-[11.5px] text-slate-500">
                  {p.email}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-white/[0.07] pt-6 sm:flex-row sm:items-center">
          <p className="text-[12px] text-slate-600">
            © {new Date().getFullYear()} DealFlow360. Built for the Odoo Hack.
          </p>
          <p className="font-mono text-[11px] text-slate-700">
            Seeded demo data · every figure computed live
          </p>
        </div>
      </div>
    </footer>
  );
}
