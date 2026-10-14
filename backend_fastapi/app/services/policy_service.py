"""Discount-policy versions — port of policy/service/DiscountPolicyService.java.

Policy is append-only: publishing mints version_no from the
discount_policy_version_seq sequence and never updates old rows. The stored
definition is a JSONB dict on the wire shape (camelCase keys); parse()
coerces it to the DiscountPolicyDefinition dataclass in risk_engine.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.engines.risk_engine import (
    DiscountPolicyDefinition,
    FinanceTriggers,
    ManagerTriggers,
)
from app.models.policy import DiscountPolicy
from app.repositories.sequences import DISCOUNT_POLICY_VERSION_SEQ, nextval
from app.services import audit_service
from app.services.clock import now_utc

CUSTOMER_TIERS = ("BRONZE", "SILVER", "GOLD")


@dataclass(frozen=True)
class EffectivePolicy:
    version_no: int
    definition: DiscountPolicyDefinition
    effective_at: datetime


# ------------------------------------------------------------------ parse ---


def _dec_or_none(value: Any, label: str) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except Exception as exc:
        raise ApiException(ErrorCode.VALIDATION_FAILED, f"{label} must be a number.") from exc


def _int_or_none(value: Any, label: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ApiException(ErrorCode.VALIDATION_FAILED, f"{label} must be a number.")
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ApiException(ErrorCode.VALIDATION_FAILED, f"{label} must be a number.") from exc


def _pick(mapping: dict, *names: str) -> Any:
    for name in names:
        if name in mapping:
            return mapping[name]
    return None


def parse_definition(stored: Any) -> DiscountPolicyDefinition:
    """Coerce a stored/request definition dict to the dataclass.

    Accepts the camelCase wire shape (and snake_case aliases, defensively).
    Structural problems raise VALIDATION_FAILED.
    """
    if not isinstance(stored, dict):
        raise ApiException(ErrorCode.VALIDATION_FAILED, "definition must be an object.")

    tier_raw = _pick(stored, "tierCeilingPercent", "tier_ceiling_percent")
    cat_raw = _pick(stored, "categoryCeilingPercent", "category_ceiling_percent")
    manager_raw = _pick(stored, "manager")
    finance_raw = _pick(stored, "finance")
    if not isinstance(tier_raw, dict):
        raise ApiException(
            ErrorCode.VALIDATION_FAILED, "Configure a ceiling for every customer tier."
        )
    if cat_raw is None:
        cat_raw = {}
    if not isinstance(cat_raw, dict):
        raise ApiException(ErrorCode.VALIDATION_FAILED, "categoryCeilingPercent must be an object.")

    tiers: dict[str, Decimal] = {}
    for key, val in tier_raw.items():
        upper = str(key).upper()
        if upper not in CUSTOMER_TIERS:
            raise ApiException(ErrorCode.VALIDATION_FAILED, f'"{key}" is not a valid CustomerTier.')
        percent = _dec_or_none(val, f"The {upper} ceiling")
        if percent is None:
            raise ApiException(
                ErrorCode.VALIDATION_FAILED, f"The {upper} ceiling must be between 0% and 100%."
            )
        tiers[upper] = percent
    cats: dict[str, Decimal] = {}
    for key, val in cat_raw.items():
        percent = _dec_or_none(val, f"The {key} ceiling")
        if percent is None:
            raise ApiException(
                ErrorCode.VALIDATION_FAILED, f"The {key} ceiling must be between 0% and 100%."
            )
        cats[str(key)] = percent

    manager = None
    if isinstance(manager_raw, dict):
        manager = ManagerTriggers(
            any_positive_excess=bool(
                _pick(manager_raw, "anyPositiveExcess", "any_positive_excess",) or False
            ),
            aggregate_discount_percent_above=_dec_or_none(
                _pick(manager_raw, "aggregateDiscountPercentAbove", "aggregate_discount_percent_above"),
                "manager.aggregateDiscountPercentAbove",
            ),
            aggregate_margin_percent_below=_dec_or_none(
                _pick(manager_raw, "aggregateMarginPercentBelow", "aggregate_margin_percent_below"),
                "manager.aggregateMarginPercentBelow",
            ),
        )
    finance = None
    if isinstance(finance_raw, dict):
        finance = FinanceTriggers(
            worst_line_excess_pp_at_least=_dec_or_none(
                _pick(finance_raw, "worstLineExcessPpAtLeast", "worst_line_excess_pp_at_least"),
                "finance.worstLineExcessPpAtLeast",
            ),
            weighted_excess_pp_at_least=_dec_or_none(
                _pick(finance_raw, "weightedExcessPpAtLeast", "weighted_excess_pp_at_least"),
                "finance.weightedExcessPpAtLeast",
            ),
            excess_value_minor_at_least=_int_or_none(
                _pick(finance_raw, "excessValueMinorAtLeast", "excess_value_minor_at_least"),
                "finance.excessValueMinorAtLeast",
            ),
            aggregate_margin_percent_below=_dec_or_none(
                _pick(finance_raw, "aggregateMarginPercentBelow", "aggregate_margin_percent_below"),
                "finance.aggregateMarginPercentBelow",
            ),
            non_positive_line_contribution=bool(
                _pick(finance_raw, "nonPositiveLineContribution", "non_positive_line_contribution")
                or False
            ),
        )
    return DiscountPolicyDefinition(
        tier_ceiling_percent=tiers,
        category_ceiling_percent=cats,
        manager=manager,  # type: ignore[arg-type]
        finance=finance,  # type: ignore[arg-type]
    )


def validate_definition(definition: DiscountPolicyDefinition) -> None:
    """Reject a policy that cannot be applied consistently (mirror of Java)."""
    if not definition.tier_ceiling_percent:
        raise ApiException(
            ErrorCode.VALIDATION_FAILED, "Configure a ceiling for every customer tier."
        )
    for tier, percent in definition.tier_ceiling_percent.items():
        if percent is None or percent < 0 or percent > 100:
            raise ApiException(
                ErrorCode.VALIDATION_FAILED,
                f"The {tier} ceiling must be between 0% and 100%.",
            )
    for code, percent in (definition.category_ceiling_percent or {}).items():
        if percent is None or percent < 0 or percent > 100:
            raise ApiException(
                ErrorCode.VALIDATION_FAILED,
                f"The {code} ceiling must be between 0% and 100%.",
            )
    if definition.manager is None or definition.finance is None:
        raise ApiException(
            ErrorCode.VALIDATION_FAILED,
            "Both manager and finance triggers must be configured.",
        )
    manager_floor = definition.manager.aggregate_margin_percent_below
    finance_floor = definition.finance.aggregate_margin_percent_below
    if manager_floor is not None and finance_floor is not None and finance_floor > manager_floor:
        raise ApiException(
            ErrorCode.VALIDATION_FAILED,
            "The finance margin floor cannot be higher than the manager floor: finance approval "
            "always follows manager approval, never replaces it.",
        )


def _json_num(value: Decimal | None) -> str | None:
    # JSONB via asyncpg only accepts std-json types: persist percents as
    # plain strings (exact; floats would carry binary dust). parse() coerces
    # strings, ints, floats and Decimals alike, so reads are unaffected.
    return None if value is None else format(Decimal(str(value)), "f")


def definition_to_wire(definition: DiscountPolicyDefinition) -> dict:
    """Dataclass -> JSONB-safe dict (percents as strings; wire renders them back)."""
    return {
        "tierCeilingPercent": {k: _json_num(v) for k, v in definition.tier_ceiling_percent.items()},
        "categoryCeilingPercent": {
            k: _json_num(v) for k, v in (definition.category_ceiling_percent or {}).items()
        },
        "manager": {
            "anyPositiveExcess": definition.manager.any_positive_excess,
            "aggregateDiscountPercentAbove": _json_num(
                definition.manager.aggregate_discount_percent_above
            ),
            "aggregateMarginPercentBelow": _json_num(
                definition.manager.aggregate_margin_percent_below
            ),
        }
        if definition.manager is not None
        else None,
        "finance": {
            "worstLineExcessPpAtLeast": _json_num(
                definition.finance.worst_line_excess_pp_at_least
            ),
            "weightedExcessPpAtLeast": _json_num(
                definition.finance.weighted_excess_pp_at_least
            ),
            "excessValueMinorAtLeast": definition.finance.excess_value_minor_at_least,
            "aggregateMarginPercentBelow": _json_num(
                definition.finance.aggregate_margin_percent_below
            ),
            "nonPositiveLineContribution": definition.finance.non_positive_line_contribution,
        }
        if definition.finance is not None
        else None,
    }


# ---------------------------------------------------------------- service ---


async def effective_at(db: AsyncSession, moment: datetime) -> EffectivePolicy:
    row = (
        await db.execute(
            select(DiscountPolicy)
            .where(DiscountPolicy.effective_at <= moment)
            .order_by(desc(DiscountPolicy.effective_at), desc(DiscountPolicy.version_no))
            .limit(1)
        )
    ).scalars().first()
    if row is None:
        raise ApiException(
            ErrorCode.POLICY_NOT_CONFIGURED,
            "No discount policy version is in effect. An administrator must publish one "
            "before quotations can be evaluated.",
        )
    return EffectivePolicy(row.version_no, parse_definition(row.definition), row.effective_at)


async def effective_now(db: AsyncSession) -> EffectivePolicy:
    return await effective_at(db, now_utc())


async def by_version(db: AsyncSession, version_no: int) -> DiscountPolicyDefinition:
    row = (
        await db.execute(select(DiscountPolicy).where(DiscountPolicy.version_no == version_no))
    ).scalars().first()
    if row is None:
        raise ApiException.not_found(f"Discount policy version {version_no}")
    return parse_definition(row.definition)


async def publish(
    db: AsyncSession,
    actor: Actor,
    definition_dict: dict,
    note: str | None = None,
) -> DiscountPolicy:
    if actor.role not in ("ADMIN", "MANAGER"):
        raise ApiException.forbidden()
    definition = parse_definition(definition_dict)
    validate_definition(definition)
    version_no = await nextval(db, DISCOUNT_POLICY_VERSION_SEQ)
    policy = DiscountPolicy(
        version_no=version_no,
        definition=definition_to_wire(definition),
        effective_at=now_utc(),
        note=note,
        created_by_profile_id=None if actor.is_system else actor.profile_id,
    )
    db.add(policy)
    await db.flush()
    await audit_service.record(
        db, actor, "DISCOUNT_POLICY_PUBLISHED", "DiscountPolicy", policy.id,
        after={"versionNo": version_no},
        reason=note,
    )
    return policy


async def history(db: AsyncSession) -> list[DiscountPolicy]:
    return (
        await db.execute(
            select(DiscountPolicy).order_by(desc(DiscountPolicy.version_no))
        )
    ).scalars().all()


def policy_to_wire(policy: DiscountPolicy, *, current: bool) -> dict:
    definition = policy.definition if isinstance(policy.definition, dict) else {}
    return {
        "id": str(policy.id),
        "versionNo": policy.version_no,
        "definition": definition,
        "effectiveAt": policy.effective_at.isoformat() if policy.effective_at else None,
        "note": policy.note,
        "current": current,
    }
