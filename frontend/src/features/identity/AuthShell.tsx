import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Wordmark } from '@/layouts/Brand'

/**
 * The frame around every identity screen.
 *
 * A quiet, two-column composition: the form on the left where it is reached
 * first by keyboard and by eye, and an editorial panel on the right that
 * disappears entirely below `lg` rather than shrinking into decoration.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  aside,
}: {
  title: string
  subtitle: ReactNode
  children: ReactNode
  footer?: ReactNode
  aside?: ReactNode
}) {
  return (
    <div className="grid min-h-screen bg-canvas paper-grain lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <Wordmark />
        {/* Every page needs a main landmark, identity screens included. */}
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <h1 className="font-serif text-3xl font-semibold leading-tight text-text">{title}</h1>
          <p className="mt-2.5 text-sm leading-relaxed text-text-secondary">{subtitle}</p>
          <div className="mt-7">{children}</div>
          {footer ? <div className="mt-6 text-[13px] text-text-secondary">{footer}</div> : null}
        </main>
        <p className="text-2xs text-text-muted">
          <Link to="/" className="hover:text-text">
            ← Back to dealflow360.com
          </Link>
        </p>
      </div>

      <aside className="hidden bg-ink-900 px-10 py-12 text-text-inverse lg:flex lg:flex-col lg:justify-center">
        {aside ?? <DefaultAside />}
      </aside>
    </div>
  )
}

function DefaultAside() {
  return (
    <div className="max-w-md">
      <p className="text-2xs font-semibold uppercase tracking-[0.09em] text-brass-300">
        What you are signing into
      </p>
      <h2 className="mt-3 font-serif text-2xl font-semibold leading-snug">
        One record every role reads differently
      </h2>
      <ul className="mt-6 space-y-4 text-[13px] leading-relaxed text-text-inverse-muted">
        <li>
          <span className="font-semibold text-text-inverse">Sales</span> builds terms and sees the
          approval they are about to trigger before submitting.
        </li>
        <li>
          <span className="font-semibold text-text-inverse">Managers and finance</span> decide in
          order, with the reason and the version in front of them.
        </li>
        <li>
          <span className="font-semibold text-text-inverse">Customers</span> negotiate and accept one
          exact version — and never see a cost or a margin.
        </li>
      </ul>
      <p className="mt-8 border-t border-line-inverse pt-5 text-2xs text-text-inverse-muted">
        Prices, policy decisions, approval order, stock reservation and proration are resolved on the
        server. The browser asks; it does not decide.
      </p>
    </div>
  )
}
