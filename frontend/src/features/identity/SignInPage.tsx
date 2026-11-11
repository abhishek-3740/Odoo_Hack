import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRight, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { identity, keys, ROLE_LABEL, type DemoAccount, type Role } from '@/api'
import { ROLE_HOME } from '@/auth/capabilities'
import { useAuth } from '@/auth/useAuth'
import { REFERENCE_QUERY_OPTIONS } from '@/app/queryClient'
import { Badge, Button, Field, InlineError, Input, Panel, Spinner } from '@/design-system'
import { cn } from '@/lib/cn'

import { AuthShell } from './AuthShell'

/**
 * Sign in.
 *
 * The form is built from `/auth/options`, so it never renders a control the
 * server cannot honour: if password login is off there is no password field,
 * and if demo personas are off there is no persona chooser. Guessing here is
 * how a sign-in page ends up with a button that always fails.
 */
export default function SignInPage() {
  const { adopt, reason } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const intended = (location.state as { from?: string } | null)?.from

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPersonas, setShowPersonas] = useState(false)

  const options = useQuery({
    queryKey: keys.authOptions(),
    queryFn: () => identity.options(),
    ...REFERENCE_QUERY_OPTIONS,
  })

  const demoAccounts = useQuery({
    queryKey: keys.demoAccounts(),
    queryFn: () => identity.demoAccounts(),
    enabled: showPersonas && options.data?.demoPersonas === true,
    ...REFERENCE_QUERY_OPTIONS,
  })

  const signIn = useMutation({
    mutationFn: () => identity.login({ email: email.trim(), password }),
    onSuccess: async (token) => {
      const me = await adopt(token, 'LOCAL')
      navigate(intended ?? ROLE_HOME[me.role], { replace: true })
    },
  })

  const usePersona = useMutation({
    mutationFn: (account: DemoAccount) => identity.demoToken({ email: account.email }),
    onSuccess: async (token) => {
      const me = await adopt(token, 'DEMO')
      navigate(intended ?? ROLE_HOME[me.role], { replace: true })
    },
  })

  const canPassword = options.data?.passwordLogin !== false
  const canRegister = options.data?.selfRegistration === true
  const hasPersonas = options.data?.demoPersonas === true

  return (
    <AuthShell
      title="Sign in"
      subtitle="Open the workspace for your role — or the deal room, if you are here as a customer."
      footer={
        canRegister ? (
          <>
            <p>
              New customer?{' '}
              <Link to="/sign-up" className="font-medium text-forest-600 hover:underline">
                Create an account
              </Link>
            </p>
            <p className="mt-1">
              Joining an internal team?{' '}
              <Link to="/sign-up/team" className="font-medium text-forest-600 hover:underline">
                Set up a staff account
              </Link>
            </p>
          </>
        ) : null
      }
    >
      <div className="space-y-5">
        {reason ? (
          <div
            role="status"
            className="rounded-[--radius-control] border border-wait-border bg-wait-surface px-3.5 py-2.5 text-[13px] text-wait-text"
          >
            {reason}
          </div>
        ) : null}

        {options.isLoading ? (
          <div className="flex items-center gap-2 text-[13px] text-text-secondary">
            <Spinner /> Checking which sign-in methods this server offers…
          </div>
        ) : null}

        {options.error ? (
          <InlineError error={options.error} onRetry={() => void options.refetch()} />
        ) : null}

        {canPassword ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              signIn.mutate()
            }}
          >
            <Field label="Work email" required>
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                />
              )}
            </Field>

            <Field label="Password" required>
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                />
              )}
            </Field>

            {signIn.error ? <InlineError error={signIn.error} title="Could not sign in" /> : null}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              busy={signIn.isPending || usePersona.isPending}
              iconAfter={<ArrowRight className="size-4" />}
            >
              Sign in
            </Button>
          </form>
        ) : (
          <Panel tone="muted" className="text-[13px] text-text-secondary">
            This server does not accept password sign-in. Use the identity provider your
            administrator configured.
          </Panel>
        )}

        {hasPersonas ? (
          <div className="border-t border-line pt-5">
            {!showPersonas ? (
              <Button
                variant="secondary"
                className="w-full"
                icon={<Users className="size-4" />}
                onClick={() => setShowPersonas(true)}
              >
                Use a demo persona
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] font-semibold text-text">Demo personas</p>
                  <Badge tone="wait" size="sm">
                    Demonstration accounts
                  </Badge>
                </div>
                <p className="text-[13px] leading-relaxed text-text-secondary">
                  These are pre-seeded accounts on this server, offered because it has demo
                  authentication switched on. Everything they do is real.
                </p>

                {demoAccounts.isLoading ? (
                  <div className="flex items-center gap-2 text-[13px] text-text-secondary">
                    <Spinner /> Loading personas…
                  </div>
                ) : demoAccounts.error ? (
                  <InlineError
                    error={demoAccounts.error}
                    onRetry={() => void demoAccounts.refetch()}
                  />
                ) : (
                  <ul className="space-y-1.5">
                    {(demoAccounts.data ?? []).map((account) => (
                      <li key={account.email}>
                        <button
                          type="button"
                          disabled={usePersona.isPending}
                          onClick={() => usePersona.mutate(account)}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 rounded-[--radius-control]',
                            'border border-line bg-panel px-3.5 py-2.5 text-left transition-colors',
                            'hover:border-forest-300 hover:bg-forest-50 disabled:opacity-60',
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-500',
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium text-text">
                              {account.fullName ?? account.email}
                            </span>
                            <span className="block truncate text-2xs text-text-muted">
                              {account.email}
                            </span>
                          </span>
                          <Badge tone="neutral" size="sm">
                            {ROLE_LABEL[account.role as Role] ?? account.role}
                          </Badge>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {usePersona.error ? (
                  <InlineError error={usePersona.error} title="Could not switch persona" />
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </AuthShell>
  )
}
