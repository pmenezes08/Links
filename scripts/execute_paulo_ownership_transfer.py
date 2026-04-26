#!/usr/bin/env python
"""Transfer Paulo-owned communities to admin, keeping Paulo as admin."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.database import get_db_connection, get_sql_placeholder  # noqa: E402


CONFIRM_FLAG = "--yes-i-have-backup"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(CONFIRM_FLAG, action="store_true", dest="confirmed")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.dry_run and not args.confirmed:
        print(f"Refusing to mutate data without {CONFIRM_FLAG}. Run the survey and take a DB backup first.")
        return 2

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        admin_id = _user_id(c, "admin", ph)
        paulo_id = _user_id(c, "paulo", ph)
        if not admin_id or not paulo_id:
            print(json.dumps({"success": False, "error": "admin and paulo users must both exist"}))
            return 1

        c.execute(
            f"SELECT id, name FROM communities WHERE LOWER(creator_username) = LOWER({ph}) ORDER BY id",
            ("paulo",),
        )
        rows = c.fetchall() or []
        community_ids = [_value(row, "id", 0) for row in rows]

        if args.dry_run:
            print(json.dumps({
                "success": True,
                "dry_run": True,
                "would_transfer": [{"id": _value(r, "id", 0), "name": _value(r, "name", 1)} for r in rows],
            }, indent=2))
            return 0

        try:
            now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
            for community_id in community_ids:
                c.execute(
                    f"UPDATE communities SET creator_username = {ph} WHERE id = {ph}",
                    ("admin", community_id),
                )
                _upsert_membership(c, admin_id, community_id, "owner", now, ph)
                _upsert_membership(c, paulo_id, community_id, "admin", now, ph)
            conn.commit()
        except Exception as exc:
            try:
                conn.rollback()
            except Exception:
                pass
            print(json.dumps({"success": False, "error": str(exc)}))
            return 1

    print(json.dumps({"success": True, "transferred_count": len(community_ids), "community_ids": community_ids}))
    return 0


def _user_id(cursor: Any, username: str, ph: str) -> Optional[int]:
    cursor.execute(f"SELECT id FROM users WHERE LOWER(username) = LOWER({ph})", (username,))
    row = cursor.fetchone()
    if not row:
        return None
    return int(_value(row, "id", 0))


def _upsert_membership(cursor: Any, user_id: int, community_id: int, role: str, joined_at: str, ph: str) -> None:
    cursor.execute(
        f"UPDATE user_communities SET role = {ph} WHERE user_id = {ph} AND community_id = {ph}",
        (role, user_id, community_id),
    )
    if getattr(cursor, "rowcount", 0):
        return
    cursor.execute(
        f"""
        INSERT INTO user_communities (user_id, community_id, role, joined_at)
        VALUES ({ph}, {ph}, {ph}, {ph})
        """,
        (user_id, community_id, role, joined_at),
    )


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
