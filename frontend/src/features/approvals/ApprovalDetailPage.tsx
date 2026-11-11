import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'

import { approvals as approvalsApi, keys, ROLE_LABEL } from '@/api'
import { useAuth } from '@/auth/useAuth'
import { InlineError, LoadingPanel, PageHeader, RefreshingHint } from '@/design-system'

import { ApprovalCard } from './ApprovalInboxPage'

/**
 * One approval step, on its own URL.
 *
 * Exists so a step can be linked to — from a notification, a chat message, or
 * simply a bookmark — and land on the decision rather than on a queue the
 * reader then has to search. It reads the step directly rather than filtering
 * the queue, so a superseded or already-decided step still opens and explains
 * itself instead of appearing to have vanished.
 */
export default function ApprovalDetailPage() {
  const { approvalRequestId = '' } = useParams()
  const { me } = useAuth()

  const step = useQuery({
    queryKey: keys.approval(approvalRequestId),
    queryFn: ({ signal }) => approvalsApi.get(approvalRequestId, signal),
    enabled: Boolean(approvalRequestId),
  })

  if (step.isLoading && !step.data) return <LoadingPanel rows={5} />
  if (step.error) {
    return (
      <InlineError
        error={step.error}
        title="This approval step could not be opened"
        onRetry={() => void step.refetch()}
      />
    )
  }
  if (!step.data) return null

  const item = step.data

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Approvals', to: '/admin/approvals' },
          { label: `Step ${item.step} · ${item.quoteReference ?? ''}` },
        ]}
        title={`Step ${item.step} · ${ROLE_LABEL[item.requiredRole] ?? item.requiredRole}`}
        description={
          item.actionable
            ? 'You can record a decision on this step now.'
            : (item.blockedReason ??
              'This step is not currently actionable. Its state is shown below.')
        }
        meta={<RefreshingHint visible={step.isFetching && !step.isLoading} />}
      />

      <ul className="space-y-3">
        <ApprovalCard item={item} canReassign={me?.role === 'ADMIN'} />
      </ul>
    </>
  )
}
