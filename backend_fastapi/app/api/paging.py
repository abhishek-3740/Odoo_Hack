"""Paging helper — port of shared/web/Paging.java."""

from __future__ import annotations

from app.core.exceptions import ApiException, ErrorCode

MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 25


def parse_sort(
    sort: str | None, allowed: set[str], default: str = "createdAt"
) -> tuple[str, bool]:
    """Returns (field, descending). Unknown field -> VALIDATION_FAILED."""
    raw = (sort or "").strip()
    if not raw:
        return default, True
    parts = [p.strip() for p in raw.split(",")]
    field = parts[0] or default
    descending = True
    if len(parts) > 1:
        direction = parts[1].lower()
        if direction not in ("asc", "desc"):
            raise ApiException(
                ErrorCode.VALIDATION_FAILED,
                "The request could not be read.",
                {"fields": {"sort": "use 'field,asc' or 'field,desc'"}, "allowed": sorted(allowed)},
            )
        descending = direction == "desc"
    if field not in allowed:
        raise ApiException(
            ErrorCode.VALIDATION_FAILED,
            "The request could not be read.",
            {"fields": {"sort": f"unknown sort field '{field}'"}, "allowed": sorted(allowed)},
        )
    return field, descending


def page_size_or_default(size: int | None) -> int:
    if size is None or size <= 0:
        return DEFAULT_PAGE_SIZE
    return min(size, MAX_PAGE_SIZE)


# snake_case column mapping for sort fields used across routers
SORT_COLUMNS = {
    "createdAt": "created_at",
    "updatedAt": "updated_at",
    "lastActivityAt": "last_activity_at",
    "stage": "stage",
    "email": "email",
    "role": "role",
    "name": "name",
    "confirmedAt": "confirmed_at",
    "fulfillmentStatus": "fulfillment_status",
    "issueDate": "issue_date",
    "dueDate": "due_date",
    "recordedAt": "recorded_at",
    "created_at": "created_at",
    "dueAt": "due_at",
    "lastSeenAt": "last_seen_at",
    "firstSeenAt": "first_seen_at",
    "severity": "severity",
}
