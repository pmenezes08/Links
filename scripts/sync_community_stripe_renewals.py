#!/usr/bin/env python3
"""Repair missing ``current_period_end`` for community tier Stripe subscriptions.

Examples::

    # Dry-run: print roots that look broken (paid/enterprise + active-ish but bad renewal)
    python scripts/sync_community_stripe_renewals.py --audit-only

    # Sync one community root id (writes DB via Stripe retrieve)
    python scripts/sync_community_stripe_renewals.py --community-id 123

Requires ``STRIPE_API_KEY`` in the environment (same as the API).
"""

from __future__ import annotations

import argparse
import os
import sys

# Repo root on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.services.database import get_db_connection  # noqa: E402
from backend.services.stripe_subscription_sync import (  # noqa: E402
    sync_community_tier_subscription_from_stripe,
)
from backend.services.subscription_health import (  # noqa: E402
    RENEWAL_VALID,
    derive_community_subscription_health,
)
from backend.services import community_billing  # noqa: E402


def _audit_rows():
    ph = get_sql_placeholder()
    q = f"""
        SELECT id, tier, stripe_subscription_id, subscription_status, current_period_end
        FROM communities
        WHERE parent_community_id IS NULL
          AND COALESCE(stripe_subscription_id, '') <> ''
          AND LOWER(COALESCE(subscription_status, '')) IN ('active', 'trialing')
    """
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(q)
        rows = c.fetchall() or []
    out = []
    for row in rows:
        cid = int(row["id"] if hasattr(row, "keys") else row[0])
        state = community_billing.get_billing_state(cid) or {}
        health = derive_community_subscription_health(
            state,
            enterprise_steve_package_included=False,
        )
        rs = health.get("renewal_date_status")
        if rs != RENEWAL_VALID:
            out.append((cid, rs, health))
    return out


def main() -> int:
    p = argparse.ArgumentParser(description="Community Stripe renewal sync / audit")
    p.add_argument("--audit-only", action="store_true", help="Print IDs needing attention")
    p.add_argument("--community-id", type=int, default=0, help="Sync a single root community")
    args = p.parse_args()

    if args.audit_only:
        bad = _audit_rows()
        print(f"Communities with Stripe id + active/trialing but renewal not valid: {len(bad)}")
        for cid, rs, health in bad:
            print(f"  id={cid} renewal_date_status={rs} tier_active={health.get('tier_subscription_active')}")
        return 0

    if args.community_id <= 0:
        print("Specify --community-id or use --audit-only", file=sys.stderr)
        return 2

    result = sync_community_tier_subscription_from_stripe(args.community_id)
    print(result)
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
