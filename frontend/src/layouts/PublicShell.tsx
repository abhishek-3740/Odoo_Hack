import { ArrowRight, Menu as MenuIcon, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { ROLE_HOME } from '@/auth/capabilities'
import { useAuth } from '@/auth/useAuth'
import { IconButton } from '@/design-system'
import { cn } from '@/lib/cn'

import { Wordmark } from './Brand'

/**
 * The public shell: marketing site and open catalogue.
 *
 * Deliberately light — no query subscriptions, no socket, nothing that needs a
 * session. A visitor who has never signed in should download the smallest
 * useful thing, which is why the workspace is lazy and this is not.
 */

const SECTIONS = [
  { href: '/#workflow', label: 'Workflow' },
  { href: '/#roles', label: 'Teams' },
  { href: '/#negotiation', label: 'Negotiation' },
  { to: '/catalogue', label: 'Catalogue' },
]

export function PublicShell() {
  const { status, me } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [location.pathname, location.hash])

  const signedIn = status === 'authenticated' && me

  return (
    <div className="flex min-h-screen flex-col bg-canvas paper-grain">
      <a href="#public-main" className="skip-link">
        Skip to main content
      </a>

      <header className="sticky top-0 z-40 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto w-full max-w-[1240px] px-4 sm:px-6">
          <div className="flex h-16 min-w-0 items-center justify-between gap-4">
            <Wordmark />

            <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
              {SECTIONS.map((section) =>
                section.to ? (
                  <NavLink
                    key={section.label}
                    to={section.to}
                    className={({ isActive }) =>
                      cn(
                        'rounded-[--radius-control] px-3 py-2 text-[13px] font-medium transition-colors',
                        isActive
                          ? 'text-forest-700'
                          : 'text-text-secondary hover:bg-canvas-sunken hover:text-text',
                      )
                    }
                  >
                    {section.label}
                  </NavLink>
                ) : (
                  <a
                    key={section.label}
                    href={section.href}
                    className="rounded-[--radius-control] px-3 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:bg-canvas-sunken hover:text-text"
                  >
                    {section.label}
                  </a>
                ),
              )}
            </nav>

            <div className="flex shrink-0 items-center gap-2">
              {signedIn ? (
                <Link
                  to={ROLE_HOME[me.role]}
                  className="inline-flex h-10 items-center gap-1.5 rounded-[--radius-control] bg-forest-500 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-forest-600"
                >
                  Open workspace
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              ) : (
                <>
                  <Link
                    to="/sign-in"
                    className="hidden h-10 items-center rounded-[--radius-control] px-3 text-[13px] font-medium text-text-secondary transition-colors hover:bg-canvas-sunken hover:text-text sm:inline-flex"
                  >
                    Sign in
                  </Link>
                  <Link
                    to="/sign-up"
                    className="inline-flex h-10 items-center gap-1.5 rounded-[--radius-control] bg-forest-500 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-forest-600"
                  >
                    Get started
                  </Link>
                </>
              )}
              <IconButton
                label={open ? 'Close menu' : 'Open menu'}
                className="md:hidden"
                onClick={() => setOpen((value) => !value)}
              >
                {open ? <X className="size-[18px]" aria-hidden /> : <MenuIcon className="size-[18px]" aria-hidden />}
              </IconButton>
            </div>
          </div>
        </div>

        {open ? (
          <nav aria-label="Sections (compact)" className="border-t border-line bg-canvas px-4 py-2 md:hidden">
            <ul className="space-y-0.5">
              {SECTIONS.map((section) => (
                <li key={section.label}>
                  {section.to ? (
                    <Link
                      to={section.to}
                      className="flex min-h-11 items-center rounded-[--radius-control] px-3 text-sm font-medium text-text-secondary hover:bg-canvas-sunken"
                    >
                      {section.label}
                    </Link>
                  ) : (
                    <a
                      href={section.href}
                      className="flex min-h-11 items-center rounded-[--radius-control] px-3 text-sm font-medium text-text-secondary hover:bg-canvas-sunken"
                    >
                      {section.label}
                    </a>
                  )}
                </li>
              ))}
              {!signedIn ? (
                <li>
                  <Link
                    to="/sign-in"
                    className="flex min-h-11 items-center rounded-[--radius-control] px-3 text-sm font-medium text-text-secondary hover:bg-canvas-sunken"
                  >
                    Sign in
                  </Link>
                </li>
              ) : null}
            </ul>
          </nav>
        ) : null}
      </header>

      <main id="public-main" className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-line bg-ink-900 text-text-inverse">
        <div className="mx-auto w-full max-w-[1240px] px-4 py-10 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-8">
            <div className="max-w-sm">
              <Wordmark tone="paper" />
              <p className="mt-3 text-[13px] leading-relaxed text-text-inverse-muted">
                Quotation, discount approval, customer acceptance, fulfilment and billing as one
                connected workflow — with the figures resolved on the server, not guessed in a
                browser.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-[13px]">
              <a href="/#workflow" className="text-text-inverse-muted hover:text-text-inverse">
                Workflow
              </a>
              <Link to="/catalogue" className="text-text-inverse-muted hover:text-text-inverse">
                Catalogue
              </Link>
              <a href="/#roles" className="text-text-inverse-muted hover:text-text-inverse">
                Teams
              </a>
              <Link to="/sign-in" className="text-text-inverse-muted hover:text-text-inverse">
                Sign in
              </Link>
              <a href="/#faq" className="text-text-inverse-muted hover:text-text-inverse">
                Questions
              </a>
              <Link to="/sign-up" className="text-text-inverse-muted hover:text-text-inverse">
                Create an account
              </Link>
            </div>
          </div>
          <p className="mt-8 border-t border-line-inverse pt-5 text-2xs text-text-inverse-muted">
            Figures and records shown on this page are illustrative examples, labelled as such. They
            are not customer data.
          </p>
        </div>
      </footer>
    </div>
  )
}
