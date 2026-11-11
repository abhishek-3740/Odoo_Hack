import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  CircleDollarSign,
  ClipboardCheck,
  Handshake,
  MessageSquareQuote,
  ShieldCheck,
  Sparkles,
  Truck,
  UserRound,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/design-system'
import { cn } from '@/lib/cn'

/**
 * Marketing sections.
 *
 * Everything here is an illustration and is labelled as one. There are no
 * invented customers, no testimonials, no usage counters and no revenue claims —
 * the product's own shapes are the proof, and inventing social proof for a
 * business system would be both dishonest and unnecessary.
 */

const SAMPLE_LABEL = 'Example — illustrative figures, not customer data'

/* ------------------------------------------------------------ product proof */

/**
 * A realistic quotation.
 *
 * Deliberately a *hybrid* deal, because that is the case a demo usually hides:
 * one-time hardware alongside a monthly subscription. The two figures stay
 * separate, exactly as they do in the product, because ₹39,300 once and ₹3,000
 * a month are not ₹42,300 of anything.
 */
export function ProductProof() {
  return (
    <figure className="overflow-hidden rounded-[--radius-showcase] border border-line bg-panel shadow-raised">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel-muted px-5 py-3.5">
        <div className="min-w-0">
          <p className="tabular text-[13px] font-semibold text-text">Q-1042 · Northwind Systems</p>
          <p className="text-2xs text-text-muted">Version 2 · valid to 31 Mar 2026</p>
        </div>
        <Badge tone="wait">Waiting for manager — step 1</Badge>
      </div>

      <div className="scroll-subtle overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">Example quotation lines</caption>
          <thead>
            <tr className="border-b border-line text-2xs uppercase tracking-wide text-text-muted">
              <th scope="col" className="px-5 py-2 text-left font-semibold">
                Item
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Qty
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Discount
              </th>
              <th scope="col" className="px-5 py-2 text-right font-semibold">
                Net
              </th>
            </tr>
          </thead>
          <tbody className="tabular">
            <tr className="border-b border-line">
              <td className="px-5 py-2.5">
                <span className="font-medium text-text">Rackmount switch · 24 port</span>
                <span className="block text-2xs text-text-muted">One-time · in stock</span>
              </td>
              <td className="px-3 py-2.5 text-right">3</td>
              <td className="px-3 py-2.5 text-right">8%</td>
              <td className="px-5 py-2.5 text-right font-medium">₹33,120.00</td>
            </tr>
            <tr className="border-b border-line">
              <td className="px-5 py-2.5">
                <span className="font-medium text-text">On-site installation</span>
                <span className="block text-2xs text-text-muted">One-time · service</span>
              </td>
              <td className="px-3 py-2.5 text-right">1</td>
              <td className="px-3 py-2.5 text-right text-brass-600">12%</td>
              <td className="px-5 py-2.5 text-right font-medium">₹6,180.00</td>
            </tr>
            <tr>
              <td className="px-5 py-2.5">
                <span className="font-medium text-text">Monitoring · 10 seats</span>
                <span className="block text-2xs text-text-muted">Recurring · monthly</span>
              </td>
              <td className="px-3 py-2.5 text-right">10</td>
              <td className="px-3 py-2.5 text-right">0%</td>
              <td className="px-5 py-2.5 text-right font-medium">₹3,000.00 / mo</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid gap-px bg-line sm:grid-cols-3">
        <div className="bg-panel px-5 py-3.5">
          <p className="text-2xs uppercase tracking-wide text-text-muted">One-time</p>
          <p className="tabular mt-1 text-base font-semibold text-text">₹39,300.00</p>
        </div>
        <div className="bg-panel px-5 py-3.5">
          <p className="text-2xs uppercase tracking-wide text-text-muted">Recurring</p>
          <p className="tabular mt-1 text-base font-semibold text-text">
            ₹3,000.00 <span className="text-2xs font-normal text-text-muted">/ month</span>
          </p>
        </div>
        <div className="bg-forest-50 px-5 py-3.5">
          <p className="text-2xs uppercase tracking-wide text-forest-700">Payable on confirmation</p>
          <p className="tabular mt-1 text-base font-semibold text-forest-700">₹42,300.00</p>
        </div>
      </div>

      <div className="border-t border-line bg-wait-surface px-5 py-3.5">
        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-wait-text">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">Why this needs approval:</span> installation is 12% off
            against a 10% ceiling for this category — 2 percentage points over. One reason, with the
            number that caused it.
          </span>
        </p>
      </div>

      <figcaption className="border-t border-line px-5 py-2.5 text-2xs text-text-muted">
        {SAMPLE_LABEL}
      </figcaption>
    </figure>
  )
}

/* ------------------------------------------------------------ role selector */

interface RoleView {
  id: string
  label: string
  icon: typeof UserRound
  headline: string
  body: string
  capabilities: string[]
}

const ROLE_VIEWS: RoleView[] = [
  {
    id: 'sales',
    label: 'Sales',
    icon: UserRound,
    headline: 'Build terms and see what they will cost you',
    body: 'Every edit is re-priced by the server and measured against policy before you submit — so the approval you are about to trigger is visible while you can still change it.',
    capabilities: [
      'Live evaluation as you edit, with the exact reason any line breaches policy',
      'Cross-sell that adds a line and upsell that replaces a compatible one',
      'One panel that says what is blocking the deal and who has to act next',
    ],
  },
  {
    id: 'manager',
    label: 'Manager',
    icon: ClipboardCheck,
    headline: 'Decide with the reason in front of you',
    body: 'Step 1 arrives with the version, the trigger, the margin and what changed since the last version — not a link to go and find out.',
    capabilities: [
      'The queue shows only steps you can actually action, and says why when you cannot',
      'Side-by-side comparison of the two versions before any decision',
      'Approve, reject or return for revision, with the reason kept in the history',
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    icon: Wallet,
    headline: 'Step 2, and everything downstream of it',
    body: 'Finance sees its step immediately but can only decide once the manager has. Past that: invoices, subscriptions, receipts, credits and refunds.',
    capabilities: [
      'Sequential approval enforced by the server, not by convention',
      'Subscription quantity and plan changes previewed before they are committed',
      'Receipts allocated across invoices, with any surplus kept as customer credit',
    ],
  },
  {
    id: 'customer',
    label: 'Customer',
    icon: Handshake,
    headline: 'Understand the offer, and negotiate it',
    body: 'A deal room with the terms, the conversation and one unambiguous accept — with none of the seller’s cost or margin anywhere behind it.',
    capabilities: [
      'Ask for a discount on one line or on the whole quotation',
      'Accept one exact version, verified against the terms you were shown',
      'Invoices with the outstanding amount and a document you can download',
    ],
  },
  {
    id: 'admin',
    label: 'Administrator',
    icon: ShieldCheck,
    headline: 'Set the rules the workflow enforces',
    body: 'Discount ceilings, approval triggers, catalogue, plans and warehouses. Publishing a policy version changes the next evaluation — not the ones already decided.',
    capabilities: [
      'Versioned discount policy with tier and category ceilings',
      'Products, variants, tier price rules, subscription plans and warehouses',
      'People, teams and time-boxed approval delegations',
    ],
  },
]

export function RoleShowcase() {
  const [active, setActive] = useState(ROLE_VIEWS[0].id)
  const view = ROLE_VIEWS.find((role) => role.id === active) ?? ROLE_VIEWS[0]
  const Icon = view.icon

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <div
        role="tablist"
        aria-label="Choose a role"
        aria-orientation="vertical"
        className="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible"
      >
        {ROLE_VIEWS.map((role) => {
          const RoleIcon = role.icon
          const selected = role.id === active
          return (
            <button
              key={role.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(role.id)}
              className={cn(
                'flex shrink-0 items-center gap-2.5 rounded-[--radius-control] px-3.5 py-2.5 text-[13px] font-medium transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-500',
                selected
                  ? 'bg-ink-800 text-text-inverse'
                  : 'text-text-secondary hover:bg-canvas-sunken hover:text-text',
              )}
            >
              <RoleIcon className="size-4" aria-hidden />
              {role.label}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        className="rounded-[--radius-panel] border border-line bg-panel p-6 shadow-panel"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[--radius-control] bg-forest-50 text-forest-600">
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="font-serif text-lg font-semibold leading-snug text-text">
              {view.headline}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{view.body}</p>
          </div>
        </div>
        <ul className="mt-5 space-y-2.5 border-t border-line pt-5">
          {view.capabilities.map((capability) => (
            <li key={capability} className="flex gap-2.5 text-[13px] leading-relaxed text-text">
              <BadgeCheck className="mt-0.5 size-4 shrink-0 text-forest-500" aria-hidden />
              {capability}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/* --------------------------------------------------------- negotiation card */

/** The one exchange that most systems get wrong, shown as it actually behaves. */
export function NegotiationStory() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <article className="rounded-[--radius-panel] border border-line bg-panel p-5 shadow-panel">
        <span className="flex size-9 items-center justify-center rounded-full bg-brass-50 text-brass-600">
          <MessageSquareQuote className="size-4" aria-hidden />
        </span>
        <h3 className="mt-3 text-[15px] font-semibold text-text">The customer asks for 10% off</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-text-secondary">
          On one line, or on the whole quotation. It arrives as a request against the exact version
          they were looking at — not against whatever is current by the time it lands.
        </p>
      </article>

      <article className="rounded-[--radius-panel] border border-line bg-panel p-5 shadow-panel">
        <span className="flex size-9 items-center justify-center rounded-full bg-info-surface text-info-text">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <h3 className="mt-3 text-[15px] font-semibold text-text">It becomes a priced version</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-text-secondary">
          The server builds the counteroffer as a real version and prices it from scratch, so both
          sides are looking at the same figures. Nobody has agreed to it yet.
        </p>
      </article>

      <article className="rounded-[--radius-panel] border border-forest-200 bg-forest-50 p-5 shadow-panel">
        <span className="flex size-9 items-center justify-center rounded-full bg-panel text-forest-600">
          <Handshake className="size-4" aria-hidden />
        </span>
        <h3 className="mt-3 text-[15px] font-semibold text-text">
          Only adopting it commits anyone
        </h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-text-secondary">
          Seller agreement is reset and the approval chain re-runs from scratch, so an order cannot
          follow until the salesperson adopts it. A friendly reply is a message and changes none of
          that.
        </p>
      </article>
    </div>
  )
}

/* ---------------------------------------------------------- operations grid */

const OPERATIONS = [
  {
    icon: Truck,
    title: 'Allocation you can argue with',
    body: 'The plan shows which warehouse covers which line and what it costs to ship. Override it and the server validates the exact quantities under a lock, or refuses with a plan that would work.',
  },
  {
    icon: Boxes,
    title: 'Backorders with real dates',
    body: 'A shortage carries the expected receipt date when one is known, and says "unconfirmed" when it is not. Record the goods and the order can be re-planned into the parcels already open.',
  },
  {
    icon: CircleDollarSign,
    title: 'Subscriptions that show their arithmetic',
    body: 'Change a quantity or switch a plan and the proration is previewed first — days remaining, the fraction, the charge or credit — using the same inputs the confirmation will send.',
  },
  {
    icon: Wallet,
    title: 'Money recorded, not simulated',
    body: 'Receipts are allocated across invoices oldest due first, surplus is kept as customer credit, and refunds are recorded against a credit note. Nothing here pretends to be a payment gateway.',
  },
]

export function OperationsGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {OPERATIONS.map((item) => {
        const Icon = item.icon
        return (
          <article
            key={item.title}
            className="rounded-[--radius-panel] border border-line bg-panel p-5 shadow-panel"
          >
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[--radius-control] bg-canvas-sunken text-forest-600">
                <Icon className="size-4" aria-hidden />
              </span>
              <div>
                <h3 className="text-[15px] font-semibold text-text">{item.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-text-secondary">{item.body}</p>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}

/* ----------------------------------------------------------------- FAQ */

const FAQ = [
  {
    q: 'Does a discount request commit us to it?',
    a: 'No. It does become a real, priced version straight away — so both sides see the same figures rather than arguing about arithmetic. What it does not do is commit anyone: seller agreement is reset and any approval starts again, so no order can follow until the salesperson adopts it.',
  },
  {
    q: 'Can finance approve before the manager?',
    a: 'No. Both steps are created when a breaching version is submitted, so finance can see what is coming, but the finance step is not actionable until step 1 is approved. The server enforces the order.',
  },
  {
    q: 'What happens if two people edit the same quotation?',
    a: 'Saving carries the version you started from. If it moved, the save is refused with a conflict rather than silently overwriting — your draft is kept and you are shown what changed.',
  },
  {
    q: 'Are one-time and recurring charges ever added together?',
    a: 'Only as a clearly labelled comparison figure used for risk and margin. What the customer pays on confirmation, and what recurs each period, are always shown as separate amounts.',
  },
  {
    q: 'Is the assistant able to change anything?',
    a: 'No. It reads the context you are already authorised to see and explains it. Handing a question to finance or a manager drafts a request that you review and submit yourself.',
  },
]

export function FaqList() {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-[--radius-panel] border border-line bg-panel shadow-panel">
      {FAQ.map((item) => (
        <details key={item.q} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[15px] font-medium text-text hover:bg-canvas-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest-500">
            {item.q}
            <ArrowRight
              aria-hidden
              className="size-4 shrink-0 text-text-muted transition-transform group-open:rotate-90"
            />
          </summary>
          <p className="px-5 pb-4 text-[13px] leading-relaxed text-text-secondary">{item.a}</p>
        </details>
      ))}
    </div>
  )
}
