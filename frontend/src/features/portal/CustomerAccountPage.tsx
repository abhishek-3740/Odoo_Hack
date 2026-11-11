import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { keys, portalAccount, TIER_LABEL } from '@/api'
import { useAuth } from '@/auth/useAuth'
import {
  Badge,
  Button,
  Checkbox,
  DetailRow,
  Dialog,
  Field,
  InlineError,
  Input,
  LoadingPanel,
  Panel,
  PanelHeader,
  PageHeader,
  Section,
  Textarea,
  useDisclosure,
} from '@/design-system'
import { formatTimestamp } from '@/lib/dates'

/**
 * The customer's own account.
 *
 * Password change is offered only when the server says this identity actually
 * has a local credential — a demo persona or a hosted identity has nothing to
 * change here, and showing the form anyway would guarantee a confusing failure.
 */
export default function CustomerAccountPage() {
  const { me, refresh } = useAuth()
  const queryClient = useQueryClient()
  const password = useDisclosure()

  const account = useQuery({
    queryKey: keys.portalAccount(),
    queryFn: ({ signal }) => portalAccount.get(signal),
  })

  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    contactEmail: '',
    contactPhone: '',
    billingAddress: '',
  })
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    const data = account.data
    if (!data || dirty) return
    setForm({
      fullName: data.fullName ?? '',
      phone: data.phone ?? '',
      contactEmail: data.organisation?.contactEmail ?? '',
      contactPhone: data.organisation?.contactPhone ?? '',
      billingAddress: data.organisation?.billingAddress ?? '',
    })
  }, [account.data, dirty])

  const set = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    setDirty(true)
  }

  const save = useMutation({
    mutationFn: () =>
      portalAccount.update({
        fullName: form.fullName.trim() || null,
        phone: form.phone.trim() || null,
        contactEmail: form.contactEmail.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        billingAddress: form.billingAddress.trim() || null,
      }),
    onSuccess: () => {
      toast.success('Account updated')
      setDirty(false)
      void queryClient.invalidateQueries({ queryKey: keys.portalAccount() })
      void refresh()
    },
  })

  const preferences = useMutation({
    mutationFn: (next: Record<string, unknown>) => portalAccount.savePreferences(next),
    onSuccess: () => {
      toast.success('Preferences saved')
      void queryClient.invalidateQueries({ queryKey: keys.portalAccount() })
    },
  })

  if (account.isLoading && !account.data) return <LoadingPanel rows={6} />
  if (account.error) {
    return (
      <InlineError
        error={account.error}
        title="Your account could not be loaded"
        onRetry={() => void account.refetch()}
      />
    )
  }
  if (!account.data) return null

  const data = account.data
  const prefs = data.preferences ?? {}

  return (
    <>
      <PageHeader
        title="Account settings"
        description="Your contact details and your organisation's billing information."
        meta={
          <>
            <Badge tone="neutral" size="sm">
              {data.authProvider === 'LOCAL'
                ? 'Password account'
                : data.authProvider === 'DEMO'
                  ? 'Demo persona'
                  : 'Single sign-on'}
            </Badge>
            {data.memberSince ? (
              <span className="text-[13px] text-text-secondary">
                With us since {formatTimestamp(data.memberSince)}
              </span>
            ) : null}
          </>
        }
        actions={
          data.canChangePassword ? (
            <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={password.show}>
              Change password
            </Button>
          ) : null
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Section id="you" title="You" description="How we reach you personally.">
            <Panel className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Your name">
                  {(props) => (
                    <Input
                      {...props}
                      value={form.fullName}
                      onChange={(event) => set('fullName', event.target.value)}
                    />
                  )}
                </Field>
                <Field label="Your phone">
                  {(props) => (
                    <Input
                      {...props}
                      type="tel"
                      value={form.phone}
                      onChange={(event) => set('phone', event.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Field label="Sign-in email" hint="Changing this is not supported here — ask your account manager.">
                {(props) => <Input {...props} value={data.email} disabled />}
              </Field>
            </Panel>
          </Section>

          <Section
            id="organisation"
            title="Organisation"
            description="Where invoices are sent and how we contact your company."
          >
            <Panel className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Company contact email">
                  {(props) => (
                    <Input
                      {...props}
                      type="email"
                      value={form.contactEmail}
                      onChange={(event) => set('contactEmail', event.target.value)}
                    />
                  )}
                </Field>
                <Field label="Company phone">
                  {(props) => (
                    <Input
                      {...props}
                      type="tel"
                      value={form.contactPhone}
                      onChange={(event) => set('contactPhone', event.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Field label="Billing address" hint="Appears on every invoice we raise.">
                {(props) => (
                  <Textarea
                    {...props}
                    rows={3}
                    value={form.billingAddress}
                    onChange={(event) => set('billingAddress', event.target.value)}
                  />
                )}
              </Field>
            </Panel>
          </Section>

          {save.error ? <InlineError error={save.error} title="Could not save" /> : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              icon={<Save className="size-4" />}
              busy={save.isPending}
              disabled={!dirty}
              disabledReason="Nothing has changed."
              onClick={() => save.mutate()}
            >
              Save changes
            </Button>
            {dirty ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setDirty(false)
                  const current = account.data
                  if (current) {
                    setForm({
                      fullName: current.fullName ?? '',
                      phone: current.phone ?? '',
                      contactEmail: current.organisation?.contactEmail ?? '',
                      contactPhone: current.organisation?.contactPhone ?? '',
                      billingAddress: current.organisation?.billingAddress ?? '',
                    })
                  }
                }}
              >
                Discard
              </Button>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <Panel className="space-y-2">
            <PanelHeader title="Your organisation" />
            <dl className="divide-y divide-line">
              <DetailRow label="Name">{data.organisation?.name ?? me?.customerName ?? '—'}</DetailRow>
              <DetailRow label="Account level">
                {data.organisation?.tier ? (TIER_LABEL[data.organisation.tier] ?? data.organisation.tier) : '—'}
              </DetailRow>
              <DetailRow label="Currency">{data.organisation?.currency ?? '—'}</DetailRow>
            </dl>
          </Panel>

          <Panel className="space-y-2">
            <PanelHeader title="Your account manager" />
            <dl className="divide-y divide-line">
              <DetailRow label="Name">{data.accountManager?.name ?? '—'}</DetailRow>
              <DetailRow label="Email">{data.accountManager?.email ?? '—'}</DetailRow>
            </dl>
            <p className="border-t border-line pt-3 text-[13px] leading-relaxed text-text-secondary">
              Questions about a quotation are best asked inside the quotation itself — they arrive
              with the version you were looking at.
            </p>
          </Panel>

          <Panel className="space-y-3">
            <PanelHeader
              title="Preferences"
              description="Stored against your profile and used by the workspace."
            />
            <Checkbox
              label="Email me when a quotation is shared or updated"
              checked={Boolean(prefs.notifyOnQuoteUpdates ?? true)}
              onChange={(event) =>
                preferences.mutate({ ...prefs, notifyOnQuoteUpdates: event.target.checked })
              }
            />
            <Checkbox
              label="Email me when an invoice is raised"
              checked={Boolean(prefs.notifyOnInvoices ?? true)}
              onChange={(event) =>
                preferences.mutate({ ...prefs, notifyOnInvoices: event.target.checked })
              }
            />
            <p className="text-[13px] leading-relaxed text-text-secondary">
              These record what you would like. Whether an email actually goes out depends on the
              mail transport your supplier has configured, so we do not promise delivery here.
            </p>
            {preferences.error ? <InlineError error={preferences.error} /> : null}
          </Panel>
        </div>
      </div>

      <PasswordDialog open={password.open} onOpenChange={password.setOpen} />
    </>
  )
}

function PasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')

  const change = useMutation({
    mutationFn: () => portalAccount.changePassword(current, next),
    onSuccess: () => {
      toast.success('Password changed')
      setCurrent('')
      setNext('')
      onOpenChange(false)
    },
  })

  const tooShort = next.length > 0 && next.length < 8

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change your password"
      description="You stay signed in on this device."
      busy={change.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={change.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={change.isPending}
            disabled={!current || next.length < 8}
            disabledReason="Enter your current password and a new one of at least 8 characters."
            onClick={() => change.mutate()}
          >
            Change password
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Current password" required>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          )}
        </Field>
        <Field
          label="New password"
          required
          error={tooShort ? 'Use at least 8 characters.' : null}
        >
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          )}
        </Field>
        {change.error ? <InlineError error={change.error} /> : null}
      </div>
    </Dialog>
  )
}
