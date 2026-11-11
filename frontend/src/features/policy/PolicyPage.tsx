import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { History, ShieldCheck, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import {
  catalog,
  keys,
  policy,
  TIER_LABEL,
  type CustomerTier,
  type DiscountPolicyDefinition,
} from '@/api'
import { canPublishPolicy } from '@/auth/capabilities'
import { useAuth } from '@/auth/useAuth'
import { CATALOG_QUERY_OPTIONS } from '@/app/queryClient'
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  Field,
  InlineError,
  Input,
  LoadingPanel,
  Panel,
  PanelHeader,
  PageHeader,
  PermissionBoundary,
  Section,
  Textarea,
  useDisclosure,
} from '@/design-system'
import { formatTimestamp } from '@/lib/dates'
import { formatMoney } from '@/lib/money'

const TIERS: CustomerTier[] = ['BRONZE', 'SILVER', 'GOLD']

/**
 * Discount governance.
 *
 * The rules on this page are the ones that decide, on every save, whether a
 * quotation needs a manager, a manager and finance, or nobody at all. Publishing
 * creates a new immutable version: the next evaluation uses it, and revisions
 * already submitted keep the version they were judged against — so a policy
 * change never retroactively approves or rejects a deal that was already decided.
 */
export default function PolicyPage() {
  const { me } = useAuth()
  const publish = useDisclosure()

  const current = useQuery({
    queryKey: keys.policyCurrent(),
    queryFn: ({ signal }) => policy.current(signal),
  })

  const history = useQuery({
    queryKey: keys.policyHistory(),
    queryFn: ({ signal }) => policy.history(signal),
  })

  const categories = useQuery({
    queryKey: keys.categories(),
    queryFn: ({ signal }) => catalog.categories(signal),
    ...CATALOG_QUERY_OPTIONS,
  })

  if (current.isLoading && !current.data) return <LoadingPanel rows={6} />
  if (current.error) {
    return (
      <InlineError
        error={current.error}
        title="The discount policy could not be read"
        onRetry={() => void current.refetch()}
      />
    )
  }

  const definition = current.data?.definition

  return (
    <>
      <PageHeader
        title="Discount policy"
        description="Ceilings and triggers. Every saved quotation version is measured against the version in force at that moment."
        meta={
          current.data ? (
            <>
              <Badge tone="ok" size="sm">
                Version {current.data.versionNo} in force
              </Badge>
              <span className="text-[13px] text-text-secondary">
                Effective {formatTimestamp(current.data.effectiveAt)}
              </span>
            </>
          ) : null
        }
        actions={
          <PermissionBoundary allowed={canPublishPolicy(me)}>
            <Button variant="primary" icon={<Upload className="size-4" />} onClick={publish.show}>
              Publish a new version
            </Button>
          </PermissionBoundary>
        }
      />

      {definition ? (
        <div className="space-y-6">
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel className="space-y-3">
              <PanelHeader
                title="Tier ceilings"
                description="The most a salesperson may concede to a customer of this tier before anyone has to say yes."
              />
              <ul className="space-y-1.5">
                {TIERS.map((tier) => (
                  <li
                    key={tier}
                    className="flex items-center justify-between gap-3 rounded-[--radius-control] bg-canvas-sunken px-3 py-2"
                  >
                    <span className="text-[13px] font-medium text-text">{TIER_LABEL[tier]}</span>
                    <span className="tabular text-[13px] font-semibold">
                      {definition.tierCeilingPercent[tier] ?? '—'}%
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel className="space-y-3">
              <PanelHeader
                title="Category ceilings"
                description="Keyed by category code, so renaming a category never moves its ceiling."
              />
              {Object.keys(definition.categoryCeilingPercent).length === 0 ? (
                <p className="text-[13px] text-text-secondary">No category-specific ceiling is set.</p>
              ) : (
                <ul className="space-y-1.5">
                  {Object.entries(definition.categoryCeilingPercent).map(([code, percent]) => {
                    const category = (categories.data ?? []).find((row) => row.code === code)
                    return (
                      <li
                        key={code}
                        className="flex items-center justify-between gap-3 rounded-[--radius-control] bg-canvas-sunken px-3 py-2"
                      >
                        <span className="min-w-0">
                          <span className="tabular block text-[13px] font-medium text-text">
                            {code}
                          </span>
                          {category ? (
                            <span className="block text-2xs text-text-muted">{category.name}</span>
                          ) : null}
                        </span>
                        <span className="tabular text-[13px] font-semibold">{percent}%</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Panel>
          </div>

          <Section
            id="triggers"
            title="What raises an approval"
            description="Step 1 is a manager; step 2 is finance and only ever follows step 1."
          >
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel className="space-y-3">
                <PanelHeader as="h3" title="Step 1 · manager" />
                <ul className="space-y-2 text-[13px] leading-relaxed">
                  <li className="flex gap-2">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-forest-500" aria-hidden />
                    <span>
                      {definition.manager.anyPositiveExcess
                        ? 'Any excess at all over a ceiling routes to a manager.'
                        : 'Excess over a ceiling alone does not route to a manager.'}
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-forest-500" aria-hidden />
                    <span>
                      Overall discount strictly above{' '}
                      <strong className="tabular">
                        {definition.manager.aggregateDiscountPercentAbove}%
                      </strong>
                      .
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-forest-500" aria-hidden />
                    <span>
                      Overall margin strictly below{' '}
                      <strong className="tabular">
                        {definition.manager.aggregateMarginPercentBelow}%
                      </strong>
                      .
                    </span>
                  </li>
                </ul>
              </Panel>

              <Panel className="space-y-3">
                <PanelHeader as="h3" title="Step 2 · finance" />
                <ul className="space-y-2 text-[13px] leading-relaxed">
                  <li className="flex gap-2">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brass-500" aria-hidden />
                    <span>
                      Worst single line at least{' '}
                      <strong className="tabular">
                        {definition.finance.worstLineExcessPpAtLeast} pp
                      </strong>{' '}
                      over its ceiling.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brass-500" aria-hidden />
                    <span>
                      Value-weighted excess at least{' '}
                      <strong className="tabular">
                        {definition.finance.weightedExcessPpAtLeast} pp
                      </strong>
                      .
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brass-500" aria-hidden />
                    <span>
                      Total conceded beyond ceilings at least{' '}
                      <strong className="tabular">
                        {formatMoney(
                          String(definition.finance.excessValueMinorAtLeast / 100),
                          'INR',
                        )}
                      </strong>
                      .
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brass-500" aria-hidden />
                    <span>
                      Overall margin below{' '}
                      <strong className="tabular">
                        {definition.finance.aggregateMarginPercentBelow}%
                      </strong>
                      .
                    </span>
                  </li>
                  {definition.finance.nonPositiveLineContribution ? (
                    <li className="flex gap-2">
                      <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brass-500" aria-hidden />
                      <span>Any line that sells at a positive price yet earns nothing or loses money.</span>
                    </li>
                  ) : null}
                </ul>
              </Panel>
            </div>
          </Section>

          <Section
            id="policy-history"
            title="Version history"
            description="Immutable. A quotation is always judged against the version that was in force when it was evaluated."
          >
            <DataTable
              caption="Discount policy versions"
              rows={history.data ?? []}
              rowKey={(row) => String(row.id ?? row.versionNo)}
              loading={history.isLoading}
              error={history.error ? <InlineError error={history.error} /> : undefined}
              empty={<EmptyHistory />}
              columns={[
                {
                  id: 'version',
                  header: 'Version',
                  cell: (row) => (
                    <span className="flex items-center gap-2">
                      <span className="tabular font-semibold">v{row.versionNo}</span>
                      {row.current ? (
                        <Badge tone="ok" size="sm">
                          In force
                        </Badge>
                      ) : null}
                    </span>
                  ),
                },
                {
                  id: 'effective',
                  header: 'Effective from',
                  cell: (row) => formatTimestamp(row.effectiveAt),
                },
                {
                  id: 'bronze',
                  header: 'Bronze',
                  align: 'right',
                  hideBelow: 'md',
                  cell: (row) => `${row.definition.tierCeilingPercent.BRONZE ?? '—'}%`,
                },
                {
                  id: 'silver',
                  header: 'Silver',
                  align: 'right',
                  hideBelow: 'md',
                  cell: (row) => `${row.definition.tierCeilingPercent.SILVER ?? '—'}%`,
                },
                {
                  id: 'gold',
                  header: 'Gold',
                  align: 'right',
                  hideBelow: 'md',
                  cell: (row) => `${row.definition.tierCeilingPercent.GOLD ?? '—'}%`,
                },
                {
                  id: 'note',
                  header: 'Note',
                  hideBelow: 'lg',
                  cell: (row) => <span className="text-text-secondary">{row.note ?? '—'}</span>,
                },
              ]}
            />
          </Section>
        </div>
      ) : null}

      {definition ? (
        <PublishDialog
          open={publish.open}
          onOpenChange={publish.setOpen}
          base={definition}
          categoryCodes={(categories.data ?? []).map((row) => row.code)}
        />
      ) : null}
    </>
  )
}

function EmptyHistory() {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <History className="mb-2 size-5 text-text-muted" aria-hidden />
      <p className="text-sm font-semibold text-text">Only the seeded version exists</p>
      <p className="mt-1 text-[13px] text-text-secondary">
        Publishing a change creates version 2 and leaves version 1 intact.
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------- publish */

function PublishDialog({
  open,
  onOpenChange,
  base,
  categoryCodes,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  base: DiscountPolicyDefinition
  categoryCodes: string[]
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<DiscountPolicyDefinition>(base)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (open) {
      setDraft(base)
      setNote('')
    }
  }, [open, base])

  const submit = useMutation({
    mutationFn: () => policy.publish({ definition: draft, note: note.trim() || null }),
    onSuccess: (result) => {
      toast.success(`Version ${result.versionNo} published`, {
        description: 'It applies to the next evaluation. Decisions already made are untouched.',
      })
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: keys.policyCurrent() })
      void queryClient.invalidateQueries({ queryKey: keys.policyHistory() })
    },
  })

  const setTier = (tier: CustomerTier, value: string) =>
    setDraft((current) => ({
      ...current,
      tierCeilingPercent: { ...current.tierCeilingPercent, [tier]: value },
    }))

  const setCategory = (code: string, value: string) =>
    setDraft((current) => {
      const next = { ...current.categoryCeilingPercent }
      if (value === '') delete next[code]
      else next[code] = value
      return { ...current, categoryCeilingPercent: next }
    })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Publish a new policy version"
      description="This becomes the version every future evaluation is measured against. Existing submissions keep the version they were judged on."
      size="lg"
      busy={submit.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={submit.isPending}
            disabled={note.trim().length < 3}
            disabledReason="Say why this version exists — it is kept with it permanently."
            onClick={() => submit.mutate()}
          >
            Publish
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-[13px] font-semibold text-text">Tier ceilings (%)</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {TIERS.map((tier) => (
              <Field key={tier} label={TIER_LABEL[tier]}>
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={draft.tierCeilingPercent[tier] ?? ''}
                    onChange={(event) => setTier(tier, event.target.value)}
                  />
                )}
              </Field>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[13px] font-semibold text-text">Category ceilings (%)</p>
          <p className="mb-2 text-[13px] leading-relaxed text-text-secondary">
            Leave one empty to remove its category-specific ceiling; the tier ceiling then applies
            on its own.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {categoryCodes.map((code) => (
              <Field key={code} label={code}>
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={draft.categoryCeilingPercent[code] ?? ''}
                    onChange={(event) => setCategory(code, event.target.value)}
                  />
                )}
              </Field>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[13px] font-semibold text-text">Step 1 · manager triggers</p>
          <div className="space-y-3">
            <Checkbox
              label="Any excess over a ceiling routes to a manager"
              hint="With this off, only the aggregate thresholds below raise a step 1."
              checked={draft.manager.anyPositiveExcess}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  manager: { ...current.manager, anyPositiveExcess: event.target.checked },
                }))
              }
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Overall discount above (%)">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    step="0.1"
                    value={draft.manager.aggregateDiscountPercentAbove}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        manager: {
                          ...current.manager,
                          aggregateDiscountPercentAbove: event.target.value,
                        },
                      }))
                    }
                  />
                )}
              </Field>
              <Field label="Overall margin below (%)">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    step="0.1"
                    value={draft.manager.aggregateMarginPercentBelow}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        manager: {
                          ...current.manager,
                          aggregateMarginPercentBelow: event.target.value,
                        },
                      }))
                    }
                  />
                )}
              </Field>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 text-[13px] font-semibold text-text">Step 2 · finance triggers</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Worst line over ceiling (pp)">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  step="0.1"
                  value={draft.finance.worstLineExcessPpAtLeast}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      finance: { ...current.finance, worstLineExcessPpAtLeast: event.target.value },
                    }))
                  }
                />
              )}
            </Field>
            <Field label="Weighted excess (pp)">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  step="0.1"
                  value={draft.finance.weightedExcessPpAtLeast}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      finance: { ...current.finance, weightedExcessPpAtLeast: event.target.value },
                    }))
                  }
                />
              )}
            </Field>
            <Field label="Conceded value (minor units)" hint="10000 minor units is ₹100.">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  value={draft.finance.excessValueMinorAtLeast}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      finance: {
                        ...current.finance,
                        excessValueMinorAtLeast: Number(event.target.value) || 0,
                      },
                    }))
                  }
                />
              )}
            </Field>
            <Field label="Overall margin below (%)">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  step="0.1"
                  value={draft.finance.aggregateMarginPercentBelow}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      finance: {
                        ...current.finance,
                        aggregateMarginPercentBelow: event.target.value,
                      },
                    }))
                  }
                />
              )}
            </Field>
          </div>
          <Checkbox
            className="mt-3"
            label="A line that earns nothing or loses money routes to finance"
            checked={draft.finance.nonPositiveLineContribution}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                finance: {
                  ...current.finance,
                  nonPositiveLineContribution: event.target.checked,
                },
              }))
            }
          />
        </div>

        <Field label="Why this version" required hint="Kept permanently with the version.">
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Gold ceiling raised to 15% for the Q4 push."
            />
          )}
        </Field>

        {submit.error ? <InlineError error={submit.error} /> : null}
      </div>
    </Dialog>
  )
}
