import { Navigate, Outlet, useLocation } from 'react-router-dom'

import type { Role } from '@/api'
import { ROLE_HOME } from '@/auth/capabilities'
import { useAuth } from '@/auth/useAuth'
import { Panel, Spinner } from '@/design-system'

/** The full-screen wait while a stored session is being verified against `/me`. */
function SessionLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="flex items-center gap-3 text-[13px] text-text-secondary">
        <Spinner label="Restoring your session" />
        Restoring your session…
      </div>
    </div>
  )
}

/**
 * Requires a signed-in identity.
 *
 * The attempted URL is carried through sign-in so a deep link survives the
 * round trip — landing someone on a generic home page after they clicked a
 * quotation link is a small thing that makes a workspace feel broken.
 */
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <SessionLoading />
  if (status === 'anonymous') {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />
  }
  return <Outlet />
}

/**
 * Restricts a branch of the app to a set of roles.
 *
 * Coarse by design: it keeps a customer out of `/admin` and staff out of the
 * portal, which are genuinely different applications sharing a build. Anything
 * finer — who may adopt, who may approve — is a capability check at the control
 * itself, so a Manager permitted to publish policy is never blocked by an
 * Admin-shaped wrapper.
 */
export function RequireRole({ roles }: { roles: Role[] }) {
  const { status, me } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <SessionLoading />
  if (status === 'anonymous' || !me) {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />
  }
  if (!roles.includes(me.role)) {
    return <Navigate to={ROLE_HOME[me.role]} replace />
  }
  return <Outlet />
}

/** Sends a signed-in user away from the sign-in screens. */
export function RedirectIfSignedIn() {
  const { status, me } = useAuth()
  const location = useLocation()
  const intended = (location.state as { from?: string } | null)?.from

  if (status === 'loading') return <SessionLoading />
  if (status === 'authenticated' && me) {
    return <Navigate to={intended ?? ROLE_HOME[me.role]} replace />
  }
  return <Outlet />
}

/** A denied branch that renders rather than redirecting, for nested sections. */
export function RoleGate({
  roles,
  children,
  reason,
}: {
  roles: Role[]
  children: React.ReactNode
  reason?: string
}) {
  const { me } = useAuth()
  if (me && roles.includes(me.role)) return <>{children}</>
  return (
    <Panel tone="muted" className="text-[13px] text-text-secondary">
      {reason ?? 'This section is not available to your role.'}
    </Panel>
  )
}
