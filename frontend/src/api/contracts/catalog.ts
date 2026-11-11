import type {
  BasisPoints,
  BillingAnchor,
  BusinessDate,
  CancellationPolicy,
  CategoryKind,
  ChargeKind,
  CustomerTier,
  Decimal,
  FulfillmentKind,
  ProrationPolicy,
  QuantityMode,
  UUID,
} from './common'

/** Configuration surface — `catalog/dto/CatalogDtos.java`. */

export interface CustomerRequest {
  name: string
  tier: CustomerTier
  currency?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  billingAddress?: string | null
  ownerRepProfileId?: UUID | null
  active?: boolean | null
}

export interface Customer {
  id: UUID
  name: string
  tier: CustomerTier
  currency: string
  contactEmail: string | null
  contactPhone: string | null
  billingAddress: string | null
  ownerRepProfileId: UUID | null
  active: boolean
}

export interface CategoryRequest {
  code: string
  name: string
  kind: CategoryKind
  active?: boolean | null
}

export interface Category {
  id: UUID
  code: string
  name: string
  kind: CategoryKind
  active: boolean
}

export interface ProductRequest {
  categoryId: UUID
  code: string
  name: string
  description?: string | null
  unit?: string | null
  basePrice: Decimal | number
  baseCost: Decimal | number
  currency?: string | null
  taxRateBp?: BasisPoints | null
  fulfillmentKind: FulfillmentKind
  chargeKind: ChargeKind
  quantityMode?: QuantityMode | null
  promoted?: boolean | null
  active?: boolean | null
}

export interface Product {
  id: UUID
  categoryId: UUID
  categoryCode: string | null
  code: string
  name: string
  description: string | null
  unit: string | null
  basePrice: Decimal
  baseCost: Decimal
  currency: string
  taxRateBp: BasisPoints
  fulfillmentKind: FulfillmentKind
  chargeKind: ChargeKind
  quantityMode: QuantityMode
  promoted: boolean
  active: boolean
}

export interface VariantRequest {
  productId: UUID
  sku: string
  name: string
  attributesJson?: string | null
  priceExtra?: Decimal | number | null
  cost?: Decimal | number | null
  weightGrams?: number | null
  substitutionGroup?: string | null
  active?: boolean | null
}

export interface Variant {
  id: UUID
  productId: UUID
  sku: string
  name: string
  attributesJson: string | null
  priceExtra: Decimal | null
  cost: Decimal | null
  weightGrams: number
  substitutionGroup: string | null
  active: boolean
}

export interface PriceRuleRequest {
  variantId: UUID
  tier: CustomerTier
  currency?: string | null
  unitPrice: Decimal | number
  priority?: number | null
  activeFrom: BusinessDate
  activeUntil?: BusinessDate | null
}

export interface PriceRule {
  id: UUID
  variantId: UUID
  tier: CustomerTier
  currency: string
  unitPrice: Decimal
  priority: number
  activeFrom: BusinessDate
  activeUntil: BusinessDate | null
}

export interface PlanRequest {
  productId: UUID
  code: string
  name: string
  intervalMonths: number
  currency?: string | null
  intervalPrice: Decimal | number
  intervalCost?: Decimal | number | null
  taxRateBp?: BasisPoints | null
  billingAnchor?: BillingAnchor | null
  prorationPolicy?: ProrationPolicy | null
  cancellationPolicy?: CancellationPolicy | null
  active?: boolean | null
}

export interface SubscriptionPlan {
  id: UUID
  productId: UUID
  code: string
  name: string
  intervalMonths: number
  currency: string
  intervalPrice: Decimal
  intervalCost: Decimal | null
  taxRateBp: BasisPoints
  billingAnchor: BillingAnchor
  prorationPolicy: ProrationPolicy
  cancellationPolicy: CancellationPolicy
  clawbackPolicy: string | null
  active: boolean
}

export interface WarehouseRequest {
  code: string
  name: string
  location?: string | null
  shippingFixedCost?: Decimal | number | null
  shippingCostPerKg?: Decimal | number | null
  sortOrder?: number | null
  active?: boolean | null
}

export interface Warehouse {
  id: UUID
  code: string
  name: string
  location: string | null
  shippingFixedCost: Decimal | null
  shippingCostPerKg: Decimal | null
  sortOrder: number
  active: boolean
}

/* ------------------------------------------------------------ storefront */

/**
 * The anonymous view — `catalog/dto/StorefrontDtos.java`.
 *
 * Separate types on purpose: no field for cost, margin, stock quantity or
 * warehouse. "In stock" is a yes/no statement, never a count.
 */

export interface StoreCategory {
  id: UUID
  code: string
  name: string
  kind: CategoryKind
}

export interface StoreProduct {
  id: UUID
  categoryId: UUID
  categoryCode: string
  categoryKind: CategoryKind
  code: string
  name: string
  description: string | null
  unit: string | null
  basePrice: Decimal
  currency: string
  taxRateBp: BasisPoints
  fulfillmentKind: FulfillmentKind
  chargeKind: ChargeKind
  quantityMode: QuantityMode
  promoted: boolean
}

export interface StoreVariant {
  id: UUID
  productId: UUID
  sku: string
  name: string
  attributesJson: string | null
  listPrice: Decimal
  inStock: boolean
  substitutionGroup: string | null
}

export interface StorePlan {
  id: UUID
  productId: UUID
  code: string
  name: string
  intervalMonths: number
  currency: string
  intervalPrice: Decimal
  taxRateBp: BasisPoints
  billingAnchor: BillingAnchor
  prorationPolicy: ProrationPolicy
  cancellationPolicy: CancellationPolicy
}

export interface StorefrontCatalog {
  categories: StoreCategory[]
  products: StoreProduct[]
  variants: StoreVariant[]
  plans: StorePlan[]
}
