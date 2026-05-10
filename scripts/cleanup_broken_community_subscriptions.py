#!/usr/bin/env python3
"""Audit/reset demo community tier labels that have no Stripe backing.

Default names come from the staging screenshot that showed Paid tiers under
"Needs Attention" despite having no Stripe subscription/customer ids.

Dry-run by default:

    python scripts/cleanup_broken_community_subscriptions.py

Apply:

    python scripts/cleanup_broken_community_subscriptions.py --execute
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any, Iterable

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.services.database import get_db_connection, get_sql_placeholder  # noqa: E402


DEFAULT_NAMES = ("Enterprise Hub", "Growth Network", "Scale Community")
PAID_TIERS = ("paid_l1", "paid_l2", "paid_l3")


def _row_value(row: Any, key: str, index: int) -> Any:
    if hasattr(row, "keys") and key in row.keys():
        return row[key]
    if isinstance(row, dict):
        return row.get(key)
    if isinstance(row, (list, tuple)) and len(row) > index:
        return row[index]
    return None


def _fetch(names: Iterable[str]) -> list[dict[str, Any]]:
    names = tuple(n for n in names if n)
    if not names:
        return []
    ph = get_sql_placeholder()
    placeholders = ", ".join([ph] * len(names))
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT id, name, tier, stripe_subscription_id, stripe_customer_id,
                   subscription_status, current_period_end,
                   steve_package_stripe_subscription_id,
                   steve_package_subscription_status
            FROM communities
            WHERE name IN ({placeholders})
            ORDER BY name, id
            """,
            names,
        )
        rows = c.fetchall() or []
    out: list[dict[str, Any]] = []
    for row in rows:
        out.append({
            "id": _row_value(row, "id", 0),
            "name": _row_value(row, "name", 1),
            "tier": _row_value(row, "tier", 2),
            "stripe_subscription_id": _row_value(row, "stripe_subscription_id", 3),
            "stripe_customer_id": _row_value(row, "stripe_customer_id", 4),
            "subscription_status": _row_value(row, "subscription_status", 5),
            "current_period_end": _row_value(row, "current_period_end", 6),
            "steve_package_stripe_subscription_id": _row_value(row, "steve_package_stripe_subscription_id", 7),
            "steve_package_subscription_status": _row_value(row, "steve_package_subscription_status", 8),
        })
    return out


def _is_reset_candidate(row: dict[str, Any]) -> bool:
    tier = str(row.get("tier") or "").strip().lower()
    return (
        tier in PAID_TIERS
        and not str(row.get("stripe_subscription_id") or "").strip()
        and not str(row.get("stripe_customer_id") or "").strip()
    )


def _reset(ids: list[int]) -> int:
    if not ids:
        return 0
    ph = get_sql_placeholder()
    placeholders = ", ".join([ph] * len(ids))
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            UPDATE communities
            SET tier = 'free',
                stripe_subscription_id = NULL,
                stripe_customer_id = NULL,
                subscription_status = NULL,
                current_period_end = NULL,
                cancel_at_period_end = 0,
                canceled_at = NULL
            WHERE id IN ({placeholders})
              AND COALESCE(stripe_subscription_id, '') = ''
              AND COALESCE(stripe_customer_id, '') = ''
            """,
            tuple(ids),
        )
        count = c.rowcount if c.rowcount is not None else 0
        try:
            conn.commit()
        except Exception:
            pass
    return int(count)


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit/reset broken demo community subscriptions")
    parser.add_argument("--execute", action="store_true", help="Apply reset instead of dry-run")
    parser.add_argument(
        "--name",
        action="append",
        dest="names",
        help="Community name to audit/reset; repeatable. Defaults to screenshot names.",
    )
    args = parser.parse_args()

    try:
        rows = _fetch(args.names or DEFAULT_NAMES)
    except Exception as exc:
        print(f"Could not audit communities with current DB settings: {exc}")
        return 1
    if not rows:
        print("No matching communities found.")
        return 0

    candidates = [r for r in rows if _is_reset_candidate(r)]
    print("Matched communities:")
    for row in rows:
        marker = "RESET_CANDIDATE" if row in candidates else "KEEP"
        print(
            f"  {marker} id={row['id']} name={row['name']!r} tier={row['tier']!r} "
            f"stripe_subscription_id={row['stripe_subscription_id']!r} "
            f"stripe_customer_id={row['stripe_customer_id']!r} "
            f"status={row['subscription_status']!r} "
            f"steve_sub={row['steve_package_stripe_subscription_id']!r}"
        )

    if not args.execute:
        print(f"Dry-run only. Would reset {len(candidates)} row(s).")
        return 0

    changed = _reset([int(r["id"]) for r in candidates if r.get("id")])
    print(f"Reset {changed} row(s) to free tier.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
