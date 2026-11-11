import { Menu as MenuIcon, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'

import { ROLE_LABEL } from '@/api'
import { useAuth } from '@/auth/useAuth'
import { IconButton } from '@/design-system'
import { cn } from '@/lib/cn'

import { AssistantDock } from '@/features/assistant/AssistantDock'

import { Wordmark } from './Brand'
import { ConnectionIndicator, NotificationBell, SwitchPersonaButton, UserMenu } from './HeaderControls'
import { isActive, visibleNavigation } from './navigation'

/**
 * The staff workspace shell.
 *
 * A 232px sidebar and a 64px header at desktop widths; below `lg` the sidebar
 * becomes a drawer and the header keeps only what a phone can hold. Two rules
 * this layout exists to enforce:
 *
 *  - The header's two groups may both shrink, and the right-hand controls never
 *    do. A header whose contents cannot shrink is what made every page of the
 *    previous frontend scroll sideways at tablet width.
 *  - Exactly one element scrolls vertically — the main region — so a long table
 *    never moves the navigation off screen.
 */
export function AppShell() {
  const { me } = useAuth()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const groups = visibleNavigation(me)

  // A navigation is a completed intent: close the drawer behind it.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  return (
    <div className="flex min-h-screen bg-canvas">
      <a href="#workspace-main" className="skip-link">
        Skip to main content
      </a>

      {/* ------------------------------------------------------- sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-line-inverse bg-ink-900',
          'transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:w-[232px] lg:translate-x-0',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-line-inverse px-4">
          <Wordmark tone="paper" to="/admin" />
          <IconButton
            label="Close navigation"
            size="sm"
            className="lg:hidden text-text-inverse hover:bg-ink-700"
            onClick={() => setDrawerOpen(false)}
          >
            <X className="size-4" aria-hidden />
          </IconButton>
        </div>

        <nav aria-label="Workspace" className="scroll-subtle flex-1 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group.heading} className="mb-5 last:mb-0">
              <p className="px-2.5 pb-1.5 text-2xs font-semibold uppercase tracking-[0.1em] text-text-inverse-muted">
                {group.heading}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item, location.pathname)
                  const Icon = item.icon
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'group flex items-center gap-2.5 rounded-[--radius-control] px-2.5 py-2 text-[13px]',
                          'transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest-300',
                          active
                            ? 'bg-forest-500/18 font-semibold text-text-inverse'
                            : 'text-text-inverse-muted hover:bg-ink-700 hover:text-text-inverse',
                        )}
                      >
                        <Icon
                          aria-hidden
                          className={cn('size-4 shrink-0', active ? 'text-forest-200' : 'text-text-inverse-muted')}
                        />
                        <span className="min-w-0 truncate">{item.label}</span>
                        {active ? (
                          <span aria-hidden className="ml-auto h-4 w-0.5 rounded-full bg-forest-300" />
                        ) : null}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        {me ? (
          <div className="shrink-0 border-t border-line-inverse px-4 py-3">
            <p className="text-2xs font-medium uppercase tracking-wide text-text-inverse-muted">
              Signed in as
            </p>
            <p className="mt-0.5 truncate text-[13px] font-semibold text-text-inverse">
              {me.fullName ?? me.email}
            </p>
            <p className="truncate text-2xs text-text-inverse-muted">{ROLE_LABEL[me.role]}</p>
          </div>
        ) : null}
      </aside>

      {/* Scrim behind the mobile drawer. */}
      {drawerOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-30 bg-ink-950/40 lg:hidden"
        />
      ) : null}

      {/* --------------------------------------------------------- main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-canvas/92 backdrop-blur">
          <div className="flex h-16 min-w-0 items-center gap-3 px-4 sm:px-6">
            <IconButton
              label="Open navigation"
              className="lg:hidden"
              onClick={() => setDrawerOpen(true)}
            >
              <MenuIcon className="size-[18px]" aria-hidden />
            </IconButton>

            <div className="min-w-0 flex-1 lg:hidden">
              <Wordmark to="/admin" />
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              <SwitchPersonaButton />
              <ConnectionIndicator />
              <NotificationBell />
              <UserMenu />
            </div>
          </div>
        </header>

        <main id="workspace-main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1400px]">
            <Outlet />
          </div>
        </main>

        <AssistantDock />
      </div>
    </div>
  )
}
