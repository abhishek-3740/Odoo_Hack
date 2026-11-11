import { ArrowRight } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'

import { ROLE_HOME } from '@/auth/capabilities'
import { useAuth } from '@/auth/useAuth'
import { Panel } from '@/design-system'

import { CatalogueBrowser } from './CatalogueBrowser'

/**
 * The open catalogue.
 *
 * Anyone can read it without an account. Requesting a quotation needs one,
 * because a quotation belongs to a customer and is owned by their account
 * manager — so the page says that plainly rather than showing a button that
 * would bounce a visitor to a sign-in screen with no explanation.
 */
export default function PublicCataloguePage() {
  const { status, me } = useAuth()
  const signedIn = status === 'authenticated' && me

  useEffect(() => {
    document.title = 'Catalogue — DealFlow360'
  }, [])

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-10 sm:px-6">
      <header className="mb-6 max-w-2xl">
        <p className="text-2xs font-semibold uppercase tracking-[0.09em] text-brass-600">
          Open catalogue
        </p>
        <h1 className="mt-3 font-serif text-3xl font-semibold leading-tight text-text">
          Everything we sell, with its list price
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-text-secondary">
          Hardware bought once, services, and subscriptions billed on their own cadence. Availability
          is shown as a plain yes or no — never as a stock count.
        </p>
      </header>

      <CatalogueBrowser
        intro={
          <Panel tone="muted" className="flex flex-wrap items-center justify-between gap-4">
            <p className="min-w-0 text-[13px] leading-relaxed text-text-secondary">
              {signedIn
                ? 'You are signed in. Open your deal room to turn a selection into a quotation request.'
                : 'To ask for a quotation you need an account — a quotation belongs to a customer and is owned by their account manager.'}
            </p>
            <Link
              to={signedIn ? (me.role === 'CUSTOMER' ? '/customer/catalogue' : ROLE_HOME[me.role]) : '/sign-up'}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[--radius-control] bg-forest-500 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-forest-600"
            >
              {signedIn ? 'Open the workspace' : 'Create an account'}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </Panel>
        }
      />
    </div>
  )
}
