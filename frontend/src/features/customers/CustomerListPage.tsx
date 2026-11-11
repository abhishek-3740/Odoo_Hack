import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Users } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { customers as customersApi, keys, people, TIER_LABEL, type CustomerTier } from '@/api'
import { useAuth } from '@/auth/useAuth'
import { CATALOG_QUERY_OPTIONS } from '@/app/queryClient'
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  FilterBar,
  InlineError,
  Input,
  PageHeader,
  Pagination,
  RefreshingHint,
  Select,
  Textarea,
  useDisclosure,
} from '@/design-system'

const TIERS: CustomerTier[] = ['BRONZE', 'SILVER', 'GOLD']

/**
 * Customer accounts.
 *
 * Tier is the field that matters most here and it is not cosmetic: it decides
 * which price rules apply and how much discount a salesperson may give before
 * an approval step is raised. The list says so rather than showing a coloured
 * chip with no explanation.
 */
export default function CustomerListPage() {
  const { me } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const create = useDisclosure()

  const search = params.get('q') ?? ''
  const page = Number(params.get('page') ?? '0')

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key)
      else next.set(key, value)
    }
    if (!('page' in patch)) next.delete('page')
    setParams(next, { replace: true })
  }

  const query = { search: search || undefined, page, pageSize: 25 }
  const list = useQuery({
    queryKey: keys.customers(query),
    queryFn: ({ signal }) => customersApi.list(query, signal),
  })

  const canCreate = me?.role === 'ADMIN' || me?.role === 'MANAGER' || me?.role === 'REP'

  return (
    <>
      <PageHeader
        title="Customers"
        description="Tier decides the price rules that apply and the discount ceiling before approval is required."
        meta={<RefreshingHint visible={list.isFetching && !list.isLoading} />}
        actions={
          canCreate ? (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={create.show}>
              New customer
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <div className="w-full flex-1 space-y-1.5 sm:min-w-64">
          <label htmlFor="customer-search" className="block text-[13px] font-medium text-text">
            Search
          </label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
            />
            <Input
              id="customer-search"
              type="search"
              className="pl-9"
              value={search}
              placeholder="Company name"
              onChange={(event) => update({ q: event.target.value })}
            />
          </div>
        </div>
      </FilterBar>

      <DataTable
        caption="Customers"
        rows={list.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        error={
          list.error ? <InlineError error={list.error} onRetry={() => void list.refetch()} /> : undefined
        }
        empty={
          <EmptyState
            icon={<Users className="size-5" aria-hidden />}
            title={search ? 'No customer matches that search' : 'No customers yet'}
            description="A customer is created here, or by someone signing up through the public site."
          />
        }
        onRowClick={(row) => navigate(`/admin/customers/${row.id}`)}
        columns={[
          {
            id: 'name',
            header: 'Company',
            cell: (row) => (
              <span>
                <span className="block font-medium text-text">{row.name}</span>
                {row.contactEmail ? (
                  <span className="block truncate text-2xs text-text-muted">{row.contactEmail}</span>
                ) : null}
              </span>
            ),
          },
          {
            id: 'tier',
            header: 'Tier',
            cell: (row) => (
              <Badge tone={row.tier === 'GOLD' ? 'brass' : 'neutral'} size="sm">
                {TIER_LABEL[row.tier] ?? row.tier}
              </Badge>
            ),
          },
          {
            id: 'currency',
            header: 'Currency',
            hideBelow: 'md',
            cell: (row) => <span className="tabular text-text-secondary">{row.currency}</span>,
          },
          {
            id: 'phone',
            header: 'Contact',
            hideBelow: 'lg',
            cell: (row) => (
              <span className="text-text-secondary">{row.contactPhone ?? '—'}</span>
            ),
          },
          {
            id: 'active',
            header: 'Status',
            cell: (row) => (
              <Badge tone={row.active ? 'ok' : 'neutral'} size="sm">
                {row.active ? 'Active' : 'Inactive'}
              </Badge>
            ),
          },
        ]}
      />

      {list.data ? (
        <Pagination
          page={list.data.page}
          pageSize={list.data.pageSize}
          totalItems={list.data.totalItems}
          totalPages={list.data.totalPages}
          busy={list.isFetching}
          onPageChange={(next) => update({ page: String(next) })}
        />
      ) : null}

      <CustomerDialog open={create.open} onOpenChange={create.setOpen} />
    </>
  )
}

/* ------------------------------------------------------------------ create */

export function CustomerDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    tier: 'BRONZE' as CustomerTier,
    currency: 'INR',
    contactEmail: '',
    contactPhone: '',
    billingAddress: '',
    ownerRepProfileId: '',
  })
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const reps = useQuery({
    queryKey: keys.profiles({ role: 'REP' }),
    queryFn: ({ signal }) => people.profiles({ role: 'REP', pageSize: 100 }, signal),
    enabled: open,
    ...CATALOG_QUERY_OPTIONS,
  })

  const create = useMutation({
    mutationFn: () =>
      customersApi.create({
        name: form.name.trim(),
        tier: form.tier,
        currency: form.currency.trim() || null,
        contactEmail: form.contactEmail.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        billingAddress: form.billingAddress.trim() || null,
        ownerRepProfileId: form.ownerRepProfileId || null,
      }),
    onSuccess: (customer) => {
      toast.success(`${customer.name} created`)
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'customers'] })
      navigate(`/admin/customers/${customer.id}`)
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New customer"
      description="Tier and currency affect pricing immediately, so set them deliberately."
      busy={create.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={create.isPending}
            disabled={!form.name.trim()}
            disabledReason="A company name is required."
            onClick={() => create.mutate()}
          >
            Create customer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Company name" required>
          {(props) => (
            <Input
              {...props}
              required
              value={form.name}
              onChange={(event) => set('name', event.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Tier"
            required
            hint="Decides the price rules and the discount ceiling before approval."
          >
            {(props) => (
              <Select
                {...props}
                value={form.tier}
                onChange={(event) => set('tier', event.target.value as CustomerTier)}
              >
                {TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {TIER_LABEL[tier]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Currency">
            {(props) => (
              <Input
                {...props}
                maxLength={3}
                value={form.currency}
                onChange={(event) => set('currency', event.target.value.toUpperCase())}
              />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact email">
            {(props) => (
              <Input
                {...props}
                type="email"
                value={form.contactEmail}
                onChange={(event) => set('contactEmail', event.target.value)}
              />
            )}
          </Field>
          <Field label="Contact phone">
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

        <Field label="Billing address">
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={form.billingAddress}
              onChange={(event) => set('billingAddress', event.target.value)}
            />
          )}
        </Field>

        <Field label="Account manager" hint="The salesperson who owns quotations for this customer.">
          {(props) => (
            <Select
              {...props}
              value={form.ownerRepProfileId}
              onChange={(event) => set('ownerRepProfileId', event.target.value)}
            >
              <option value="">Assign later</option>
              {(reps.data?.items ?? [])
                .filter((profile) => profile.active)
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.fullName ?? profile.email}
                  </option>
                ))}
            </Select>
          )}
        </Field>

        {create.error ? <InlineError error={create.error} title="Could not create" /> : null}
      </div>
    </Dialog>
  )
}
