"""Portal recommendation service — port of portal/service/PortalRecommendationService.

Ownership is checked first via the portal quote gate. Offers are a
customer-safe projection (no cost, no margin, no thresholds): promoted
catalogue items not already on the deal, with a plain availability note.
Requesting one posts a COMMENT asking the seller for revised terms.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.engines import shared_math as m
from app.models.catalog import Customer, Product, ProductVariant
from app.models.fulfillment import StockLevel, Warehouse
from app.models.quotes import QuoteLine
from app.schemas import portal as dto
from app.schemas.portal import RecommendationRequest
from app.services import portal_service
from app.services.clock import business_today


async def recommend(
    db: AsyncSession, actor: Actor, quote_id: uuid.UUID
) -> dict[str, Any]:
    customer_id = portal_service.require_customer_id(actor)
    quote = await portal_service.load_quote_for_customer(db, quote_id, customer_id)
    revision = await portal_service.current_revision(db, quote)
    customer = (
        await db.execute(select(Customer).where(Customer.id == quote.customer_id))
    ).scalars().first()
    if customer is None:  # pragma: no cover - guarded by FK
        raise portal_service.scope_404()
    in_cart = {
        row[0]
        for row in (
            await db.execute(
                select(QuoteLine.variant_id).where(
                    QuoteLine.revision_id == revision.id,
                    QuoteLine.variant_id.is_not(None),
                )
            )
        ).all()
    }
    candidates = (
        await db.execute(
            select(ProductVariant, Product)
            .join(Product, Product.id == ProductVariant.product_id)
            .where(
                ProductVariant.is_active.is_(True),
                Product.is_active.is_(True),
                Product.promoted.is_(True),
                Product.charge_kind == "ONE_TIME",
            )
            .order_by(ProductVariant.sku.asc())
            .limit(20)
        )
    ).all()
    today = business_today()
    cache: dict = {}
    suggestions = []
    for variant, product in candidates:
        if variant.id in in_cart or len(suggestions) >= 5:
            continue
        try:
            resolved = await portal_service.resolve_price(
                db, variant.id, customer.tier, customer.currency, today, cache
            )
        except ApiException:
            continue  # inactive or unpriceable items are never offered
        available = (
            await db.execute(
                select(func.coalesce(func.sum(StockLevel.on_hand - StockLevel.reserved), 0))
                .join(Warehouse, Warehouse.id == StockLevel.warehouse_id)
                .where(
                    StockLevel.variant_id == variant.id,
                    Warehouse.is_active.is_(True),
                )
            )
        ).scalar_one()
        in_stock = Decimal(str(available)) >= Decimal(1)
        suggestions.append(
            {
                "variantId": str(variant.id),
                "name": variant.name,
                "type": "CROSS_SELL",
                "replaceLineKey": None,
                "unitPrice": m.to_major(resolved["unit_price"]),
                "netDelta": m.to_major(resolved["unit_price"]),
                "availabilityNote": (
                    "Available for requested quantity"
                    if in_stock
                    else "Shortfall — would be backordered"
                ),
            }
        )
    return {
        "revisionId": str(revision.id),
        "suggestions": suggestions,
        "limitedHistory": True,
    }


async def request_offer(
    db: AsyncSession, actor: Actor, quote_id: uuid.UUID, request: RecommendationRequest
) -> dict[str, Any]:
    result = await recommend(db, actor, quote_id)
    if result["revisionId"] != str(request.expectedRevisionId):
        raise ApiException(
            ErrorCode.CONFLICTING_STATE,
            "Quotation changed. Refresh offers before requesting.",
        )
    offer = next(
        (
            o
            for o in result["suggestions"]
            if o["variantId"] == str(request.variantId)
            and o["replaceLineKey"] == request.replaceLineKey
        ),
        None,
    )
    if offer is None:
        raise ApiException(
            ErrorCode.CONFLICTING_STATE, "This offer is no longer available."
        )
    message = (
        f"Please review adding {offer['name']} (variant {offer['variantId']}). "
        "Please send revised terms for my acceptance."
    )
    return await portal_service.submit_request(
        db,
        actor,
        quote_id,
        dto.PortalRequest(
            requestType="COMMENT",
            lineKey=request.replaceLineKey,
            message=message,
            lines=None,
            requestedOrderDiscountBp=None,
            expectedRevisionId=request.expectedRevisionId,
        ),
    )
