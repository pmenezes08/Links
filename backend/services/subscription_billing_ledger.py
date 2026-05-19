"""Stripe invoice payment ledger for subscription reporting.

The Stripe customer/subscription rows tell us what is active now. This
ledger stores actual paid invoice amounts so admin reporting can show
YTD and lifetime spend without estimating from plan prices.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional

from backend.services import community_billing, user_billing
from backend.services.database import get_db_connection, get_sql_placeholder


logger = logging.getLogger(__name__)


def ensure_tables() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS subscription_invoice_payments (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    stripe_invoice_id VARCHAR(96) NOT NULL,
                    stripe_customer_id VARCHAR(96) NULL,
                    stripe_subscription_id VARCHAR(96) NULL,
                    username VARCHAR(191) NULL,
                    community_id INT NULL,
                    amount_paid_cents INT NOT NULL DEFAULT 0,
                    currency VARCHAR(8) NULL,
                    paid_at DATETIME NULL,
                    period_start DATETIME NULL,
                    period_end DATETIME NULL,
                    metadata_json TEXT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_subscription_invoice_payments_invoice (stripe_invoice_id),
                    INDEX idx_subscription_invoice_payments_username (username, paid_at),
                    INDEX idx_subscription_invoice_payments_community (community_id, paid_at)
                )
                """
            )
        except Exception:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS subscription_invoice_payments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    stripe_invoice_id VARCHAR(96) NOT NULL UNIQUE,
                    stripe_customer_id VARCHAR(96) NULL,
                    stripe_subscription_id VARCHAR(96) NULL,
                    username VARCHAR(191) NULL,
                    community_id INTEGER NULL,
                    amount_paid_cents INTEGER NOT NULL DEFAULT 0,
                    currency VARCHAR(8) NULL,
                    paid_at DATETIME NULL,
                    period_start DATETIME NULL,
                    period_end DATETIME NULL,
                    metadata_json TEXT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        try:
            conn.commit()
        except Exception:
            pass


def record_invoice_payment(invoice: Dict[str, Any]) -> bool:
    """Persist one paid Stripe invoice. Returns True when inserted."""
    invoice_id = str(invoice.get("id") or "").strip()
    if not invoice_id:
        return False
    amount = _int_or_zero(invoice.get("amount_paid"))
    if amount <= 0:
        return False

    subscription_id = _extract_subscription_id(invoice)
    customer_id = _extract_customer_id(invoice)
    username, community_id = _resolve_owner(invoice, subscription_id)
    period_start, period_end = _extract_period(invoice)
    paid_at = _coerce_datetime(
        ((invoice.get("status_transitions") or {}).get("paid_at"))
        or invoice.get("created")
    )

    ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT id FROM subscription_invoice_payments WHERE stripe_invoice_id = {ph}",
                (invoice_id,),
            )
            if c.fetchone():
                return False
            c.execute(
                f"""
                INSERT INTO subscription_invoice_payments
                    (stripe_invoice_id, stripe_customer_id, stripe_subscription_id,
                     username, community_id, amount_paid_cents, currency, paid_at,
                     period_start, period_end, metadata_json)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                """,
                (
                    invoice_id,
                    customer_id,
                    subscription_id,
                    username,
                    community_id,
                    amount,
                    str(invoice.get("currency") or "").upper() or None,
                    paid_at,
                    period_start,
                    period_end,
                    json.dumps(_safe_metadata(invoice)),
                ),
            )
            conn.commit()
            return True
        except Exception:
            logger.exception("record_invoice_payment failed for invoice %s", invoice_id)
            return False


def totals_for_user(username: str) -> Dict[str, int]:
    if not username:
        return {"spent_total_cents": 0, "spent_ytd_cents": 0}
    return _totals("username", username)


def totals_for_community(community_id: int) -> Dict[str, int]:
    if not community_id:
        return {"spent_total_cents": 0, "spent_ytd_cents": 0}
    return _totals("community_id", int(community_id))


def _totals(column: str, value: Any) -> Dict[str, int]:
    ensure_tables()
    ph = get_sql_placeholder()
    year_start = f"{datetime.utcnow().year}-01-01 00:00:00"
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            comparator = f"LOWER({column}) = LOWER({ph})" if column == "username" else f"{column} = {ph}"
            c.execute(
                f"""
                SELECT
                    COALESCE(SUM(amount_paid_cents), 0) AS total,
                    COALESCE(SUM(CASE WHEN paid_at >= {ph} THEN amount_paid_cents ELSE 0 END), 0) AS ytd
                FROM subscription_invoice_payments
                WHERE {comparator}
                """,
                (year_start, value),
            )
            row = c.fetchone()
        except Exception:
            logger.exception("subscription billing totals failed for %s=%s", column, value)
            return {"spent_total_cents": 0, "spent_ytd_cents": 0}
    return {
        "spent_total_cents": _int_or_zero(_row_value(row, "total", 0)),
        "spent_ytd_cents": _int_or_zero(_row_value(row, "ytd", 1)),
    }


def _resolve_owner(invoice: Dict[str, Any], subscription_id: Optional[str]) -> tuple[Optional[str], Optional[int]]:
    metadata = _invoice_metadata(invoice)
    sku = str(metadata.get("sku") or metadata.get("plan_id") or "").lower()
    if sku == "community_tier":
        community_id = _int_or_none(metadata.get("community_id"))
        if community_id:
            return str(metadata.get("username") or "") or None, community_id
    if subscription_id:
        community_id = community_billing.find_by_subscription_id(subscription_id)
        if community_id:
            return str(metadata.get("username") or "") or None, community_id
        username = user_billing.find_by_subscription_id(subscription_id)
        if username:
            return username, None
    username = metadata.get("username")
    return (str(username), None) if username else (None, None)


def _extract_subscription_id(invoice: Dict[str, Any]) -> Optional[str]:
    raw = invoice.get("subscription")
    if isinstance(raw, dict):
        raw = raw.get("id")
    if not raw:
        raw = ((invoice.get("parent") or {}).get("subscription_details") or {}).get("subscription")
    return str(raw) if raw else None


def _extract_customer_id(invoice: Dict[str, Any]) -> Optional[str]:
    raw = invoice.get("customer")
    if isinstance(raw, dict):
        raw = raw.get("id")
    return str(raw) if raw else None


def _extract_period(invoice: Dict[str, Any]) -> tuple[Optional[str], Optional[str]]:
    lines = ((invoice.get("lines") or {}).get("data") or [])
    if lines:
        period = lines[0].get("period") or {}
        return _coerce_datetime(period.get("start")), _coerce_datetime(period.get("end"))
    return None, None


def _invoice_metadata(invoice: Dict[str, Any]) -> Dict[str, Any]:
    metadata: Dict[str, Any] = {}
    for source in (
        invoice.get("metadata"),
        (invoice.get("subscription_details") or {}).get("metadata"),
        ((invoice.get("parent") or {}).get("subscription_details") or {}).get("metadata"),
    ):
        if isinstance(source, dict):
            metadata.update(source)
    return metadata


def _safe_metadata(invoice: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "metadata": _invoice_metadata(invoice),
        "billing_reason": invoice.get("billing_reason"),
        "hosted_invoice_url": invoice.get("hosted_invoice_url"),
    }


def _coerce_datetime(value: Any) -> Optional[str]:
    if value in (None, "", 0):
        return None
    try:
        return datetime.utcfromtimestamp(int(value)).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        pass
    text = str(value).strip()
    return text or None


def _int_or_none(value: Any) -> Optional[int]:
    try:
        parsed = int(value)
        return parsed if parsed > 0 else None
    except Exception:
        return None


def _int_or_zero(value: Any) -> int:
    try:
        return int(value or 0)
    except Exception:
        return 0


def _row_value(row: Any, key: str, idx: int) -> Any:
    if not row:
        return None
    if hasattr(row, "keys") and key in row.keys():
        return row[key]
    if isinstance(row, dict):
        return row.get(key)
    if isinstance(row, (list, tuple)) and len(row) > idx:
        return row[idx]
    return None
