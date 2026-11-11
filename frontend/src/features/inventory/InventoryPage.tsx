import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PackagePlus, Settings2, Warehouse } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import {
  catalog,
  keys,
  newIdempotencyKey,
  stock,
  type MovementType,
  type StockLevel,
} from '@/api'
import { useAuth } from '@/auth/useAuth'
import { CATALOG_QUERY_OPTIONS } from '@/app/queryClient'
import {
  Badge,
  Button,
  DataTable,
  DateInput,
  Dialog,
  EmptyState,
  Field,
  FilterBar,
  InlineError,
  Input,
  PageHeader,
  RefreshingHint,
  Section,
  Select,
  Textarea,
  useDisclosure,
} from '@/design-system'
import { formatBusinessDate, todayAsBusinessDate } from '@/lib/dates'
import { formatQuantity } from '@/lib/money'

/**
 * Stock by variant and warehouse.
 *
 * Two operations live here and they are genuinely different: a **goods receipt**
 * changes what physically exists, and a **threshold** changes when the system
 * complains about it. Mixing them into one form is how a reorder point ends up
 * being recorded as inventory.
 *
 * A receipt requires an idempotency key, so a retried submission after a dropped
 * connection does not book the same delivery twice.
 */
export default function InventoryPage() {
  const { me } = useAuth()
  const [warehouseId, setWarehouseId] = useState('')
  const receipt = useDisclosure()
  const [editing, setEditing] = useState<StockLevel | null>(null)

  const warehouses = useQuery({
    queryKey: keys.warehouses(),
    queryFn: ({ signal }) => catalog.warehouses(signal),
    ...CATALOG_QUERY_OPTIONS,
  })

  const query = { warehouseId: warehouseId || undefined }
  const levels = useQuery({
    queryKey: keys.stockLevels(query),
    queryFn: ({ signal }) => stock.levels(query, signal),
  })

  const canOperate = me?.role === 'FINANCE' || me?.role === 'ADMIN'
  const rows = levels.data ?? []
  const low = rows.filter((row) => row.needsReplenishment)

  return (
    <>
      <PageHeader
        title="Inventory"
        description="On hand, reserved and available by warehouse. Reserved quantities belong to confirmed orders and are not free to promise again."
        meta={<RefreshingHint visible={levels.isFetching && !levels.isLoading} />}
        actions={
          canOperate ? (
            <Button
              variant="primary"
              icon={<PackagePlus className="size-4" />}
              onClick={receipt.show}
            >
              Record a receipt
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <div className="w-64 space-y-1.5">
          <label htmlFor="warehouse-filter" className="block text-[13px] font-medium text-text">
            Warehouse
          </label>
          <Select
            id="warehouse-filter"
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
          >
            <option value="">Every warehouse</option>
            {(warehouses.data ?? [])
              .filter((house) => house.active)
              .map((house) => (
                <option key={house.id} value={house.id}>
                  {house.name} ({house.code})
                </option>
              ))}
          </Select>
        </div>
      </FilterBar>

      {low.length > 0 ? (
        <div className="mb-4 rounded-[--radius-panel] border border-wait-border bg-wait-surface px-4 py-3">
          <p className="text-[13px] font-semibold text-wait-text">
            {low.length} line{low.length === 1 ? '' : 's'} below its reorder point
          </p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-wait-text/90">
            The suggested quantity is the gap between what is available and the target — it is a
            prompt, not an order.
          </p>
        </div>
      ) : null}

      <Section
        id="stock"
        title="Stock levels"
        description="Available is on hand less what is already reserved for confirmed orders."
      >
        <DataTable
          caption="Stock levels by variant and warehouse"
          rows={rows}
          rowKey={(row) => `${row.variantId}-${row.warehouseId}`}
          loading={levels.isLoading}
          error={
            levels.error ? (
              <InlineError error={levels.error} onRetry={() => void levels.refetch()} />
            ) : undefined
          }
          empty={
            <EmptyState
              icon={<Warehouse className="size-5" aria-hidden />}
              title="No stock records"
              description="A record appears the first time a variant is received into a warehouse."
            />
          }
          columns={[
            {
              id: 'product',
              header: 'Item',
              cell: (row) => (
                <span>
                  <span className="block font-medium text-text">{row.productName ?? '—'}</span>
                  <span className="tabular block text-2xs text-text-muted">{row.sku}</span>
                </span>
              ),
            },
            {
              id: 'warehouse',
              header: 'Warehouse',
              cell: (row) => <span className="tabular text-text-secondary">{row.warehouseCode}</span>,
            },
            {
              id: 'onHand',
              header: 'On hand',
              align: 'right',
              cell: (row) => formatQuantity(row.onHand),
            },
            {
              id: 'reserved',
              header: 'Reserved',
              align: 'right',
              hideBelow: 'md',
              cell: (row) => (
                <span className="text-text-secondary">{formatQuantity(row.reserved)}</span>
              ),
            },
            {
              id: 'available',
              header: 'Available',
              align: 'right',
              cell: (row) => (
                <span className={row.needsReplenishment ? 'font-semibold text-wait-text' : ''}>
                  {formatQuantity(row.available)}
                </span>
              ),
            },
            {
              id: 'reorder',
              header: 'Reorder at',
              align: 'right',
              hideBelow: 'lg',
              cell: (row) => formatQuantity(row.reorderPoint),
            },
            {
              id: 'target',
              header: 'Target',
              align: 'right',
              hideBelow: 'xl',
              cell: (row) => formatQuantity(row.targetQty),
            },
            {
              id: 'expected',
              header: 'Next receipt',
              hideBelow: 'lg',
              cell: (row) =>
                row.expectedReceiptDate ? (
                  formatBusinessDate(row.expectedReceiptDate)
                ) : (
                  <span className="text-text-muted">Unconfirmed</span>
                ),
            },
            {
              id: 'flag',
              header: '',
              cell: (row) =>
                row.needsReplenishment ? (
                  <Badge tone="wait" size="sm">
                    Suggest {formatQuantity(row.replenishmentSuggestion)}
                  </Badge>
                ) : null,
            },
            ...(canOperate
              ? [
                  {
                    id: 'edit',
                    header: '',
                    align: 'right' as const,
                    cell: (row: StockLevel) => (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Settings2 className="size-3.5" />}
                        onClick={() => setEditing(row)}
                      >
                        Thresholds
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Section>

      <p className="mt-4 text-[13px] leading-relaxed text-text-secondary">
        Looking for a specific order's reservations? They are on the{' '}
        <Link to="/admin/orders" className="font-medium text-forest-600 hover:underline">
          order
        </Link>{' '}
        itself, where they can be re-planned and dispatched.
      </p>

      <ReceiptDialog open={receipt.open} onOpenChange={receipt.setOpen} />
      <ThresholdDialog level={editing} onClose={() => setEditing(null)} />
    </>
  )
}

/* ----------------------------------------------------------------- receipt */

function ReceiptDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [productId, setProductId] = useState('')
  const [variantId, setVariantId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [movementType, setMovementType] = useState<MovementType>('RECEIPT')
  const [expectedDate, setExpectedDate] = useState<string | null>(null)
  const [expectedQty, setExpectedQty] = useState('')
  const [note, setNote] = useState('')
  const [consolidatable, setConsolidatable] = useState<string[]>([])

  const products = useQuery({
    queryKey: keys.products({ pageSize: 200 }),
    queryFn: ({ signal }) => catalog.products({ pageSize: 200 }, signal),
    enabled: open,
    ...CATALOG_QUERY_OPTIONS,
  })

  const variants = useQuery({
    queryKey: keys.variants(productId || 'none'),
    queryFn: ({ signal }) => catalog.variants(productId, signal),
    enabled: open && Boolean(productId),
    ...CATALOG_QUERY_OPTIONS,
  })

  const warehouses = useQuery({
    queryKey: keys.warehouses(),
    queryFn: ({ signal }) => catalog.warehouses(signal),
    enabled: open,
    ...CATALOG_QUERY_OPTIONS,
  })

  const record = useMutation({
    mutationFn: () =>
      stock.recordMovement(
        {
          variantId,
          warehouseId,
          quantity,
          movementType,
          expectedNextReceiptDate: expectedDate,
          expectedNextReceiptQty: expectedQty || null,
          note: note.trim() || null,
        },
        // One key per receipt. A retry after a dropped connection replays the
        // same movement rather than booking the delivery twice.
        newIdempotencyKey(),
      ),
    onSuccess: (result) => {
      toast.success(
        result.movement.replayed ? 'Already recorded' : 'Stock movement recorded',
        {
          description: result.consolidatableOrderIds.length
            ? `${result.consolidatableOrderIds.length} order(s) can now be re-planned with this stock.`
            : undefined,
        },
      )
      setConsolidatable(result.consolidatableOrderIds)
      setQuantity('')
      setNote('')
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'stock-levels'] })
      void queryClient.invalidateQueries({ queryKey: keys.orders() })
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setConsolidatable([])
        onOpenChange(next)
      }}
      title="Record a stock movement"
      description="A receipt books goods in. An adjustment corrects a count. Both change what the allocator can reserve."
      busy={record.isPending}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={record.isPending}>
            Close
          </Button>
          <Button
            variant="primary"
            busy={record.isPending}
            disabled={!variantId || !warehouseId || !quantity}
            disabledReason="Choose an item, a warehouse and a quantity."
            onClick={() => record.mutate()}
          >
            Record movement
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Product" required>
            {(props) => (
              <Select
                {...props}
                value={productId}
                onChange={(event) => {
                  setProductId(event.target.value)
                  setVariantId('')
                }}
              >
                <option value="">Choose a product…</option>
                {(products.data?.items ?? [])
                  .filter((product) => product.fulfillmentKind === 'STOCK')
                  .map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>

          <Field label="Variant" required>
            {(props) => (
              <Select
                {...props}
                value={variantId}
                disabled={!productId}
                onChange={(event) => setVariantId(event.target.value)}
              >
                <option value="">Choose a variant…</option>
                {(variants.data ?? []).map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.name} · {variant.sku}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Warehouse" required>
            {(props) => (
              <Select
                {...props}
                value={warehouseId}
                onChange={(event) => setWarehouseId(event.target.value)}
              >
                <option value="">Choose…</option>
                {(warehouses.data ?? [])
                  .filter((house) => house.active)
                  .map((house) => (
                    <option key={house.id} value={house.id}>
                      {house.code}
                    </option>
                  ))}
              </Select>
            )}
          </Field>

          <Field label="Movement" required>
            {(props) => (
              <Select
                {...props}
                value={movementType}
                onChange={(event) => setMovementType(event.target.value as MovementType)}
              >
                <option value="RECEIPT">Receipt — goods arrived</option>
                <option value="ADJUSTMENT">Adjustment — correct the count</option>
              </Select>
            )}
          </Field>

          <Field
            label="Quantity"
            required
            hint={movementType === 'ADJUSTMENT' ? 'May be negative.' : undefined}
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                step="0.001"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <DateInput
            label="Next receipt expected"
            hint="Shown against shortages. Leave empty and the system says “unconfirmed” rather than inventing a date."
            value={expectedDate}
            min={todayAsBusinessDate()}
            onChange={setExpectedDate}
          />
          <Field label="Next receipt quantity">
            {(props) => (
              <Input
                {...props}
                type="number"
                step="0.001"
                value={expectedQty}
                onChange={(event) => setExpectedQty(event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Note">
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Delivery note number, supplier, or why the count was corrected."
            />
          )}
        </Field>

        {consolidatable.length > 0 ? (
          <div className="rounded-[--radius-control] border border-ok-border bg-ok-surface px-3 py-2.5">
            <p className="text-[13px] font-semibold text-ok-text">
              {consolidatable.length} order{consolidatable.length === 1 ? '' : 's'} can now be
              re-planned
            </p>
            <ul className="mt-1.5 space-y-1">
              {consolidatable.map((orderId) => (
                <li key={orderId}>
                  <Link
                    to={`/admin/orders/${orderId}`}
                    className="text-[13px] font-medium text-forest-700 hover:underline"
                  >
                    Open the order and re-plan →
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {record.error ? <InlineError error={record.error} /> : null}
      </div>
    </Dialog>
  )
}

/* --------------------------------------------------------------- thresholds */

function ThresholdDialog({
  level,
  onClose,
}: {
  level: StockLevel | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [reorderPoint, setReorderPoint] = useState('')
  const [targetQty, setTargetQty] = useState('')
  const [expectedDate, setExpectedDate] = useState<string | null>(null)
  const [expectedQty, setExpectedQty] = useState('')

  const open = level !== null

  const save = useMutation({
    mutationFn: () =>
      stock.updateLevel({
        variantId: level!.variantId,
        warehouseId: level!.warehouseId,
        reorderPoint: reorderPoint || null,
        targetQty: targetQty || null,
        expectedReceiptDate: expectedDate,
        expectedReceiptQty: expectedQty || null,
      }),
    onSuccess: () => {
      toast.success('Thresholds saved')
      onClose()
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'stock-levels'] })
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={level ? `Thresholds · ${level.productName ?? level.sku}` : 'Thresholds'}
      description="Replenishment settings, not inventory. Changing these does not change what is on hand."
      busy={save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
            Save thresholds
          </Button>
        </>
      }
    >
      {level ? (
        <div className="space-y-4">
          <p className="rounded-[--radius-control] bg-canvas-sunken px-3 py-2.5 text-[13px] text-text-secondary">
            {level.warehouseCode} · currently {formatQuantity(level.available)} available of{' '}
            {formatQuantity(level.onHand)} on hand.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Reorder point"
              hint="An alert is raised when available falls below this."
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  step="0.001"
                  placeholder={String(level.reorderPoint)}
                  value={reorderPoint}
                  onChange={(event) => setReorderPoint(event.target.value)}
                />
              )}
            </Field>
            <Field label="Target quantity" hint="The suggestion tops available back up to this.">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  step="0.001"
                  placeholder={String(level.targetQty)}
                  value={targetQty}
                  onChange={(event) => setTargetQty(event.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <DateInput
              label="Expected receipt date"
              value={expectedDate}
              min={todayAsBusinessDate()}
              onChange={setExpectedDate}
            />
            <Field label="Expected receipt quantity">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  step="0.001"
                  value={expectedQty}
                  onChange={(event) => setExpectedQty(event.target.value)}
                />
              )}
            </Field>
          </div>

          {save.error ? <InlineError error={save.error} /> : null}
        </div>
      ) : null}
    </Dialog>
  )
}
