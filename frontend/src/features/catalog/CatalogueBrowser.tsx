import { useQuery } from '@tanstack/react-query'
import { Package, Repeat, Search, Store } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import {
  CATEGORY_KIND_LABEL,
  catalog,
  keys,
  type StorePlan,
  type StoreProduct,
  type StoreVariant,
} from '@/api'
import { CATALOG_QUERY_OPTIONS } from '@/app/queryClient'
import {
  Badge,
  EmptyState,
  FilterBar,
  InlineError,
  Input,
  LoadingPanel,
  Panel,
  PanelHeader,
  Select,
} from '@/design-system'
import { cn } from '@/lib/cn'
import { formatBasisPoints, formatMoney } from '@/lib/money'

/**
 * The public catalogue.
 *
 * Anonymous and read-only: the storefront response has no field for cost,
 * margin, stock quantity or warehouse, so this component could not leak one
 * even by accident. Availability is a yes/no statement, never a count — a
 * competitor should not be able to read inventory levels off a public page.
 *
 * Prices here are list prices. A customer's tier price is resolved inside an
 * authenticated quotation, and the page says so rather than implying the number
 * on screen is what they would pay.
 */
export function CatalogueBrowser({
  renderVariantAction,
  renderPlanAction,
  intro,
}: {
  /** Lets the signed-in portal add to a request while the public page stays read-only. */
  renderVariantAction?: (variant: StoreVariant, product: StoreProduct) => ReactNode
  renderPlanAction?: (plan: StorePlan, product: StoreProduct) => ReactNode
  intro?: ReactNode
}) {
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')

  const store = useQuery({
    queryKey: keys.storefront(),
    queryFn: ({ signal }) => catalog.storefront(signal),
    ...CATALOG_QUERY_OPTIONS,
  })

  const grouped = useMemo(() => {
    const data = store.data
    if (!data) return []
    const needle = search.trim().toLowerCase()

    const products = data.products.filter((product) => {
      if (categoryId && product.categoryId !== categoryId) return false
      if (!needle) return true
      return (
        product.name.toLowerCase().includes(needle) ||
        product.code.toLowerCase().includes(needle) ||
        (product.description ?? '').toLowerCase().includes(needle)
      )
    })

    return products.map((product) => ({
      product,
      variants: data.variants.filter((variant) => variant.productId === product.id),
      plans: data.plans.filter((plan) => plan.productId === product.id),
    }))
  }, [store.data, search, categoryId])

  if (store.isLoading && !store.data) return <LoadingPanel rows={6} />
  if (store.error) {
    return (
      <InlineError
        error={store.error}
        title="The catalogue could not be loaded"
        onRetry={() => void store.refetch()}
      />
    )
  }

  return (
    <div className="space-y-5">
      {intro}

      <FilterBar>
        <div className="w-full flex-1 space-y-1.5 sm:min-w-64">
          <label htmlFor="catalogue-search" className="block text-[13px] font-medium text-text">
            Search
          </label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
            />
            <Input
              id="catalogue-search"
              type="search"
              className="pl-9"
              value={search}
              placeholder="Product name, code or description"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        <div className="w-56 space-y-1.5">
          <label htmlFor="catalogue-category" className="block text-[13px] font-medium text-text">
            Category
          </label>
          <Select
            id="catalogue-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">Everything</option>
            {(store.data?.categories ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>

      {grouped.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Store className="size-5" aria-hidden />}
            title="Nothing matches"
            description="Try a shorter search, or clear the category filter."
          />
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {grouped.map(({ product, variants, plans }) => (
            <Panel key={product.id} className="flex flex-col gap-3">
              <PanelHeader
                as="h3"
                title={product.name}
                description={product.description ?? undefined}
                actions={
                  product.promoted ? (
                    <Badge tone="brass" size="sm">
                      Featured
                    </Badge>
                  ) : null
                }
              />

              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="neutral" size="sm">
                  {CATEGORY_KIND_LABEL[product.categoryKind] ?? product.categoryKind}
                </Badge>
                <Badge tone={product.chargeKind === 'RECURRING' ? 'info' : 'neutral'} size="sm">
                  {product.chargeKind === 'RECURRING' ? (
                    <>
                      <Repeat className="size-3" aria-hidden /> Subscription
                    </>
                  ) : (
                    <>
                      <Package className="size-3" aria-hidden /> One-time
                    </>
                  )}
                </Badge>
                <span className="tabular text-2xs text-text-muted">{product.code}</span>
              </div>

              <p className="tabular text-[13px] text-text-secondary">
                From{' '}
                <span className="font-semibold text-text">
                  {formatMoney(product.basePrice, product.currency)}
                </span>
                {product.unit ? ` per ${product.unit}` : ''} · tax{' '}
                {formatBasisPoints(product.taxRateBp)}
              </p>

              {product.chargeKind === 'RECURRING' ? (
                <ul className="mt-auto space-y-1.5 border-t border-line pt-3">
                  {plans.length === 0 ? (
                    <li className="text-[13px] text-text-muted">No plan is published yet.</li>
                  ) : (
                    plans.map((plan) => (
                      <li
                        key={plan.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-[13px]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-text">{plan.name}</span>
                          <span className="block text-2xs text-text-muted">
                            Every {plan.intervalMonths} month{plan.intervalMonths === 1 ? '' : 's'}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="tabular font-medium">
                            {formatMoney(plan.intervalPrice, plan.currency)}
                          </span>
                          {renderPlanAction?.(plan, product)}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              ) : (
                <ul className="mt-auto space-y-1.5 border-t border-line pt-3">
                  {variants.length === 0 ? (
                    <li className="text-[13px] text-text-muted">No variant is published yet.</li>
                  ) : (
                    variants.map((variant) => (
                      <li
                        key={variant.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-[13px]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-text">{variant.name}</span>
                          <span className="tabular block text-2xs text-text-muted">
                            {variant.sku}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span
                            className={cn(
                              'text-2xs font-medium',
                              variant.inStock ? 'text-ok-text' : 'text-wait-text',
                            )}
                          >
                            {variant.inStock ? 'In stock' : 'Made to order'}
                          </span>
                          <span className="tabular font-medium">
                            {formatMoney(variant.listPrice, product.currency)}
                          </span>
                          {renderVariantAction?.(variant, product)}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </Panel>
          ))}
        </div>
      )}

      <p className="text-[13px] leading-relaxed text-text-secondary">
        Prices shown are list prices. Tier pricing and any discount are resolved inside a
        quotation, so what you are quoted may differ from what is here — and it will always be
        stated in full before you accept anything.
      </p>
    </div>
  )
}
