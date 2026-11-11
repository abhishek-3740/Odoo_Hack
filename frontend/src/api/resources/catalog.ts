import { api, type Page } from '../client'
import type {
  Category,
  CategoryRequest,
  Customer,
  CustomerRequest,
  PlanRequest,
  PriceRule,
  PriceRuleRequest,
  Product,
  ProductRequest,
  StorefrontCatalog,
  SubscriptionPlan,
  UUID,
  Variant,
  VariantRequest,
  Warehouse,
  WarehouseRequest,
} from '../contracts'

/** Customer accounts. Ownership and edit rules stay server-controlled. */
export const customers = {
  list: (
    params: { search?: string; page?: number; pageSize?: number; sort?: string } = {},
    signal?: AbortSignal,
  ) => api.get<Page<Customer>>('/customers', { query: params, signal }),

  get: (customerId: UUID, signal?: AbortSignal) =>
    api.get<Customer>(`/customers/${customerId}`, { signal }),

  create: (body: CustomerRequest) => api.post<Customer>('/customers', body),

  update: (customerId: UUID, body: Partial<CustomerRequest>) =>
    api.patch<Customer>(`/customers/${customerId}`, body),
}

/**
 * The configurable catalogue.
 *
 * These are working setup forms, not decoration: changing a price rule or a plan
 * policy changes the very next evaluation.
 */
export const catalog = {
  /** Anonymous, no token. Powers the public storefront. */
  storefront: (signal?: AbortSignal) =>
    api.get<StorefrontCatalog>('/public/catalog', { anonymous: true, signal }),

  categories: (signal?: AbortSignal) => api.get<Category[]>('/categories', { signal }),
  createCategory: (body: CategoryRequest) => api.post<Category>('/categories', body),

  products: (
    params: {
      categoryId?: UUID
      search?: string
      page?: number
      pageSize?: number
      sort?: string
    } = {},
    signal?: AbortSignal,
  ) => api.get<Page<Product>>('/products', { query: params, signal }),

  product: (productId: UUID, signal?: AbortSignal) =>
    api.get<Product>(`/products/${productId}`, { signal }),
  createProduct: (body: ProductRequest) => api.post<Product>('/products', body),
  updateProduct: (productId: UUID, body: Partial<ProductRequest>) =>
    api.patch<Product>(`/products/${productId}`, body),

  /** `productId` is required by the server; there is no "all variants" read. */
  variants: (productId: UUID, signal?: AbortSignal) =>
    api.get<Variant[]>('/variants', { query: { productId }, signal }),
  createVariant: (body: VariantRequest) => api.post<Variant>('/variants', body),
  updateVariant: (variantId: UUID, body: Partial<VariantRequest>) =>
    api.patch<Variant>(`/variants/${variantId}`, body),

  priceRules: (variantId: UUID, signal?: AbortSignal) =>
    api.get<PriceRule[]>('/price-rules', { query: { variantId }, signal }),
  createPriceRule: (body: PriceRuleRequest) => api.post<PriceRule>('/price-rules', body),
  updatePriceRule: (ruleId: UUID, body: Partial<PriceRuleRequest>) =>
    api.patch<PriceRule>(`/price-rules/${ruleId}`, body),

  plans: (productId?: UUID, signal?: AbortSignal) =>
    api.get<SubscriptionPlan[]>('/subscription-plans', { query: { productId }, signal }),
  createPlan: (body: PlanRequest) => api.post<SubscriptionPlan>('/subscription-plans', body),
  updatePlan: (planId: UUID, body: Partial<PlanRequest>) =>
    api.patch<SubscriptionPlan>(`/subscription-plans/${planId}`, body),

  warehouses: (signal?: AbortSignal) => api.get<Warehouse[]>('/warehouses', { signal }),
  createWarehouse: (body: WarehouseRequest) => api.post<Warehouse>('/warehouses', body),
  updateWarehouse: (warehouseId: UUID, body: Partial<WarehouseRequest>) =>
    api.patch<Warehouse>(`/warehouses/${warehouseId}`, body),
}
