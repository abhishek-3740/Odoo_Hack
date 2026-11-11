import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import {
  ApiError,
  catalog,
  fulfillment,
  keys,
  type AllocationPlan,
  type Order,
  type UUID,
} from '@/api'
import { CATALOG_QUERY_OPTIONS } from '@/app/queryClient'
import {
  Button,
  Dialog,
  Field,
  IconButton,
  InlineError,
  Panel,
  Select,
  Textarea,
} from '@/design-system'
import { formatQuantity } from '@/lib/money'

/**
 * A manual warehouse split.
 *
 * The server validates this exactly, under the same locks an automatic
 * allocation uses, and refuses an infeasible request outright rather than
 * quietly turning "five from Bangalore" into "three now, two later". So this
 * form's job is to make the intent unambiguous and then show the refusal
 * clearly when it comes — not to pre-validate against stock figures that could
 * be stale by the time the request lands.
 */
export function AllocationOverrideDialog({
  open,
  onOpenChange,
  order,
  plan,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  order: Order
  plan: AllocationPlan | undefined
}) {
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<Array<{ orderLineId: UUID; warehouseId: UUID | ''; quantity: string }>>([])
  const [reason, setReason] = useState('')

  const warehouses = useQuery({
    queryKey: keys.warehouses(),
    queryFn: ({ signal }) => catalog.warehouses(signal),
    enabled: open,
    ...CATALOG_QUERY_OPTIONS,
  })

  const stockLines = order.lines.filter((line) => line.requiresStock)

  // Seed from the plan the server proposed, so the starting point is a feasible
  // split rather than an empty form.
  useEffect(() => {
    if (!open) return
    const seeded = (plan?.allocations ?? []).map((allocation) => ({
      orderLineId: allocation.orderLineId,
      warehouseId: allocation.warehouseId as UUID | '',
      quantity: String(allocation.quantity),
    }))
    setRows(
      seeded.length > 0
        ? seeded
        : stockLines.map((line) => ({
            orderLineId: line.id,
            warehouseId: '' as UUID | '',
            quantity: String(line.quantity),
          })),
    )
    setReason('')
    // The seed depends on the plan and the order's own lines, both stable here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan])

  const apply = useMutation({
    mutationFn: () =>
      fulfillment.override(order.id, {
        allocations: rows
          .filter((row) => row.warehouseId && Number(row.quantity) > 0)
          .map((row) => ({
            orderLineId: row.orderLineId,
            warehouseId: row.warehouseId as UUID,
            quantity: row.quantity,
          })),
        reason: reason.trim() || null,
      }),
    onSuccess: (result) => {
      toast.success('Allocation applied', {
        description: result.fullyFulfilled
          ? `${result.shipmentCount} parcel${result.shipmentCount === 1 ? '' : 's'}, fully covered.`
          : `${result.shortages.length} line(s) remain short and become backorders.`,
      })
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: keys.order(order.id) })
      void queryClient.invalidateQueries({ queryKey: keys.orderAllocation(order.id) })
      void queryClient.invalidateQueries({ queryKey: keys.orderFulfillment(order.id) })
    },
  })

  const lineName = (orderLineId: UUID) =>
    order.lines.find((line) => line.id === orderLineId)?.description ?? 'Line'

  // The server insists allocated plus backordered equals ordered, so showing the
  // running total per line is the difference between one refusal and five.
  const allocatedFor = (orderLineId: UUID) =>
    rows
      .filter((row) => row.orderLineId === orderLineId)
      .reduce((total, row) => total + Number(row.quantity || 0), 0)

  const infeasible = apply.error instanceof ApiError && apply.error.status === 422

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Allocate by hand"
      description="Exact quantities from exact warehouses. The server validates this under a lock and refuses anything it cannot actually reserve."
      size="lg"
      busy={apply.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={apply.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={apply.isPending}
            disabled={rows.every((row) => !row.warehouseId || Number(row.quantity) <= 0)}
            disabledReason="Give at least one line a warehouse and a quantity."
            onClick={() => apply.mutate()}
          >
            Apply this split
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {stockLines.length === 0 ? (
          <Panel tone="muted" className="text-[13px] text-text-secondary">
            No line on this order consumes stock, so there is nothing to allocate.
          </Panel>
        ) : (
          <>
            <ul className="space-y-2">
              {rows.map((row, index) => (
                <li
                  key={`${row.orderLineId}-${index}`}
                  className="grid gap-2 rounded-[--radius-control] border border-line px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_6rem_auto] sm:items-end"
                >
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`alloc-line-${index}`}
                      className="block text-2xs font-medium text-text-muted"
                    >
                      Line
                    </label>
                    <Select
                      id={`alloc-line-${index}`}
                      value={row.orderLineId}
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((entry, position) =>
                            position === index
                              ? { ...entry, orderLineId: event.target.value as UUID }
                              : entry,
                          ),
                        )
                      }
                    >
                      {stockLines.map((line) => (
                        <option key={line.id} value={line.id}>
                          {line.description}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor={`alloc-house-${index}`}
                      className="block text-2xs font-medium text-text-muted"
                    >
                      Warehouse
                    </label>
                    <Select
                      id={`alloc-house-${index}`}
                      value={row.warehouseId}
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((entry, position) =>
                            position === index
                              ? { ...entry, warehouseId: event.target.value as UUID }
                              : entry,
                          ),
                        )
                      }
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
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor={`alloc-qty-${index}`}
                      className="block text-2xs font-medium text-text-muted"
                    >
                      Quantity
                    </label>
                    <input
                      id={`alloc-qty-${index}`}
                      type="number"
                      step="0.001"
                      min="0"
                      value={row.quantity}
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((entry, position) =>
                            position === index ? { ...entry, quantity: event.target.value } : entry,
                          ),
                        )
                      }
                      className="tabular h-10 w-full rounded-[--radius-control] border border-line-strong px-2 text-right text-sm"
                    />
                  </div>

                  <IconButton
                    label={`Remove this allocation of ${lineName(row.orderLineId)}`}
                    size="sm"
                    onClick={() =>
                      setRows((current) => current.filter((_entry, position) => position !== index))
                    }
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ul>

            <Button
              size="sm"
              variant="secondary"
              icon={<Plus className="size-3.5" />}
              onClick={() =>
                setRows((current) => [
                  ...current,
                  { orderLineId: stockLines[0].id, warehouseId: '', quantity: '1' },
                ])
              }
            >
              Split a line across another warehouse
            </Button>

            <Panel tone="muted" className="space-y-1 text-[13px]">
              <p className="font-medium text-text">Allocated against ordered</p>
              {stockLines.map((line) => {
                const allocated = allocatedFor(line.id)
                const ordered = Number(line.quantity)
                return (
                  <p key={line.id} className="tabular text-text-secondary">
                    {line.description}: {formatQuantity(String(allocated))} of{' '}
                    {formatQuantity(line.quantity)}
                    {allocated < ordered ? (
                      <span className="text-wait-text">
                        {' '}
                        · {formatQuantity(String(ordered - allocated))} would become a backorder
                      </span>
                    ) : allocated > ordered ? (
                      <span className="text-stop-text"> · more than was ordered</span>
                    ) : null}
                  </p>
                )
              })}
            </Panel>

            <Field label="Reason" hint="Recorded in the audit trail alongside the override.">
              {(props) => (
                <Textarea
                  {...props}
                  rows={2}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="e.g. Customer collects from the Pune warehouse."
                />
              )}
            </Field>
          </>
        )}

        {apply.error ? (
          <InlineError
            error={apply.error}
            title={infeasible ? 'That split cannot be fulfilled' : 'The allocation was refused'}
          />
        ) : null}
      </div>
    </Dialog>
  )
}
