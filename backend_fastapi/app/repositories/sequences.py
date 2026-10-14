"""Sequence helpers — nextval() for reference/number sequences."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import SCHEMA

QUOTE_REFERENCE_SEQ = f"{SCHEMA}.quote_reference_seq"
ORDER_REFERENCE_SEQ = f"{SCHEMA}.order_reference_seq"
INVOICE_NUMBER_SEQ = f"{SCHEMA}.invoice_number_seq"
PAYMENT_REFERENCE_SEQ = f"{SCHEMA}.payment_reference_seq"
CREDIT_NOTE_REFERENCE_SEQ = f"{SCHEMA}.credit_note_reference_seq"
REFUND_REFERENCE_SEQ = f"{SCHEMA}.refund_reference_seq"
DISCOUNT_POLICY_VERSION_SEQ = f"{SCHEMA}.discount_policy_version_seq"


async def nextval(db: AsyncSession, sequence: str) -> int:
    return int((await db.execute(text(f"SELECT nextval('{sequence}')"))).scalar_one())
