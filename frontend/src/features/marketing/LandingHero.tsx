import { ArrowRight, Fingerprint, GitBranch, ShieldCheck, Store } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

import { ROLE_HOME } from '@/auth/capabilities'
import { useAuth } from '@/auth/useAuth'

import { LANDING_COPY } from './seo'

const PROOFS = [
  { icon: ShieldCheck, label: 'Policy-driven approval' },
  { icon: GitBranch, label: 'Atomic finalisation' },
  { icon: Fingerprint, label: 'Hash-verified acceptance' },
]

export function LandingHero() {
  const { status, me } = useAuth()
  const workspace = status === 'authenticated' && me ? ROLE_HOME[me.role] : '/sign-in'
  const heroRef = useRef<HTMLDivElement>(null)

  // Subtle interactive pointer spotlight
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const el = heroRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 100
      const y = ((e.clientY - rect.top) / rect.height) * 100
      el.style.setProperty('--ld-mx', `${x.toFixed(1)}%`)
      el.style.setProperty('--ld-my', `${y.toFixed(1)}%`)
    }

    window.addEventListener('pointermove', handleMove, { passive: true })
    return () => window.removeEventListener('pointermove', handleMove)
  }, [])

  return (
    <section
      ref={heroRef}
      className="relative overflow-hidden pt-12 pb-16 sm:pt-16 sm:pb-20"
      style={{
        background:
          'radial-gradient(850px circle at var(--ld-mx, 40%) var(--ld-my, 25%), rgba(23, 100, 72, 0.08), transparent 60%)',
      }}
    >
      {/* Background ambient lighting */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(1100px_420px_at_18%_-10%,rgba(23,100,72,0.12),transparent_62%),radial-gradient(900px_380px_at_88%_0%,rgba(139,107,56,0.12),transparent_58%)]"
      />

      <div className="relative mx-auto w-full max-w-[1240px] px-4 sm:px-6">
        <div className="max-w-3xl">
          {/* Eyebrow badge */}
          <div className="inline-flex items-center gap-2.5 rounded-full border border-line bg-panel px-3.5 py-1 text-2xs font-semibold uppercase tracking-[0.12em] text-brass-600 shadow-panel">
            <span className="flex size-2 rounded-full bg-forest-500 animate-pulse" aria-hidden />
            <span>Quotation-to-cash, end to end</span>
          </div>

          {/* Main Headline */}
          <h1 className="mt-5 font-serif text-4xl font-semibold leading-[1.06] tracking-[-0.03em] text-text sm:text-5xl lg:text-[3.65rem]">
            {LANDING_COPY.headline}{' '}
            <span className="bg-gradient-to-r from-forest-700 via-forest-600 to-brass-600 bg-clip-text text-transparent">
              {LANDING_COPY.headlineAccent}
            </span>
          </h1>

          {/* Detailed premise */}
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-text-secondary sm:text-[17px]">
            DealFlow360 is a governed deal desk for hardware, services and subscriptions. Browse live
            pricing, negotiate on the line, clear policy-driven approval, and finalise stock and invoice
            in one transaction — every figure computed by the running system, never a mock-up.
          </p>

          {/* Action buttons */}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/catalogue"
              className="inline-flex h-12 items-center gap-2 rounded-[--radius-control] bg-forest-500 px-6 text-[15px] font-semibold text-white shadow-panel transition-all hover:-translate-y-0.5 hover:bg-forest-600"
            >
              <Store className="size-4" aria-hidden />
              Browse live catalogue
            </Link>
            <a
              href="#workflow"
              className="inline-flex h-12 items-center gap-2 rounded-[--radius-control] border border-line-strong bg-panel px-5 text-[15px] font-semibold text-text shadow-panel transition-all hover:bg-canvas-sunken"
            >
              See how it works
              <ArrowRight className="size-4 text-text-muted" aria-hidden />
            </a>
            <Link
              to={workspace}
              className="inline-flex h-12 items-center gap-2 rounded-[--radius-control] px-4 text-[15px] font-medium text-text-secondary transition-colors hover:text-text"
            >
              Open workspace
            </Link>
          </div>

          {/* Verifiable guarantees */}
          <ul className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line/70 pt-6">
            {PROOFS.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="flex items-center gap-2 text-xs font-medium text-text-muted"
              >
                <Icon className="size-4 text-forest-600" strokeWidth={2} aria-hidden />
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
