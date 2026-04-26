"""Backfill community names onto existing Stripe community subscriptions.

Usage:
    python scripts/backfill_stripe_subscription_descriptions.py --dry-run
    python scripts/backfill_stripe_subscription_descriptions.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.database import get_db_connection  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Stamp community names on Stripe subscriptions.")
    parser.add_argument("--dry-run", action="store_true", help="Only print the updates that would be sent.")
    parser.add_argument("--apply", action="store_true", help="Apply updates to Stripe.")
    args = parser.parse_args()

    if not args.dry_run and not args.apply:
        args.dry_run = True
    if args.apply and args.dry_run:
        print("Choose either --dry-run or --apply, not both.")
        return 2

    rows = _load_community_subscriptions()
    report = {"dry_run": bool(args.dry_run), "count": len(rows), "subscriptions": rows}
    print(json.dumps(report, indent=2, default=str))

    if args.dry_run or not rows:
        return 0

    api_key = (os.getenv("STRIPE_API_KEY") or "").strip()
    if not api_key or api_key == "sk_test_your_stripe_key":
        print("STRIPE_API_KEY is not configured.")
        return 2

    try:
        import stripe  # type: ignore
    except Exception as exc:
        print(f"stripe package is unavailable: {exc}")
        return 2

    stripe.api_key = api_key
    updated: List[Dict[str, Any]] = []
    for row in rows:
        subscription_id = row["stripe_subscription_id"]
        metadata = {
            "sku": "community_tier",
            "community_id": str(row["id"]),
            "community_name": _metadata_value(row["name"]),
            "tier_code": str(row["tier"] or ""),
        }
        description = _description(row)
        try:
            current = stripe.Subscription.retrieve(subscription_id)
            existing = dict((current.get("metadata") if hasattr(current, "get") else getattr(current, "metadata", {})) or {})
            stripe.Subscription.modify(
                subscription_id,
                description=description,
                metadata={**existing, **metadata},
            )
            updated.append({"id": row["id"], "subscription_id": subscription_id, "description": description})
        except Exception as exc:
            print(json.dumps({"success": False, "failed": row, "error": str(exc)}, indent=2, default=str))
            return 1

    print(json.dumps({"success": True, "updated": updated}, indent=2, default=str))
    return 0


def _load_community_subscriptions() -> List[Dict[str, Any]]:
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """
            SELECT id, name, creator_username, tier, stripe_subscription_id
            FROM communities
            WHERE COALESCE(stripe_subscription_id, '') <> ''
            ORDER BY id ASC
            """
        )
        rows = c.fetchall() or []
    return [
        {
            "id": int(_value(row, "id", 0) or 0),
            "name": str(_value(row, "name", 1) or ""),
            "owner": str(_value(row, "creator_username", 2) or ""),
            "tier": str(_value(row, "tier", 3) or ""),
            "stripe_subscription_id": str(_value(row, "stripe_subscription_id", 4) or ""),
            "description": _description({
                "name": _value(row, "name", 1),
                "tier": _value(row, "tier", 3),
            }),
        }
        for row in rows
        if _value(row, "stripe_subscription_id", 4)
    ]


def _description(row: Dict[str, Any]) -> str:
    name = str(row.get("name") or "Unknown community").strip()
    tier = str(row.get("tier") or "").strip()
    return f'Community "{name}" - {tier or "paid tier"}'


def _metadata_value(value: Any) -> str:
    return str(value or "").strip()[:500]


def _value(row: Any, key: str, idx: int) -> Any:
    if hasattr(row, "keys") and key in row.keys():
        return row[key]
    if isinstance(row, dict):
        return row.get(key)
    if isinstance(row, (list, tuple)) and len(row) > idx:
        return row[idx]
    return None


if __name__ == "__main__":
    raise SystemExit(main())
