#!/usr/bin/env python
"""Read-only survey for communities currently owned by Paulo."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.database import get_db_connection, get_sql_placeholder  # noqa: E402


def main() -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT c.id, c.name, c.creator_username, c.parent_community_id,
                   c.tier, c.subscription_status, c.stripe_customer_id,
                   c.stripe_subscription_id, c.current_period_end,
                   COUNT(uc_all.user_id) AS member_count,
                   MAX(CASE WHEN LOWER(u_admin.username) = 'admin' THEN uc_admin.role END) AS admin_role,
                   MAX(CASE WHEN LOWER(u_paulo.username) = 'paulo' THEN uc_paulo.role END) AS paulo_role
            FROM communities c
            LEFT JOIN user_communities uc_all ON uc_all.community_id = c.id
            LEFT JOIN user_communities uc_admin ON uc_admin.community_id = c.id
            LEFT JOIN users u_admin ON u_admin.id = uc_admin.user_id AND LOWER(u_admin.username) = 'admin'
            LEFT JOIN user_communities uc_paulo ON uc_paulo.community_id = c.id
            LEFT JOIN users u_paulo ON u_paulo.id = uc_paulo.user_id AND LOWER(u_paulo.username) = 'paulo'
            WHERE LOWER(c.creator_username) = LOWER({ph})
            GROUP BY c.id, c.name, c.creator_username, c.parent_community_id,
                     c.tier, c.subscription_status, c.stripe_customer_id,
                     c.stripe_subscription_id, c.current_period_end
            ORDER BY c.parent_community_id IS NOT NULL, c.id
            """,
            ("paulo",),
        )
        rows = c.fetchall() or []

    payload = [_row_to_dict(row) for row in rows]
    print(json.dumps({"count": len(payload), "communities": payload}, indent=2, default=str))
    return 0


def _row_to_dict(row):
    keys = [
        "id", "name", "creator_username", "parent_community_id", "tier",
        "subscription_status", "stripe_customer_id", "stripe_subscription_id",
        "current_period_end", "member_count", "admin_role", "paulo_role",
    ]
    if hasattr(row, "keys"):
        return {k: row[k] for k in keys}
    return {k: row[i] if i < len(row) else None for i, k in enumerate(keys)}


if __name__ == "__main__":
    raise SystemExit(main())
