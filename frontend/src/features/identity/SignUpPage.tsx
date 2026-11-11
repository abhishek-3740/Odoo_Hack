import { useMutation } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { identity } from '@/api'
import { ROLE_HOME } from '@/auth/capabilities'
import { useAuth } from '@/auth/useAuth'
import { Button, Field, InlineError, Input } from '@/design-system'

import { AuthShell } from './AuthShell'

/** Customer self-registration. Creates the organisation and the first contact. */
export default function SignUpPage() {
  const { adopt } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    fullName: '',
    companyName: '',
    email: '',
    phone: '',
    password: '',
  })
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  const register = useMutation({
    mutationFn: () =>
      identity.register({
        email: form.email.trim(),
        password: form.password,
        fullName: form.fullName.trim(),
        companyName: form.companyName.trim(),
        phone: form.phone.trim() || null,
      }),
    onSuccess: async (token) => {
      const me = await adopt(token, 'LOCAL')
      navigate(ROLE_HOME[me.role], { replace: true })
    },
  })

  // The server bounds the password at 8–128; saying so before submission is
  // kinder than a round trip that comes back with a field error.
  const passwordTooShort = form.password.length > 0 && form.password.length < 8

  return (
    <AuthShell
      title="Create a customer account"
      subtitle="See your quotations, negotiate them, accept the version you agree to, and read your invoices."
      footer={
        <p>
          Already have an account?{' '}
          <Link to="/sign-in" className="font-medium text-forest-600 hover:underline">
            Sign in
          </Link>
        </p>
      }
      aside={
        <div className="max-w-md">
          <p className="text-2xs font-semibold uppercase tracking-[0.09em] text-brass-300">
            Your deal room
          </p>
          <h2 className="mt-3 font-serif text-2xl font-semibold leading-snug">
            Everything about your quotation, in one place
          </h2>
          <ul className="mt-6 space-y-4 text-[13px] leading-relaxed text-text-inverse-muted">
            <li>See exactly what is one-time and what recurs, and what is payable today.</li>
            <li>Ask for a discount on one line or the whole quotation, and see the answer.</li>
            <li>Accept one exact version — the same one the invoice is raised from.</li>
          </ul>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          register.mutate()
        }}
      >
        <Field label="Your name" required>
          {(props) => (
            <Input
              {...props}
              required
              autoComplete="name"
              value={form.fullName}
              onChange={(event) => set('fullName')(event.target.value)}
            />
          )}
        </Field>

        <Field
          label="Company"
          required
          hint="This becomes your organisation. Your account manager will be assigned to it."
        >
          {(props) => (
            <Input
              {...props}
              required
              autoComplete="organization"
              value={form.companyName}
              onChange={(event) => set('companyName')(event.target.value)}
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
              onChange={(event) => set('email')(event.target.value)}
            />
          )}
        </Field>

        <Field label="Phone" hint="Optional. Used by your account manager, not for marketing.">
          {(props) => (
            <Input
              {...props}
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(event) => set('phone')(event.target.value)}
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
              onChange={(event) => set('password')(event.target.value)}
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
          disabled={passwordTooShort}
          disabledReason="The password needs at least 8 characters."
          iconAfter={<ArrowRight className="size-4" />}
        >
          Create account
        </Button>
      </form>
    </AuthShell>
  )
}
