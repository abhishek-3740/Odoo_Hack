"""Price resolution — port of catalog/service/PriceResolver.java.

Precedence per variant: highest-priority in-date price_rules row for
variant + tier + currency, else the variant default (product base plus the
variant's extra), else an error — never a guess. Ties at the top priority
are ambiguous configuration, never broken silently.

`resolve_all` mirrors the Java batch signature (one bounded query per table,
dict keyed by variant). `resolve_one` is the single-variant convenience used
by the recommendation repricing path.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ApiException, ErrorCode
from app.models.catalog import Category, PriceRule, Product, ProductVariant

CUSTOMER_TIERS = ("BRONZE", "SILVER", "GOLD")


@dataclass(frozen=True)
class ResolvedPrice:
    variant_id: uuid.UUID
    product_id: uuid.UUID
    category_id: uuid.UUID
    category_code: str | None
    sku: str
    name: str
    unit_price_minor: int
    unit_cost_minor: int
    tax_rate_bp: int
    currency: str
    requires_stock: bool
    promoted: bool
    source: str


def is_rule_active(rule: PriceRule, on_date: date) -> bool:
    """Half-open window [active_from, active_until); until is exclusive."""
    return rule.active_from <= on_date and (
        rule.active_until is None or on_date < rule.active_until
    )


async def resolve_all(
    db: AsyncSession,
    variant_ids: set[uuid.UUID] | list[uuid.UUID] | tuple[uuid.UUID, ...],
    tier: str,
    currency: str,
    on_date: date,
) -> dict[uuid.UUID, ResolvedPrice]:
    ordered = list(dict.fromkeys(variant_ids))
    if not ordered:
        return {}
    tier_key = (tier or "").upper()
    if tier_key not in CUSTOMER_TIERS:
        raise ApiException(ErrorCode.VALIDATION_FAILED, f'"{tier}" is not a valid CustomerTier.')

    variants = (
        (await db.execute(select(ProductVariant).where(ProductVariant.id.in_(ordered))))
        .scalars()
        .all()
    )
    by_id = {v.id: v for v in variants}
    for missing in ordered:
        if missing not in by_id:
            raise ApiException.not_found(f"Product variant {missing}")

    products = (
        (await db.execute(select(Product).where(Product.id.in_({v.product_id for v in variants}))))
        .scalars()
        .all()
    )
    products_by_id = {p.id: p for p in products}

    categories = (
        (
            await db.execute(
                select(Category).where(Category.id.in_({p.category_id for p in products}))
            )
        )
        .scalars()
        .all()
    )
    code_by_category = {c.id: c.code for c in categories}

    rules = (
        (
            await db.execute(
                select(PriceRule).where(
                    PriceRule.variant_id.in_(ordered),
                    PriceRule.tier == tier_key,
                    PriceRule.currency == currency,
                )
            )
        )
        .scalars()
        .all()
    )
    rules_by_variant: dict[uuid.UUID, list[PriceRule]] = {}
    for rule in rules:
        if is_rule_active(rule, on_date):
            rules_by_variant.setdefault(rule.variant_id, []).append(rule)

    resolved: dict[uuid.UUID, ResolvedPrice] = {}
    for vid in ordered:
        variant = by_id[vid]
        product = products_by_id.get(variant.product_id)
        if product is None:
            raise ApiException.not_found(f"Product for variant {variant.sku}")
        if not product.is_active or not variant.is_active:
            raise ApiException(
                ErrorCode.PRICE_NOT_RESOLVABLE, f'"{variant.name}" is no longer available.'
            )
        if product.currency != currency:
            raise ApiException(
                ErrorCode.CURRENCY_MISMATCH,
                f'"{variant.name}" is priced in {product.currency}, not {currency}.',
            )
        candidates = rules_by_variant.get(vid, [])
        if not candidates:
            unit_price = product.base_price_minor + (variant.price_extra_minor or 0)
            source = "VARIANT_DEFAULT"
        else:
            top = max(r.priority for r in candidates)
            winners = sorted(
                (r for r in candidates if r.priority == top),
                key=lambda r: r.active_from,
                reverse=True,
            )
            if len(winners) > 1:
                raise ApiException.of(
                    ErrorCode.AMBIGUOUS_PRICE_RULE,
                    f'Two price rules of equal priority match "{variant.name}" '
                    "for this tier. Fix the configuration before quoting it.",
                    variantId=str(vid),
                    priority=top,
                )
            unit_price = winners[0].unit_price_minor
            source = "PRICE_RULE"
        resolved[vid] = ResolvedPrice(
            variant_id=variant.id,
            product_id=product.id,
            category_id=product.category_id,
            category_code=code_by_category.get(product.category_id),
            sku=variant.sku,
            name=variant.name,
            unit_price_minor=unit_price,
            unit_cost_minor=(
                variant.cost_minor if variant.cost_minor is not None else product.base_cost_minor
            ),
            tax_rate_bp=product.tax_rate_bp,
            currency=currency,
            requires_stock=product.fulfillment_kind == "STOCK",
            promoted=product.promoted,
            source=source,
        )
    return resolved


async def resolve_one(
    db: AsyncSession, variant_id: uuid.UUID, tier: str, currency: str, on_date: date
) -> ResolvedPrice:
    """Single-variant convenience for the recommendation panel's repricing."""
    price = (await resolve_all(db, [variant_id], tier, currency, on_date)).get(variant_id)
    if price is None:
        raise ApiException(
            ErrorCode.PRICE_NOT_RESOLVABLE,
            "No price is configured for this item at the customer's tier.",
        )
    return price
