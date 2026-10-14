"""Catalogue CRUD — port of catalog/controller/CatalogAdminController.java
(reads + writes) and PublicCatalogController.java (storefront).

Guards: reads need any internal role (CUSTOMER -> 403 "The catalogue is
internal."); writes are ADMIN-only except customers POST (ADMIN/MANAGER/REP)
and PATCH (ADMIN/MANAGER). Archive via active=false, never delete.
"""

from __future__ import annotations

import json
import uuid
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.paging import SORT_COLUMNS, page_size_or_default, parse_sort
from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.engines import shared_math as m
from app.models.catalog import (
    Category,
    Customer,
    PriceRule,
    Product,
    ProductVariant,
    SubscriptionPlan,
)
from app.models.fulfillment import StockLevel, Warehouse
from app.schemas.catalog import (
    CategoryRequest,
    CategoryResponse,
    CustomerRequest,
    CustomerResponse,
    PlanRequest,
    PlanResponse,
    PriceRuleRequest,
    PriceRuleResponse,
    ProductRequest,
    ProductResponse,
    StorefrontCatalog,
    VariantRequest,
    VariantResponse,
    WarehouseRequest,
    WarehouseResponse,
)
from app.services import audit_service

CATALOG_FORBIDDEN = "The catalogue is internal."

CUSTOMER_TIERS = {"BRONZE", "SILVER", "GOLD"}
CATEGORY_KINDS = {"HARDWARE", "SERVICE", "SUBSCRIPTION"}
FULFILLMENT_KINDS = {"STOCK", "NONE"}
CHARGE_KINDS = {"ONE_TIME", "RECURRING"}
QUANTITY_MODES = {"INTEGER", "DECIMAL"}
BILLING_ANCHORS = {"ACTIVATION_DATE", "CALENDAR_MONTH_START"}
PRORATION_POLICIES = {"IMMEDIATE_PRORATED", "NEXT_PERIOD"}
CANCELLATION_POLICIES = {"END_OF_PERIOD", "IMMEDIATE_PRORATED"}
PLAN_INTERVALS = (1, 3, 12)

CUSTOMER_SORTS = {"name", "createdAt", "updatedAt"}
PRODUCT_SORTS = {"name", "createdAt", "updatedAt", "code"}


# --------------------------------------------------------------- helpers ---


def parse_enum(type_name: str, value: str | None, *, required: bool = True) -> str | None:
    if value is None:
        if required:
            raise ApiException(ErrorCode.VALIDATION_FAILED, f"{type_name} is required.")
        return None
    upper = value.upper()
    allowed = _ENUM_SETS[type_name]
    if upper not in allowed:
        raise ApiException(ErrorCode.VALIDATION_FAILED, f'"{value}" is not a valid {type_name}.')
    return upper


_ENUM_SETS = {
    "CustomerTier": CUSTOMER_TIERS,
    "CategoryKind": CATEGORY_KINDS,
    "FulfillmentKind": FULFILLMENT_KINDS,
    "ChargeKind": CHARGE_KINDS,
    "QuantityMode": QUANTITY_MODES,
    "BillingAnchor": BILLING_ANCHORS,
    "ProrationPolicy": PRORATION_POLICIES,
    "CancellationPolicy": CANCELLATION_POLICIES,
}


def like_pattern(search: str | None) -> str:
    """Lower-cased contains pattern; user wildcards escaped, blank matches all."""
    if search is None or not search.strip():
        return "%"
    escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped.lower()}%"


def _non_negative(label: str, minor: int) -> int:
    if minor < 0:
        raise ApiException(ErrorCode.VALIDATION_FAILED, f"{label} must not be negative.")
    return minor


def _to_minor(label: str, major: Decimal | None, *, default: int | None = None) -> int | None:
    if major is None:
        return default
    return _non_negative(label, m.to_minor(major))


def require_internal(actor: Actor) -> None:
    if actor.is_customer:
        raise ApiException.forbidden(CATALOG_FORBIDDEN)


def require_admin(actor: Actor) -> None:
    require_internal(actor)
    if actor.role != "ADMIN":
        raise ApiException.forbidden()


def _order(model: type, field: str, descending: bool):  # type: ignore[no-untyped-def]
    column = getattr(model, SORT_COLUMNS[field])
    ordered = column.desc() if descending else column.asc()
    return ordered, model.id.asc()


async def _page(
    db: AsyncSession,
    base,  # select
    count_from,  # select(count)
    *,
    page: int | None,
    page_size: int | None,
    sort: str | None,
    allowed: set[str],
    default: str = "name",
    model: type,
):  # type: ignore[no-untyped-def]
    field, descending = parse_sort(sort, allowed, default)
    page_eff = page if page is not None and page >= 0 else 0
    size_eff = page_size_or_default(page_size)
    total = int((await db.execute(count_from)).scalar_one())
    rows = (
        (await db.execute(base.order_by(*_order(model, field, descending)).offset(page_eff * size_eff).limit(size_eff)))
        .scalars()
        .all()
    )
    return rows, page_eff, size_eff, total


def _dump(model_cls, **kwargs):  # type: ignore[no-untyped-def]
    return model_cls(**kwargs).model_dump(mode="json", by_alias=True)


def _attributes_to_dict(value: object) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
        except ValueError as exc:
            raise ApiException(ErrorCode.VALIDATION_FAILED, "attributesJson must be a JSON object.") from exc
        if not isinstance(parsed, dict):
            raise ApiException(ErrorCode.VALIDATION_FAILED, "attributesJson must be a JSON object.")
        return parsed
    raise ApiException(ErrorCode.VALIDATION_FAILED, "attributesJson must be a JSON object.")


# -------------------------------------------------------------- customers ---


def _customer_to_dict(customer: Customer) -> dict:
    return _dump(
        CustomerResponse,
        id=customer.id,
        name=customer.name,
        tier=customer.tier,
        currency=customer.currency,
        contact_email=customer.contact_email,
        contact_phone=customer.contact_phone,
        billing_address=customer.billing_address,
        owner_rep_profile_id=customer.owner_rep_profile_id,
        active=customer.is_active,
    )


async def list_customers(
    db: AsyncSession,
    actor: Actor,
    *,
    search: str | None = None,
    page: int | None = None,
    page_size: int | None = None,
    sort: str | None = None,
) -> tuple[list[dict], int, int, int]:
    require_internal(actor)
    pattern = like_pattern(search)
    filt = [Customer.is_active == True, func.lower(Customer.name).like(pattern, escape="\\")]  # noqa: E712
    rows, page_eff, size_eff, total = await _page(
        db,
        select(Customer).where(*filt),
        select(func.count()).select_from(Customer).where(*filt),
        page=page,
        page_size=page_size,
        sort=sort,
        allowed=CUSTOMER_SORTS,
        model=Customer,
    )
    return [_customer_to_dict(c) for c in rows], page_eff, size_eff, total


async def get_customer(db: AsyncSession, actor: Actor, customer_id: uuid.UUID) -> dict:
    require_internal(actor)
    customer = (
        await db.execute(select(Customer).where(Customer.id == customer_id))
    ).scalars().first()
    if customer is None:
        raise ApiException.not_found(f"Customer {customer_id}")
    return _customer_to_dict(customer)


def _apply_customer(customer: Customer, req: CustomerRequest) -> None:
    customer.contact_email = req.contact_email
    customer.contact_phone = req.contact_phone
    customer.billing_address = req.billing_address
    customer.owner_rep_profile_id = req.owner_rep_profile_id
    if req.active is not None:
        customer.is_active = req.active


async def create_customer(db: AsyncSession, actor: Actor, req: CustomerRequest) -> dict:
    require_internal(actor)
    if actor.role not in ("ADMIN", "MANAGER", "REP"):
        raise ApiException.forbidden()
    name = req.name.strip()
    if not name:
        raise ApiException(ErrorCode.VALIDATION_FAILED, "name must not be blank.")
    customer = Customer(
        name=name,
        tier=parse_enum("CustomerTier", req.tier),
        currency=(req.currency or "INR").upper(),
    )
    _apply_customer(customer, req)
    db.add(customer)
    await db.flush()
    await audit_service.record(
        db, actor, "CUSTOMER_CREATED", "Customer", customer.id,
        after={"name": customer.name, "tier": customer.tier},
    )
    return _customer_to_dict(customer)


async def patch_customer(
    db: AsyncSession, actor: Actor, customer_id: uuid.UUID, req: CustomerRequest
) -> dict:
    require_internal(actor)
    if actor.role not in ("ADMIN", "MANAGER"):
        raise ApiException.forbidden()
    customer = (
        await db.execute(select(Customer).where(Customer.id == customer_id).with_for_update())
    ).scalars().first()
    if customer is None:
        raise ApiException.not_found(f"Customer {customer_id}")
    name = req.name.strip()
    if not name:
        raise ApiException(ErrorCode.VALIDATION_FAILED, "name must not be blank.")
    before = customer.tier
    customer.name = name
    customer.tier = parse_enum("CustomerTier", req.tier)
    _apply_customer(customer, req)
    await audit_service.record(
        db, actor, "CUSTOMER_UPDATED", "Customer", customer.id,
        before={"tier": before}, after={"tier": customer.tier},
    )
    return _customer_to_dict(customer)


# ------------------------------------------------------------- categories ---


def _category_to_dict(category: Category) -> dict:
    return _dump(
        CategoryResponse,
        id=category.id,
        code=category.code,
        name=category.name,
        kind=category.kind,
        active=category.is_active,
    )


async def list_categories(db: AsyncSession, actor: Actor) -> list[dict]:
    require_internal(actor)
    rows = (
        await db.execute(select(Category).order_by(Category.name.asc(), Category.id.asc()))
    ).scalars().all()
    return [_category_to_dict(c) for c in rows]


async def create_category(db: AsyncSession, actor: Actor, req: CategoryRequest) -> dict:
    require_admin(actor)
    name = req.name.strip()
    if not name:
        raise ApiException(ErrorCode.VALIDATION_FAILED, "name must not be blank.")
    category = Category(
        code=req.code.strip().upper(),
        name=name,
        kind=parse_enum("CategoryKind", req.kind),
    )
    if req.active is not None:
        category.is_active = req.active
    db.add(category)
    await db.flush()
    await audit_service.record(
        db, actor, "CATEGORY_CREATED", "Category", category.id,
        after={"code": category.code},
    )
    return _category_to_dict(category)


# --------------------------------------------------------------- products ---


async def _category_code(db: AsyncSession, category_id: uuid.UUID) -> str | None:
    return (
        await db.execute(select(Category.code).where(Category.id == category_id))
    ).scalars().first()


def _product_to_dict(product: Product, category_code: str | None) -> dict:
    return _dump(
        ProductResponse,
        id=product.id,
        category_id=product.category_id,
        category_code=category_code,
        code=product.code,
        name=product.name,
        description=product.description,
        unit=product.unit,
        base_price=m.to_major(product.base_price_minor),
        base_cost=m.to_major(product.base_cost_minor),
        currency=product.currency,
        tax_rate_bp=product.tax_rate_bp,
        fulfillment_kind=product.fulfillment_kind,
        charge_kind=product.charge_kind,
        quantity_mode=product.quantity_mode,
        promoted=product.promoted,
        active=product.is_active,
    )


async def list_products(
    db: AsyncSession,
    actor: Actor,
    *,
    category_id: uuid.UUID | None = None,
    search: str | None = None,
    page: int | None = None,
    page_size: int | None = None,
    sort: str | None = None,
) -> tuple[list[dict], int, int, int]:
    require_internal(actor)
    pattern = like_pattern(search)
    filt = [Product.is_active == True]  # noqa: E712
    if category_id is not None:
        filt.append(Product.category_id == category_id)
    if pattern != "%":
        filt.append(
            func.lower(Product.name).like(pattern, escape="\\")
            | func.lower(Product.code).like(pattern, escape="\\")
        )
    rows, page_eff, size_eff, total = await _page(
        db,
        select(Product).where(*filt),
        select(func.count()).select_from(Product).where(*filt),
        page=page,
        page_size=page_size,
        sort=sort,
        allowed=PRODUCT_SORTS,
        model=Product,
    )
    cats = (
        await db.execute(select(Category).where(Category.id.in_({p.category_id for p in rows})))
    ).scalars().all() if rows else []
    codes = {c.id: c.code for c in cats}
    return [_product_to_dict(p, codes.get(p.category_id)) for p in rows], page_eff, size_eff, total


async def get_product(db: AsyncSession, actor: Actor, product_id: uuid.UUID) -> dict:
    require_internal(actor)
    product = (
        await db.execute(select(Product).where(Product.id == product_id))
    ).scalars().first()
    if product is None:
        raise ApiException.not_found(f"Product {product_id}")
    return _product_to_dict(product, await _category_code(db, product.category_id))


def _apply_product(product: Product, req: ProductRequest) -> None:
    product.description = req.description
    if req.unit is not None:
        product.unit = req.unit
    if req.currency is not None:
        product.currency = req.currency.upper()
    if req.tax_rate_bp is not None:
        product.tax_rate_bp = req.tax_rate_bp
    if req.quantity_mode is not None:
        product.quantity_mode = parse_enum("QuantityMode", req.quantity_mode)
    if req.promoted is not None:
        product.promoted = req.promoted
    if req.active is not None:
        product.is_active = req.active


async def create_product(db: AsyncSession, actor: Actor, req: ProductRequest) -> dict:
    require_admin(actor)
    missing = (
        await db.execute(select(Category.id).where(Category.id == req.category_id))
    ).scalars().first()
    if missing is None:
        raise ApiException.not_found(f"Category {req.category_id}")
    product = Product(
        category_id=req.category_id,
        code=req.code,
        name=req.name,
        base_price_minor=_to_minor("basePrice", req.base_price),
        base_cost_minor=_to_minor("baseCost", req.base_cost),
        currency=(req.currency or "INR").upper(),
        fulfillment_kind=parse_enum("FulfillmentKind", req.fulfillment_kind),
        charge_kind=parse_enum("ChargeKind", req.charge_kind),
    )
    _apply_product(product, req)
    db.add(product)
    await db.flush()
    await audit_service.record(
        db, actor, "PRODUCT_CREATED", "Product", product.id,
        after={"code": product.code},
    )
    return _product_to_dict(product, await _category_code(db, product.category_id))


async def patch_product(
    db: AsyncSession, actor: Actor, product_id: uuid.UUID, req: ProductRequest
) -> dict:
    require_admin(actor)
    product = (
        await db.execute(select(Product).where(Product.id == product_id).with_for_update())
    ).scalars().first()
    if product is None:
        raise ApiException.not_found(f"Product {product_id}")
    before = product.base_price_minor
    product.category_id = req.category_id
    product.code = req.code
    product.name = req.name
    product.base_price_minor = _to_minor("basePrice", req.base_price)
    product.base_cost_minor = _to_minor("baseCost", req.base_cost)
    product.fulfillment_kind = parse_enum("FulfillmentKind", req.fulfillment_kind)
    product.charge_kind = parse_enum("ChargeKind", req.charge_kind)
    _apply_product(product, req)
    await audit_service.record(
        db, actor, "PRODUCT_UPDATED", "Product", product.id,
        before={"basePriceMinor": before}, after={"basePriceMinor": product.base_price_minor},
    )
    return _product_to_dict(product, await _category_code(db, product.category_id))


# --------------------------------------------------------------- variants ---


def _variant_to_dict(variant: ProductVariant) -> dict:
    return _dump(
        VariantResponse,
        id=variant.id,
        product_id=variant.product_id,
        sku=variant.sku,
        name=variant.name,
        attributes=variant.attributes or {},
        price_extra=m.to_major(variant.price_extra_minor),
        cost=m.to_major(variant.cost_minor) if variant.cost_minor is not None else None,
        weight_grams=variant.weight_grams,
        substitution_group=variant.substitution_group,
        active=variant.is_active,
    )


async def list_variants(db: AsyncSession, actor: Actor, *, product_id: uuid.UUID) -> list[dict]:
    require_internal(actor)
    rows = (
        await db.execute(
            select(ProductVariant)
            .where(ProductVariant.product_id == product_id, ProductVariant.is_active == True)  # noqa: E712
            .order_by(ProductVariant.name.asc(), ProductVariant.id.asc())
        )
    ).scalars().all()
    return [_variant_to_dict(v) for v in rows]


async def create_variant(db: AsyncSession, actor: Actor, req: VariantRequest) -> dict:
    require_admin(actor)
    found = (
        await db.execute(select(Product.id).where(Product.id == req.product_id))
    ).scalars().first()
    if found is None:
        raise ApiException.not_found(f"Product {req.product_id}")
    variant = ProductVariant(product_id=req.product_id, sku=req.sku, name=req.name)
    variant.attributes = _attributes_to_dict(req.attributes)
    variant.price_extra_minor = _to_minor("priceExtra", req.price_extra, default=0)
    variant.cost_minor = _to_minor("cost", req.cost)
    if req.weight_grams is not None:
        variant.weight_grams = req.weight_grams
    variant.substitution_group = req.substitution_group
    if req.active is not None:
        variant.is_active = req.active
    db.add(variant)
    await db.flush()
    await audit_service.record(
        db, actor, "VARIANT_CREATED", "ProductVariant", variant.id,
        after={"sku": variant.sku},
    )
    return _variant_to_dict(variant)


async def patch_variant(
    db: AsyncSession, actor: Actor, variant_id: uuid.UUID, req: VariantRequest
) -> dict:
    require_admin(actor)
    variant = (
        await db.execute(select(ProductVariant).where(ProductVariant.id == variant_id).with_for_update())
    ).scalars().first()
    if variant is None:
        raise ApiException.not_found(f"Variant {variant_id}")
    variant.sku = req.sku
    variant.name = req.name
    if req.attributes is not None:
        variant.attributes = _attributes_to_dict(req.attributes)
    if req.price_extra is not None:
        variant.price_extra_minor = _to_minor("priceExtra", req.price_extra)
    variant.cost_minor = _to_minor("cost", req.cost)
    if req.weight_grams is not None:
        variant.weight_grams = req.weight_grams
    variant.substitution_group = req.substitution_group
    if req.active is not None:
        variant.is_active = req.active
    await audit_service.record(
        db, actor, "VARIANT_UPDATED", "ProductVariant", variant.id,
        after={"sku": variant.sku},
    )
    return _variant_to_dict(variant)


# ------------------------------------------------------------ price rules ---


def _rule_to_dict(rule: PriceRule) -> dict:
    return _dump(
        PriceRuleResponse,
        id=rule.id,
        variant_id=rule.variant_id,
        tier=rule.tier,
        currency=rule.currency,
        unit_price=m.to_major(rule.unit_price_minor),
        priority=rule.priority,
        active_from=rule.active_from,
        active_until=rule.active_until,
    )


async def list_price_rules(db: AsyncSession, actor: Actor, *, variant_id: uuid.UUID) -> list[dict]:
    require_internal(actor)
    rows = (
        await db.execute(
            select(PriceRule)
            .where(PriceRule.variant_id == variant_id)
            .order_by(PriceRule.priority.desc(), PriceRule.active_from.desc(), PriceRule.id.asc())
        )
    ).scalars().all()
    return [_rule_to_dict(r) for r in rows]


async def create_price_rule(db: AsyncSession, actor: Actor, req: PriceRuleRequest) -> dict:
    require_admin(actor)
    found = (
        await db.execute(select(ProductVariant.id).where(ProductVariant.id == req.variant_id))
    ).scalars().first()
    if found is None:
        raise ApiException.not_found(f"Variant {req.variant_id}")
    rule = PriceRule(
        variant_id=req.variant_id,
        tier=parse_enum("CustomerTier", req.tier),
        currency=(req.currency or "INR").upper(),
        unit_price_minor=_to_minor("unitPrice", req.unit_price),
        priority=req.priority if req.priority is not None else 0,
        active_from=req.active_from,
    )
    rule.active_until = req.active_until
    db.add(rule)
    await db.flush()
    await audit_service.record(
        db, actor, "PRICE_RULE_CREATED", "PriceRule", rule.id,
        after={"variantId": str(rule.variant_id), "tier": rule.tier, "unitPriceMinor": rule.unit_price_minor},
    )
    return _rule_to_dict(rule)


async def patch_price_rule(
    db: AsyncSession, actor: Actor, rule_id: uuid.UUID, req: PriceRuleRequest
) -> dict:
    require_admin(actor)
    rule = (
        await db.execute(select(PriceRule).where(PriceRule.id == rule_id).with_for_update())
    ).scalars().first()
    if rule is None:
        raise ApiException.not_found(f"Price rule {rule_id}")
    before = rule.unit_price_minor
    rule.unit_price_minor = _to_minor("unitPrice", req.unit_price)
    if req.priority is not None:
        rule.priority = req.priority
    rule.active_from = req.active_from
    rule.active_until = req.active_until
    await audit_service.record(
        db, actor, "PRICE_RULE_UPDATED", "PriceRule", rule.id,
        before={"unitPriceMinor": before}, after={"unitPriceMinor": rule.unit_price_minor},
    )
    return _rule_to_dict(rule)


# ------------------------------------------------------------------ plans ---


def _plan_to_dict(plan: SubscriptionPlan) -> dict:
    return _dump(
        PlanResponse,
        id=plan.id,
        product_id=plan.product_id,
        code=plan.code,
        name=plan.name,
        interval_months=plan.interval_months,
        currency=plan.currency,
        interval_price=m.to_major(plan.interval_price_minor),
        interval_cost=m.to_major(plan.interval_cost_minor),
        tax_rate_bp=plan.tax_rate_bp,
        billing_anchor=plan.billing_anchor,
        proration_policy=plan.proration_policy,
        cancellation_policy=plan.cancellation_policy,
        clawback_policy=plan.clawback_policy,
        active=plan.is_active,
    )


async def list_plans(
    db: AsyncSession, actor: Actor, *, product_id: uuid.UUID | None = None
) -> list[dict]:
    require_internal(actor)
    filt = [SubscriptionPlan.is_active == True]  # noqa: E712
    if product_id is not None:
        filt.append(SubscriptionPlan.product_id == product_id)
    rows = (
        await db.execute(
            select(SubscriptionPlan).where(*filt).order_by(SubscriptionPlan.name.asc(), SubscriptionPlan.id.asc())
        )
    ).scalars().all()
    return [_plan_to_dict(p) for p in rows]


def _apply_plan(plan: SubscriptionPlan, req: PlanRequest) -> None:
    if req.currency is not None:
        plan.currency = req.currency.upper()
    if req.tax_rate_bp is not None:
        plan.tax_rate_bp = req.tax_rate_bp
    if req.billing_anchor is not None:
        plan.billing_anchor = parse_enum("BillingAnchor", req.billing_anchor)
    if req.proration_policy is not None:
        plan.proration_policy = parse_enum("ProrationPolicy", req.proration_policy)
    if req.cancellation_policy is not None:
        plan.cancellation_policy = parse_enum("CancellationPolicy", req.cancellation_policy)
    if req.active is not None:
        plan.is_active = req.active


async def create_plan(db: AsyncSession, actor: Actor, req: PlanRequest) -> dict:
    require_admin(actor)
    product = (
        await db.execute(select(Product).where(Product.id == req.product_id))
    ).scalars().first()
    if product is None:
        raise ApiException.not_found(f"Product {req.product_id}")
    if product.charge_kind != "RECURRING":
        raise ApiException(
            ErrorCode.VALIDATION_FAILED,
            f'Plans belong to recurring products. "{product.name}" is one-time.',
        )
    if req.interval_months not in PLAN_INTERVALS:
        raise ApiException(ErrorCode.VALIDATION_FAILED, "intervalMonths must be 1, 3 or 12.")
    plan = SubscriptionPlan(
        product_id=req.product_id,
        code=req.code,
        name=req.name,
        interval_months=req.interval_months,
        interval_price_minor=_to_minor("intervalPrice", req.interval_price),
        interval_cost_minor=_to_minor("intervalCost", req.interval_cost, default=0),
    )
    _apply_plan(plan, req)
    db.add(plan)
    await db.flush()
    await audit_service.record(
        db, actor, "PLAN_CREATED", "SubscriptionPlan", plan.id,
        after={"code": plan.code},
    )
    return _plan_to_dict(plan)


async def patch_plan(
    db: AsyncSession, actor: Actor, plan_id: uuid.UUID, req: PlanRequest
) -> dict:
    require_admin(actor)
    plan = (
        await db.execute(select(SubscriptionPlan).where(SubscriptionPlan.id == plan_id).with_for_update())
    ).scalars().first()
    if plan is None:
        raise ApiException.not_found(f"Plan {plan_id}")
    plan.name = req.name
    plan.interval_months = req.interval_months
    plan.interval_price_minor = _to_minor("intervalPrice", req.interval_price)
    if req.interval_cost is not None:
        plan.interval_cost_minor = _to_minor("intervalCost", req.interval_cost)
    _apply_plan(plan, req)
    await audit_service.record(
        db, actor, "PLAN_UPDATED", "SubscriptionPlan", plan.id,
        after={"code": plan.code, "prorationPolicy": plan.proration_policy,
               "cancellationPolicy": plan.cancellation_policy},
    )
    return _plan_to_dict(plan)


# -------------------------------------------------------------- warehouses ---


def _warehouse_to_dict(warehouse: Warehouse) -> dict:
    return _dump(
        WarehouseResponse,
        id=warehouse.id,
        code=warehouse.code,
        name=warehouse.name,
        location=warehouse.location,
        shipping_fixed_cost=m.to_major(warehouse.shipping_fixed_cost_minor),
        shipping_cost_per_kg=m.to_major(warehouse.shipping_cost_per_kg_minor),
        sort_order=warehouse.sort_order,
        active=warehouse.is_active,
    )


async def list_warehouses(db: AsyncSession, actor: Actor) -> list[dict]:
    require_internal(actor)
    rows = (
        await db.execute(
            select(Warehouse).order_by(Warehouse.sort_order.asc(), Warehouse.code.asc(), Warehouse.id.asc())
        )
    ).scalars().all()
    return [_warehouse_to_dict(w) for w in rows]


async def create_warehouse(db: AsyncSession, actor: Actor, req: WarehouseRequest) -> dict:
    require_admin(actor)
    warehouse = Warehouse(
        code=req.code,
        name=req.name,
        shipping_fixed_cost_minor=_to_minor("shippingFixedCost", req.shipping_fixed_cost, default=0),
        sort_order=req.sort_order if req.sort_order is not None else 0,
    )
    warehouse.location = req.location
    if req.shipping_cost_per_kg is not None:
        warehouse.shipping_cost_per_kg_minor = _to_minor("shippingCostPerKg", req.shipping_cost_per_kg)
    if req.active is not None:
        warehouse.is_active = req.active
    db.add(warehouse)
    await db.flush()
    await audit_service.record(
        db, actor, "WAREHOUSE_CREATED", "Warehouse", warehouse.id,
        after={"code": warehouse.code},
    )
    return _warehouse_to_dict(warehouse)


async def patch_warehouse(
    db: AsyncSession, actor: Actor, warehouse_id: uuid.UUID, req: WarehouseRequest
) -> dict:
    require_admin(actor)
    warehouse = (
        await db.execute(select(Warehouse).where(Warehouse.id == warehouse_id).with_for_update())
    ).scalars().first()
    if warehouse is None:
        raise ApiException.not_found(f"Warehouse {warehouse_id}")
    warehouse.name = req.name
    if req.shipping_fixed_cost is not None:
        warehouse.shipping_fixed_cost_minor = _to_minor("shippingFixedCost", req.shipping_fixed_cost)
    if req.sort_order is not None:
        warehouse.sort_order = req.sort_order
    warehouse.location = req.location
    if req.shipping_cost_per_kg is not None:
        warehouse.shipping_cost_per_kg_minor = _to_minor("shippingCostPerKg", req.shipping_cost_per_kg)
    if req.active is not None:
        warehouse.is_active = req.active
    await audit_service.record(
        db, actor, "WAREHOUSE_UPDATED", "Warehouse", warehouse.id,
        after={"shippingFixedCostMinor": warehouse.shipping_fixed_cost_minor},
    )
    return _warehouse_to_dict(warehouse)


# -------------------------------------------------------------- storefront ---


async def storefront_catalog(db: AsyncSession) -> dict:
    """Anonymous storefront view: list prices only, in-stock yes/no, no cost."""
    categories = (
        await db.execute(
            select(Category).where(Category.is_active == True).order_by(Category.name.asc())  # noqa: E712
        )
    ).scalars().all()
    category_by_id = {c.id: c for c in categories}

    products = (
        await db.execute(select(Product).where(Product.is_active == True))  # noqa: E712
    ).scalars().all()
    active_products = sorted(
        (p for p in products if p.category_id in category_by_id),
        key=lambda p: (not p.promoted, p.name, str(p.id)),
    )
    product_by_id = {p.id: p for p in active_products}

    variants = (
        await db.execute(select(ProductVariant).where(ProductVariant.is_active == True))  # noqa: E712
    ).scalars().all()
    active_variants = sorted(
        (
            v for v in variants
            if v.product_id in product_by_id and product_by_id[v.product_id].charge_kind != "RECURRING"
        ),
        key=lambda v: (v.sku, str(v.id)),
    )

    stock_variant_ids = {
        v.id for v in active_variants if product_by_id[v.product_id].fulfillment_kind == "STOCK"
    }
    available: dict[uuid.UUID, Decimal] = {}
    if stock_variant_ids:
        active_warehouses = (
            await db.execute(select(Warehouse.id).where(Warehouse.is_active == True))  # noqa: E712
        ).scalars().all()
        active_wh = set(active_warehouses)
        if active_wh:
            levels = (
                await db.execute(
                    select(StockLevel).where(
                        StockLevel.variant_id.in_(stock_variant_ids),
                        StockLevel.warehouse_id.in_(active_wh),
                    )
                )
            ).scalars().all()
            for level in levels:
                available[level.variant_id] = (
                    available.get(level.variant_id, Decimal(0))
                    + (level.on_hand - level.reserved)
                )

    plans = (
        await db.execute(select(SubscriptionPlan).where(SubscriptionPlan.is_active == True))  # noqa: E712
    ).scalars().all()
    active_plans = sorted(
        (p for p in plans if p.product_id in product_by_id),
        key=lambda p: (str(p.product_id), p.interval_months, str(p.id)),
    )

    catalog = StorefrontCatalog(
        categories=[
            {"id": c.id, "code": c.code, "name": c.name, "kind": c.kind}
            for c in sorted(categories, key=lambda c: (c.name, str(c.id)))
        ],
        products=[
            {
                "id": p.id,
                "category_id": p.category_id,
                "category_code": category_by_id[p.category_id].code,
                "category_kind": category_by_id[p.category_id].kind,
                "code": p.code,
                "name": p.name,
                "description": p.description,
                "unit": p.unit,
                "base_price": m.to_major(p.base_price_minor),
                "currency": p.currency,
                "tax_rate_bp": p.tax_rate_bp,
                "fulfillment_kind": p.fulfillment_kind,
                "charge_kind": p.charge_kind,
                "quantity_mode": p.quantity_mode,
                "promoted": p.promoted,
            }
            for p in active_products
        ],
        variants=[
            {
                "id": v.id,
                "product_id": v.product_id,
                "sku": v.sku,
                "name": v.name,
                "attributes": v.attributes or {},
                "list_price": m.to_major(
                    product_by_id[v.product_id].base_price_minor + v.price_extra_minor
                ),
                "in_stock": (
                    available.get(v.id, Decimal(0)) > 0
                    if v.id in stock_variant_ids
                    else True
                ),
                "substitution_group": v.substitution_group,
            }
            for v in active_variants
        ],
        plans=[
            {
                "id": p.id,
                "product_id": p.product_id,
                "code": p.code,
                "name": p.name,
                "interval_months": p.interval_months,
                "currency": p.currency,
                "interval_price": m.to_major(p.interval_price_minor),
                "tax_rate_bp": p.tax_rate_bp,
                "billing_anchor": p.billing_anchor,
                "proration_policy": p.proration_policy,
                "cancellation_policy": p.cancellation_policy,
            }
            for p in active_plans
        ],
    )
    return catalog.model_dump(mode="json", by_alias=True)
