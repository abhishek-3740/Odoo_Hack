import { useQuery } from '@tanstack/react-query'
import { Package, Repeat, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { catalog, keys, type Product, type UUID } from '@/api'
import { CATALOG_QUERY_OPTIONS } from '@/app/queryClient'
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  InlineError,
  Input,
  Spinner,
} from '@/design-system'
import { cn } from '@/lib/cn'
import { formatMoney } from '@/lib/money'

/**
 * Choosing what to add to a quotation.
 *
 * A one-time item is a *variant*; a recurring item is a *plan*. The server
 * rejects a line carrying both or neither, so the picker is built around that
 * distinction rather than presenting a single flat list and hoping.
 *
 * Prices shown are list prices from the catalogue. The customer's tier price is
 * resolved when the line is evaluated, which is why nothing here is presented
 * as what the deal will cost.
 */
export function AddLineDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (choice: { variantId?: UUID; planId?: UUID; label: string }) => void
}) {
  const [search, setSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

  const products = useQuery({
    queryKey: keys.products({ pageSize: 200 }),
    queryFn: ({ signal }) => catalog.products({ pageSize: 200 }, signal),
    enabled: open,
    ...CATALOG_QUERY_OPTIONS,
  })

  const variants = useQuery({
    queryKey: keys.variants(selectedProduct?.id ?? 'none'),
    queryFn: ({ signal }) => catalog.variants(selectedProduct!.id, signal),
    enabled: Boolean(selectedProduct && selectedProduct.chargeKind === 'ONE_TIME'),
    ...CATALOG_QUERY_OPTIONS,
  })

  const plans = useQuery({
    queryKey: keys.plans(selectedProduct?.id),
    queryFn: ({ signal }) => catalog.plans(selectedProduct!.id, signal),
    enabled: Boolean(selectedProduct && selectedProduct.chargeKind === 'RECURRING'),
    ...CATALOG_QUERY_OPTIONS,
  })

  const filtered = useMemo(() => {
    const rows = (products.data?.items ?? []).filter((product) => product.active)
    const needle = search.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(
      (product) =>
        product.name.toLowerCase().includes(needle) ||
        product.code.toLowerCase().includes(needle) ||
        (product.categoryCode ?? '').toLowerCase().includes(needle),
    )
  }, [products.data, search])

  const close = () => {
    setSelectedProduct(null)
    setSearch('')
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={selectedProduct ? selectedProduct.name : 'Add a line'}
      description={
        selectedProduct
          ? selectedProduct.chargeKind === 'RECURRING'
            ? 'Choose the plan and its billing interval.'
            : 'Choose the variant to quote.'
          : 'Search the catalogue. Prices shown are list prices — the customer’s tier price is applied when the line is evaluated.'
      }
      size="lg"
      footer={
        selectedProduct ? (
          <Button variant="ghost" onClick={() => setSelectedProduct(null)}>
            ← Back to catalogue
          </Button>
        ) : null
      }
    >
      {!selectedProduct ? (
        <div className="space-y-3">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
            />
            <Input
              type="search"
              value={search}
              autoFocus
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search products by name, code or category"
              aria-label="Search the catalogue"
              className="pl-9"
            />
          </div>

          {products.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-[13px] text-text-secondary">
              <Spinner /> Loading the catalogue…
            </div>
          ) : products.error ? (
            <InlineError error={products.error} onRetry={() => void products.refetch()} />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No products match"
              description="Try a shorter search, or ask an administrator to add the product to the catalogue."
            />
          ) : (
            <ul className="max-h-96 space-y-1 overflow-y-auto scroll-subtle">
              {filtered.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedProduct(product)}
                    className={cn(
                      'flex w-full items-center justify-between gap-4 rounded-[--radius-control]',
                      'border border-line px-3.5 py-2.5 text-left transition-colors',
                      'hover:border-forest-300 hover:bg-forest-50',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-500',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-text">
                          {product.name}
                        </span>
                        {product.promoted ? (
                          <Badge tone="brass" size="sm">
                            Promoted
                          </Badge>
                        ) : null}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-text-muted">
                        {product.chargeKind === 'RECURRING' ? (
                          <Repeat className="size-3" aria-hidden />
                        ) : (
                          <Package className="size-3" aria-hidden />
                        )}
                        {product.code}
                        {product.categoryCode ? ` · ${product.categoryCode}` : ''}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-[13px] text-text-secondary">
                      {formatMoney(product.basePrice, product.currency)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : selectedProduct.chargeKind === 'RECURRING' ? (
        <ChoiceList
          loading={plans.isLoading}
          error={plans.error}
          onRetry={() => void plans.refetch()}
          emptyTitle="This product has no active plan"
          emptyDescription="An administrator can add a subscription plan in the catalogue."
          rows={(plans.data ?? [])
            .filter((plan) => plan.active)
            .map((plan) => ({
              id: plan.id,
              title: plan.name,
              subtitle: `${plan.code} · every ${plan.intervalMonths} month${plan.intervalMonths === 1 ? '' : 's'}`,
              amount: formatMoney(plan.intervalPrice, plan.currency),
              onSelect: () => {
                onAdd({ planId: plan.id, label: plan.name })
                close()
              },
            }))}
        />
      ) : (
        <ChoiceList
          loading={variants.isLoading}
          error={variants.error}
          onRetry={() => void variants.refetch()}
          emptyTitle="This product has no active variant"
          emptyDescription="An administrator can add one in the catalogue."
          rows={(variants.data ?? [])
            .filter((variant) => variant.active)
            .map((variant) => ({
              id: variant.id,
              title: variant.name,
              subtitle: variant.sku,
              amount: variant.priceExtra
                ? `+${formatMoney(variant.priceExtra, selectedProduct.currency, { bare: true })}`
                : formatMoney(selectedProduct.basePrice, selectedProduct.currency),
              onSelect: () => {
                onAdd({ variantId: variant.id, label: variant.name })
                close()
              },
            }))}
        />
      )}
    </Dialog>
  )
}

function ChoiceList({
  rows,
  loading,
  error,
  onRetry,
  emptyTitle,
  emptyDescription,
}: {
  rows: Array<{
    id: string
    title: string
    subtitle: string
    amount: string
    onSelect: () => void
  }>
  loading: boolean
  error: unknown
  onRetry: () => void
  emptyTitle: string
  emptyDescription: string
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-[13px] text-text-secondary">
        <Spinner /> Loading…
      </div>
    )
  }
  if (error) return <InlineError error={error} onRetry={onRetry} />
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />

  return (
    <ul className="space-y-1">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            onClick={row.onSelect}
            className={cn(
              'flex w-full items-center justify-between gap-4 rounded-[--radius-control]',
              'border border-line px-3.5 py-2.5 text-left transition-colors',
              'hover:border-forest-300 hover:bg-forest-50',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-500',
            )}
          >
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-text">{row.title}</span>
              <span className="block truncate text-2xs text-text-muted">{row.subtitle}</span>
            </span>
            <span className="tabular shrink-0 text-[13px] text-text-secondary">{row.amount}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
