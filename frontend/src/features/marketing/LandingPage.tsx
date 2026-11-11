import { ArrowRight, Store } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'

import { ROLE_HOME } from '@/auth/capabilities'
import { useAuth } from '@/auth/useAuth'

import { CapabilitiesBento } from './CapabilitiesBento'
import { IntegrityStrip } from './IntegrityStrip'
import { LandingHero } from './LandingHero'
import { LiveSystemStrip } from './LiveSystemStrip'
import { PersonasSection } from './PersonasSection'
import { ProductValue } from './ProductValue'
import { FaqList, NegotiationStory, OperationsGrid, ProductProof, RoleShowcase } from './sections'
import { LANDING_COPY } from './seo'
import { WorkflowDiagram } from './WorkflowDiagram'

/**
 * The public landing page.
 *
 * Integrates the previous landing page's cinematic hero, live catalogue telemetry,
 * product pillars, risk engine bento, seeded demo personas, and enterprise
 * integrity guarantees — styled entirely in the current paper-and-ink design system.
 */
export default function LandingPage() {
  const { status, me } = useAuth()
  const workspace = status === 'authenticated' && me ? ROLE_HOME[me.role] : '/sign-in'

  useEffect(() => {
    document.title = LANDING_COPY.title
  }, [])

  return (
    <>
      {/* 1. Cinematic Hero */}
      <LandingHero />

      {/* 2. Live System Strip (telemetry from running backend) */}
      <LiveSystemStrip />

      {/* 3. Product Value (4 foundational pillars) */}
      <ProductValue />

      {/* 4. Interactive Workflow Story */}
      <section
        id="workflow"
        aria-labelledby="workflow-heading"
        className="mx-auto w-full max-w-[1240px] scroll-mt-20 px-4 py-14 sm:px-6 sm:py-20"
      >
        <div className="mb-8 max-w-2xl">
          <p className="text-2xs font-semibold uppercase tracking-[0.09em] text-brass-600">
            Interactive Walkthrough
          </p>
          <h2
            id="workflow-heading"
            className="mt-3 font-serif text-3xl font-semibold leading-tight text-text sm:text-4xl"
          >
            One deal, end to end
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">
            The story below runs on its own. Approval is sequential when it is required at all;
            seller agreement and customer acceptance are separate gates that can land in either
            order. Pick a scenario, pause it, or click any step to inspect what it does.
          </p>
        </div>

        <WorkflowDiagram />
      </section>

      {/* 5. Product Proof (Hybrid deal quotation) */}
      <section id="proof" className="border-y border-line bg-canvas-sunken/60 py-16 sm:py-20">
        <div className="mx-auto grid w-full max-w-[1240px] gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-[0.09em] text-brass-600">
              What a quotation looks like
            </p>
            <h2 className="mt-3 font-serif text-3xl font-semibold leading-tight text-text sm:text-4xl">
              Hybrid deals, told honestly
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-text-secondary">
              Most quoting tools flatten a deal into one number. Hardware bought once and a
              subscription billed monthly are different commitments, so they stay different
              figures — and the amount payable on confirmation is stated on its own.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary">
              When a version needs approval, the reason is the exact number that caused it: which line,
              which ceiling, how far over. Not a generic red badge saying “review required”.
            </p>
          </div>
          <ProductProof />
        </div>
      </section>

      {/* 6. Capabilities Bento (Risk engine, SHA-256 integrity seal, atomic stock allocation) */}
      <CapabilitiesBento />

      {/* 7. Seeded Demo Personas */}
      <PersonasSection />

      {/* 8. Role Showcase */}
      <section
        id="roles"
        aria-labelledby="roles-heading"
        className="mx-auto w-full max-w-[1240px] scroll-mt-20 px-4 py-16 sm:px-6 sm:py-20"
      >
        <div className="mb-8 max-w-2xl">
          <p className="text-2xs font-semibold uppercase tracking-[0.09em] text-brass-600">
            Role Architecture
          </p>
          <h2
            id="roles-heading"
            className="mt-3 font-serif text-3xl font-semibold leading-tight text-text sm:text-4xl"
          >
            Everyone sees the same deal, and only their part of it
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">
            The customer view is a distinct DTO on the server, not the internal record with fields
            hidden. There is no field for your internal cost or margin in a portal response,
            so there is nothing to leak.
          </p>
        </div>
        <RoleShowcase />
      </section>

      {/* 9. Negotiation Desk */}
      <section
        id="negotiation"
        aria-labelledby="negotiation-heading"
        className="border-y border-line bg-canvas-sunken/60 py-16 sm:py-20"
      >
        <div className="mx-auto w-full max-w-[1240px] scroll-mt-20 px-4 sm:px-6">
          <div className="mb-8 max-w-2xl">
            <p className="text-2xs font-semibold uppercase tracking-[0.09em] text-brass-600">
              Deal Room Negotiation
            </p>
            <h2
              id="negotiation-heading"
              className="mt-3 font-serif text-3xl font-semibold leading-tight text-text sm:text-4xl"
            >
              Asking is not agreeing
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary">
              A counteroffer becomes a real, priced version immediately, so nobody argues about
              arithmetic. Agreement is the separate part: it needs the salesperson to adopt it and
              any approval to run again from the beginning.
            </p>
          </div>
          <NegotiationStory />
        </div>
      </section>

      {/* 10. Integrity Strip (Database guarantees + Production stack) */}
      <IntegrityStrip />

      {/* 11. Post-Order Operations */}
      <section className="mx-auto w-full max-w-[1240px] px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-8 max-w-2xl">
          <p className="text-2xs font-semibold uppercase tracking-[0.09em] text-brass-600">
            After the order
          </p>
          <h2 className="mt-3 font-serif text-3xl font-semibold leading-tight text-text sm:text-4xl">
            Fulfilment and billing, with the reasoning visible
          </h2>
        </div>
        <OperationsGrid />
      </section>

      {/* 12. Frequently Asked Questions */}
      <section
        id="faq"
        aria-labelledby="faq-heading"
        className="mx-auto w-full max-w-[860px] scroll-mt-20 px-4 pb-16 sm:px-6"
      >
        <h2
          id="faq-heading"
          className="mb-6 font-serif text-3xl font-semibold leading-tight text-text"
        >
          Questions worth asking
        </h2>
        <FaqList />
      </section>

      {/* 13. Closing Call to Action */}
      <section className="mx-auto w-full max-w-[1240px] px-4 pb-20 sm:px-6">
        <div className="overflow-hidden rounded-[--radius-showcase] border border-line-inverse bg-ink-900 px-6 py-12 text-text-inverse sm:px-12 shadow-raised">
          <div className="flex flex-wrap items-end justify-between gap-8">
            <div className="max-w-xl">
              <h2 className="font-serif text-3xl font-semibold leading-tight sm:text-4xl">
                Open the live deal desk
              </h2>
              <p className="mt-4 text-base leading-relaxed text-text-inverse-muted">
                Sign in to build a quotation, watch it route for approval, negotiate it from the
                customer portal and confirm the order. Every figure comes from the server.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to={workspace}
                className="inline-flex h-12 items-center gap-2 rounded-[--radius-control] bg-forest-500 px-6 text-[15px] font-semibold text-white shadow-panel transition-all hover:-translate-y-0.5 hover:bg-forest-400"
              >
                {LANDING_COPY.ctaPrimary}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link
                to="/catalogue"
                className="inline-flex h-12 items-center gap-2 rounded-[--radius-control] border border-line-inverse px-5 text-[15px] font-semibold text-text-inverse transition-colors hover:bg-ink-700"
              >
                <Store className="size-4" aria-hidden />
                Browse the catalogue
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
