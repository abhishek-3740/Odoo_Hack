import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  Handshake,
  MessageSquare,
  Percent,
  Send,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
  ApiError,
  keys,
  newIdempotencyKey,
  portal,
  type PortalLine,
  type PortalQuoteDetail,
} from '@/api'
import {
  Badge,
  Button,
  ChargeBreakdown,
  ConfirmDialog,
  DataTable,
  DetailRow,
  Dialog,
  EmptyState,
  Field,
  InlineError,
  LoadingPanel,
  Money,
  Panel,
  PanelHeader,
  PageHeader,
  PercentInput,
  RefreshingHint,
  StatusBadge,
  TabPanel,
  Tabs,
  Textarea,
  negotiationStatus,
  portalStatus,
  useDisclosure,
} from '@/design-system'
import { formatBusinessDate, daysUntilBusinessDate, formatRelative } from '@/lib/dates'
import { useIntentKey } from '@/lib/useIntentKey'
import { formatBasisPoints, formatMoney, formatQuantity } from '@/lib/money'

/**
 * The customer's deal room.
 *
 * Three things this screen is careful about, because each has an obvious wrong
 * way to build it:
 *
 *  - **Acceptance eligibility comes from `acceptable`.** Not from a stage label,
 *    not from a status string. The server decides; the button follows.
 *  - **Acceptance names one exact version.** The revision id and the commercial
 *    hash the customer was shown both travel with it, so a click made on a page
 *    that has been open for an hour cannot become consent to a price they never
 *    saw — the server refuses instead.
 *  - **A counteroffer proposes the line's own discount.** The table shows the
 *    combined figure, but the form is seeded from `lineDiscountPercentBp`;
 *    seeding it from the combined one would silently re-apply the order-level
 *    discount a second time.
 */
export default function DealRoomPage() {
  const { quoteId = '' } = useParams()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('terms')

  const quote = useQuery({
    queryKey: keys.portalQuote(quoteId),
    queryFn: ({ signal }) => portal.quote(quoteId, signal),
    enabled: Boolean(quoteId),
  })

  if (quote.isLoading && !quote.data) return <LoadingPanel rows={7} />
  if (quote.error) {
    return (
      <InlineError
        error={quote.error}
        title="This quotation could not be opened"
        onRetry={() => void quote.refetch()}
      />
    )
  }
  if (!quote.data) return null

  const detail = quote.data
  const status = portalStatus(detail.status)
  const daysLeft = daysUntilBusinessDate(detail.validUntil)
  const openRequests = detail.activity.filter(
    (entry) => entry.status === 'OPEN' || entry.status === 'ANSWERED',
  ).length

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.portalQuote(quoteId) })
    void queryClient.invalidateQueries({ queryKey: keys.portalQuotes() })
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Quotations', to: '/customer/quotes' }, { label: detail.reference }]}
        title={detail.title || detail.reference}
        meta={
          <>
            <span className="tabular text-[13px] text-text-secondary">{detail.reference}</span>
            <Badge tone="neutral" size="sm">
              Version {detail.versionNumber}
            </Badge>
            <StatusBadge label={status.label} tone={status.tone} size="sm" />
            {detail.validUntil ? (
              <span className="text-[13px] text-text-secondary">
                Valid to {formatBusinessDate(detail.validUntil)}
                {daysLeft !== null && daysLeft >= 0 && daysLeft <= 7
                  ? ` · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
                  : ''}
              </span>
            ) : null}
            <RefreshingHint visible={quote.isFetching && !quote.isLoading} />
          </>
        }
      />

      {/* The single sentence that says where this stands. */}
      <StatusBanner detail={detail} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0">
          <Tabs
            label="Quotation sections"
            value={tab}
            onValueChange={setTab}
            tabs={[
              { value: 'terms', label: 'Terms' },
              {
                value: 'conversation',
                label: 'Conversation',
                badge: openRequests ? (
                  <Badge tone="wait" size="sm">
                    {openRequests}
                  </Badge>
                ) : undefined,
              },
              { value: 'suggestions', label: 'Suggestions' },
            ]}
          >
            <TabPanel value="terms">
              <TermsTable detail={detail} onRefresh={refresh} />
            </TabPanel>

            <TabPanel value="conversation">
              <Conversation detail={detail} onRefresh={refresh} />
            </TabPanel>

            <TabPanel value="suggestions">
              <Suggestions detail={detail} onRefresh={refresh} />
            </TabPanel>
          </Tabs>
        </div>

        <aside className="space-y-4">
          <TotalsCard detail={detail} />
          <AcceptCard detail={detail} onAccepted={refresh} />
        </aside>
      </div>
    </>
  )
}

/* ---------------------------------------------------------------- banners */

function StatusBanner({ detail }: { detail: PortalQuoteDetail }) {
  if (detail.orderPlaced) {
    return (
      <Panel className="mb-5 border-ok-border bg-ok-surface">
        <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-ok-text">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">Order confirmed.</span> Your order
            {detail.orderReference ? ` ${detail.orderReference}` : ''} is being prepared. These are
            the exact terms it was created from.
          </span>
        </p>
      </Panel>
    )
  }

  if (detail.acceptedByYou && detail.awaitingInternalApproval) {
    return (
      <Panel className="mb-5 border-wait-border bg-wait-surface">
        <p className="text-[13px] leading-relaxed text-wait-text">
          <span className="font-semibold">Your acceptance is recorded.</span> It is not an order
          yet — this version still needs an internal approval on our side. You do not need to do
          anything; we will confirm as soon as it clears.
        </p>
      </Panel>
    )
  }

  if (detail.expired) {
    return (
      <Panel className="mb-5 border-stop-border bg-stop-surface">
        <p className="text-[13px] leading-relaxed text-stop-text">
          <span className="font-semibold">This quotation has expired.</span> It can no longer be
          accepted. Ask your account manager for a fresh version and the prices will be re-checked.
        </p>
      </Panel>
    )
  }

  return (
    <Panel className="mb-5">
      <p className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
        Where this stands
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-text">{detail.statusMessage}</p>
    </Panel>
  )
}

/**
 * The portal sends "one-time" in the same field as "monthly", so a line is only
 * recurring when its cadence is something other than that. Treating the field as
 * truthy is how a one-off installation ends up labelled "per period".
 */
function recurringCadence(cadence: string | null | undefined): string | null {
  if (!cadence) return null
  return /one[-\s]?time|once/i.test(cadence) ? null : cadence
}

/* ------------------------------------------------------------------ terms */

function TermsTable({
  detail,
  onRefresh,
}: {
  detail: PortalQuoteDetail
  onRefresh: () => void
}) {
  const counter = useDisclosure()
  const [targetLine, setTargetLine] = useState<PortalLine | null>(null)
  const locked = detail.orderPlaced || detail.expired

  return (
    <div className="space-y-4">
      <DataTable
        caption={`Lines on quotation ${detail.reference}`}
        rows={detail.lines}
        rowKey={(line) => line.lineKey}
        columns={[
          {
            id: 'description',
            header: 'Item',
            width: 'min-w-48',
            cell: (line) => (
              <span>
                <span className="block font-medium text-text">{line.description}</span>
                <span className="block text-2xs text-text-muted">
                  {recurringCadence(line.billingCadence)
                    ? `Billed ${line.billingCadence?.toLowerCase()}`
                    : 'One-time charge'}
                  {line.availabilityNote ? ` · ${line.availabilityNote}` : ''}
                  {line.promisedDate ? ` · promised ${formatBusinessDate(line.promisedDate)}` : ''}
                </span>
              </span>
            ),
          },
          {
            id: 'quantity',
            header: 'Qty',
            align: 'right',
            cell: (line) => formatQuantity(line.quantity),
          },
          {
            id: 'unitPrice',
            header: 'Unit price',
            align: 'right',
            hideBelow: 'sm',
            cell: (line) => <Money amount={line.unitPrice} currency={detail.totals.currency} />,
          },
          {
            id: 'discount',
            header: 'Discount',
            align: 'right',
            cell: (line) =>
              line.discountPercentBp > 0 ? (
                <span className="text-forest-600">{formatBasisPoints(line.discountPercentBp)}</span>
              ) : (
                <span className="text-text-muted">—</span>
              ),
          },
          {
            id: 'total',
            header: 'Total',
            align: 'right',
            cell: (line) => (
              <span className="font-medium">
                <Money amount={line.lineTotal} currency={detail.totals.currency} />
                {recurringCadence(line.billingCadence) ? (
                  <span className="block text-2xs font-normal text-text-muted">
                    each {line.billingCadence?.replace(/ly$/, '')}
                  </span>
                ) : null}
              </span>
            ),
          },
          ...(locked
            ? []
            : [
                {
                  id: 'action',
                  header: '',
                  align: 'right' as const,
                  width: 'whitespace-nowrap',
                  cell: (line: PortalLine) => (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setTargetLine(line)
                        counter.show()
                      }}
                    >
                      Ask about this
                    </Button>
                  ),
                },
              ]),
        ]}
      />

      {detail.orderDiscountBp > 0 ? (
        <Panel tone="muted" className="text-[13px] text-text-secondary">
          A quotation-wide discount of{' '}
          <span className="tabular font-semibold text-text">
            {formatBasisPoints(detail.orderDiscountBp)}
          </span>{' '}
          is already applied on top of any line discount. The discount column above shows the two
          combined.
        </Panel>
      ) : null}

      {detail.invoicingNote ? (
        <Panel tone="muted" className="text-[13px] leading-relaxed text-text-secondary">
          {detail.invoicingNote}
        </Panel>
      ) : null}

      {!locked ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon={<Percent className="size-4" />}
            onClick={() => {
              setTargetLine(null)
              counter.show()
            }}
          >
            Ask for a discount
          </Button>
        </div>
      ) : null}

      <NegotiationDialog
        open={counter.open}
        onOpenChange={counter.setOpen}
        detail={detail}
        line={targetLine}
        onSent={onRefresh}
      />
    </div>
  )
}

/* ----------------------------------------------------------------- totals */

function TotalsCard({ detail }: { detail: PortalQuoteDetail }) {
  const { totals } = detail
  return (
    <Panel className="space-y-3">
      <PanelHeader
        title="What this costs"
        description="One-time charges and anything recurring are kept apart, because they are not the same commitment."
      />
      <ChargeBreakdown
        currency={totals.currency}
        oneTime={totals.oneTimeTotal}
        recurring={totals.recurring}
        dueNow={totals.dueOnConfirmation}
      />
      <dl className="divide-y divide-line border-t border-line pt-1">
        <DetailRow label="Subtotal">
          {formatMoney(totals.oneTimeSubtotal, totals.currency)}
        </DetailRow>
        <DetailRow label="Tax">{formatMoney(totals.oneTimeTax, totals.currency)}</DetailRow>
      </dl>
    </Panel>
  )
}

/* ----------------------------------------------------------------- accept */

function AcceptCard({
  detail,
  onAccepted,
}: {
  detail: PortalQuoteDetail
  onAccepted: () => void
}) {
  const confirm = useDisclosure()
  const [note, setNote] = useState('')
  // One key per acceptance intent, scoped to the version being accepted:
  // replaying it returns the same answer rather than accepting twice, and a new
  // version is a genuinely different intent.
  const idempotencyKey = useIntentKey(detail.revisionId)

  const accept = useMutation({
    mutationFn: () =>
      portal.accept(
        detail.id,
        {
          // Both identify the exact version on screen. If the terms moved, the
          // server refuses rather than binding the customer to a new price.
          revisionId: detail.revisionId,
          commercialHash: detail.commercialHash,
          note: note.trim() || null,
        },
        idempotencyKey,
      ),
    onSuccess: (result) => {
      confirm.hide()
      toast.success(result.conditional ? 'Acceptance recorded' : 'Order confirmed', {
        description: result.message,
      })
      onAccepted()
    },
  })

  if (detail.orderPlaced) {
    return (
      <Panel className="border-ok-border bg-ok-surface">
        <p className="text-[13px] font-semibold text-ok-text">Order confirmed</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ok-text/90">
          {detail.orderReference
            ? `Your order reference is ${detail.orderReference}.`
            : 'Your order has been created from these terms.'}
        </p>
      </Panel>
    )
  }

  if (detail.acceptedByYou) {
    return (
      <Panel className="space-y-2">
        <PanelHeader title="You accepted these terms" />
        <p className="text-[13px] leading-relaxed text-text-secondary">
          Recorded {detail.acceptedAt ? formatRelative(detail.acceptedAt) : 'already'}. Nothing more
          is needed from you.
        </p>
      </Panel>
    )
  }

  const stale = accept.error instanceof ApiError && accept.error.code === 'ACCEPTANCE_HASH_MISMATCH'

  return (
    <Panel className="space-y-3">
      <PanelHeader
        title="Accept this quotation"
        description={`Version ${detail.versionNumber}, exactly as shown on this page.`}
      />
      <p className="text-[13px] leading-relaxed text-text-secondary">
        Accepting records your agreement to <strong>version {detail.versionNumber}</strong> as it is
        shown on this page. If the terms have changed since it loaded, we will tell you rather than
        accept a different price on your behalf.
      </p>

      <Button
        variant="primary"
        size="lg"
        className="w-full"
        icon={<Handshake className="size-4" />}
        disabled={!detail.acceptable}
        // The server owns this decision, so the reason for a disabled button
        // comes from the server's own status message.
        disabledReason={detail.expired ? 'This quotation has expired.' : detail.statusMessage}
        onClick={confirm.show}
      >
        Accept &amp; confirm
      </Button>

      {!detail.acceptable ? (
        <p className="text-[13px] leading-relaxed text-text-secondary">{detail.statusMessage}</p>
      ) : null}

      {stale ? (
        <InlineError
          error={accept.error}
          title="The terms changed"
          onRetry={onAccepted}
        />
      ) : accept.error ? (
        <InlineError error={accept.error} title="That could not be recorded" />
      ) : null}

      <ConfirmDialog
        open={confirm.open}
        onOpenChange={confirm.setOpen}
        title={`Accept version ${detail.versionNumber}?`}
        confirmLabel="Yes, accept these terms"
        cancelLabel="Not yet"
        busy={accept.isPending}
        onConfirm={() => accept.mutate()}
        body={
          <div className="space-y-3">
            <p>
              You are accepting{' '}
              <strong>{formatMoney(detail.totals.dueOnConfirmation, detail.totals.currency)}</strong>{' '}
              payable on confirmation
              {detail.totals.recurring.length > 0
                ? `, plus ${detail.totals.recurring
                    .map(
                      (row) =>
                        `${formatMoney(row.amount, detail.totals.currency)} ${row.cadence.toLowerCase()}`,
                    )
                    .join(' and ')}`
                : ''}
              .
            </p>
            <Field label="Anything to add?" hint="Optional. Sent to your account manager.">
              {(props) => (
                <Textarea
                  {...props}
                  rows={2}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              )}
            </Field>
            {detail.awaitingInternalApproval ? (
              <p className="rounded-[--radius-control] bg-wait-surface px-3 py-2 text-wait-text">
                This version still needs an internal approval on our side, so your acceptance will
                be recorded and the order created once that clears.
              </p>
            ) : null}
          </div>
        }
      />
    </Panel>
  )
}

/* ----------------------------------------------------------- conversation */

function Conversation({
  detail,
  onRefresh,
}: {
  detail: PortalQuoteDetail
  onRefresh: () => void
}) {
  const compose = useDisclosure()
  const [message, setMessage] = useState('')
  const [key, setKey] = useState(() => newIdempotencyKey())

  const send = useMutation({
    mutationFn: () =>
      portal.submitRequest(
        detail.id,
        {
          requestType: 'COMMENT',
          message: message.trim(),
          expectedRevisionId: detail.revisionId,
        },
        key,
      ),
    onSuccess: () => {
      toast.success('Message sent')
      setMessage('')
      setKey(newIdempotencyKey())
      compose.hide()
      onRefresh()
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="secondary" icon={<MessageSquare className="size-4" />} onClick={compose.show}>
          Send a message
        </Button>
      </div>

      {detail.activity.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<MessageSquare className="size-5" aria-hidden />}
            title="No messages yet"
            description="Ask a question or propose a change and it appears here, with your account manager's reply."
          />
        </Panel>
      ) : (
        <Panel flush className="overflow-hidden">
          <ul className="divide-y divide-line">
            {detail.activity.map((entry) => {
              const status = negotiationStatus(entry.status)
              return (
                <li key={entry.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-text">
                      {entry.fromCustomer ? 'You' : 'Your account manager'}
                    </span>
                    <Badge tone="neutral" size="sm">
                      {entry.requestType === 'COMMENT'
                        ? 'Message'
                        : entry.requestType === 'CHANGE'
                          ? 'Change request'
                          : 'Counteroffer'}
                    </Badge>
                    <StatusBadge
                      label={status.label}
                      tone={status.tone}
                      size="sm"
                      withIcon={false}
                    />
                    <span className="text-2xs text-text-muted">
                      {formatRelative(entry.createdAt)}
                    </span>
                  </div>

                  {entry.message ? (
                    <p className="mt-2 whitespace-pre-wrap rounded-[--radius-control] bg-canvas-sunken px-3 py-2 text-[13px] leading-relaxed text-text">
                      {entry.message}
                    </p>
                  ) : null}

                  {entry.responseMessage ? (
                    <div className="mt-2 rounded-[--radius-control] border-l-2 border-forest-300 bg-forest-50/60 px-3 py-2">
                      <p className="text-2xs font-semibold text-forest-700">
                        Reply
                        {entry.respondedAt ? ` · ${formatRelative(entry.respondedAt)}` : ''}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-text">
                        {entry.responseMessage}
                      </p>
                    </div>
                  ) : null}

                  {entry.status === 'ADOPTED' ? (
                    <p className="mt-2 text-[13px] text-ok-text">
                      Accepted — the terms above already reflect this.
                    </p>
                  ) : entry.status === 'DECLINED' ? (
                    <p className="mt-2 text-[13px] text-stop-text">
                      Declined — the terms above are unchanged.
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </Panel>
      )}

      <Dialog
        open={compose.open}
        onOpenChange={compose.setOpen}
        title="Send a message"
        description="Goes to your account manager against this exact version."
        busy={send.isPending}
        footer={
          <>
            <Button variant="ghost" onClick={compose.hide} disabled={send.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<Send className="size-3.5" />}
              busy={send.isPending}
              disabled={!message.trim()}
              disabledReason="Write something first."
              onClick={() => send.mutate()}
            >
              Send
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Your message" required>
            {(props) => (
              <Textarea
                {...props}
                rows={4}
                autoFocus
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="A question about delivery, the terms, or anything else."
              />
            )}
          </Field>
          {send.error ? <InlineError error={send.error} /> : null}
        </div>
      </Dialog>
    </div>
  )
}

/* ---------------------------------------------------------- counteroffers */

function NegotiationDialog({
  open,
  onOpenChange,
  detail,
  line,
  onSent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  detail: PortalQuoteDetail
  line: PortalLine | null
  onSent: () => void
}) {
  // Seeded from the line's *own* discount, never the combined figure — using
  // the combined one would re-apply the quotation-wide discount a second time.
  const [lineDiscountBp, setLineDiscountBp] = useState<number | null>(
    line?.lineDiscountPercentBp ?? 0,
  )
  const [orderDiscountBp, setOrderDiscountBp] = useState<number | null>(detail.orderDiscountBp)
  const [message, setMessage] = useState('')
  const [key, setKey] = useState(() => newIdempotencyKey())

  // Reset when the target line changes.
  const seedKey = line?.lineKey ?? 'order'
  const [seeded, setSeeded] = useState(seedKey)
  if (seeded !== seedKey) {
    setSeeded(seedKey)
    setLineDiscountBp(line?.lineDiscountPercentBp ?? 0)
    setOrderDiscountBp(detail.orderDiscountBp)
  }

  const unchanged =
    (line ? (lineDiscountBp ?? 0) === line.lineDiscountPercentBp : true) &&
    (orderDiscountBp ?? 0) === detail.orderDiscountBp

  const send = useMutation({
    mutationFn: () =>
      portal.submitRequest(
        detail.id,
        {
          requestType: 'COUNTER',
          lineKey: line?.lineKey ?? null,
          message: message.trim() || null,
          lines: line
            ? [{ lineKey: line.lineKey, requestedDiscountBp: lineDiscountBp ?? 0 }]
            : null,
          requestedOrderDiscountBp: orderDiscountBp ?? 0,
          expectedRevisionId: detail.revisionId,
        },
        key,
      ),
    onSuccess: () => {
      toast.success('Proposal sent', {
        description:
          'It is now a new version of this quotation, priced for you. Your account manager still has to agree to it.',
      })
      setMessage('')
      setKey(newIdempotencyKey())
      onOpenChange(false)
      onSent()
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={line ? `Ask about “${line.description}”` : 'Ask for a discount'}
      description="Your proposal becomes a new version of this quotation, priced straight away. It is not agreed until your account manager adopts it."
      size="lg"
      busy={send.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={send.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={send.isPending}
            disabled={unchanged && !message.trim()}
            disabledReason="Change a discount or write a message first."
            onClick={() => send.mutate()}
          >
            Send the proposal
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <PercentInput
          label="Discount you are asking for on the whole quotation"
          hint={`Currently ${formatBasisPoints(detail.orderDiscountBp)}. This applies on top of each line's own discount.`}
          valueBp={orderDiscountBp}
          onChangeBp={setOrderDiscountBp}
        />

        {line ? (
          <div className="rounded-[--radius-panel] border border-line bg-panel-muted p-4">
            <p className="text-[13px] font-semibold text-text">{line.description}</p>
            <p className="tabular mt-0.5 text-2xs text-text-muted">
              {formatQuantity(line.quantity)} × {formatMoney(line.unitPrice, detail.totals.currency)}{' '}
              · currently {formatBasisPoints(line.lineDiscountPercentBp)} on this line
              {line.discountPercentBp !== line.lineDiscountPercentBp
                ? ` (${formatBasisPoints(line.discountPercentBp)} with the quotation-wide discount)`
                : ''}
            </p>
            <PercentInput
              className="mt-3"
              label="Discount you are asking for on this line"
              valueBp={lineDiscountBp}
              onChangeBp={setLineDiscountBp}
            />
          </div>
        ) : null}

        <Field label="Why?" hint="Optional, but a reason makes a yes much more likely.">
          {(props) => (
            <Textarea
              {...props}
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="e.g. We are ordering three of these and can commit this quarter."
            />
          )}
        </Field>

        <p className="rounded-[--radius-control] bg-canvas-sunken px-3 py-2.5 text-[13px] leading-relaxed text-text-secondary">
          <span className="font-medium text-text">What happens when you send this.</span> We price
          your proposal immediately and it becomes the version shown on this page — so you can see
          exactly what you are asking for. It is a request, not an agreement: your account manager
          has to adopt it, and any internal approval starts again, before it can become an order.
        </p>

        {send.error ? <InlineError error={send.error} /> : null}
      </div>
    </Dialog>
  )
}

/* ------------------------------------------------------------ suggestions */

function Suggestions({
  detail,
  onRefresh,
}: {
  detail: PortalQuoteDetail
  onRefresh: () => void
}) {
  const offers = useQuery({
    queryKey: keys.portalQuoteRecommendations(detail.id),
    queryFn: ({ signal }) => portal.recommendations(detail.id, signal),
  })

  const request = useMutation({
    mutationFn: (variantId: string) =>
      portal.requestRecommendation(
        detail.id,
        { variantId, expectedRevisionId: detail.revisionId },
        newIdempotencyKey(),
      ),
    onSuccess: () => {
      toast.success('Sent to your account manager', {
        description: 'They will price it and reply. Your quotation is unchanged for now.',
      })
      onRefresh()
    },
  })

  if (offers.isLoading && !offers.data) return <LoadingPanel rows={3} />
  if (offers.error) {
    return <InlineError error={offers.error} onRetry={() => void offers.refetch()} />
  }

  const suggestions = offers.data?.suggestions ?? []

  return (
    <div className="space-y-4">
      {suggestions.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Sparkles className="size-5" aria-hidden />}
            title="Nothing to suggest right now"
            description="Suggestions come from what comparable customers actually bought alongside these items."
          />
        </Panel>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {suggestions.map((offer) => (
            <Panel key={offer.variantId} className="flex flex-col gap-3">
              <PanelHeader
                as="h3"
                title={offer.name}
                actions={
                  <Badge tone={offer.type === 'UPSELL' ? 'brass' : 'info'} size="sm">
                    {offer.type === 'UPSELL' ? 'Upgrade' : 'Add-on'}
                  </Badge>
                }
              />
              <dl className="grid grid-cols-2 gap-2 text-[13px]">
                <div>
                  <dt className="text-text-secondary">Unit price</dt>
                  <dd className="tabular font-medium">
                    {formatMoney(offer.unitPrice, detail.totals.currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Change to your total</dt>
                  <dd className="tabular font-medium">
                    {formatMoney(offer.netDelta, detail.totals.currency, { signed: true })}
                  </dd>
                </div>
              </dl>
              {offer.availabilityNote ? (
                <Badge tone="neutral" size="sm" className="self-start">
                  {offer.availabilityNote}
                </Badge>
              ) : null}
              <div className="mt-auto border-t border-line pt-3">
                <Button
                  size="sm"
                  variant="secondary"
                  busy={request.isPending && request.variables === offer.variantId}
                  disabled={detail.orderPlaced || detail.expired}
                  disabledReason="This quotation is closed."
                  onClick={() => request.mutate(offer.variantId)}
                >
                  Ask about this
                </Button>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <p className="text-[13px] leading-relaxed text-text-secondary">
        Asking about a suggestion sends a request to your account manager. It is not a price
        agreement and it does not change your quotation.
      </p>

      {request.error ? <InlineError error={request.error} /> : null}
    </div>
  )
}
