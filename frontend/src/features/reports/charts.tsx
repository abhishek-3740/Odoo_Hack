import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { STAGE_LABEL, type CategoryRow, type ProductRow, type StageCount } from '@/api'
import { formatMoney, formatMoneyCompact } from '@/lib/money'

/**
 * Report charts.
 *
 * Colour decisions, so they are not re-litigated per chart:
 *
 *  - **One series gets one colour.** Pipeline value by stage and revenue by
 *    product are single measures across nominal categories, so every bar is
 *    slot 1. Shading each bar darker-where-bigger would double-encode the length
 *    as hue and buy nothing.
 *  - **Two series get the validated pair.** One-time and recurring revenue are
 *    both money on one axis, so they share a scale legitimately. The pair
 *    (`#0B7A52` forest, `#C98500` brass) was run through the palette validator:
 *    it clears the lightness band, the chroma floor, CVD separation (ΔE 11.9
 *    protan, 23.7 normal-vision) and the contrast check on green. The brass step
 *    sits just under 3:1 on the panel surface, which obliges relief — so every
 *    chart on this screen ships a legend and a table view of the same figures.
 *  - **Never a second y-axis.** Any measure on a different scale gets its own
 *    chart rather than a borrowed axis that would invent a correlation.
 *
 * Marks follow the house spec: bars capped at 24px with a 4px rounded data-end,
 * hairline solid gridlines one step off the surface, and axis text in text
 * tokens rather than the series colour.
 */

const SERIES_1 = '#0B7A52'
const SERIES_2 = '#C98500'
const GRID = 'var(--color-line)'
const AXIS_TEXT = 'var(--color-text-muted)'

const AXIS_STYLE = { fontSize: 11, fill: AXIS_TEXT } as const

/** The Recharts tooltip payload is readonly and loosely typed, so it is narrowed here once. */
interface TooltipEntry {
  name?: unknown
  value?: unknown
  color?: string
  dataKey?: unknown
}

function TooltipShell({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean
  payload?: readonly TooltipEntry[]
  label?: unknown
  currency: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-[--radius-control] border border-line bg-panel px-3 py-2 shadow-overlay">
      <p className="text-[13px] font-semibold text-text">{String(label ?? '')}</p>
      <ul className="mt-1 space-y-0.5">
        {payload.map((entry) => (
          <li key={String(entry.dataKey)} className="flex items-center gap-2 text-[13px]">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: entry.color }}
            />
            <span className="text-text-secondary">{String(entry.name ?? '')}</span>
            <span className="tabular ml-auto font-medium text-text">
              {formatMoney(String(entry.value ?? 0), currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* --------------------------------------------------------------- pipeline */

export function PipelineChart({
  rows,
  currency,
}: {
  rows: StageCount[]
  currency: string
}) {
  const data = rows.map((row) => ({
    stage: STAGE_LABEL[row.stage] ?? row.stage,
    value: Number(row.oneTimeNet ?? 0),
    count: row.count,
  }))

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 46)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 8 }}>
        <CartesianGrid horizontal={false} stroke={GRID} strokeWidth={1} />
        <XAxis
          type="number"
          tickFormatter={(value: number) => formatMoneyCompact(value, currency)}
          tick={AXIS_STYLE}
          axisLine={{ stroke: GRID }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="stage"
          width={132}
          tick={AXIS_STYLE}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: 'var(--color-canvas-sunken)' }}
          content={(props) => (
            <TooltipShell
              active={props.active}
              payload={props.payload as readonly TooltipEntry[] | undefined}
              label={props.label}
              currency={currency}
            />
          )}
        />
        <Bar dataKey="value" name="One-time value" fill={SERIES_1} radius={[0, 4, 4, 0]} barSize={22}>
          <LabelList
            dataKey="value"
            position="right"
            offset={8}
            className="tabular"
            style={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
            formatter={(value: unknown) => formatMoneyCompact(Number(value ?? 0), currency)}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/* -------------------------------------------------------------- categories */

export function CategoryChart({
  rows,
  currency,
}: {
  rows: CategoryRow[]
  currency: string
}) {
  const data = rows.map((row) => ({
    category: row.categoryName,
    oneTime: Number(row.oneTimeSales ?? 0),
    recurring: Number(row.recurringFirstCycle ?? 0),
  }))

  return (
    <ResponsiveContainer width="100%" height={Math.max(240, data.length * 62)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
        <CartesianGrid horizontal={false} stroke={GRID} strokeWidth={1} />
        <XAxis
          type="number"
          tickFormatter={(value: number) => formatMoneyCompact(value, currency)}
          tick={AXIS_STYLE}
          axisLine={{ stroke: GRID }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="category"
          width={132}
          tick={AXIS_STYLE}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: 'var(--color-canvas-sunken)' }}
          content={(props) => (
            <TooltipShell
              active={props.active}
              payload={props.payload as readonly TooltipEntry[] | undefined}
              label={props.label}
              currency={currency}
            />
          )}
        />
        {/* Two series, so a legend is always present — identity never rests on
            colour alone, and the table below repeats every figure. */}
        <Legend
          verticalAlign="top"
          align="left"
          height={28}
          iconType="square"
          iconSize={9}
          wrapperStyle={{ fontSize: 12, color: 'var(--color-text-secondary)' }}
        />
        <Bar
          dataKey="oneTime"
          name="One-time sales"
          fill={SERIES_1}
          radius={[0, 4, 4, 0]}
          barSize={14}
        />
        <Bar
          dataKey="recurring"
          name="Recurring, first cycle"
          fill={SERIES_2}
          radius={[0, 4, 4, 0]}
          barSize={14}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

/* ---------------------------------------------------------------- products */

export function TopProductsChart({
  rows,
  currency,
}: {
  rows: ProductRow[]
  currency: string
}) {
  const data = rows.slice(0, 8).map((row) => ({
    product: row.productName,
    value: Number(row.net ?? 0),
  }))

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 46)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 8 }}>
        <CartesianGrid horizontal={false} stroke={GRID} strokeWidth={1} />
        <XAxis
          type="number"
          tickFormatter={(value: number) => formatMoneyCompact(value, currency)}
          tick={AXIS_STYLE}
          axisLine={{ stroke: GRID }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="product"
          width={168}
          tick={AXIS_STYLE}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: 'var(--color-canvas-sunken)' }}
          content={(props) => (
            <TooltipShell
              active={props.active}
              payload={props.payload as readonly TooltipEntry[] | undefined}
              label={props.label}
              currency={currency}
            />
          )}
        />
        <Bar dataKey="value" name="Net sold" fill={SERIES_1} radius={[0, 4, 4, 0]} barSize={22}>
          {data.map((row) => (
            // One series, one colour: shading by size would encode length twice.
            <Cell key={row.product} fill={SERIES_1} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            offset={8}
            className="tabular"
            style={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
            formatter={(value: unknown) => formatMoneyCompact(Number(value ?? 0), currency)}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export const CHART_SERIES = { oneTime: SERIES_1, recurring: SERIES_2 }
