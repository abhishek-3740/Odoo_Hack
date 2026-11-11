import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ScrollText, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import {
  customers as customersApi,
  keys,
  quotes as quotesApi,
  STAGE_LABEL,
  type UUID,
} from '@/api'
import { can } from '@/auth/capabilities'
import { useAuth } from '@/auth/useAuth'
import { CATALOG_QUERY_OPTIONS } from '@/app/queryClient'
import {
  Badge,
  Button,
  DataTable,
  DateInput,
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
  StatusBadge,
  approvalStatus,
  stageStatus,
  useDisclosure,
} from '@/design-system'
import { businessDatePlusDays, formatBusinessDate, formatRelative } from '@/lib/dates'
import { formatMoney, formatPercent } from '@/lib/money'

const STAGES = [
  'DRAFT',
  'REVIEW',
  'SENT',
  'UNDER_NEGOTIATION',
  'CONFIRMED',
  'CANCELED',
  'LOST',
  'EXPIRED',
]

/**
 * The pipeline.
 *
 * Filters live in the URL, so a filtered view is a link someone can send. Scope
 * is the server's decision — a rep sees their team's deals, a manager theirs,
 * finance and admins everything — and the page says which scope it is showing
 * rather than implying it is the whole business.
 */
export default function PipelinePage() {
  const { me } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const createDialog = useDisclosure()

  const stage = params.get('stage') ?? ''
  const customerId = params.get('customerId') ?? ''
  const page = Number(params.get('page') ?? '0')
  const search = params.get('q') ?? ''

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    // Any filter change resets to the first page; keeping the old page number
    // is how a filtered list ends up looking empty when it is not.
    if (!('page' in patch)) next.delete('page')
    setParams(next, { replace: true })
  }

  const query = { stage: stage || undefined, customerId: customerId || undefined, page, pageSize: 25 }
  const list = useQuery({
    queryKey: keys.quoteList(query),
    queryFn: ({ signal }) => quotesApi.list(query, signal),
  })

  // The pipeline endpoint has no text search, so filtering by reference or
  // customer name is done on the page that is loaded — and labelled as such.
  const rows = useMemo(() => {
    const items = list.data?.items ?? []
    const needle = search.trim().toLowerCase()
    if (!needle) return items
    return items.filter(
      (row) =>
        row.reference.toLowerCase().includes(needle) ||
        (row.customerName ?? '').toLowerCase().includes(needle) ||
        (row.title ?? '').toLowerCase().includes(needle),
    )
  }, [list.data, search])

  return (
    <>
      <PageHeader
        title="Quotations"
        description={
          me?.role === 'REP'
            ? 'Your team’s quotations. Ownership and visibility are decided by the server.'
            : me?.role === 'MANAGER'
              ? 'Your team’s quotations.'
              : 'Every quotation you are entitled to see.'
        }
        meta={<RefreshingHint visible={list.isFetching && !list.isLoading} />}
        actions={
          can(me, 'quotes:create') || me?.role === 'ADMIN' ? (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={createDialog.show}>
              New quotation
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <div className="w-full flex-1 space-y-1.5 sm:min-w-56">
          <label htmlFor="pipeline-search" className="block text-[13px] font-medium text-text">
            Search this page
          </label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
            />
            <Input
              id="pipeline-search"
              type="search"
              className="pl-9"
              value={search}
              placeholder="Reference, customer or title"
              onChange={(event) => update({ q: event.target.value })}
            />
          </div>
        </div>

        <div className="w-52 space-y-1.5">
          <label htmlFor="pipeline-stage" className="block text-[13px] font-medium text-text">
            Stage
          </label>
          <Select
            id="pipeline-stage"
            value={stage}
            onChange={(event) => update({ stage: event.target.value })}
          >
            <option value="">Every stage</option>
            {STAGES.map((value) => (
              <option key={value} value={value}>
                {STAGE_LABEL[value] ?? value}
              </option>
            ))}
          </Select>
        </div>

        {stage || search ? (
          <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>
            Clear filters
          </Button>
        ) : null}
      </FilterBar>

      {search ? (
        <p className="mb-3 text-[13px] text-text-secondary">
          Searching within the {list.data?.items.length ?? 0} quotations on this page. The server
          filters by stage and customer; text search is local to what is loaded.
        </p>
      ) : null}

      <DataTable
        caption="Quotations"
        rows={rows}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        error={
          list.error ? <InlineError error={list.error} onRetry={() => void list.refetch()} /> : undefined
        }
        empty={
          <EmptyState
            icon={<ScrollText className="size-5" aria-hidden />}
            title={stage ? `No quotations in ${STAGE_LABEL[stage] ?? stage}` : 'No quotations yet'}
            description="A quotation starts here, or arrives when a customer asks for one from the catalogue."
            action={
              can(me, 'quotes:create') ? (
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={createDialog.show}>
                  New quotation
                </Button>
              ) : undefined
            }
          />
        }
        onRowClick={(row) => navigate(`/admin/quotes/${row.id}`)}
        columns={[
          {
            id: 'reference',
            header: 'Reference',
            cell: (row) => (
              <span>
                <span className="tabular block font-semibold text-text">{row.reference}</span>
                {row.title ? (
                  <span className="block max-w-56 truncate text-2xs text-text-muted">{row.title}</span>
                ) : null}
              </span>
            ),
          },
          {
            id: 'customer',
            header: 'Customer',
            cell: (row) => <span className="text-text">{row.customerName ?? '—'}</span>,
          },
          {
            id: 'owner',
            header: 'Owner',
            hideBelow: 'lg',
            cell: (row) => <span className="text-text-secondary">{row.ownerName ?? '—'}</span>,
          },
          {
            id: 'stage',
            header: 'Stage',
            cell: (row) => {
              const presentation = stageStatus(row.stage)
              return <StatusBadge label={presentation.label} tone={presentation.tone} size="sm" />
            },
          },
          {
            id: 'approval',
            header: 'Approval',
            hideBelow: 'md',
            cell: (row) => {
              const presentation = approvalStatus(row.approvalStatus)
              return (
                <Badge tone={presentation.tone} size="sm">
                  {presentation.label}
                </Badge>
              )
            },
          },
          {
            id: 'oneTime',
            header: 'One-time',
            align: 'right',
            cell: (row) => formatMoney(row.oneTimeNet, row.currency),
          },
          {
            id: 'recurring',
            header: 'Recurring',
            align: 'right',
            hideBelow: 'lg',
            cell: (row) =>
              Number(row.recurringFirstCycleNet ?? 0) > 0 ? (
                <span>
                  {formatMoney(row.recurringFirstCycleNet, row.currency)}
                  <span className="block text-2xs font-normal text-text-muted">first cycle</span>
                </span>
              ) : (
                <span className="text-text-muted">—</span>
              ),
          },
          {
            id: 'margin',
            header: 'Margin',
            align: 'right',
            hideBelow: 'xl',
            cell: (row) => formatPercent(row.contributionPercent),
          },
          {
            id: 'activity',
            header: 'Last activity',
            hideBelow: 'xl',
            cell: (row) => (
              <span className="text-text-secondary">{formatRelative(row.lastActivityAt)}</span>
            ),
          },
          {
            id: 'valid',
            header: 'Valid to',
            align: 'right',
            hideBelow: 'xl',
            cell: (row) => formatBusinessDate(row.validUntil),
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

      <NewQuoteDialog
        open={createDialog.open}
        onOpenChange={createDialog.setOpen}
        onCreated={(quoteId) => {
          void queryClient.invalidateQueries({ queryKey: keys.quotes() })
          navigate(`/admin/quotes/${quoteId}`)
        }}
      />
    </>
  )
}

/* ------------------------------------------------------------ new quotation */

function NewQuoteDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (quoteId: UUID) => void
}) {
  const [customerId, setCustomerId] = useState('')
  const [title, setTitle] = useState('')
  const [validUntil, setValidUntil] = useState<string | null>(businessDatePlusDays(30))

  const customers = useQuery({
    queryKey: keys.customers({ pageSize: 200 }),
    queryFn: ({ signal }) => customersApi.list({ pageSize: 200 }, signal),
    enabled: open,
    ...CATALOG_QUERY_OPTIONS,
  })

  const create = useMutation({
    mutationFn: () =>
      quotesApi.create({
        customerId,
        title: title.trim() || null,
        validUntil,
      }),
    onSuccess: (result) => {
      onOpenChange(false)
      setTitle('')
      setCustomerId('')
      onCreated(result.quoteId)
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New quotation"
      description="Pick the customer. Their tier decides which price rules apply and how much discount is allowed before approval."
      busy={create.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={create.isPending}
            disabled={!customerId}
            disabledReason="Choose a customer first."
            onClick={() => create.mutate()}
          >
            Create and open
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Customer" required>
          {(props) => (
            <Select
              {...props}
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <option value="">Choose a customer…</option>
              {(customers.data?.items ?? [])
                .filter((customer) => customer.active)
                .map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} · {customer.tier}
                  </option>
                ))}
            </Select>
          )}
        </Field>

        <Field label="Title" hint="Optional. A short description you will recognise in the list.">
          {(props) => (
            <Input
              {...props}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Q3 network refresh"
            />
          )}
        </Field>

        <DateInput
          label="Valid until"
          hint="After this date the quotation expires and can no longer be accepted."
          value={validUntil}
          onChange={setValidUntil}
        />

        {customers.error ? <InlineError error={customers.error} /> : null}
        {create.error ? <InlineError error={create.error} title="Could not create" /> : null}
      </div>
    </Dialog>
  )
}
