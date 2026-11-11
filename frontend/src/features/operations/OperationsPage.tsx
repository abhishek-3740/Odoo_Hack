import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, HeartPulse, Play, Receipt } from 'lucide-react'
import { toast } from 'sonner'

import { keys, operations, type JobName } from '@/api'
import { canRunJobs } from '@/auth/capabilities'
import { useAuth } from '@/auth/useAuth'
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  InlineError,
  Panel,
  PanelHeader,
  PageHeader,
  PermissionBoundary,
  RefreshingHint,
  Section,
} from '@/design-system'
import { formatTimestamp } from '@/lib/dates'
import { formatCount } from '@/lib/money'

const JOBS: Array<{
  name: JobName
  title: string
  icon: typeof Receipt
  description: string
}> = [
  {
    name: 'recurring-billing',
    title: 'Recurring billing',
    icon: Receipt,
    description:
      'Bills every subscription period that is due. Idempotent: running it twice on the same business date does not invoice twice.',
  },
  {
    name: 'deal-health',
    title: 'Deal health sweep',
    icon: HeartPulse,
    description:
      'Opens alerts for stalled quotations, overdue approvals, slipping deliveries, low stock and overdue invoices — and closes the ones that have resolved.',
  },
  {
    name: 'quote-expiry',
    title: 'Quotation expiry',
    icon: CalendarClock,
    description:
      'Expires quotations past their validity date so nobody can accept terms that have lapsed.',
  },
]

/**
 * Manual job control.
 *
 * These run the exact implementation the scheduler runs, with the same
 * idempotency guarantees — which is the only reason it is safe to offer a button
 * for them. A "catch up after an outage" job that behaved differently from its
 * scheduled twin would be worse than no button at all.
 */
export default function OperationsPage() {
  const { me } = useAuth()
  const queryClient = useQueryClient()

  const runs = useQuery({
    queryKey: keys.jobRuns(),
    queryFn: ({ signal }) => operations.runs(signal),
    refetchInterval: 30_000,
  })

  const run = useMutation({
    mutationFn: (jobName: JobName) => operations.run(jobName),
    onSuccess: (result, jobName) => {
      const summary = Object.entries(result)
        .filter(([key]) => key !== 'job')
        .map(([key, value]) => `${key}: ${value}`)
        .join(' · ')
      toast.success(`${jobName} finished`, { description: summary || undefined })
      void queryClient.invalidateQueries({ queryKey: keys.jobRuns() })
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'alerts'] })
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'invoices'] })
    },
  })

  return (
    <>
      <PageHeader
        title="Scheduled jobs"
        description="The same implementations the scheduler runs, available on demand for a catch-up or a demonstration."
        meta={<RefreshingHint visible={runs.isFetching && !runs.isLoading} />}
      />

      <PermissionBoundary
        allowed={canRunJobs(me)}
        reason="Running a job is limited to finance and administrators. The run history below is still readable."
      >
        <div className="mb-6 grid gap-3 md:grid-cols-3">
          {JOBS.map((job) => {
            const Icon = job.icon
            return (
              <Panel key={job.name} className="flex flex-col gap-3">
                <PanelHeader
                  as="h3"
                  title={
                    <span className="flex items-center gap-2">
                      <Icon className="size-4 text-forest-600" aria-hidden />
                      {job.title}
                    </span>
                  }
                  description={job.description}
                />
                <div className="mt-auto">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Play className="size-3.5" />}
                    busy={run.isPending && run.variables === job.name}
                    disabled={run.isPending}
                    disabledReason="Another job is running."
                    onClick={() => run.mutate(job.name)}
                  >
                    Run now
                  </Button>
                </div>
              </Panel>
            )
          })}
        </div>
      </PermissionBoundary>

      {run.error ? (
        <InlineError className="mb-4" error={run.error} title="The job could not be run" />
      ) : null}

      <Section
        id="job-runs"
        title="Recent runs"
        description="Scheduled and manual runs alike, newest first."
      >
        <DataTable
          caption="Job run history"
          rows={runs.data ?? []}
          rowKey={(row) => row.id}
          loading={runs.isLoading}
          error={runs.error ? <InlineError error={runs.error} onRetry={() => void runs.refetch()} /> : undefined}
          empty={
            <EmptyState
              title="No runs recorded"
              description="A run appears here as soon as the scheduler or someone here executes one."
            />
          }
          columns={[
            {
              id: 'job',
              header: 'Job',
              cell: (row) => <span className="font-medium text-text">{row.jobName}</span>,
            },
            {
              id: 'trigger',
              header: 'Trigger',
              cell: (row) => (
                <Badge tone={row.trigger === 'MANUAL' ? 'info' : 'neutral'} size="sm">
                  {row.trigger === 'MANUAL' ? 'Run by hand' : 'Scheduled'}
                </Badge>
              ),
            },
            {
              id: 'status',
              header: 'Status',
              cell: (row) => (
                <Badge
                  tone={
                    row.status === 'SUCCEEDED' || row.status === 'COMPLETED'
                      ? 'ok'
                      : row.status === 'FAILED'
                        ? 'stop'
                        : 'wait'
                  }
                  size="sm"
                >
                  {row.status}
                </Badge>
              ),
            },
            {
              id: 'businessDate',
              header: 'Business date',
              hideBelow: 'md',
              cell: (row) =>
                row.businessDate && row.businessDate !== 'null' ? (
                  row.businessDate
                ) : (
                  <span className="text-text-muted">—</span>
                ),
            },
            {
              id: 'processed',
              header: 'Processed',
              align: 'right',
              cell: (row) => formatCount(row.processed),
            },
            {
              id: 'failed',
              header: 'Failed',
              align: 'right',
              cell: (row) => (
                <span className={row.failed > 0 ? 'font-semibold text-stop-text' : ''}>
                  {formatCount(row.failed)}
                </span>
              ),
            },
            {
              id: 'started',
              header: 'Started',
              hideBelow: 'lg',
              cell: (row) => formatTimestamp(row.startedAt),
            },
            {
              id: 'message',
              header: 'Message',
              hideBelow: 'xl',
              cell: (row) =>
                row.message && row.message !== 'null' ? (
                  <span className="text-text-secondary">{row.message}</span>
                ) : (
                  <span className="text-text-muted">—</span>
                ),
            },
          ]}
        />
      </Section>
    </>
  )
}
