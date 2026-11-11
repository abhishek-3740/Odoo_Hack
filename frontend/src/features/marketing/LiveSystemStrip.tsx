import { useEffect, useState } from 'react'

interface CatalogPayload {
  categories?: unknown[]
  products?: unknown[]
  variants?: Array<{ inStock?: boolean }>
  plans?: unknown[]
}

interface Stats {
  products: number
  categories: number
  plans: number
  inStock: number
  variants: number
}

export function LiveSystemStrip() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetch('/api/v1/public/catalog')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { data?: CatalogPayload }
        if (cancelled) return
        const payload: CatalogPayload = json.data ?? {}
        const products = Array.isArray(payload.products) ? payload.products : []
        const variants = Array.isArray(payload.variants) ? payload.variants : []
        const plans = Array.isArray(payload.plans) ? payload.plans : []
        const categories = Array.isArray(payload.categories) ? payload.categories : []

        setStats({
          products: products.length,
          categories: categories.length,
          plans: plans.length,
          inStock: variants.filter((v) => Boolean(v.inStock)).length,
          variants: variants.length,
        })
        setLoading(false)
        setOffline(false)
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false)
          setOffline(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const items = [
    { label: 'Live products', value: stats?.products },
    { label: 'Categories', value: stats?.categories },
    { label: 'Subscription plans', value: stats?.plans },
    {
      label: 'Variants in stock',
      value: stats ? `${stats.inStock}/${stats.variants}` : undefined,
    },
  ]

  return (
    <section className="relative border-y border-line bg-canvas-sunken/80 backdrop-blur-sm">
      <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-block size-2.5 rounded-full transition-colors ${
                offline
                  ? 'bg-neutral-400'
                  : loading
                    ? 'animate-pulse bg-amber-400'
                    : 'animate-pulse bg-forest-500 shadow-[0_0_10px_rgba(23,100,72,0.6)]'
              }`}
              aria-hidden
            />
            <span className="font-mono text-2xs uppercase tracking-[0.14em] text-text-muted">
              {offline
                ? 'Backend offline — start the service to load live figures'
                : loading
                  ? 'Reading live catalogue…'
                  : 'Live connected catalogue telemetry'}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4 lg:gap-x-12">
            {items.map((item) => (
              <div key={item.label} className="min-w-0">
                <dd className="font-serif text-2xl font-bold tabular-nums tracking-tight text-text sm:text-3xl">
                  {loading ? (
                    <span className="inline-block h-8 w-14 animate-pulse rounded bg-line" />
                  ) : item.value === undefined ? (
                    <span className="text-text-muted">—</span>
                  ) : (
                    item.value
                  )}
                </dd>
                <dt className="mt-1 text-xs font-medium text-text-secondary">{item.label}</dt>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}
