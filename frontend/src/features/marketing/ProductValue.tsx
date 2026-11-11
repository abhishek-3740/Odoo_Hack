import { Coins, MessageSquare, Scale, ShoppingBag } from 'lucide-react'

const VALUES = [
  {
    icon: ShoppingBag,
    title: 'One catalogue, no price ping-pong',
    text: 'Hardware, services and subscriptions live in a single catalogue. Tier pricing is resolved server-side, so a buyer sees their terms and never your raw cost.',
  },
  {
    icon: MessageSquare,
    title: 'Negotiation happens on the line',
    text: 'Customers comment on individual lines and counter discounts in the deal room. Every counter-offer becomes a versioned revision that is re-evaluated against current policy.',
  },
  {
    icon: Scale,
    title: 'Approval that explains itself',
    text: 'Each required approval names the rule, the line it came from, the number observed and the ceiling it crossed — so a reviewer acts on evidence, not a vague red badge.',
  },
  {
    icon: Coins,
    title: 'Billing that matches the deal',
    text: 'Calendar-month subscriptions, prorated mid-cycle changes, and cancellation credits capped at money actually received. No clawback on bundled hardware.',
  },
]

export function ProductValue() {
  return (
    <section id="product-value" className="mx-auto w-full max-w-[1240px] px-4 py-16 sm:px-6 sm:py-20">
      <div className="max-w-3xl">
        <p className="text-2xs font-semibold uppercase tracking-[0.09em] text-brass-600">
          Commercial Foundation
        </p>
        <h2 className="mt-3 font-serif text-3xl font-semibold leading-tight text-text sm:text-4xl">
          Built for the way enterprise deals actually close
        </h2>
        <p className="mt-4 text-base leading-relaxed text-text-secondary">
          A quotation is not a static PDF. It is a governed, live object that survives pricing,
          negotiation, multi-step approval, stock allocation and billing without being retyped once.
        </p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:gap-8">
        {VALUES.map((item) => {
          const Icon = item.icon
          return (
            <div
              key={item.title}
              className="group relative rounded-[--radius-showcase] border border-line bg-panel p-7 shadow-panel transition-all duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-raised"
            >
              <div className="mb-5 flex size-12 items-center justify-center rounded-xl border border-forest-200/80 bg-forest-50 text-forest-700 transition-colors group-hover:border-forest-400 group-hover:bg-forest-100">
                <Icon className="size-5" strokeWidth={1.9} aria-hidden />
              </div>
              <h3 className="font-serif text-xl font-semibold text-text">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-text-secondary">{item.text}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
