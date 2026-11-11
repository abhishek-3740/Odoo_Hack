import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

import { EmptyState, LoadingPanel } from './feedback'
import { Button } from './primitives'

/**
 * Dense financial tables.
 *
 * Deliberately not a generic grid: the requirements are narrow and specific —
 * numbers right-aligned and tabular so digits line up between rows, 44px rows,
 * a horizontal scroll that lives *inside* the table's own container so the page
 * never scrolls sideways, and one component that knows what loading, empty and
 * failed look like.
 */

export interface Column<Row> {
  /** Stable key, also used for the cell's `key`. */
  id: string
  header: ReactNode
  /** Numeric columns are right-aligned and use tabular figures. */
  align?: 'left' | 'right'
  /** Width or min-width class. Applied to the header and every cell. */
  width?: string
  /** Hidden below this breakpoint, for columns that are useful but not essential. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl'
  cell: (row: Row) => ReactNode
}

const HIDE_BELOW: Record<string, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
}

export interface DataTableProps<Row> {
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  /** An accessible name for the table. Required — a table with no name is a wall. */
  caption: string
  loading?: boolean
  error?: ReactNode
  empty?: ReactNode
  onRowClick?: (row: Row) => void
  /** Marks a row as the one currently open elsewhere on the page. */
  isActive?: (row: Row) => boolean
  className?: string
  /** Rendered below the last row, inside the same scroll container. */
  footer?: ReactNode
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  loading,
  error,
  empty,
  onRowClick,
  isActive,
  className,
  footer,
}: DataTableProps<Row>) {
  if (loading && rows.length === 0) return <LoadingPanel rows={5} />
  if (error) return <>{error}</>
  if (rows.length === 0) {
    return (
      <div className="rounded-[--radius-panel] border border-line bg-panel">
        {empty ?? <EmptyState title="Nothing here yet" />}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden rounded-[--radius-panel] border border-line bg-panel shadow-panel',
        className,
      )}
    >
      {/* The scroll lives here, so a wide table never pushes the page sideways. */}
      <div className="scroll-subtle overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line bg-panel-muted">
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className={cn(
                    'px-3 py-2.5 text-2xs font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap',
                    column.align === 'right' ? 'text-right' : 'text-left',
                    column.width,
                    column.hideBelow && HIDE_BELOW[column.hideBelow],
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const active = isActive?.(row)
              return (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            onRowClick(row)
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    'border-b border-line last:border-0 transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-canvas-sunken focus:bg-canvas-sunken focus:outline-none',
                    active && 'bg-forest-50',
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={cn(
                        'px-3 py-3 align-middle',
                        column.align === 'right' ? 'text-right tabular' : 'text-left',
                        column.width,
                        column.hideBelow && HIDE_BELOW[column.hideBelow],
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
          {footer ? (
            <tfoot className="border-t-2 border-line-strong bg-panel-muted">{footer}</tfoot>
          ) : null}
        </table>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- pagination */

/**
 * Server pagination.
 *
 * Shows what is actually on screen against the server's own total, so nobody
 * mistakes the first page for the whole business.
 */
export function Pagination({
  page,
  pageSize,
  totalItems,
  totalPages,
  onPageChange,
  busy,
}: {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  onPageChange: (page: number) => void
  busy?: boolean
}) {
  if (totalItems === 0) return null
  const first = page * pageSize + 1
  const last = Math.min((page + 1) * pageSize, totalItems)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
      <p className="tabular text-[13px] text-text-secondary">
        Showing {first}–{last} of {totalItems.toLocaleString('en-IN')}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={<ChevronLeft className="size-3.5" />}
          disabled={page <= 0 || busy}
          disabledReason={page <= 0 ? 'You are on the first page.' : undefined}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <span className="tabular px-1 text-[13px] text-text-secondary">
          Page {page + 1} of {Math.max(totalPages, 1)}
        </span>
        <Button
          size="sm"
          variant="secondary"
          iconAfter={<ChevronRight className="size-3.5" />}
          disabled={page + 1 >= totalPages || busy}
          disabledReason={page + 1 >= totalPages ? 'You are on the last page.' : undefined}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
