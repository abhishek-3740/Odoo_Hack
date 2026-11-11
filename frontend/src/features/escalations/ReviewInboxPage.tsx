import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, MessageSquareQuote } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import {
  ESCALATION_CATEGORY_LABEL,
  escalations as escalationsApi,
  keys,
  ROLE_LABEL,
  type Escalation,
} from '@/api'
import {
  Badge,
  Button,
  EmptyState,
  InlineError,
  LoadingPanel,
  Panel,
  PageHeader,
  RefreshingHint,
  Select,
  StatusBadge,
  Textarea,
} from '@/design-system'
import { formatRelative, formatTimestamp } from '@/lib/dates'

/**
 * Questions and escalations — deliberately not the approval queue.
 *
 * The two are separate systems on the server and separate screens here. Closing
 * an item on this page records an answer; it does not approve a discount, move
 * a quotation forward or satisfy any gate. The heading and the resolve
 * confirmation both say so, because this is the confusion the plan calls out.
 */
export default function ReviewInboxPage() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'OPEN' | 'RESOLVED' | 'ALL'>('OPEN')

  const list = useQuery({
    queryKey: keys.escalations(),
    queryFn: ({ signal }) => escalationsApi.list(undefined, signal),
  })

  const rows = (list.data ?? []).filter((row) =>
    filter === 'ALL' ? true : row.status === filter,
  )

  return (
    <>
      <PageHeader
        title="Questions"
        description="Pricing questions, policy exceptions and routine reviews. Answering one records an answer — it does not approve a quotation."
        meta={<RefreshingHint visible={list.isFetching && !list.isLoading} />}
        actions={
          <div className="w-52">
            <label htmlFor="question-filter" className="sr-only">
              Filter questions
            </label>
            <Select
              id="question-filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value as typeof filter)}
            >
              <option value="OPEN">Open questions</option>
              <option value="RESOLVED">Answered</option>
              <option value="ALL">All</option>
            </Select>
          </div>
        }
      />

      {list.isLoading && !list.data ? (
        <LoadingPanel rows={4} />
      ) : list.error ? (
        <InlineError error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<MessageSquareQuote className="size-5" aria-hidden />}
            title={filter === 'OPEN' ? 'No open questions' : 'Nothing here'}
            description="A salesperson raises one from a deal when they need finance, a manager or an administrator to weigh in."
          />
        </Panel>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <EscalationCard
              key={row.id}
              escalation={row}
              onResolved={() => {
                void queryClient.invalidateQueries({ queryKey: keys.escalations() })
              }}
            />
          ))}
        </ul>
      )}
    </>
  )
}

function EscalationCard({
  escalation,
  onResolved,
}: {
  escalation: Escalation
  onResolved: () => void
}) {
  const [answering, setAnswering] = useState(false)
  const [answer, setAnswer] = useState('')

  const resolve = useMutation({
    mutationFn: () => escalationsApi.resolve(escalation.id, { resolution: answer.trim() }),
    onSuccess: () => {
      toast.success('Answer recorded', {
        description: 'The salesperson can see it. No approval has been granted by this.',
      })
      setAnswering(false)
      setAnswer('')
      onResolved()
    },
  })

  const open = escalation.status === 'OPEN'

  return (
    <li>
      <Panel className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <Link
                to={`/admin/quotes/${escalation.quoteId}`}
                className="tabular text-[13px] font-semibold text-forest-700 hover:underline"
              >
                {escalation.reference}
              </Link>
              <Badge tone="neutral" size="sm">
                {ESCALATION_CATEGORY_LABEL[escalation.category] ?? escalation.category}
              </Badge>
              <Badge tone="info" size="sm">
                For {ROLE_LABEL[escalation.targetRole] ?? escalation.targetRole}
              </Badge>
              <StatusBadge
                label={open ? 'Open' : 'Answered'}
                tone={open ? 'wait' : 'ok'}
                size="sm"
              />
            </p>
            <p className="mt-1 text-2xs text-text-muted">
              Raised {formatRelative(escalation.createdAt)}
              {escalation.resolvedAt
                ? ` · answered ${formatTimestamp(escalation.resolvedAt)}`
                : ''}
            </p>
          </div>
        </div>

        <p className="whitespace-pre-wrap rounded-[--radius-control] bg-canvas-sunken px-3 py-2.5 text-[13px] leading-relaxed text-text">
          {escalation.reason}
        </p>

        {escalation.resolution ? (
          <div className="rounded-[--radius-control] border-l-2 border-forest-300 bg-forest-50/60 px-3 py-2.5">
            <p className="text-2xs font-semibold text-forest-700">Answer</p>
            <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-text">
              {escalation.resolution}
            </p>
          </div>
        ) : null}

        {open ? (
          answering ? (
            <div className="space-y-2">
              <label
                htmlFor={`answer-${escalation.id}`}
                className="block text-[13px] font-medium text-text"
              >
                Your answer
              </label>
              <Textarea
                id={`answer-${escalation.id}`}
                rows={3}
                autoFocus
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Say what is and is not possible, and why."
              />
              <p className="text-[13px] leading-relaxed text-text-secondary">
                Recording this answers the question. It does not approve the quotation — if these
                terms need approval, that still has to happen in the approval queue.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  icon={<CheckCircle2 className="size-3.5" />}
                  busy={resolve.isPending}
                  disabled={answer.trim().length < 3}
                  disabledReason="Write an answer first."
                  onClick={() => resolve.mutate()}
                >
                  Record the answer
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAnswering(false)}>
                  Cancel
                </Button>
              </div>
              {resolve.error ? <InlineError error={resolve.error} /> : null}
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setAnswering(true)}>
              Answer this question
            </Button>
          )
        ) : null}
      </Panel>
    </li>
  )
}
