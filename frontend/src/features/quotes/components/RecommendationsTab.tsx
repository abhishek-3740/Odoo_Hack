import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, PlusCircle, Repeat2, X } from 'lucide-react'
import { toast } from 'sonner'

import {
  keys,
  recommendations as recommendationsApi,
  type QuoteEvaluation,
  type SellerOffer,
} from '@/api'
import {
  Badge,
  Button,
  EmptyState,
  InlineError,
  LoadingPanel,
  Panel,
  PanelHeader,
  Section,
  StatusBadge,
  approvalLevelStatus,
} from '@/design-system'
import { formatMoney, formatPercent } from '@/lib/money'

/**
 * Cross-sell and upsell, kept apart.
 *
 * They are different operations with different consequences and the plan is
 * explicit that they must not be one list:
 *
 *  - **Cross-sell adds a line.** Nothing existing changes.
 *  - **Upsell replaces a specific compatible line.** Something the customer was
 *    already being quoted goes away.
 *
 * Each offer states the price change, what it does to margin, whether it is in
 * stock and — the part that decides whether a salesperson uses it — whether
 * applying it would trigger an approval that did not exist a moment ago.
 */
export function RecommendationsTab({
  evaluation,
  canApply,
  applyDisabledReason,
}: {
  evaluation: QuoteEvaluation
  canApply: boolean
  applyDisabledReason?: string
}) {
  const quoteId = evaluation.quoteId
  const queryClient = useQueryClient()

  const offers = useQuery({
    queryKey: keys.quoteRecommendations(quoteId),
    queryFn: ({ signal }) => recommendationsApi.list(quoteId, signal),
  })

  const apply = useMutation({
    mutationFn: (offer: SellerOffer) =>
      recommendationsApi.apply(quoteId, {
        variantId: offer.variantId,
        replaceLineKey: offer.replaceLineKey,
        expectedRevisionId: evaluation.revisionId,
        expectedRowVersion: evaluation.rowVersion,
      }),
    onSuccess: (result, offer) => {
      toast.success(offer.replaceLineKey ? 'Line replaced' : 'Line added', {
        description: `The quotation is now version ${result.revisionNo}, re-priced by the server.`,
      })
      void queryClient.invalidateQueries({ queryKey: keys.quote(quoteId) })
      void queryClient.invalidateQueries({ queryKey: keys.quoteRecommendations(quoteId) })
    },
  })

  const dismiss = useMutation({
    mutationFn: (offer: SellerOffer) =>
      recommendationsApi.dismiss(quoteId, { variantId: offer.variantId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.quoteRecommendations(quoteId) })
    },
  })

  // The server prices every candidate against this quotation before answering,
  // which takes several seconds on a real catalogue. A bare skeleton for that
  // long reads as a broken screen, so say what is happening.
  if (offers.isLoading && !offers.data) {
    return (
      <LoadingPanel
        rows={3}
        label="Pricing each candidate against these terms. This takes a few seconds."
      />
    )
  }
  if (offers.error) return <InlineError error={offers.error} onRetry={() => void offers.refetch()} />

  const result = offers.data
  const suggestions = result?.suggestions ?? []
  const crossSell = suggestions.filter((offer) => offer.type !== 'UPSELL')
  const upsell = suggestions.filter((offer) => offer.type === 'UPSELL')

  // The revision moved under the offers: applying one would be refused, so say
  // so rather than letting the user find out from a 409.
  const stale = result != null && result.revisionId !== evaluation.revisionId

  return (
    <div className="space-y-6">
      {result?.note ? (
        <Panel tone="muted" className="text-[13px] leading-relaxed text-text-secondary">
          {result.note}
        </Panel>
      ) : null}

      {result?.limitedHistory ? (
        <Panel tone="muted" className="text-[13px] leading-relaxed text-text-secondary">
          These suggestions come from a small amount of order history
          {result.eligibleHistoricalOrders
            ? ` (${result.eligibleHistoricalOrders} comparable order${result.eligibleHistoricalOrders === 1 ? '' : 's'})`
            : ''}
          , so treat them as a starting point rather than a pattern.
        </Panel>
      ) : null}

      {stale ? (
        <Panel tone="muted" className="text-[13px] leading-relaxed text-wait-text">
          These offers were calculated against an earlier version of the quotation. Refresh before
          applying one — applying it now would be refused.
        </Panel>
      ) : null}

      <Section
        id="cross-sell"
        title="Add a useful item"
        description="Cross-sell. Adds a line; nothing currently quoted changes."
      >
        {crossSell.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<PlusCircle className="size-5" aria-hidden />}
              title="Nothing to add right now"
              description="Suggestions come from what comparable customers actually bought alongside these items."
            />
          </Panel>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {crossSell.map((offer) => (
              <OfferCard
                key={offer.variantId}
                offer={offer}
                currency={evaluation.currency}
                canApply={canApply && !stale}
                disabledReason={
                  stale ? 'Refresh the quotation first.' : applyDisabledReason
                }
                applying={apply.isPending}
                onApply={() => apply.mutate(offer)}
                onDismiss={() => dismiss.mutate(offer)}
              />
            ))}
          </div>
        )}
      </Section>

      <Section
        id="upsell"
        title="Upgrade an existing item"
        description="Upsell. Replaces the compatible line named on the offer, keeping supported quantity and terms."
      >
        {upsell.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<ArrowUpRight className="size-5" aria-hidden />}
              title="No compatible upgrade"
              description="An upgrade only appears when the catalogue marks a variant as compatible with one already on the quotation."
            />
          </Panel>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {upsell.map((offer) => (
              <OfferCard
                key={offer.variantId}
                offer={offer}
                currency={evaluation.currency}
                canApply={canApply && !stale}
                disabledReason={stale ? 'Refresh the quotation first.' : applyDisabledReason}
                applying={apply.isPending}
                onApply={() => apply.mutate(offer)}
                onDismiss={() => dismiss.mutate(offer)}
              />
            ))}
          </div>
        )}
      </Section>

      {apply.error ? <InlineError error={apply.error} title="Could not apply that offer" /> : null}
    </div>
  )
}

function OfferCard({
  offer,
  currency,
  canApply,
  disabledReason,
  applying,
  onApply,
  onDismiss,
}: {
  offer: SellerOffer
  currency: string
  canApply: boolean
  disabledReason?: string
  applying: boolean
  onApply: () => void
  onDismiss: () => void
}) {
  const level = approvalLevelStatus(offer.requiredApproval)
  const raisesApproval = offer.requiredApproval && offer.requiredApproval !== 'NONE'

  return (
    <Panel className="flex flex-col gap-3">
      <PanelHeader
        as="h4"
        title={offer.name}
        description={offer.reason ?? undefined}
        actions={
          offer.type === 'UPSELL' ? (
            <Badge tone="brass" size="sm" icon={<Repeat2 className="size-3" aria-hidden />}>
              Replaces a line
            </Badge>
          ) : (
            <Badge tone="info" size="sm" icon={<PlusCircle className="size-3" aria-hidden />}>
              Adds a line
            </Badge>
          )
        }
      />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
        <div>
          <dt className="text-text-secondary">Unit price</dt>
          <dd className="tabular font-medium">{formatMoney(offer.unitPrice, currency)}</dd>
        </div>
        <div>
          <dt className="text-text-secondary">Change to the quotation</dt>
          <dd className="tabular font-medium">
            {formatMoney(offer.netDelta, currency, { signed: true })}
          </dd>
        </div>
        {offer.contributionDelta != null ? (
          <div>
            <dt className="text-text-secondary">Contribution</dt>
            <dd className="tabular font-medium">
              {formatMoney(offer.contributionDelta, currency, { signed: true })}
            </dd>
          </div>
        ) : null}
        {offer.marginPercentDelta != null ? (
          <div>
            <dt className="text-text-secondary">Margin</dt>
            <dd className="tabular font-medium">
              {formatPercent(offer.marginPercentDelta)} points
            </dd>
          </div>
        ) : null}
      </dl>

      {offer.replaceLineKey ? (
        <p className="rounded-[--radius-control] bg-canvas-sunken px-3 py-2 text-[13px] text-text-secondary">
          Replaces the line <span className="font-medium text-text">{offer.replaceLineKey}</span>.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={offer.inStock ? 'ok' : 'wait'} size="sm">
          {offer.availabilityNote ?? (offer.inStock ? 'In stock' : 'Availability unconfirmed')}
        </Badge>
        {raisesApproval ? (
          <StatusBadge label={`Would need ${level.label.toLowerCase()}`} tone={level.tone} size="sm" />
        ) : (
          <Badge tone="ok" size="sm">
            Stays within policy
          </Badge>
        )}
      </div>

      <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-3">
        <Button
          size="sm"
          variant="primary"
          busy={applying}
          disabled={!canApply}
          disabledReason={disabledReason ?? 'This quotation cannot be changed right now.'}
          onClick={onApply}
        >
          {offer.type === 'UPSELL' ? 'Replace the line' : 'Add to the quotation'}
        </Button>
        <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={onDismiss}>
          Not relevant
        </Button>
      </div>
    </Panel>
  )
}
