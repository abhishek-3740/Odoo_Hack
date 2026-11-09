"""Catalog + storefront + policy DTOs — port of catalog/dto/{CatalogDtos,StorefrontDtos}
and the policy controller records.

Wire contract: camelCase JSON keys (Jackson record names preserved verbatim so
the Vite frontend is untouched). Money arrives as MoneyInput (major units,
string-or-number) and leaves as DecimalStr (major-unit strings). Enum fields
are plain strings; case-insensitive parsing + rejection live in services.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.core.response import DecimalStr
from app.schemas.money import MoneyInput


class _Wired(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


# ------------------------------------------------------------- customers ---


class CustomerRequest(_Wired):
    name: str = Field(min_length=1, max_length=200)
    tier: str
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    contact_email: str | None = Field(default=None, max_length=200, alias="contactEmail")
    contact_phone: str | None = Field(default=None, max_length=40, alias="contactPhone")
    billing_address: str | None = Field(default=None, max_length=500, alias="billingAddress")
    owner_rep_profile_id: uuid.UUID | None = Field(default=None, alias="ownerRepProfileId")
    active: bool | None = None


class CustomerResponse(_Wired):
    id: uuid.UUID
    name: str
    tier: str
    currency: str
    contact_email: str | None = Field(default=None, alias="contactEmail")
    contact_phone: str | None = Field(default=None, alias="contactPhone")
    billing_address: str | None = Field(default=None, alias="billingAddress")
    owner_rep_profile_id: uuid.UUID | None = Field(default=None, alias="ownerRepProfileId")
    active: bool


# ------------------------------------------------------------ categories ---


class CategoryRequest(_Wired):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    kind: str
    active: bool | None = None


class CategoryResponse(_Wired):
    id: uuid.UUID
    code: str
    name: str
    kind: str
    active: bool


# -------------------------------------------------------------- products ---


class ProductRequest(_Wired):
    category_id: uuid.UUID = Field(alias="categoryId")
    code: str = Field(min_length=1, max_length=60)
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    unit: str | None = Field(default=None, max_length=20)
    base_price: MoneyInput = Field(alias="basePrice")
    base_cost: MoneyInput = Field(alias="baseCost")
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    tax_rate_bp: int | None = Field(default=None, ge=0, le=10000, alias="taxRateBp")
    fulfillment_kind: str = Field(alias="fulfillmentKind")
    charge_kind: str = Field(alias="chargeKind")
    quantity_mode: str | None = Field(default=None, alias="quantityMode")
    promoted: bool | None = None
    active: bool | None = None


class ProductResponse(_Wired):
    id: uuid.UUID
    category_id: uuid.UUID = Field(alias="categoryId")
    category_code: str | None = Field(default=None, alias="categoryCode")
    code: str
    name: str
    description: str | None = None
    unit: str
    base_price: DecimalStr = Field(alias="basePrice")
    base_cost: DecimalStr = Field(alias="baseCost")
    currency: str
    tax_rate_bp: int = Field(alias="taxRateBp")
    fulfillment_kind: str = Field(alias="fulfillmentKind")
    charge_kind: str = Field(alias="chargeKind")
    quantity_mode: str = Field(alias="quantityMode")
    promoted: bool
    active: bool


# -------------------------------------------------------------- variants ---


class VariantRequest(_Wired):
    product_id: uuid.UUID = Field(alias="productId")
    sku: str = Field(min_length=1, max_length=60)
    name: str = Field(min_length=1, max_length=200)
    attributes: Any | None = Field(default=None, alias="attributesJson")
    price_extra: MoneyInput | None = Field(default=None, alias="priceExtra")
    cost: MoneyInput | None = None
    weight_grams: int | None = Field(default=None, ge=0, alias="weightGrams")
    substitution_group: str | None = Field(default=None, max_length=60, alias="substitutionGroup")
    active: bool | None = None


class VariantResponse(_Wired):
    id: uuid.UUID
    product_id: uuid.UUID = Field(alias="productId")
    sku: str
    name: str
    attributes: dict = Field(alias="attributesJson")
    price_extra: DecimalStr = Field(alias="priceExtra")
    cost: DecimalStr | None = None
    weight_grams: int = Field(alias="weightGrams")
    substitution_group: str | None = Field(default=None, alias="substitutionGroup")
    active: bool


# ------------------------------------------------------------ price rules ---


class PriceRuleRequest(_Wired):
    variant_id: uuid.UUID = Field(alias="variantId")
    tier: str
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    unit_price: MoneyInput = Field(alias="unitPrice")
    priority: int | None = None
    active_from: date = Field(alias="activeFrom")
    active_until: date | None = Field(default=None, alias="activeUntil")


class PriceRuleResponse(_Wired):
    id: uuid.UUID
    variant_id: uuid.UUID = Field(alias="variantId")
    tier: str
    currency: str
    unit_price: DecimalStr = Field(alias="unitPrice")
    priority: int
    active_from: date = Field(alias="activeFrom")
    active_until: date | None = Field(default=None, alias="activeUntil")


# ----------------------------------------------------------------- plans ---


class PlanRequest(_Wired):
    product_id: uuid.UUID = Field(alias="productId")
    code: str = Field(min_length=1, max_length=60)
    name: str = Field(min_length=1, max_length=200)
    interval_months: int = Field(alias="intervalMonths")
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    interval_price: MoneyInput = Field(alias="intervalPrice")
    interval_cost: MoneyInput | None = Field(default=None, alias="intervalCost")
    tax_rate_bp: int | None = Field(default=None, ge=0, le=10000, alias="taxRateBp")
    billing_anchor: str | None = Field(default=None, alias="billingAnchor")
    proration_policy: str | None = Field(default=None, alias="prorationPolicy")
    cancellation_policy: str | None = Field(default=None, alias="cancellationPolicy")
    active: bool | None = None


class PlanResponse(_Wired):
    id: uuid.UUID
    product_id: uuid.UUID = Field(alias="productId")
    code: str
    name: str
    interval_months: int = Field(alias="intervalMonths")
    currency: str
    interval_price: DecimalStr = Field(alias="intervalPrice")
    interval_cost: DecimalStr = Field(alias="intervalCost")
    tax_rate_bp: int = Field(alias="taxRateBp")
    billing_anchor: str = Field(alias="billingAnchor")
    proration_policy: str = Field(alias="prorationPolicy")
    cancellation_policy: str = Field(alias="cancellationPolicy")
    clawback_policy: str = Field(alias="clawbackPolicy")
    active: bool


# ------------------------------------------------------------- warehouses ---


class WarehouseRequest(_Wired):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    location: str | None = Field(default=None, max_length=200)
    shipping_fixed_cost: MoneyInput | None = Field(default=None, alias="shippingFixedCost")
    shipping_cost_per_kg: MoneyInput | None = Field(default=None, alias="shippingCostPerKg")
    sort_order: int | None = Field(default=None, alias="sortOrder")
    active: bool | None = None


class WarehouseResponse(_Wired):
    id: uuid.UUID
    code: str
    name: str
    location: str | None = None
    shipping_fixed_cost: DecimalStr = Field(alias="shippingFixedCost")
    shipping_cost_per_kg: DecimalStr = Field(alias="shippingCostPerKg")
    sort_order: int = Field(alias="sortOrder")
    active: bool


# ------------------------------------------------------------- storefront ---


class StoreCategory(_Wired):
    id: uuid.UUID
    code: str
    name: str
    kind: str


class StoreProduct(_Wired):
    id: uuid.UUID
    category_id: uuid.UUID = Field(alias="categoryId")
    category_code: str = Field(alias="categoryCode")
    category_kind: str = Field(alias="categoryKind")
    code: str
    name: str
    description: str | None = None
    unit: str
    base_price: DecimalStr = Field(alias="basePrice")
    currency: str
    tax_rate_bp: int = Field(alias="taxRateBp")
    fulfillment_kind: str = Field(alias="fulfillmentKind")
    charge_kind: str = Field(alias="chargeKind")
    quantity_mode: str = Field(alias="quantityMode")
    promoted: bool


class StoreVariant(_Wired):
    id: uuid.UUID
    product_id: uuid.UUID = Field(alias="productId")
    sku: str
    name: str
    attributes: dict = Field(alias="attributesJson")
    list_price: DecimalStr = Field(alias="listPrice")
    in_stock: bool = Field(alias="inStock")
    substitution_group: str | None = Field(default=None, alias="substitutionGroup")


class StorePlan(_Wired):
    id: uuid.UUID
    product_id: uuid.UUID = Field(alias="productId")
    code: str
    name: str
    interval_months: int = Field(alias="intervalMonths")
    currency: str
    interval_price: DecimalStr = Field(alias="intervalPrice")
    tax_rate_bp: int = Field(alias="taxRateBp")
    billing_anchor: str = Field(alias="billingAnchor")
    proration_policy: str = Field(alias="prorationPolicy")
    cancellation_policy: str = Field(alias="cancellationPolicy")


class StorefrontCatalog(_Wired):
    categories: list[StoreCategory]
    products: list[StoreProduct]
    variants: list[StoreVariant]
    plans: list[StorePlan]


# ----------------------------------------------------------------- policy ---


class PublishRequest(_Wired):
    definition: dict
    note: str | None = Field(default=None, max_length=500)


class PolicyResponse(_Wired):
    id: uuid.UUID | None = None
    version_no: int = Field(alias="versionNo")
    definition: dict
    effective_at: datetime = Field(alias="effectiveAt")
    note: str | None = None
    current: bool
