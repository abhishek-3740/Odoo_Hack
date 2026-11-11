import { FileText, LayoutDashboard, Menu as MenuIcon, ReceiptText, Store, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { TIER_LABEL } from '@/api'
import { useAuth } from '@/auth/useAuth'
import { Badge, IconButton } from '@/design-system'
import { cn } from '@/lib/cn'

import { AssistantDock } from '@/features/assistant/AssistantDock'

import { Wordmark } from './Brand'
import { ConnectionIndicator, UserMenu } from './HeaderControls'

/**
 * The customer deal room shell.
 *
 * Simpler than the staff workspace on purpose: five destinations, readable
 * content width, and a menu that appears well before the header runs out of
 * room. The previous portal forced full navigation at 768px and overflowed on
 * every page; the switch here happens at `lg`, where the row measurably fits.
 */

const LINKS = [
  { to: '/customer', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/customer/quotes', label: 'Quotations', icon: FileText, end: false },
  { to: '/customer/invoices', label: 'Invoices', icon: ReceiptText, end: false },
  { to: '/customer/catalogue', label: 'Catalogue', icon: Store, end: false },
]

export function CustomerShell() {
  const { me } = useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <a href="#portal-main" className="skip-link">
        Skip to main content
      </a>

      <header className="sticky top-0 z-30 border-b border-line bg-panel/94 backdrop-blur">
        <div className="mx-auto w-full max-w-[1180px] px-4 sm:px-6">
          {/* Both groups may shrink; the controls on the right never do. */}
          <div className="flex h-16 min-w-0 items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-6">
              <Wordmark to="/customer" suffix="Deal room" />
              <nav aria-label="Portal" className="hidden lg:flex lg:items-center lg:gap-1">
                {LINKS.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.end}
                    className={({ isActive }) =>
                      cn(
                        'rounded-[--radius-control] px-3 py-2 text-[13px] font-medium transition-colors',
                        isActive
                          ? 'bg-forest-50 text-forest-700'
                          : 'text-text-secondary hover:bg-canvas-sunken hover:text-text',
                      )
                    }
                  >
                    {link.label}
                  </NavLink>
                ))}
              </nav>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              {me?.customerName ? (
                <Badge tone="brass" className="hidden xl:inline-flex">
                  <span className="max-w-40 truncate">{me.customerName}</span>
                  {me.customerTier ? (
                    <span className="text-brass-600">· {TIER_LABEL[me.customerTier]}</span>
                  ) : null}
                </Badge>
              ) : null}
              <ConnectionIndicator className="hidden sm:inline-flex" />
              <UserMenu />
              <IconButton
                label={menuOpen ? 'Close menu' : 'Open menu'}
                className="lg:hidden"
                onClick={() => setMenuOpen((open) => !open)}
              >
                {menuOpen ? (
                  <X className="size-[18px]" aria-hidden />
                ) : (
                  <MenuIcon className="size-[18px]" aria-hidden />
                )}
              </IconButton>
            </div>
          </div>
        </div>

        {menuOpen ? (
          <nav
            aria-label="Portal (compact)"
            className="border-t border-line bg-panel px-4 py-2 lg:hidden"
          >
            <ul className="space-y-0.5">
              {LINKS.map((link) => {
                const Icon = link.icon
                return (
                  <li key={link.to}>
                    <NavLink
                      to={link.to}
                      end={link.end}
                      className={({ isActive }) =>
                        cn(
                          'flex min-h-11 items-center gap-2.5 rounded-[--radius-control] px-3 text-sm font-medium',
                          isActive
                            ? 'bg-forest-50 text-forest-700'
                            : 'text-text-secondary hover:bg-canvas-sunken',
                        )
                      }
                    >
                      <Icon className="size-4" aria-hidden />
                      {link.label}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
            {me?.customerName ? (
              <p className="border-t border-line px-3 pt-2 text-2xs text-text-muted">
                {me.customerName}
                {me.customerTier ? ` · ${TIER_LABEL[me.customerTier]} account` : ''}
              </p>
            ) : null}
          </nav>
        ) : null}
      </header>

      <main id="portal-main" className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-7 sm:px-6">
        <Outlet />
      </main>

      <footer className="border-t border-line bg-panel">
        <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-3 px-4 py-4 text-2xs text-text-muted sm:px-6">
          <p>
            Prices and availability are confirmed by your account manager. Accepting a quotation
            records your agreement to that exact version.
          </p>
          <Link to="/customer/account" className="font-medium text-forest-600 hover:underline">
            Account settings
          </Link>
        </div>
      </footer>

      <AssistantDock />
    </div>
  )
}
