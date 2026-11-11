import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Handshake, MessageSquare, Send, ThumbsDown } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  keys,
  negotiation,
  quotes as quotesApi,
  type NegotiationView,
  type QuoteEvaluation,
  type UUID,
} from '@/api'
import {
  Badge,
  Button,
  EmptyState,
  InlineError,
  LoadingPanel,
  Panel,
  PanelHeader,
  RefreshingHint,
  StatusBadge,
  Textarea,
  negotiationStatus,
} from '@/design-system'
import { formatRelative, formatTimestamp } from '@/lib/dates'
import { formatBasisPoints, formatQuantity } from '@/lib/money'
import { cn } from '@/lib/cn'

/**
 * The customer conversation, from the seller's side.
 *
 * The distinction this screen exists to make visible: **a counteroffer has
 * already changed the version; adopting it is the business agreeing to sell on
 * those terms.** The server prices a customer proposal at once and makes it
 * current, but it deliberately leaves seller agreement unset and re-runs the
 * approval chain from scratch — so nothing can become an order until someone
 * here says yes.
 *
 * A reply is a message and moves none of that. The two are therefore separate
 * controls with separate wording, and the proposed terms are rendered as numbers
 * so nobody adopts something they only skim-read.
 */
export function NegotiationDesk({
  evaluation,
  canAdoptCandidate,
  adoptDisabledReason,
}: {
  evaluation: QuoteEvaluation
  canAdoptCandidate: boolean
  adoptDisabledReason?: string
}) {
  const quoteId = evaluation.quoteId
  const queryClient = useQueryClient()
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const requests = useQuery({
    queryKey: keys.quoteRequests(quoteId),
    queryFn: ({ signal }) => negotiation.list(quoteId, signal),
  })

  const reply = useMutation({
    mutationFn: (input: { requestId: UUID; decision: 'ANSWERED' | 'DECLINED' }) =>
      negotiation.reply(quoteId, input.requestId, {
        message: message.trim(),
        decision: input.decision,
      }),
    onSuccess: (_result, input) => {
      setMessage('')
      setReplyTo(null)
      toast.success(
        input.decision === 'DECLINED' ? 'Reply sent and marked declined' : 'Reply sent',
        { description: 'The customer sees it in their deal room. The terms have not changed.' },
      )
      void queryClient.invalidateQueries({ queryKey: keys.quoteRequests(quoteId) })
      void queryClient.invalidateQueries({ queryKey: keys.quote(quoteId) })
    },
  })

  const adopt = useMutation({
    mutationFn: (revisionId: UUID) =>
      quotesApi.adopt(quoteId, { revisionId, expectedRowVersion: evaluation.rowVersion }),
    onSuccess: (result) => {
      toast.success('Customer terms adopted', {
        description: `You now stand behind version ${result.revisionNo}. Approval and customer acceptance are still their own gates.`,
      })
      void queryClient.invalidateQueries({ queryKey: keys.quote(quoteId) })
      void queryClient.invalidateQueries({ queryKey: keys.quoteRequests(quoteId) })
      void queryClient.invalidateQueries({ queryKey: keys.quotes() })
    },
  })

  if (requests.isLoading && !requests.data) return <LoadingPanel rows={3} />
  if (requests.error) {
    return <InlineError error={requests.error} onRetry={() => void requests.refetch()} />
  }

  const rows = requests.data ?? []

  return (
    <div className="space-y-4">
      <Panel flush className="overflow-hidden">
        <PanelHeader
          className="border-b border-line px-5 py-4"
          title="Customer conversation"
          description="Messages, change requests and counteroffers, oldest first."
          actions={<RefreshingHint visible={requests.isFetching && !requests.isLoading} />}
        />

        {rows.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="size-5" aria-hidden />}
            title="No messages yet"
            description="When the customer comments, asks for a change or counters the price, it appears here with the version they were looking at."
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((request) => (
              <li key={request.id} className="px-5 py-4">
                <RequestEntry
                  request={request}
                  currentRevisionId={evaluation.revisionId}
                  canAdopt={canAdoptCandidate}
                  adoptDisabledReason={adoptDisabledReason}
                  adopting={adopt.isPending}
                  onAdopt={(revisionId) => adopt.mutate(revisionId)}
                  replying={replyTo === request.id}
                  onStartReply={() => {
                    setReplyTo(request.id)
                    setMessage('')
                  }}
                />

                {replyTo === request.id ? (
                  <div className="mt-3 space-y-2 rounded-[--radius-control] bg-canvas-sunken p-3">
                    <label
                      htmlFor={`reply-${request.id}`}
                      className="block text-[13px] font-medium text-text"
                    >
                      Your reply
                    </label>
                    <Textarea
                      id={`reply-${request.id}`}
                      rows={3}
                      autoFocus
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      placeholder="Explain what you can and cannot do. This does not change the price."
                    />
                    <p className="text-[13px] leading-relaxed text-text-secondary">
                      A reply is a message: it agrees to nothing. To stand behind the customer's
                      version, adopt it above; to counter it, edit the quotation and save a revised
                      offer.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<Send className="size-3.5" />}
                        busy={reply.isPending}
                        disabled={!message.trim()}
                        disabledReason="Write a reply first."
                        onClick={() =>
                          reply.mutate({ requestId: request.id, decision: 'ANSWERED' })
                        }
                      >
                        Send reply
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<ThumbsDown className="size-3.5" />}
                        busy={reply.isPending}
                        disabled={!message.trim()}
                        disabledReason="Give the customer a reason first."
                        onClick={() =>
                          reply.mutate({ requestId: request.id, decision: 'DECLINED' })
                        }
                      >
                        Decline with this reason
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>
                        Cancel
                      </Button>
                    </div>
                    {reply.error ? <InlineError error={reply.error} /> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {adopt.error ? (
        <InlineError error={adopt.error} title="Could not adopt those terms" />
      ) : null}
    </div>
  )
}

function RequestEntry({
  request,
  currentRevisionId,
  canAdopt,
  adoptDisabledReason,
  adopting,
  onAdopt,
  replying,
  onStartReply,
}: {
  request: NegotiationView
  currentRevisionId: UUID
  canAdopt: boolean
  adoptDisabledReason?: string
  adopting: boolean
  onAdopt: (revisionId: UUID) => void
  replying: boolean
  onStartReply: () => void
}) {
  const status = negotiationStatus(request.status)
  const isCounter = request.requestType === 'COUNTER' || request.requestType === 'CHANGE'
  const candidate = request.candidateRevisionId
  const open = request.status === 'OPEN' || request.status === 'ANSWERED'
  const stale = request.revisionId !== currentRevisionId

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-semibold text-text">{request.raisedBy ?? 'Customer'}</span>
            <Badge tone="neutral" size="sm">
              {request.requestType === 'COMMENT'
                ? 'Message'
                : request.requestType === 'CHANGE'
                  ? 'Change request'
                  : 'Counteroffer'}
            </Badge>
            <StatusBadge label={status.label} tone={status.tone} size="sm" withIcon={false} />
          </p>
          <p className="mt-0.5 text-2xs text-text-muted">
            <time dateTime={request.createdAt} title={formatTimestamp(request.createdAt)}>
              {formatRelative(request.createdAt)}
            </time>
            {stale ? ' · raised against an earlier version' : null}
          </p>
        </div>
      </div>

      {request.message ? (
        <p className="mt-2 whitespace-pre-wrap rounded-[--radius-control] bg-canvas-sunken px-3 py-2 text-[13px] leading-relaxed text-text">
          {request.message}
        </p>
      ) : null}

      {isCounter && request.payload ? <ProposedTerms payload={request.payload} /> : null}

      {request.responseMessage ? (
        <div className="mt-2 rounded-[--radius-control] border-l-2 border-forest-300 bg-forest-50/60 px-3 py-2">
          <p className="text-2xs font-semibold text-forest-700">
            {request.respondedBy ?? 'You'}
            {request.respondedAt ? ` · ${formatRelative(request.respondedAt)}` : ''}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-text">
            {request.responseMessage}
          </p>
        </div>
      ) : null}

      {open ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {!replying ? (
            <Button
              size="sm"
              variant="secondary"
              icon={<MessageSquare className="size-3.5" />}
              onClick={onStartReply}
            >
              Reply
            </Button>
          ) : null}

          {candidate && isCounter ? (
            <Button
              size="sm"
              variant="primary"
              icon={<Handshake className="size-3.5" />}
              busy={adopting}
              disabled={!canAdopt}
              disabledReason={
                adoptDisabledReason ?? 'These terms cannot be adopted in the current state.'
              }
              onClick={() => onAdopt(candidate)}
            >
              Adopt these terms
            </Button>
          ) : null}
        </div>
      ) : null}

      {request.status === 'ADOPTED' ? (
        <p className="mt-2 text-[13px] text-ok-text">
          Adopted — these terms became the current offer.
        </p>
      ) : null}
    </div>
  )
}

/** What the customer actually asked for, as figures rather than prose. */
function ProposedTerms({ payload }: { payload: NonNullable<NegotiationView['payload']> }) {
  const order = payload.requestedOrderDiscountBp
  const lines = payload.lines ?? []
  if (order == null && lines.length === 0) return null

  return (
    <div
      className={cn(
        'mt-2 rounded-[--radius-control] border border-brass-200 bg-brass-50 px-3 py-2.5',
      )}
    >
      <p className="text-2xs font-semibold uppercase tracking-wide text-brass-700">
        What they are asking for
      </p>
      <ul className="mt-1.5 space-y-1 text-[13px] text-text">
        {order != null ? (
          <li>
            <span className="tabular font-semibold">{formatBasisPoints(order)}</span> off the whole
            quotation
          </li>
        ) : null}
        {lines.map((line) => (
          <li key={line.lineKey}>
            <span className="font-medium">{line.lineKey}</span>
            {line.requestedDiscountBp != null ? (
              <>
                {' '}
                at <span className="tabular font-semibold">
                  {formatBasisPoints(line.requestedDiscountBp)}
                </span>{' '}
                off
              </>
            ) : null}
            {line.quantity != null ? (
              <>
                {' '}
                · quantity{' '}
                <span className="tabular font-semibold">{formatQuantity(line.quantity)}</span>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-2xs leading-relaxed text-brass-700">
        This is already the current version and it has been priced — but seller agreement was reset
        and approval re-run, so it cannot become an order until you adopt it.
      </p>
    </div>
  )
}
