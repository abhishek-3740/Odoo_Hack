import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { identity, keys, ROLE_LABEL, type Role } from '@/api'
import { ROLE_HOME } from '@/auth/capabilities'
import { useAuth } from '@/auth/useAuth'
import { REFERENCE_QUERY_OPTIONS } from '@/app/queryClient'
import { Button, Field, InlineError, Input, Select } from '@/design-system'

import { AuthShell } from './AuthShell'

const INTERNAL_ROLES: Array<Exclude<Role, 'CUSTOMER'>> = ['REP', 'MANAGER', 'FINANCE', 'ADMIN']

const ROLE_NOTE: Record<string, string> = {
  REP: 'Builds quotations, submits them for approval and shares them with customers.',
  MANAGER: 'Step 1 approvals for the team, plus team reporting and deal health.',
  FINANCE: 'Step 2 approvals, invoicing, subscriptions, receipts, stock and dispatch.',
  ADMIN: 'Catalogue, discount policy, people, delegations and manual jobs.',
}

/**
 * Internal staff sign-up.
 *
 * A team is required for a rep or a manager, because scope — "my team's
 * quotations", "my team's approvals" — is derived from it server-side. The form
 * offers the existing teams and allows naming a new one, which is what the
 * endpoint actually supports.
 */
export default function InternalSignUpPage() {
  const { adopt } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    role: 'REP' as Exclude<Role, 'CUSTOMER'>,
    teamId: '',
    teamName: '',
  })
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const teams = useQuery({
    queryKey: keys.publicTeams(),
    queryFn: () => identity.publicTeams(),
    ...REFERENCE_QUERY_OPTIONS,
  })

  const register = useMutation({
    mutationFn: () =>
      identity.registerInternal({
        email: form.email.trim(),
        password: form.password,
        fullName: form.fullName.trim(),
        role: form.role,
        teamId: form.teamId || null,
        teamName: form.teamId ? null : form.teamName.trim() || null,
        phone: form.phone.trim() || null,
      }),
    onSuccess: async (token) => {
      const me = await adopt(token, 'LOCAL')
      navigate(ROLE_HOME[me.role], { replace: true })
    },
  })

  const needsTeam = form.role === 'REP' || form.role === 'MANAGER'
  const teamMissing = needsTeam && !form.teamId && !form.teamName.trim()
  const passwordTooShort = form.password.length > 0 && form.password.length < 8

  return (
    <AuthShell
      title="Set up a staff account"
      subtitle="Sales, managers, finance and administrators share one workspace and see the parts of it their role allows."
      footer={
        <p>
          Buying rather than selling?{' '}
          <Link to="/sign-up" className="font-medium text-forest-600 hover:underline">
            Create a customer account
          </Link>
        </p>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          register.mutate()
        }}
      >
        <Field label="Full name" required>
          {(props) => (
            <Input
              {...props}
              required
              autoComplete="name"
              value={form.fullName}
              onChange={(event) => set('fullName', event.target.value)}
            />
          )}
        </Field>

        <Field label="Work email" required>
          {(props) => (
            <Input
              {...props}
              type="email"
              required
              autoComplete="username"
              value={form.email}
              onChange={(event) => set('email', event.target.value)}
            />
          )}
        </Field>

        <Field label="Role" required hint={ROLE_NOTE[form.role]}>
          {(props) => (
            <Select
              {...props}
              value={form.role}
              onChange={(event) => set('role', event.target.value as Exclude<Role, 'CUSTOMER'>)}
            >
              {INTERNAL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {needsTeam ? (
          <>
            <Field
              label="Team"
              hint="A rep's and a manager's scope — whose quotations and approvals they see — comes from their team."
            >
              {(props) => (
                <Select
                  {...props}
                  value={form.teamId}
                  onChange={(event) => set('teamId', event.target.value)}
                >
                  <option value="">Create a new team…</option>
                  {(teams.data ?? []).map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {!form.teamId ? (
              <Field label="New team name" required>
                {(props) => (
                  <Input
                    {...props}
                    required
                    value={form.teamName}
                    onChange={(event) => set('teamName', event.target.value)}
                    placeholder="North region desk"
                  />
                )}
              </Field>
            ) : null}
          </>
        ) : null}

        <Field label="Phone">
          {(props) => (
            <Input
              {...props}
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(event) => set('phone', event.target.value)}
            />
          )}
        </Field>

        <Field
          label="Password"
          required
          error={passwordTooShort ? 'Use at least 8 characters.' : null}
        >
          {(props) => (
            <Input
              {...props}
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => set('password', event.target.value)}
            />
          )}
        </Field>

        {register.error ? (
          <InlineError error={register.error} title="Could not create the account" />
        ) : null}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          busy={register.isPending}
          disabled={teamMissing || passwordTooShort}
          disabledReason={
            teamMissing
              ? 'Choose an existing team or name a new one.'
              : 'The password needs at least 8 characters.'
          }
          iconAfter={<ArrowRight className="size-4" />}
        >
          Create staff account
        </Button>
      </form>
    </AuthShell>
  )
}
