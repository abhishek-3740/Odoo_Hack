import { useQuery } from '@tanstack/react-query'
import { BarChart3, Download, FileSpreadsheet, Table2 } from 'lucide-react'
import { Suspense, lazy, useState } from 'react'
import { toast } from 'sonner'

import {
  catalog,
  customers as customersApi,
  keys,
  people,
  reports,
  STAGE_LABEL,
  type ReportFilter,
  type ReportFormat,
} from '@/api'
import { useAuth } from '@/auth/useAuth'
import { CATALOG_QUERY_OPTIONS } from '@/app/queryClient'
import {
  Button,
  DataTable,
  DateInput,
  EmptyState,
  FilterBar,
  InlineError,
  LoadingPanel,
  Menu,
  MenuItem,
  MenuLabel,
  Panel,
  PanelHeader,
  PageHeader,
  RefreshingHint,
  Section,
  Select,
  Skeleton,
  Stat,
} from '@/design-system'
import { businessDatePlusDays, formatBusinessDate, formatTimestamp } from '@/lib/dates'
import { formatCount, formatMoney, formatMoneyCompact, formatPercent, formatQuantity } from '@/lib/money'

// Recharts is the largest dependency in the app and only this screen needs it.
const PipelineChart = lazy(() =>
  import('./charts').then((module) => ({ default: module.PipelineChart })),
)
const CategoryChart = lazy(() =>
  import('./charts').then((module) => ({ default: module.CategoryChart })),
)
const TopProductsChart = lazy(() =>
  import('./charts').then((module) => ({ default: module.TopProductsChart })),
)

/**
 * Sales reporting.
 *
 * Four money figures are reported and never added together, because they answer
 * four different questions — one-time sales, MRR, invoiced and collected. A tile
 * that summed them would produce a number with no meaning, so each carries its
 * own scope line.
 *
 * The export calls the same service method with the same scoping. The file is
 * the screen, rendered — not a differently-computed summary of it.
 */
export default function ReportsPage() {
  const { me } = useAuth()
  const [filter, setFilter] = useState<ReportFilter>({
    from: businessDatePlusDays(-90),
    to: businessDatePlusDays(0),
  })
  const [showTables, setShowTables] = useState(false)

  const report = useQuery({
    queryKey: keys.report(filter),
    queryFn: ({ signal }) => reports.sales(filter, signal),
  })

  const customers = useQuery({
    queryKey: keys.customers({ pageSize: 200 }),
    queryFn: ({ signal }) => customersApi.list({ pageSize: 200 }, signal),
    ...CATALOG_QUERY_OPTIONS,
  })

  const categories = useQuery({
    queryKey: keys.categories(),
    queryFn: ({ signal }) => catalog.categories(signal),
    ...CATALOG_QUERY_OPTIONS,
  })

  const reps = useQuery({
    queryKey: keys.profiles({ role: 'REP' }),
    queryFn: ({ signal }) => people.profiles({ role: 'REP', pageSize: 100 }, signal),
    enabled: me?.role === 'ADMIN' || me?.role === 'MANAGER' || me?.role === 'FINANCE',
    ...CATALOG_QUERY_OPTIONS,
  })

  const set = <K extends keyof ReportFilter>(key: K, value: ReportFilter[K]) =>
    setFilter((current) => ({ ...current, [key]: value }))

  const download = async (format: ReportFormat) => {
    try {
      await reports.export(filter, format)
      toast.success('Export downloaded', {
        description: 'The file is the same figures, computed by the same service call.',
      })
    } catch (error) {
      toast.error('The export could not be produced', {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  const data = report.data
  const currency = data?.currency ?? 'INR'

  return (
    <>
      <PageHeader
        title="Sales report"
        description="Quotations count by creation date, orders by confirmation, invoices by issue and payments by when they were recorded. Those definitions are fixed, and the export uses them too."
        meta={
          <>
            {data ? (
              <span className="text-[13px] text-text-secondary">
                Computed {formatTimestamp(data.generatedAt)}
              </span>
            ) : null}
            <RefreshingHint visible={report.isFetching && !report.isLoading} />
          </>
        }
        actions={
          <>
            <Button
              variant="ghost"
              icon={showTables ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
              onClick={() => setShowTables((value) => !value)}
            >
              {showTables ? 'Show charts' : 'Show tables'}
            </Button>
            <Menu
              trigger={
                <Button variant="secondary" icon={<Download className="size-4" />}>
                  Export
                </Button>
              }
            >
              <MenuLabel>Same figures, as a file</MenuLabel>
              <MenuItem
                icon={<FileSpreadsheet className="size-3.5" />}
                onSelect={() => void download('pdf')}
              >
                PDF
              </MenuItem>
              <MenuItem
                icon={<FileSpreadsheet className="size-3.5" />}
                onSelect={() => void download('xlsx')}
              >
                Excel (.xlsx)
              </MenuItem>
              <MenuItem
                icon={<FileSpreadsheet className="size-3.5" />}
                onSelect={() => void download('xls')}
              >
                Excel 97 (.xls)
              </MenuItem>
            </Menu>
          </>
        }
      />

      <FilterBar>
        <DateInput
          label="From"
          className="w-44"
          value={filter.from ?? null}
          onChange={(value) => set('from', value)}
        />
        <DateInput
          label="To"
          className="w-44"
          value={filter.to ?? null}
          onChange={(value) => set('to', value)}
        />

        <div className="w-52 space-y-1.5">
          <label htmlFor="report-stage" className="block text-[13px] font-medium text-text">
            Stage
          </label>
          <Select
            id="report-stage"
            value={filter.stage ?? ''}
            onChange={(event) => set('stage', event.target.value || null)}
          >
            <option value="">Every stage</option>
            {Object.entries(STAGE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-56 space-y-1.5">
          <label htmlFor="report-customer" className="block text-[13px] font-medium text-text">
            Customer
          </label>
          <Select
            id="report-customer"
            value={filter.customerId ?? ''}
            onChange={(event) => set('customerId', event.target.value || null)}
          >
            <option value="">Every customer</option>
            {(customers.data?.items ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-48 space-y-1.5">
          <label htmlFor="report-category" className="block text-[13px] font-medium text-text">
            Category
          </label>
          <Select
            id="report-category"
            value={filter.categoryId ?? ''}
            onChange={(event) => set('categoryId', event.target.value || null)}
          >
            <option value="">Every category</option>
            {(categories.data ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
        </div>

        {reps.data ? (
          <div className="w-52 space-y-1.5">
            <label htmlFor="report-owner" className="block text-[13px] font-medium text-text">
              Salesperson
            </label>
            <Select
              id="report-owner"
              value={filter.ownerProfileId ?? ''}
              onChange={(event) => set('ownerProfileId', event.target.value || null)}
            >
              <option value="">Everyone in scope</option>
              {(reps.data.items ?? []).map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.fullName ?? profile.email}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </FilterBar>

      {report.isLoading && !data ? (
        <LoadingPanel rows={8} />
      ) : report.error ? (
        <InlineError error={report.error} onRetry={() => void report.refetch()} />
      ) : !data ? null : (
        <div className="space-y-7">
          {/* Four figures, four questions, never a total. */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="One-time sales"
              value={formatMoney(data.oneTimeSales, currency, { round: true })}
              scope="Confirmed one-time lines in this window"
              tone="forest"
            />
            <Stat
              label="Monthly recurring revenue"
              value={formatMoney(data.monthlyRecurringRevenue, currency, { round: true })}
              scope="Recurring commitments normalised to a month"
              tone="brass"
            />
            <Stat
              label="Invoiced"
              value={formatMoney(data.invoicedRevenue, currency, { round: true })}
              scope="What has actually been billed"
            />
            <Stat
              label="Collected"
              value={formatMoney(data.cashCollected, currency, { round: true })}
              scope={`Received · ${formatMoney(data.outstandingReceivables, currency, { round: true })} still outstanding`}
            />
          </div>

          <p className="rounded-[--radius-panel] border border-line bg-panel-muted px-4 py-3 text-[13px] leading-relaxed text-text-secondary">
            These four are never added together. One-time sales is committed value, MRR is a
            normalised run rate, invoiced is what has been billed and collected is what has arrived
            — summing them would produce a figure that answers no question.
          </p>

          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Quotations" value={formatCount(data.quotationCount)} scope="Created in window" />
            <Stat label="Orders" value={formatCount(data.orderCount)} scope="Confirmed in window" />
            <Stat label="Invoices" value={formatCount(data.invoiceCount)} scope="Issued in window" />
            <Stat label="Receipts" value={formatCount(data.paymentCount)} scope="Recorded in window" />
          </div>

          {/* ------------------------------------------------------ pipeline */}
          <Section
            id="pipeline"
            title="Pipeline by stage"
            description="One-time value of the quotations sitting in each stage."
          >
            {data.pipeline.length === 0 ? (
              <Panel>
                <EmptyState title="No quotations in this window" />
              </Panel>
            ) : showTables ? (
              <DataTable
                caption="Pipeline by stage"
                rows={data.pipeline}
                rowKey={(row) => row.stage}
                columns={[
                  {
                    id: 'stage',
                    header: 'Stage',
                    cell: (row) => STAGE_LABEL[row.stage] ?? row.stage,
                  },
                  {
                    id: 'count',
                    header: 'Quotations',
                    align: 'right',
                    cell: (row) => formatCount(row.count),
                  },
                  {
                    id: 'value',
                    header: 'One-time value',
                    align: 'right',
                    cell: (row) => formatMoney(row.oneTimeNet, currency),
                  },
                ]}
              />
            ) : (
              <Panel>
                <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                  <PipelineChart rows={data.pipeline} currency={currency} />
                </Suspense>
              </Panel>
            )}
          </Section>

          {/* ---------------------------------------------------- categories */}
          <Section
            id="categories"
            title="Revenue by category"
            description="One-time sales and the first recurring cycle, side by side on one scale."
          >
            {data.byCategory.length === 0 ? (
              <Panel>
                <EmptyState title="No category data in this window" />
              </Panel>
            ) : showTables ? (
              <DataTable
                caption="Revenue by category"
                rows={data.byCategory}
                rowKey={(row) => row.categoryId}
                columns={[
                  { id: 'category', header: 'Category', cell: (row) => row.categoryName },
                  {
                    id: 'lines',
                    header: 'Lines',
                    align: 'right',
                    hideBelow: 'md',
                    cell: (row) => formatCount(row.lines),
                  },
                  {
                    id: 'oneTime',
                    header: 'One-time sales',
                    align: 'right',
                    cell: (row) => formatMoney(row.oneTimeSales, currency),
                  },
                  {
                    id: 'recurring',
                    header: 'Recurring, first cycle',
                    align: 'right',
                    cell: (row) => formatMoney(row.recurringFirstCycle, currency),
                  },
                  {
                    id: 'contribution',
                    header: 'Contribution',
                    align: 'right',
                    hideBelow: 'lg',
                    cell: (row) =>
                      `${formatMoney(row.contribution, currency)} · ${formatPercent(row.contributionPercent)}`,
                  },
                ]}
              />
            ) : (
              <Panel>
                <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                  <CategoryChart rows={data.byCategory} currency={currency} />
                </Suspense>
              </Panel>
            )}
          </Section>

          {/* ------------------------------------------------------ products */}
          <Section
            id="products"
            title="Top products"
            description="By net value sold in this window."
          >
            {data.topProducts.length === 0 ? (
              <Panel>
                <EmptyState title="No product data in this window" />
              </Panel>
            ) : showTables ? (
              <DataTable
                caption="Top products"
                rows={data.topProducts}
                rowKey={(row) => row.productId}
                columns={[
                  {
                    id: 'product',
                    header: 'Product',
                    cell: (row) => (
                      <span>
                        <span className="block font-medium text-text">{row.productName}</span>
                        <span className="tabular block text-2xs text-text-muted">
                          {row.productCode}
                        </span>
                      </span>
                    ),
                  },
                  {
                    id: 'quantity',
                    header: 'Quantity',
                    align: 'right',
                    cell: (row) => formatQuantity(row.quantity),
                  },
                  {
                    id: 'orders',
                    header: 'Orders',
                    align: 'right',
                    hideBelow: 'md',
                    cell: (row) => formatCount(row.orders),
                  },
                  {
                    id: 'net',
                    header: 'Net',
                    align: 'right',
                    cell: (row) => formatMoney(row.net, currency),
                  },
                ]}
              />
            ) : (
              <Panel>
                <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                  <TopProductsChart rows={data.topProducts} currency={currency} />
                </Suspense>
              </Panel>
            )}
          </Section>

          {/* ---------------------------------------------------------- reps */}
          <Section
            id="by-rep"
            title="By salesperson"
            description="Identity plus several measures — a table reads this better than any chart would."
          >
            <DataTable
              caption="Performance by salesperson"
              rows={data.byRep}
              rowKey={(row) => row.ownerProfileId}
              empty={<EmptyState title="No salesperson data in this window" />}
              columns={[
                { id: 'name', header: 'Salesperson', cell: (row) => row.ownerName ?? '—' },
                {
                  id: 'quotations',
                  header: 'Quotations',
                  align: 'right',
                  cell: (row) => formatCount(row.quotations),
                },
                {
                  id: 'orders',
                  header: 'Orders',
                  align: 'right',
                  cell: (row) => formatCount(row.orders),
                },
                {
                  id: 'oneTime',
                  header: 'One-time sales',
                  align: 'right',
                  cell: (row) => formatMoney(row.oneTimeSales, currency),
                },
                {
                  id: 'mrr',
                  header: 'MRR',
                  align: 'right',
                  hideBelow: 'md',
                  cell: (row) => formatMoney(row.monthlyRecurringRevenue, currency),
                },
                {
                  id: 'discount',
                  header: 'Average discount',
                  align: 'right',
                  hideBelow: 'lg',
                  cell: (row) => formatPercent(row.averageDiscountPercent),
                },
              ]}
            />
          </Section>

          {/* --------------------------------------------------- quotations */}
          <Section
            id="quotations"
            title="Quotations in this window"
            description="The rows behind the figures above."
          >
            <DataTable
              caption="Quotations included in this report"
              rows={data.quotations}
              rowKey={(row) => row.quoteId}
              empty={<EmptyState title="No quotations match these filters" />}
              columns={[
                {
                  id: 'reference',
                  header: 'Reference',
                  cell: (row) => <span className="tabular font-medium">{row.reference}</span>,
                },
                { id: 'customer', header: 'Customer', cell: (row) => row.customerName ?? '—' },
                {
                  id: 'owner',
                  header: 'Owner',
                  hideBelow: 'lg',
                  cell: (row) => row.ownerName ?? '—',
                },
                {
                  id: 'stage',
                  header: 'Stage',
                  cell: (row) => STAGE_LABEL[row.stage] ?? row.stage,
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
                  hideBelow: 'md',
                  cell: (row) => formatMoney(row.recurringFirstCycleNet, row.currency),
                },
                {
                  id: 'created',
                  header: 'Created',
                  hideBelow: 'xl',
                  cell: (row) => formatBusinessDate(row.createdOn),
                },
              ]}
            />
          </Section>

          <Panel tone="muted">
            <PanelHeader
              as="h3"
              title="What this report covers"
              description={`${formatBusinessDate(data.filter.from)} to ${formatBusinessDate(data.filter.to)} · ${formatMoneyCompact(data.oneTimeSales, currency)} of one-time sales · computed ${formatTimestamp(data.generatedAt)}.`}
            />
            <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
              Scope follows your role, exactly as the server computes it. An export made now
              contains these figures and carries the same timestamp, so a file can never quietly
              pass as live.
            </p>
          </Panel>
        </div>
      )}
    </>
  )
}
