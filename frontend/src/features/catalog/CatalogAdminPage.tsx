import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Boxes, Pencil, Plus, Tag } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import {
  CATEGORY_KIND_LABEL,
  catalog,
  keys,
  TIER_LABEL,
  type CategoryKind,
  type ChargeKind,
  type CustomerTier,
  type FulfillmentKind,
  type PriceRule,
  type Product,
  type SubscriptionPlan,
  type UUID,
  type Variant,
  type Warehouse,
} from '@/api'
import { useAuth } from '@/auth/useAuth'
import { CATALOG_QUERY_OPTIONS } from '@/app/queryClient'
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  DateInput,
  Dialog,
  EmptyState,
  Field,
  InlineError,
  Input,
  Panel,
  PageHeader,
  PermissionBoundary,
  Section,
  Select,
  TabPanel,
  Tabs,
  Textarea,
  useDisclosure,
} from '@/design-system'
import { formatBusinessDate, todayAsBusinessDate } from '@/lib/dates'
import { formatBasisPoints, formatMoney } from '@/lib/money'

/**
 * The catalogue.
 *
 * Working configuration, not a reference list: changing a price rule or a plan's
 * proration policy changes the very next quotation evaluation. Each section says
 * what its records actually affect, because "products" and "price rules" look
 * similar and only one of them decides what a customer is charged.
 *
 * Creating and editing is administrator-only on the server, so the forms are
 * behind that check — but everyone internal can read, because a salesperson
 * needs to know why a price resolved the way it did.
 *
 * Where the API exposes only creation (categories), only creation is offered.
 * No screen here invents a delete.
 */
export default function CatalogAdminPage() {
  const { me } = useAuth()
  const [tab, setTab] = useState('products')
  const isAdmin = me?.role === 'ADMIN'

  return (
    <>
      <PageHeader
        title="Catalogue"
        description="Products, variants, tier prices, subscription plans and warehouses. These records decide what the next quotation costs."
      />

      <Tabs
        label="Catalogue sections"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'products', label: 'Products & variants' },
          { value: 'prices', label: 'Tier prices' },
          { value: 'plans', label: 'Subscription plans' },
          { value: 'warehouses', label: 'Warehouses' },
          { value: 'categories', label: 'Categories' },
        ]}
      >
        <TabPanel value="products">
          <ProductsSection isAdmin={isAdmin} />
        </TabPanel>
        <TabPanel value="prices">
          <PriceRulesSection isAdmin={isAdmin} />
        </TabPanel>
        <TabPanel value="plans">
          <PlansSection isAdmin={isAdmin} />
        </TabPanel>
        <TabPanel value="warehouses">
          <WarehousesSection isAdmin={isAdmin} />
        </TabPanel>
        <TabPanel value="categories">
          <CategoriesSection isAdmin={isAdmin} />
        </TabPanel>
      </Tabs>
    </>
  )
}

/* ------------------------------------------------------ products & variants */

function ProductsSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<UUID | null>(null)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [editingVariant, setEditingVariant] = useState<Variant | null>(null)
  const productDialog = useDisclosure()
  const variantDialog = useDisclosure()

  const products = useQuery({
    queryKey: keys.products({ pageSize: 200 }),
    queryFn: ({ signal }) => catalog.products({ pageSize: 200 }, signal),
    ...CATALOG_QUERY_OPTIONS,
  })

  // The list is paged and cached; the detail read is the authoritative record
  // for the product being worked on, which matters when an edit form is seeded
  // from it.
  const selected = useQuery({
    queryKey: keys.product(selectedId ?? 'none'),
    queryFn: ({ signal }) => catalog.product(selectedId!, signal),
    enabled: Boolean(selectedId),
  })

  const variants = useQuery({
    queryKey: keys.variants(selectedId ?? 'none'),
    queryFn: ({ signal }) => catalog.variants(selectedId!, signal),
    enabled: Boolean(selectedId),
    ...CATALOG_QUERY_OPTIONS,
  })

  const product = selected.data ?? products.data?.items.find((row) => row.id === selectedId) ?? null

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'products'] })
    if (selectedId) {
      void queryClient.invalidateQueries({ queryKey: keys.product(selectedId) })
      void queryClient.invalidateQueries({ queryKey: keys.variants(selectedId) })
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      <Section
        id="products"
        title="Products"
        description="A product's charge kind decides whether it is quoted as a one-time variant or as a recurring plan."
        actions={
          <PermissionBoundary allowed={isAdmin}>
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="size-3.5" />}
              onClick={() => {
                setEditingProduct(null)
                productDialog.show()
              }}
            >
              New product
            </Button>
          </PermissionBoundary>
        }
      >
        <DataTable
          caption="Products"
          rows={products.data?.items ?? []}
          rowKey={(row) => row.id}
          loading={products.isLoading}
          error={products.error ? <InlineError error={products.error} /> : undefined}
          empty={<EmptyState icon={<Boxes className="size-5" aria-hidden />} title="No products yet" />}
          onRowClick={(row) => setSelectedId(row.id)}
          isActive={(row) => row.id === selectedId}
          columns={[
            {
              id: 'name',
              header: 'Product',
              cell: (row) => (
                <span>
                  <span className="block font-medium text-text">{row.name}</span>
                  <span className="tabular block text-2xs text-text-muted">
                    {row.code}
                    {row.categoryCode ? ` · ${row.categoryCode}` : ''}
                  </span>
                </span>
              ),
            },
            {
              id: 'charge',
              header: 'Charge',
              cell: (row) => (
                <Badge tone={row.chargeKind === 'RECURRING' ? 'info' : 'neutral'} size="sm">
                  {row.chargeKind === 'RECURRING' ? 'Recurring' : 'One-time'}
                </Badge>
              ),
            },
            {
              id: 'stock',
              header: 'Stock',
              hideBelow: 'md',
              cell: (row) => (
                <span className="text-text-secondary">
                  {row.fulfillmentKind === 'STOCK' ? 'Consumes stock' : 'No stock'}
                </span>
              ),
            },
            {
              id: 'price',
              header: 'List price',
              align: 'right',
              cell: (row) => formatMoney(row.basePrice, row.currency),
            },
            {
              id: 'tax',
              header: 'Tax',
              align: 'right',
              hideBelow: 'lg',
              cell: (row) => formatBasisPoints(row.taxRateBp),
            },
            {
              id: 'active',
              header: '',
              align: 'right',
              cell: (row) => (
                <span className="flex items-center justify-end gap-2">
                  {row.active ? null : (
                    <Badge tone="neutral" size="sm">
                      Inactive
                    </Badge>
                  )}
                  {isAdmin ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Pencil className="size-3.5" />}
                      onClick={(event) => {
                        event.stopPropagation()
                        setEditingProduct(row)
                        productDialog.show()
                      }}
                    >
                      Edit
                    </Button>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      </Section>

      <Section
        id="variants"
        title={product ? `Variants of ${product.name}` : 'Variants'}
        description={
          product
            ? 'A variant is what a one-time line actually quotes. Its price extra is added to the product’s list price when no tier rule matches.'
            : 'Choose a product to see its variants.'
        }
        actions={
          product && isAdmin && product.chargeKind === 'ONE_TIME' ? (
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus className="size-3.5" />}
              onClick={() => {
                setEditingVariant(null)
                variantDialog.show()
              }}
            >
              New variant
            </Button>
          ) : null
        }
      >
        {!product ? (
          <Panel>
            <EmptyState
              icon={<Tag className="size-5" aria-hidden />}
              title="No product selected"
              description="Pick a row on the left."
            />
          </Panel>
        ) : product.chargeKind === 'RECURRING' ? (
          <Panel tone="muted" className="text-[13px] leading-relaxed text-text-secondary">
            This is a recurring product, so it is quoted through a subscription plan rather than a
            variant. Its plans are on the Subscription plans tab.
          </Panel>
        ) : (
          <DataTable
            caption={`Variants of ${product.name}`}
            rows={variants.data ?? []}
            rowKey={(row) => row.id}
            loading={variants.isLoading}
            error={variants.error ? <InlineError error={variants.error} /> : undefined}
            empty={<EmptyState title="No variants" description="Add one so this product can be quoted." />}
            columns={[
              {
                id: 'name',
                header: 'Variant',
                cell: (row) => (
                  <span>
                    <span className="block font-medium text-text">{row.name}</span>
                    <span className="tabular block text-2xs text-text-muted">{row.sku}</span>
                  </span>
                ),
              },
              {
                id: 'extra',
                header: 'Price extra',
                align: 'right',
                cell: (row) => formatMoney(row.priceExtra, product.currency),
              },
              {
                id: 'group',
                header: 'Upgrade group',
                hideBelow: 'lg',
                cell: (row) => (
                  <span className="text-text-secondary">{row.substitutionGroup ?? '—'}</span>
                ),
              },
              ...(isAdmin
                ? [
                    {
                      id: 'edit',
                      header: '',
                      align: 'right' as const,
                      cell: (row: Variant) => (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Pencil className="size-3.5" />}
                          onClick={() => {
                            setEditingVariant(row)
                            variantDialog.show()
                          }}
                        >
                          Edit
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}

        {product ? (
          <Panel tone="muted" className="mt-3 text-[13px] leading-relaxed text-text-secondary">
            The upgrade group is what makes an upsell offer possible — a recommendation may only
            replace a line whose variant shares this group.
          </Panel>
        ) : null}
      </Section>

      <ProductDialog
        open={productDialog.open}
        onOpenChange={productDialog.setOpen}
        existing={editingProduct}
        onSaved={invalidate}
      />
      {product ? (
        <VariantDialog
          open={variantDialog.open}
          onOpenChange={variantDialog.setOpen}
          productId={product.id}
          existing={editingVariant}
          onSaved={invalidate}
        />
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------- price rules */

function PriceRulesSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const [productId, setProductId] = useState('')
  const [variantId, setVariantId] = useState('')
  const [editing, setEditing] = useState<PriceRule | null>(null)
  const ruleDialog = useDisclosure()

  const products = useQuery({
    queryKey: keys.products({ pageSize: 200 }),
    queryFn: ({ signal }) => catalog.products({ pageSize: 200 }, signal),
    ...CATALOG_QUERY_OPTIONS,
  })

  const variants = useQuery({
    queryKey: keys.variants(productId || 'none'),
    queryFn: ({ signal }) => catalog.variants(productId, signal),
    enabled: Boolean(productId),
    ...CATALOG_QUERY_OPTIONS,
  })

  const rules = useQuery({
    queryKey: keys.priceRules(variantId || 'none'),
    queryFn: ({ signal }) => catalog.priceRules(variantId, signal),
    enabled: Boolean(variantId),
  })

  return (
    <div className="space-y-5">
      <Panel tone="muted" className="text-[13px] leading-relaxed text-text-secondary">
        A tier price rule is what actually decides a line's unit price for a given customer. When two
        rules of equal priority match, the server refuses to guess and reports an ambiguous rule
        rather than picking one.
      </Panel>

      <div className="flex flex-wrap gap-3">
        <div className="w-full space-y-1.5 sm:w-64">
          <label htmlFor="rule-product" className="block text-[13px] font-medium text-text">
            Product
          </label>
          <Select
            id="rule-product"
            value={productId}
            onChange={(event) => {
              setProductId(event.target.value)
              setVariantId('')
            }}
          >
            <option value="">Choose a product…</option>
            {(products.data?.items ?? [])
              .filter((product) => product.chargeKind === 'ONE_TIME')
              .map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
          </Select>
        </div>

        <div className="w-full space-y-1.5 sm:w-64">
          <label htmlFor="rule-variant" className="block text-[13px] font-medium text-text">
            Variant
          </label>
          <Select
            id="rule-variant"
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
        </div>

        {isAdmin && variantId ? (
          <div className="flex items-end">
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => {
                setEditing(null)
                ruleDialog.show()
              }}
            >
              New price rule
            </Button>
          </div>
        ) : null}
      </div>

      {!variantId ? (
        <Panel>
          <EmptyState title="Choose a variant" description="Price rules are read per variant." />
        </Panel>
      ) : (
        <DataTable
          caption="Tier price rules"
          rows={rules.data ?? []}
          rowKey={(row) => row.id}
          loading={rules.isLoading}
          error={rules.error ? <InlineError error={rules.error} /> : undefined}
          empty={
            <EmptyState
              title="No price rule for this variant"
              description="Without one, a quotation for a tier with no rule cannot be priced and the server says so rather than inventing a figure."
            />
          }
          columns={[
            {
              id: 'tier',
              header: 'Tier',
              cell: (row) => (
                <Badge tone={row.tier === 'GOLD' ? 'brass' : 'neutral'} size="sm">
                  {TIER_LABEL[row.tier] ?? row.tier}
                </Badge>
              ),
            },
            {
              id: 'price',
              header: 'Unit price',
              align: 'right',
              cell: (row) => formatMoney(row.unitPrice, row.currency),
            },
            {
              id: 'priority',
              header: 'Priority',
              align: 'right',
              hideBelow: 'md',
              cell: (row) => row.priority,
            },
            {
              id: 'from',
              header: 'Active from',
              cell: (row) => formatBusinessDate(row.activeFrom),
            },
            {
              id: 'until',
              header: 'Until',
              cell: (row) =>
                row.activeUntil ? (
                  formatBusinessDate(row.activeUntil)
                ) : (
                  <span className="text-text-muted">Open-ended</span>
                ),
            },
            ...(isAdmin
              ? [
                  {
                    id: 'edit',
                    header: '',
                    align: 'right' as const,
                    cell: (row: PriceRule) => (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Pencil className="size-3.5" />}
                        onClick={() => {
                          setEditing(row)
                          ruleDialog.show()
                        }}
                      >
                        Edit
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}

      {variantId ? (
        <PriceRuleDialog
          open={ruleDialog.open}
          onOpenChange={ruleDialog.setOpen}
          variantId={variantId}
          existing={editing}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: keys.priceRules(variantId) })}
        />
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------- plans */

function PlansSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<SubscriptionPlan | null>(null)
  const planDialog = useDisclosure()

  const plans = useQuery({
    queryKey: keys.plans(),
    queryFn: ({ signal }) => catalog.plans(undefined, signal),
    ...CATALOG_QUERY_OPTIONS,
  })

  return (
    <Section
      id="plans"
      title="Subscription plans"
      description="A plan's proration and cancellation policies govern every change made to a live subscription on it."
      actions={
        isAdmin ? (
          <Button
            size="sm"
            variant="primary"
            icon={<Plus className="size-3.5" />}
            onClick={() => {
              setEditing(null)
              planDialog.show()
            }}
          >
            New plan
          </Button>
        ) : null
      }
    >
      <DataTable
        caption="Subscription plans"
        rows={plans.data ?? []}
        rowKey={(row) => row.id}
        loading={plans.isLoading}
        error={plans.error ? <InlineError error={plans.error} /> : undefined}
        empty={<EmptyState title="No subscription plans" />}
        columns={[
          {
            id: 'name',
            header: 'Plan',
            cell: (row) => (
              <span>
                <span className="block font-medium text-text">{row.name}</span>
                <span className="tabular block text-2xs text-text-muted">{row.code}</span>
              </span>
            ),
          },
          {
            id: 'interval',
            header: 'Interval',
            cell: (row) => `Every ${row.intervalMonths} month${row.intervalMonths === 1 ? '' : 's'}`,
          },
          {
            id: 'price',
            header: 'Price per interval',
            align: 'right',
            cell: (row) => formatMoney(row.intervalPrice, row.currency),
          },
          {
            id: 'proration',
            header: 'Mid-period change',
            hideBelow: 'lg',
            cell: (row) => (
              <span className="text-text-secondary">
                {row.prorationPolicy === 'IMMEDIATE_PRORATED' ? 'Prorated now' : 'Next period'}
              </span>
            ),
          },
          {
            id: 'cancellation',
            header: 'Cancellation',
            hideBelow: 'lg',
            cell: (row) => (
              <span className="text-text-secondary">
                {row.cancellationPolicy === 'END_OF_PERIOD' ? 'End of period' : 'Immediate, prorated'}
              </span>
            ),
          },
          {
            id: 'active',
            header: '',
            align: 'right',
            cell: (row) => (
              <span className="flex items-center justify-end gap-2">
                {row.active ? null : (
                  <Badge tone="neutral" size="sm">
                    Inactive
                  </Badge>
                )}
                {isAdmin ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Pencil className="size-3.5" />}
                    onClick={() => {
                      setEditing(row)
                      planDialog.show()
                    }}
                  >
                    Edit
                  </Button>
                ) : null}
              </span>
            ),
          },
        ]}
      />

      <PlanDialog
        open={planDialog.open}
        onOpenChange={planDialog.setOpen}
        existing={editing}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'plans'] })}
      />
    </Section>
  )
}

/* -------------------------------------------------------------- warehouses */

function WarehousesSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Warehouse | null>(null)
  const dialog = useDisclosure()

  const warehouses = useQuery({
    queryKey: keys.warehouses(),
    queryFn: ({ signal }) => catalog.warehouses(signal),
    ...CATALOG_QUERY_OPTIONS,
  })

  return (
    <Section
      id="warehouses"
      title="Warehouses"
      description="Shipping costs here feed the allocation planner: they are what makes one warehouse split cheaper than another."
      actions={
        isAdmin ? (
          <Button
            size="sm"
            variant="primary"
            icon={<Plus className="size-3.5" />}
            onClick={() => {
              setEditing(null)
              dialog.show()
            }}
          >
            New warehouse
          </Button>
        ) : null
      }
    >
      <DataTable
        caption="Warehouses"
        rows={warehouses.data ?? []}
        rowKey={(row) => row.id}
        loading={warehouses.isLoading}
        error={warehouses.error ? <InlineError error={warehouses.error} /> : undefined}
        empty={<EmptyState title="No warehouses" />}
        columns={[
          {
            id: 'name',
            header: 'Warehouse',
            cell: (row) => (
              <span>
                <span className="block font-medium text-text">{row.name}</span>
                <span className="tabular block text-2xs text-text-muted">{row.code}</span>
              </span>
            ),
          },
          { id: 'location', header: 'Location', cell: (row) => row.location ?? '—' },
          {
            id: 'fixed',
            header: 'Fixed shipping',
            align: 'right',
            cell: (row) => formatMoney(row.shippingFixedCost, 'INR'),
          },
          {
            id: 'perKg',
            header: 'Per kg',
            align: 'right',
            hideBelow: 'md',
            cell: (row) => formatMoney(row.shippingCostPerKg, 'INR'),
          },
          {
            id: 'active',
            header: '',
            align: 'right',
            cell: (row) => (
              <span className="flex items-center justify-end gap-2">
                {row.active ? null : (
                  <Badge tone="neutral" size="sm">
                    Inactive
                  </Badge>
                )}
                {isAdmin ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Pencil className="size-3.5" />}
                    onClick={() => {
                      setEditing(row)
                      dialog.show()
                    }}
                  >
                    Edit
                  </Button>
                ) : null}
              </span>
            ),
          },
        ]}
      />

      <WarehouseDialog
        open={dialog.open}
        onOpenChange={dialog.setOpen}
        existing={editing}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: keys.warehouses() })}
      />
    </Section>
  )
}

/* -------------------------------------------------------------- categories */

function CategoriesSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const dialog = useDisclosure()

  const categories = useQuery({
    queryKey: keys.categories(),
    queryFn: ({ signal }) => catalog.categories(signal),
    ...CATALOG_QUERY_OPTIONS,
  })

  return (
    <Section
      id="categories"
      title="Categories"
      description="The discount policy keys its category ceilings by code, so renaming a category never moves its ceiling."
      actions={
        isAdmin ? (
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={dialog.show}>
            New category
          </Button>
        ) : null
      }
    >
      <DataTable
        caption="Categories"
        rows={categories.data ?? []}
        rowKey={(row) => row.id}
        loading={categories.isLoading}
        error={categories.error ? <InlineError error={categories.error} /> : undefined}
        empty={<EmptyState title="No categories" />}
        columns={[
          {
            id: 'name',
            header: 'Category',
            cell: (row) => (
              <span>
                <span className="block font-medium text-text">{row.name}</span>
                <span className="tabular block text-2xs text-text-muted">{row.code}</span>
              </span>
            ),
          },
          {
            id: 'kind',
            header: 'Kind',
            cell: (row) => (
              <Badge tone="neutral" size="sm">
                {CATEGORY_KIND_LABEL[row.kind] ?? row.kind}
              </Badge>
            ),
          },
          {
            id: 'active',
            header: '',
            cell: (row) =>
              row.active ? null : (
                <Badge tone="neutral" size="sm">
                  Inactive
                </Badge>
              ),
          },
        ]}
      />

      <Panel tone="muted" className="mt-3 text-[13px] leading-relaxed text-text-secondary">
        The API supports listing and creating categories. There is no update or delete operation, so
        none is offered here.
      </Panel>

      <CategoryDialog
        open={dialog.open}
        onOpenChange={dialog.setOpen}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: keys.categories() })}
      />
    </Section>
  )
}

/* ----------------------------------------------------------------- dialogs */

function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  busy,
  onSubmit,
  submitLabel,
  disabled,
  disabledReason,
  error,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  busy: boolean
  onSubmit: () => void
  submitLabel: string
  disabled?: boolean
  disabledReason?: string
  error?: unknown
  children: ReactNode
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="lg"
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={disabled}
            disabledReason={disabledReason}
            onClick={onSubmit}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {children}
        {error ? <InlineError error={error} /> : null}
      </div>
    </Dialog>
  )
}

/**
 * Every form below creates *or* updates, seeded from the record when editing.
 *
 * The dialog reseeds only on open, so a background refetch cannot overwrite what
 * someone is typing.
 */
function ProductDialog({
  open,
  onOpenChange,
  existing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existing: Product | null
  onSaved: () => void
}) {
  const empty = {
    categoryId: '',
    code: '',
    name: '',
    description: '',
    unit: 'unit',
    basePrice: '',
    baseCost: '',
    taxRateBp: '1800',
    fulfillmentKind: 'STOCK' as FulfillmentKind,
    chargeKind: 'ONE_TIME' as ChargeKind,
    promoted: false,
    active: true,
  }
  const [form, setForm] = useState(empty)
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    if (!open) return
    setForm(
      existing
        ? {
            categoryId: existing.categoryId,
            code: existing.code,
            name: existing.name,
            description: existing.description ?? '',
            unit: existing.unit ?? 'unit',
            basePrice: String(existing.basePrice),
            baseCost: String(existing.baseCost),
            taxRateBp: String(existing.taxRateBp),
            fulfillmentKind: existing.fulfillmentKind,
            chargeKind: existing.chargeKind,
            promoted: existing.promoted,
            active: existing.active,
          }
        : empty,
    )
    // `empty` is a fresh literal each render; seeding depends only on the record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing])

  const categories = useQuery({
    queryKey: keys.categories(),
    queryFn: ({ signal }) => catalog.categories(signal),
    enabled: open,
    ...CATALOG_QUERY_OPTIONS,
  })

  const save = useMutation({
    mutationFn: () => {
      const body = {
        categoryId: form.categoryId,
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        unit: form.unit.trim() || null,
        basePrice: form.basePrice,
        baseCost: form.baseCost,
        taxRateBp: Number(form.taxRateBp) || 0,
        fulfillmentKind: form.fulfillmentKind,
        chargeKind: form.chargeKind,
        promoted: form.promoted,
        active: form.active,
      }
      return existing ? catalog.updateProduct(existing.id, body) : catalog.createProduct(body)
    },
    onSuccess: () => {
      toast.success(existing ? 'Product updated' : 'Product created', {
        description: 'It applies to the next evaluation, not to quotations already decided.',
      })
      onOpenChange(false)
      onSaved()
    },
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? `Edit ${existing.name}` : 'New product'}
      description="The charge kind decides whether this is quoted as a variant or as a plan."
      busy={save.isPending}
      error={save.error}
      submitLabel={existing ? 'Save changes' : 'Create product'}
      disabled={!form.categoryId || !form.code.trim() || !form.name.trim() || !form.basePrice}
      disabledReason="Category, code, name and list price are required."
      onSubmit={() => save.mutate()}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" required>
          {(props) => (
            <Select {...props} value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">Choose…</option>
              {(categories.data ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Code" required hint="Short, stable and unique.">
          {(props) => (
            <Input {...props} value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} />
          )}
        </Field>
      </div>

      <Field label="Name" required>
        {(props) => <Input {...props} value={form.name} onChange={(e) => set('name', e.target.value)} />}
      </Field>

      <Field label="Description">
        {(props) => (
          <Textarea {...props} rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Charge kind" required hint="One-time items are quoted as variants; recurring ones as plans.">
          {(props) => (
            <Select {...props} value={form.chargeKind} onChange={(e) => set('chargeKind', e.target.value as ChargeKind)}>
              <option value="ONE_TIME">One-time</option>
              <option value="RECURRING">Recurring</option>
            </Select>
          )}
        </Field>
        <Field label="Fulfilment" required hint="Stock items are allocated from warehouses; services are not.">
          {(props) => (
            <Select
              {...props}
              value={form.fulfillmentKind}
              onChange={(e) => set('fulfillmentKind', e.target.value as FulfillmentKind)}
            >
              <option value="STOCK">Consumes stock</option>
              <option value="NONE">No stock</option>
            </Select>
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="List price" required>
          {(props) => (
            <Input {...props} type="number" step="0.01" value={form.basePrice} onChange={(e) => set('basePrice', e.target.value)} />
          )}
        </Field>
        <Field label="Cost" required hint="Internal only; drives margin and the policy check.">
          {(props) => (
            <Input {...props} type="number" step="0.01" value={form.baseCost} onChange={(e) => set('baseCost', e.target.value)} />
          )}
        </Field>
        <Field label="Tax (basis points)" hint="1800 = 18%.">
          {(props) => (
            <Input {...props} type="number" value={form.taxRateBp} onChange={(e) => set('taxRateBp', e.target.value)} />
          )}
        </Field>
      </div>

      <Checkbox
        label="Promote this product"
        hint="Promoted products are ordered first on the storefront and preferred by recommendations."
        checked={form.promoted}
        onChange={(e) => set('promoted', e.target.checked)}
      />
      <Checkbox
        label="Available for quoting"
        hint="Deactivating hides it from the storefront and from new quotation lines. Existing quotations keep it."
        checked={form.active}
        onChange={(e) => set('active', e.target.checked)}
      />
    </FormDialog>
  )
}

function VariantDialog({
  open,
  onOpenChange,
  productId,
  existing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId: UUID
  existing: Variant | null
  onSaved: () => void
}) {
  const empty = { sku: '', name: '', priceExtra: '', cost: '', weightGrams: '', substitutionGroup: '', active: true }
  const [form, setForm] = useState(empty)

  useEffect(() => {
    if (!open) return
    setForm(
      existing
        ? {
            sku: existing.sku,
            name: existing.name,
            priceExtra: existing.priceExtra ?? '',
            cost: existing.cost ?? '',
            weightGrams: String(existing.weightGrams ?? ''),
            substitutionGroup: existing.substitutionGroup ?? '',
            active: existing.active,
          }
        : empty,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing])

  const save = useMutation({
    mutationFn: () => {
      const body = {
        productId,
        sku: form.sku.trim(),
        name: form.name.trim(),
        priceExtra: form.priceExtra || null,
        cost: form.cost || null,
        weightGrams: form.weightGrams ? Number(form.weightGrams) : null,
        substitutionGroup: form.substitutionGroup.trim() || null,
        active: form.active,
      }
      return existing ? catalog.updateVariant(existing.id, body) : catalog.createVariant(body)
    },
    onSuccess: () => {
      toast.success(existing ? 'Variant updated' : 'Variant created')
      onOpenChange(false)
      onSaved()
    },
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? `Edit ${existing.name}` : 'New variant'}
      description="A variant is what a one-time quotation line points at."
      busy={save.isPending}
      error={save.error}
      submitLabel={existing ? 'Save changes' : 'Create variant'}
      disabled={!form.sku.trim() || !form.name.trim()}
      disabledReason="SKU and name are required."
      onSubmit={() => save.mutate()}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="SKU" required>
          {(props) => (
            <Input
              {...props}
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })}
            />
          )}
        </Field>
        <Field label="Name" required>
          {(props) => (
            <Input {...props} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Price extra" hint="Added to the product's list price when no tier rule matches.">
          {(props) => (
            <Input
              {...props}
              type="number"
              step="0.01"
              value={form.priceExtra}
              onChange={(e) => setForm({ ...form, priceExtra: e.target.value })}
            />
          )}
        </Field>
        <Field label="Cost">
          {(props) => (
            <Input
              {...props}
              type="number"
              step="0.01"
              value={form.cost}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
            />
          )}
        </Field>
        <Field label="Weight (grams)" hint="Used to cost a shipment.">
          {(props) => (
            <Input
              {...props}
              type="number"
              value={form.weightGrams}
              onChange={(e) => setForm({ ...form, weightGrams: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field
        label="Upgrade group"
        hint="Variants sharing a group can be offered as upgrades for one another. Leave empty for no upgrade path."
      >
        {(props) => (
          <Input
            {...props}
            value={form.substitutionGroup}
            onChange={(e) => setForm({ ...form, substitutionGroup: e.target.value })}
          />
        )}
      </Field>
      <Checkbox
        label="Available for quoting"
        checked={form.active}
        onChange={(e) => setForm({ ...form, active: e.target.checked })}
      />
    </FormDialog>
  )
}

function PriceRuleDialog({
  open,
  onOpenChange,
  variantId,
  existing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  variantId: UUID
  existing: PriceRule | null
  onSaved: () => void
}) {
  const [tier, setTier] = useState<CustomerTier>('BRONZE')
  const [unitPrice, setUnitPrice] = useState('')
  const [priority, setPriority] = useState('100')
  const [activeFrom, setActiveFrom] = useState<string | null>(todayAsBusinessDate())
  const [activeUntil, setActiveUntil] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTier(existing?.tier ?? 'BRONZE')
    setUnitPrice(existing ? String(existing.unitPrice) : '')
    setPriority(String(existing?.priority ?? 100))
    setActiveFrom(existing?.activeFrom ?? todayAsBusinessDate())
    setActiveUntil(existing?.activeUntil ?? null)
  }, [open, existing])

  const save = useMutation({
    mutationFn: () => {
      const body = {
        variantId,
        tier,
        unitPrice,
        priority: Number(priority) || 100,
        activeFrom: activeFrom ?? todayAsBusinessDate(),
        activeUntil,
      }
      return existing ? catalog.updatePriceRule(existing.id, body) : catalog.createPriceRule(body)
    },
    onSuccess: () => {
      toast.success(existing ? 'Price rule updated' : 'Price rule created', {
        description: 'It applies to the next evaluation, not to quotations already decided.',
      })
      onOpenChange(false)
      onSaved()
    },
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? 'Edit tier price rule' : 'New tier price rule'}
      description="Two rules of equal priority that both match are an error the server reports rather than resolves — keep priorities distinct."
      busy={save.isPending}
      error={save.error}
      submitLabel={existing ? 'Save changes' : 'Create price rule'}
      disabled={!unitPrice}
      disabledReason="A unit price is required."
      onSubmit={() => save.mutate()}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Tier" required>
          {(props) => (
            <Select {...props} value={tier} onChange={(e) => setTier(e.target.value as CustomerTier)}>
              {(['BRONZE', 'SILVER', 'GOLD'] as CustomerTier[]).map((value) => (
                <option key={value} value={value}>
                  {TIER_LABEL[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Unit price" required>
          {(props) => (
            <Input {...props} type="number" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
          )}
        </Field>
        <Field label="Priority" hint="Higher wins. Distinct values avoid ambiguity.">
          {(props) => <Input {...props} type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <DateInput label="Active from" value={activeFrom} onChange={setActiveFrom} />
        <DateInput label="Active until" hint="Leave empty for open-ended." value={activeUntil} onChange={setActiveUntil} />
      </div>
    </FormDialog>
  )
}

function PlanDialog({
  open,
  onOpenChange,
  existing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existing: SubscriptionPlan | null
  onSaved: () => void
}) {
  const empty = {
    productId: '',
    code: '',
    name: '',
    intervalMonths: '1',
    intervalPrice: '',
    intervalCost: '',
    taxRateBp: '1800',
    prorationPolicy: 'IMMEDIATE_PRORATED',
    cancellationPolicy: 'END_OF_PERIOD',
    billingAnchor: 'ACTIVATION_DATE',
    active: true,
  }
  const [form, setForm] = useState(empty)
  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    if (!open) return
    setForm(
      existing
        ? {
            productId: existing.productId,
            code: existing.code,
            name: existing.name,
            intervalMonths: String(existing.intervalMonths),
            intervalPrice: String(existing.intervalPrice),
            intervalCost: existing.intervalCost ?? '',
            taxRateBp: String(existing.taxRateBp),
            prorationPolicy: existing.prorationPolicy,
            cancellationPolicy: existing.cancellationPolicy,
            billingAnchor: existing.billingAnchor,
            active: existing.active,
          }
        : empty,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing])

  const products = useQuery({
    queryKey: keys.products({ pageSize: 200 }),
    queryFn: ({ signal }) => catalog.products({ pageSize: 200 }, signal),
    enabled: open,
    ...CATALOG_QUERY_OPTIONS,
  })

  const save = useMutation({
    mutationFn: () => {
      const body = {
        productId: form.productId,
        code: form.code.trim(),
        name: form.name.trim(),
        intervalMonths: Number(form.intervalMonths),
        intervalPrice: form.intervalPrice,
        intervalCost: form.intervalCost || null,
        taxRateBp: Number(form.taxRateBp) || 0,
        prorationPolicy: form.prorationPolicy as 'IMMEDIATE_PRORATED' | 'NEXT_PERIOD',
        cancellationPolicy: form.cancellationPolicy as 'END_OF_PERIOD' | 'IMMEDIATE_PRORATED',
        billingAnchor: form.billingAnchor as 'ACTIVATION_DATE' | 'CALENDAR_MONTH_START',
        active: form.active,
      }
      return existing ? catalog.updatePlan(existing.id, body) : catalog.createPlan(body)
    },
    onSuccess: () => {
      toast.success(existing ? 'Plan updated' : 'Plan created', {
        description: 'Live subscriptions on this plan follow its policies from the next change.',
      })
      onOpenChange(false)
      onSaved()
    },
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? `Edit ${existing.name}` : 'New subscription plan'}
      description="These policies govern every future change to a subscription on this plan."
      busy={save.isPending}
      error={save.error}
      submitLabel={existing ? 'Save changes' : 'Create plan'}
      disabled={!form.productId || !form.code.trim() || !form.name.trim() || !form.intervalPrice}
      disabledReason="Product, code, name and interval price are required."
      onSubmit={() => save.mutate()}
    >
      <Field label="Recurring product" required>
        {(props) => (
          <Select {...props} value={form.productId} onChange={(e) => set('productId', e.target.value)}>
            <option value="">Choose…</option>
            {(products.data?.items ?? [])
              .filter((product) => product.chargeKind === 'RECURRING')
              .map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
          </Select>
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" required>
          {(props) => <Input {...props} value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} />}
        </Field>
        <Field label="Name" required>
          {(props) => <Input {...props} value={form.name} onChange={(e) => set('name', e.target.value)} />}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Interval" required>
          {(props) => (
            <Select {...props} value={form.intervalMonths} onChange={(e) => set('intervalMonths', e.target.value)}>
              <option value="1">Monthly</option>
              <option value="3">Quarterly</option>
              <option value="6">Half-yearly</option>
              <option value="12">Yearly</option>
            </Select>
          )}
        </Field>
        <Field label="Price per interval" required>
          {(props) => (
            <Input {...props} type="number" step="0.01" value={form.intervalPrice} onChange={(e) => set('intervalPrice', e.target.value)} />
          )}
        </Field>
        <Field label="Cost per interval">
          {(props) => (
            <Input {...props} type="number" step="0.01" value={form.intervalCost} onChange={(e) => set('intervalCost', e.target.value)} />
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Mid-period change">
          {(props) => (
            <Select {...props} value={form.prorationPolicy} onChange={(e) => set('prorationPolicy', e.target.value)}>
              <option value="IMMEDIATE_PRORATED">Charged or credited immediately</option>
              <option value="NEXT_PERIOD">Takes effect next period</option>
            </Select>
          )}
        </Field>
        <Field label="Cancellation">
          {(props) => (
            <Select {...props} value={form.cancellationPolicy} onChange={(e) => set('cancellationPolicy', e.target.value)}>
              <option value="END_OF_PERIOD">Runs to end of period</option>
              <option value="IMMEDIATE_PRORATED">Stops now, credits unused</option>
            </Select>
          )}
        </Field>
        <Field label="Billing anchored to">
          {(props) => (
            <Select {...props} value={form.billingAnchor} onChange={(e) => set('billingAnchor', e.target.value)}>
              <option value="ACTIVATION_DATE">Activation date</option>
              <option value="CALENDAR_MONTH_START">Calendar month start</option>
            </Select>
          )}
        </Field>
      </div>

      <Checkbox
        label="Available for quoting"
        checked={form.active}
        onChange={(e) => set('active', e.target.checked)}
      />
    </FormDialog>
  )
}

function WarehouseDialog({
  open,
  onOpenChange,
  existing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existing: Warehouse | null
  onSaved: () => void
}) {
  const empty = {
    code: '',
    name: '',
    location: '',
    shippingFixedCost: '',
    shippingCostPerKg: '',
    sortOrder: '10',
    active: true,
  }
  const [form, setForm] = useState(empty)
  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    if (!open) return
    setForm(
      existing
        ? {
            code: existing.code,
            name: existing.name,
            location: existing.location ?? '',
            shippingFixedCost: existing.shippingFixedCost ?? '',
            shippingCostPerKg: existing.shippingCostPerKg ?? '',
            sortOrder: String(existing.sortOrder),
            active: existing.active,
          }
        : empty,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing])

  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: form.code.trim(),
        name: form.name.trim(),
        location: form.location.trim() || null,
        shippingFixedCost: form.shippingFixedCost || null,
        shippingCostPerKg: form.shippingCostPerKg || null,
        sortOrder: Number(form.sortOrder) || 0,
        active: form.active,
      }
      return existing ? catalog.updateWarehouse(existing.id, body) : catalog.createWarehouse(body)
    },
    onSuccess: () => {
      toast.success(existing ? 'Warehouse updated' : 'Warehouse created', {
        description: 'Shipping costs feed straight into the next allocation plan.',
      })
      onOpenChange(false)
      onSaved()
    },
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? `Edit ${existing.name}` : 'New warehouse'}
      description="Shipping costs decide which split the allocation planner prefers."
      busy={save.isPending}
      error={save.error}
      submitLabel={existing ? 'Save changes' : 'Create warehouse'}
      disabled={!form.code.trim() || !form.name.trim()}
      disabledReason="Code and name are required."
      onSubmit={() => save.mutate()}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" required>
          {(props) => <Input {...props} value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} />}
        </Field>
        <Field label="Name" required>
          {(props) => <Input {...props} value={form.name} onChange={(e) => set('name', e.target.value)} />}
        </Field>
      </div>
      <Field label="Location">
        {(props) => <Input {...props} value={form.location} onChange={(e) => set('location', e.target.value)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Fixed shipping cost">
          {(props) => (
            <Input {...props} type="number" step="0.01" value={form.shippingFixedCost} onChange={(e) => set('shippingFixedCost', e.target.value)} />
          )}
        </Field>
        <Field label="Cost per kg">
          {(props) => (
            <Input {...props} type="number" step="0.01" value={form.shippingCostPerKg} onChange={(e) => set('shippingCostPerKg', e.target.value)} />
          )}
        </Field>
        <Field label="Sort order">
          {(props) => <Input {...props} type="number" value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />}
        </Field>
      </div>
      <Checkbox
        label="In use for allocation"
        hint="An inactive warehouse is not considered when planning a shipment."
        checked={form.active}
        onChange={(e) => set('active', e.target.checked)}
      />
    </FormDialog>
  )
}

function CategoryDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CategoryKind>('HARDWARE')

  const create = useMutation({
    mutationFn: () => catalog.createCategory({ code: code.trim().toUpperCase(), name: name.trim(), kind }),
    onSuccess: () => {
      toast.success('Category created')
      onOpenChange(false)
      setCode('')
      setName('')
      onSaved()
    },
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New category"
      description="The discount policy keys its ceilings by this code, so choose it deliberately — it is the stable identifier."
      busy={create.isPending}
      error={create.error}
      submitLabel="Create category"
      disabled={!code.trim() || !name.trim()}
      disabledReason="Code and name are required."
      onSubmit={() => create.mutate()}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code" required>
          {(props) => <Input {...props} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />}
        </Field>
        <Field label="Name" required>
          {(props) => <Input {...props} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Kind" required>
          {(props) => (
            <Select {...props} value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
              {(['HARDWARE', 'SERVICE', 'SUBSCRIPTION'] as CategoryKind[]).map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_KIND_LABEL[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </FormDialog>
  )
}
