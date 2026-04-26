"""Safely delete known broken communities from the database.

Usage:
    python scripts/cleanup_broken_communities.py --dry-run
    python scripts/cleanup_broken_communities.py --yes-i-have-backup

The script matches exact community names, expands descendants, and uses
the shared community cascade delete service inside one transaction.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services import community as community_svc  # noqa: E402
from backend.services.database import get_db_connection, get_sql_placeholder  # noqa: E402


TARGET_NAMES = ("Travelers", "Steve test")


def main() -> int:
    parser = argparse.ArgumentParser(description="Delete known broken communities safely.")
    parser.add_argument("--dry-run", action="store_true", help="Only print what would be deleted.")
    parser.add_argument("--yes-i-have-backup", action="store_true", help="Required for destructive deletion.")
    args = parser.parse_args()

    if not args.dry_run and not args.yes_i_have_backup:
        print("Refusing to delete without --yes-i-have-backup. Run --dry-run first.")
        return 2

    with get_db_connection() as conn:
        c = conn.cursor()
        matches = _load_matches(c)
        report = {
            "target_names": TARGET_NAMES,
            "matches": matches,
            "dry_run": bool(args.dry_run),
        }
        print(json.dumps(report, indent=2, default=str))

        if args.dry_run or not matches:
            return 0

        deleted: List[int] = []
        try:
            for match in matches:
                for community_id in match["delete_order"]:
                    deleted_count = community_svc.delete_community_cascade(c, int(community_id))
                    if deleted_count != 1:
                        conn.rollback()
                        print(f"Community {community_id} not removed (rowcount={deleted_count})")
                        return 1
                    deleted.append(int(community_id))
            conn.commit()
        except Exception as exc:
            conn.rollback()
            print(f"Cleanup failed, rolled back: {exc}")
            return 1

    print(json.dumps({"success": True, "deleted_ids": deleted}, indent=2))
    return 0


def _load_matches(cursor) -> List[Dict[str, Any]]:
    ph = get_sql_placeholder()
    placeholders = ", ".join([ph] * len(TARGET_NAMES))
    cursor.execute(
        f"""
        SELECT id, name, creator_username, parent_community_id, tier,
               stripe_subscription_id, subscription_status
        FROM communities
        WHERE LOWER(name) IN ({placeholders})
        ORDER BY name ASC, id ASC
        """,
        tuple(name.lower() for name in TARGET_NAMES),
    )
    rows = cursor.fetchall() or []
    matches: List[Dict[str, Any]] = []
    for row in rows:
        community_id = int(_value(row, "id", 0) or 0)
        descendants = community_svc.get_descendant_community_ids(cursor, community_id)
        matches.append({
            "id": community_id,
            "name": _value(row, "name", 1),
            "creator_username": _value(row, "creator_username", 2),
            "parent_community_id": _value(row, "parent_community_id", 3),
            "tier": _value(row, "tier", 4),
            "stripe_subscription_id": _value(row, "stripe_subscription_id", 5),
            "subscription_status": _value(row, "subscription_status", 6),
            "delete_order": descendants,
        })
    return matches


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
