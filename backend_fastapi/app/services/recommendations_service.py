"""Recommendation service — port of
recommendations/service/RecommendationService.java (ranking) and
recommendations/service/DealRecommendationService.java (apply delegation).

Suggestions come from real CONFIRMED orders: confidence(a -> b) = orders with
both / orders with a; score = 0.75*history + 0.15*promoted + 0.10*normalised
contribution. Below 5 eligible orders the panel says so and falls back to
promoted/category items. Applying delegates to the ordinary quote revision
flow, so pricing/policy checks are identical to a manual edit.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.engines import shared_math as m
from app.models.catalog import Category, Customer, Product, ProductVariant
from app.models.fulfillment import StockLevel
from app.models.quotes import QuoteLine, QuoteRevision, RecommendationDismissal
from app.schemas.quotes import QuoteDraftRequest, QuoteLineRequest
from app.services import price_resolver
from app.services.clock import business_today
from app.services.quote_service import (
    current_revision,
    load_customer,
    load_quote,
    lock_quote,
    require_edit,
    require_read,
    save_draft,
)

HISTORY_WEIGHT = Decimal("0.75")
PROMOTION_WEIGHT = Decimal("0.15")
MARGIN_WEIGHT = Decimal("0.10")
MIN_HISTORY_ORDERS = 5
MAX_RESULTS = 5
MIN_CANDIDATE_MARGIN = Decimal("0")


# --------------------------------------------------------------- recommend ---


async def recommend(db: AsyncSession, actor: Actor, quote_id: uuid.UUID) -> dict:
    quote = await load_quote(db, quote_id)
    require_read(actor, quote)
    revision = await current_revision(db, quote)
    customer = await load_customer(db, quote)
    cart = list(
        (
            await db.execute(
                select(QuoteLine)
                .where(QuoteLine.revision_id == revision.id)
                .order_by(QuoteLine.position.asc())
            )
        )
        .scalars()
        .all()
    )
    dismissed = {
        row.variant_id
        for row in (
            await db.execute(
                select(RecommendationDismissal).where(
                    RecommendationDismissal.revision_id == revision.id
                )
            )
        )
        .scalars()
        .all()
    }
    if not cart:
        return {
            "revisionId": str(revision.id),
            "rowVersion": quote.row_version,
            "suggestions": [],
            "limitedHistory": True,
            "note": "Add a product to see suggestions based on what customers usually buy together.",
            "eligibleHistoricalOrders": 0,
        }
    cart_product_ids = {ln.product_id for ln in cart}
    eligible_orders = await _count_eligible_orders(db, cart_product_ids)
    if eligible_orders >= MIN_HISTORY_ORDERS:
        suggestions = await _from_history(
            db, cart_product_ids, customer, revision, cart, dismissed
        )
    else:
        suggestions = []
    limited = eligible_orders < MIN_HISTORY_ORDERS
    if not suggestions:
        suggestions = await _fallback(db, cart_product_ids, customer, revision, cart, dismissed)
    note = (
        f"Limited purchase history for these products ({eligible_orders} of "
        f"{MIN_HISTORY_ORDERS} orders needed). Showing promoted items in related categories "
        "instead of a statistical suggestion."
        if limited
        else None
    )
    return {
        "revisionId": str(revision.id),
        "rowVersion": quote.row_version,
        "suggestions": suggestions,
        "limitedHistory": limited,
        "note": note,
        "eligibleHistoricalOrders": eligible_orders,
    }


async def _count_eligible_orders(db: AsyncSession, cart_product_ids: set[uuid.UUID]) -> int:
    row = (
        await db.execute(
            text(
                "SELECT count(DISTINCT ol.order_id) FROM dealflow.order_lines ol "
                "JOIN dealflow.orders o ON o.id = ol.order_id "
                "WHERE o.order_status = 'CONFIRMED' AND ol.product_id = ANY(:cart)"
            ),
            {"cart": list(cart_product_ids)},
        )
    ).scalar_one_or_none()
    return int(row or 0)


async def _from_history(
    db: AsyncSession,
    cart_product_ids: set[uuid.UUID],
    customer: Customer,
    revision: QuoteRevision,
    cart: list[QuoteLine],
    dismissed: set[uuid.UUID],
) -> list[dict]:
    rows = (
        await db.execute(
            text(
                """
                WITH eligible AS (
                    SELECT DISTINCT ol.order_id, ol.product_id
                      FROM dealflow.order_lines ol
                      JOIN dealflow.orders o ON o.id = ol.order_id
                     WHERE o.order_status = 'CONFIRMED'
                ),
                anchors AS (
                    SELECT order_id, product_id FROM eligible
                     WHERE product_id = ANY(:cart)
                ),
                anchor_totals AS (
                    SELECT product_id, count(DISTINCT order_id) AS anchor_total
                      FROM anchors GROUP BY product_id
                )
                SELECT e.product_id AS candidate,
                       a.product_id AS anchor,
                       count(DISTINCT e.order_id) AS together,
                       t.anchor_total AS anchor_total
                  FROM eligible e
                  JOIN anchors a ON a.order_id = e.order_id
                  JOIN anchor_totals t ON t.product_id = a.product_id
                 WHERE NOT (e.product_id = ANY(:cart))
                 GROUP BY e.product_id, a.product_id, t.anchor_total
                """
            ),
            {"cart": list(cart_product_ids)},
        )
    ).all()
    best: dict[uuid.UUID, Decimal] = {}
    evidence: dict[uuid.UUID, str] = {}
    anchor_names: dict[uuid.UUID, str] = {}
    for candidate, anchor, together, anchor_total in rows:
        if int(anchor_total) < MIN_HISTORY_ORDERS:
            continue
        confidence = (Decimal(int(together)) / Decimal(int(anchor_total))).quantize(
            Decimal("0.0001"), rounding=ROUND_HALF_UP
        )
        if best.get(candidate) is None or confidence > best[candidate]:
            best[candidate] = confidence
            if anchor not in anchor_names:
                anchor_names[anchor] = (
                    await db.execute(select(Product.name).where(Product.id == anchor))
                ).scalar_one_or_none() or "these products"
            evidence[candidate] = (
                f"Appeared with {anchor_names[anchor]} in {together} "
                f"of {anchor_total} eligible historical orders."
            )
    if not best:
        return []
    return await _rank(db, best, evidence, "CO_PURCHASE", customer, revision, cart, dismissed)


async def _fallback(
    db: AsyncSession,
    cart_product_ids: set[uuid.UUID],
    customer: Customer,
    revision: QuoteRevision,
    cart: list[QuoteLine],
    dismissed: set[uuid.UUID],
) -> list[dict]:
    cart_category_ids = {ln.category_id for ln in cart}
    candidates = list(
        (
            await db.execute(
                select(Product).where(
                    Product.is_active == True,  # noqa: E712
                    Product.charge_kind != "RECURRING",
                ).limit(50)
            )
        )
        .scalars()
        .all()
    )
    scores: dict[uuid.UUID, Decimal] = {}
    evidence: dict[uuid.UUID, str] = {}
    for product in candidates:
        if product.id in cart_product_ids:
            continue
        if not (product.promoted or product.category_id in cart_category_ids):
            continue
        scores[product.id] = Decimal(0)
        evidence[product.id] = (
            "Currently promoted." if product.promoted
            else "In a category already on this quotation."
        )
    return await _rank(db, scores, evidence, "LIMITED_HISTORY", customer, revision, cart, dismissed)


async def _rank(
    db: AsyncSession,
    history_scores: dict[uuid.UUID, Decimal],
    evidence: dict[uuid.UUID, str],
    basis: str,
    customer: Customer,
    revision: QuoteRevision,
    cart: list[QuoteLine],
    dismissed: set[uuid.UUID],
) -> list[dict]:
    if not history_scores:
        return []
    products_by_id = {
        p.id: p
        for p in (
            await db.execute(
                select(Product).where(
                    Product.id.in_(set(history_scores)),
                    Product.is_active == True,  # noqa: E712
                    Product.charge_kind != "RECURRING",
                )
            )
        )
        .scalars()
        .all()
    }
    if not products_by_id:
        return []
    categories = {
        c.id: c.code
        for c in (await db.execute(select(Category))).scalars().all()
    }
    today: date = business_today()
    variant_by_product: dict[uuid.UUID, ProductVariant] = {}
    for product_id in products_by_id:
        variant = (
            (
                await db.execute(
                    select(ProductVariant)
                    .where(
                        ProductVariant.product_id == product_id,
                        ProductVariant.is_active == True,  # noqa: E712
                    )
                    .order_by(ProductVariant.name.asc())
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )
        if variant is not None and variant.id not in dismissed:
            variant_by_product[product_id] = variant
    if not variant_by_product:
        return []
    try:
        prices = await price_resolver.resolve_all(
            db, {v.id for v in variant_by_product.values()},
            customer.tier, customer.currency, today,
        )
    except ApiException:
        return []

    quote_net = revision.one_time_net_minor + revision.recurring_first_cycle_net_minor
    quote_contribution = revision.contribution_minor
    current_margin = m.percent_of(quote_contribution, quote_net)
    max_contribution = max(
        [max(0, p.unit_price_minor - p.unit_cost_minor) for p in prices.values()],
        default=0,
    )
    stock = await _availability(db, {v.id for v in variant_by_product.values()})

    suggestions: list[dict] = []
    for product_id, variant in variant_by_product.items():
        product = products_by_id.get(product_id)
        price = prices.get(variant.id)
        if product is None or price is None:
            continue
        unit_contribution = price.unit_price_minor - price.unit_cost_minor
        candidate_margin = m.percent_of(unit_contribution, price.unit_price_minor)
        if candidate_margin is not None and candidate_margin < MIN_CANDIDATE_MARGIN:
            continue
        history = history_scores.get(product_id, Decimal(0))
        promoted_term = Decimal(1) if product.promoted else Decimal(0)
        contribution_term = (
            Decimal(0)
            if max_contribution <= 0
            else (Decimal(max(0, unit_contribution)) / Decimal(max_contribution)).quantize(
                Decimal("0.0001"), rounding=ROUND_HALF_UP
            )
        )
        score = (
            history * HISTORY_WEIGHT
            + promoted_term * PROMOTION_WEIGHT
            + contribution_term * MARGIN_WEIGHT
        ).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)

        new_margin = m.percent_of(quote_contribution + unit_contribution, quote_net + price.unit_price_minor)
        margin_delta = (
            None if new_margin is None or current_margin is None
            else new_margin - current_margin
        )
        if price.requires_stock:
            available = stock.get(variant.id, 0)
            in_stock = available > 0
            availability_note = "In stock" if in_stock else "Out of stock, would be backordered"
        else:
            in_stock, availability_note = True, None
        suggestions.append(
            {
                "variantId": str(variant.id),
                "productId": str(product.id),
                "sku": variant.sku,
                "name": variant.name,
                "categoryCode": categories.get(product.category_id),
                "unitPrice": m.to_major(price.unit_price_minor),
                "score": score,
                "promoted": product.promoted,
                "reason": evidence.get(product_id, "Related to items on this quotation."),
                "basis": basis,
                "contributionDelta": m.to_major(unit_contribution),
                "marginPercentDelta": margin_delta,
                "availabilityNote": availability_note,
                "inStock": in_stock,
            }
        )
    suggestions.sort(key=lambda s: s["name"])
    suggestions.sort(key=lambda s: s["score"], reverse=True)
    return suggestions[:MAX_RESULTS]


async def _availability(db: AsyncSession, variant_ids: set[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not variant_ids:
        return {}
    rows = (
        await db.execute(
            select(
                StockLevel.variant_id,
                func.coalesce(func.sum(StockLevel.on_hand - StockLevel.reserved), 0),
            )
            .where(StockLevel.variant_id.in_(variant_ids))
            .group_by(StockLevel.variant_id)
        )
    ).all()
    return {variant_id: int(total) for variant_id, total in rows}


# ----------------------------------------------------------------- dismiss ---


async def dismiss(
    db: AsyncSession, actor: Actor, quote_id: uuid.UUID, variant_id: uuid.UUID
) -> dict:
    quote = await lock_quote(db, quote_id)
    require_edit(actor, quote)
    revision = await current_revision(db, quote)
    existing = (
        await db.execute(
            select(RecommendationDismissal).where(
                RecommendationDismissal.revision_id == revision.id,
                RecommendationDismissal.variant_id == variant_id,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(
            RecommendationDismissal(
                quote_id=quote.id,
                revision_id=revision.id,
                variant_id=variant_id,
                actor_profile_id=actor.profile_id,
            )
        )
        await db.flush()
    return {"quoteId": str(quote_id), "variantId": str(variant_id), "dismissed": True}


# ------------------------------------------------------------------- apply ---


async def apply(
    db: AsyncSession, actor: Actor, quote_id: uuid.UUID, request
) -> dict:
    quote = await load_quote(db, quote_id)
    require_read(actor, quote)
    revision = await current_revision(db, quote)
    if revision.id != request.expectedRevisionId or quote.row_version != request.expectedRowVersion:
        raise ApiException(
            ErrorCode.CONFLICTING_STATE,
            "Quotation changed. Refresh recommendations before applying.",
        )
    offered = await recommend(db, actor, quote_id)
    if not any(s["variantId"] == str(request.variantId) for s in offered["suggestions"]):
        raise ApiException(
            ErrorCode.CONFLICTING_STATE, "This recommendation is no longer eligible."
        )
    lines = list(
        (
            await db.execute(
                select(QuoteLine)
                .where(QuoteLine.revision_id == revision.id)
                .order_by(QuoteLine.position.asc())
            )
        )
        .scalars()
        .all()
    )
    draft_lines: list[QuoteLineRequest] = []
    for ln in lines:
        replace = ln.line_key == request.replaceLineKey
        draft_lines.append(
            QuoteLineRequest(
                lineKey=ln.line_key,
                variantId=request.variantId if replace else ln.variant_id,
                planId=None if replace else ln.plan_id,
                quantity=ln.quantity,
                lineDiscountBp=ln.line_discount_bp,
                promisedDate=ln.promised_date,
                source="RECOMMENDATION" if replace else ln.source,
            )
        )
    if request.replaceLineKey is None:
        draft_lines.append(
            QuoteLineRequest(
                lineKey=f"rec-{uuid.uuid4().hex[:8]}",
                variantId=request.variantId,
                planId=None,
                quantity=Decimal(1),
                lineDiscountBp=0,
                promisedDate=None,
                source="RECOMMENDATION",
            )
        )
    draft = QuoteDraftRequest(
        lines=draft_lines,
        orderDiscountBp=revision.order_discount_bp,
        backorderTerms=revision.backorder_terms,
        requestedActivationDate=revision.requested_activation_date,
        expectedRowVersion=request.expectedRowVersion,
    )
    return await save_draft(db, actor, quote_id, draft)
