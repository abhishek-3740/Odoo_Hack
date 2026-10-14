"""Catalog + discount-policy HTTP surface — port of CatalogAdminController,
PublicCatalogController and DiscountPolicyController.

`router = APIRouter()` with FULL literal paths (no prefix here; mounted as-is
in tests, and later included by the app router). Every handler returns
ApiResponse.of / PageResponse.of dicts only. Role gates live in services so
the forbidden messages match the Java controllers exactly.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_actor
from app.core.database import get_db
from app.core.exceptions import ApiException, ErrorCode
from app.core.response import ApiResponse, PageResponse
from app.core.security import Actor
from app.schemas.catalog import (
    CategoryRequest,
    CustomerRequest,
    PlanRequest,
    PriceRuleRequest,
    ProductRequest,
    PublishRequest,
    VariantRequest,
    WarehouseRequest,
)
from app.services import catalog_service, policy_service

router = APIRouter()


def _governance(actor: Actor) -> None:
    if actor.is_customer:
        raise ApiException.forbidden("Discount policy is internal.")


# --------------------------------------------------------------- customers ---


@router.get("/api/v1/customers")
async def list_customers(
    search: str | None = None,
    page: int | None = None,
    pageSize: int | None = Query(default=None, alias="pageSize"),
    sort: str | None = None,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    items, page_eff, size_eff, total = await catalog_service.list_customers(
        db, actor, search=search, page=page, page_size=pageSize, sort=sort
    )
    return PageResponse.of(items, page_eff, size_eff, total)


@router.get("/api/v1/customers/{customer_id}")
async def get_customer(
    customer_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(await catalog_service.get_customer(db, actor, customer_id))


@router.post("/api/v1/customers", status_code=201)
async def create_customer(
    body: CustomerRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(await catalog_service.create_customer(db, actor, body))


@router.patch("/api/v1/customers/{customer_id}")
async def patch_customer(
    customer_id: uuid.UUID,
    body: CustomerRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(
        await catalog_service.patch_customer(db, actor, customer_id, body)
    )


# -------------------------------------------------------------- categories ---


@router.get("/api/v1/categories")
async def list_categories(
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(await catalog_service.list_categories(db, actor))


@router.post("/api/v1/categories", status_code=201)
async def create_category(
    body: CategoryRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(await catalog_service.create_category(db, actor, body))


# ---------------------------------------------------------------- products ---


@router.get("/api/v1/products")
async def list_products(
    categoryId: uuid.UUID | None = Query(default=None, alias="categoryId"),
    search: str | None = None,
    page: int | None = None,
    pageSize: int | None = Query(default=None, alias="pageSize"),
    sort: str | None = None,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    items, page_eff, size_eff, total = await catalog_service.list_products(
        db, actor, category_id=categoryId, search=search,
        page=page, page_size=pageSize, sort=sort,
    )
    return PageResponse.of(items, page_eff, size_eff, total)


@router.get("/api/v1/products/{product_id}")
async def get_product(
    product_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(await catalog_service.get_product(db, actor, product_id))


@router.post("/api/v1/products", status_code=201)
async def create_product(
    body: ProductRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(await catalog_service.create_product(db, actor, body))


@router.patch("/api/v1/products/{product_id}")
async def patch_product(
    product_id: uuid.UUID,
    body: ProductRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(
        await catalog_service.patch_product(db, actor, product_id, body)
    )


# ---------------------------------------------------------------- variants ---


@router.get("/api/v1/variants")
async def list_variants(
    productId: uuid.UUID = Query(alias="productId"),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(
        await catalog_service.list_variants(db, actor, product_id=productId)
    )


@router.post("/api/v1/variants", status_code=201)
async def create_variant(
    body: VariantRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(await catalog_service.create_variant(db, actor, body))


@router.patch("/api/v1/variants/{variant_id}")
async def patch_variant(
    variant_id: uuid.UUID,
    body: VariantRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(
        await catalog_service.patch_variant(db, actor, variant_id, body)
    )


# -------------------------------------------------------------- price rules ---


@router.get("/api/v1/price-rules")
async def list_price_rules(
    variantId: uuid.UUID = Query(alias="variantId"),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(
        await catalog_service.list_price_rules(db, actor, variant_id=variantId)
    )


@router.post("/api/v1/price-rules", status_code=201)
async def create_price_rule(
    body: PriceRuleRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(await catalog_service.create_price_rule(db, actor, body))


@router.patch("/api/v1/price-rules/{rule_id}")
async def patch_price_rule(
    rule_id: uuid.UUID,
    body: PriceRuleRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(
        await catalog_service.patch_price_rule(db, actor, rule_id, body)
    )


# ------------------------------------------------------------------- plans ---


@router.get("/api/v1/subscription-plans")
async def list_plans(
    productId: uuid.UUID | None = Query(default=None, alias="productId"),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(
        await catalog_service.list_plans(db, actor, product_id=productId)
    )


@router.post("/api/v1/subscription-plans", status_code=201)
async def create_plan(
    body: PlanRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(await catalog_service.create_plan(db, actor, body))


@router.patch("/api/v1/subscription-plans/{plan_id}")
async def patch_plan(
    plan_id: uuid.UUID,
    body: PlanRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(
        await catalog_service.patch_plan(db, actor, plan_id, body)
    )


# --------------------------------------------------------------- warehouses ---


@router.get("/api/v1/warehouses")
async def list_warehouses(
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(await catalog_service.list_warehouses(db, actor))


@router.post("/api/v1/warehouses", status_code=201)
async def create_warehouse(
    body: WarehouseRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(await catalog_service.create_warehouse(db, actor, body))


@router.patch("/api/v1/warehouses/{warehouse_id}")
async def patch_warehouse(
    warehouse_id: uuid.UUID,
    body: WarehouseRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    return ApiResponse.of(
        await catalog_service.patch_warehouse(db, actor, warehouse_id, body)
    )


# ------------------------------------------------------------------ public ---


@router.get("/api/v1/public/catalog")
async def public_catalog(db: AsyncSession = Depends(get_db)) -> dict:
    return ApiResponse.of(await catalog_service.storefront_catalog(db))


# ------------------------------------------------------------------ policy ---


@router.get("/api/v1/discount-policies/current")
async def policy_current(
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    _governance(actor)
    effective = await policy_service.effective_now(db)
    return ApiResponse.of(
        {
            "id": None,
            "versionNo": effective.version_no,
            "definition": policy_service.definition_to_wire(effective.definition),
            "effectiveAt": effective.effective_at.isoformat(),
            "note": None,
            "current": True,
        }
    )


@router.get("/api/v1/discount-policies")
async def policy_history(
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    _governance(actor)
    current_version = (await policy_service.effective_now(db)).version_no
    rows = await policy_service.history(db)
    return ApiResponse.of(
        [policy_service.policy_to_wire(row, current=row.version_no == current_version) for row in rows]
    )


@router.post("/api/v1/discount-policies", status_code=201)
async def policy_publish(
    body: PublishRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict:
    if actor.is_customer:
        raise ApiException(ErrorCode.FORBIDDEN, "You do not have access to this action.")
    policy = await policy_service.publish(db, actor, body.definition, body.note)
    return ApiResponse.of(
        {
            "id": str(policy.id),
            "versionNo": policy.version_no,
            "definition": body.definition,
            "effectiveAt": policy.effective_at.isoformat(),
            "note": policy.note,
            "current": True,
        },
        {"published": True},
    )
