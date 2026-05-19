#!/usr/bin/env python3
"""Delete posts (and common dependents) for a community. Defaults to --dry-run.

Example:
  python scripts/delete_community_posts.py --community-id 42 --dry-run
  python scripts/delete_community_posts.py --community-id 42 --post-ids 1,2,3 --execute

Requires SQLITE_DB_PATH / MySQL env vars like the main app.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

# Load app env (optional)
try:
    from dotenv import load_dotenv  # type: ignore

    load_dotenv(_REPO / ".env")
except Exception:
    pass

os.chdir(_REPO)

from backend.services.database import get_db_connection, get_sql_placeholder  # noqa: E402


def _row_id(row) -> int:
    if hasattr(row, "keys"):
        return int(row["id"])
    return int(row[0])


def _post_ids_for_community(cur, community_id: int, only_ids: list[int] | None) -> list[int]:
    ph = get_sql_placeholder()
    if only_ids:
        placeholders = ",".join([ph for _ in only_ids])
        cur.execute(
            f"SELECT id FROM posts WHERE community_id = {ph} AND id IN ({placeholders})",
            tuple([community_id] + only_ids),
        )
    else:
        cur.execute(f"SELECT id FROM posts WHERE community_id = {ph}", (community_id,))
    return [_row_id(r) for r in cur.fetchall() or []]


def _delete_for_posts(cur, post_ids: list[int], *, execute: bool) -> None:
    if not post_ids:
        print("No matching posts.")
        return
    ph = get_sql_placeholder()
    in_list = ",".join([ph for _ in post_ids])
    tup = tuple(post_ids)

    cur.execute(f"SELECT id FROM polls WHERE post_id IN ({in_list})", tup)
    poll_ids = [_row_id(r) for r in cur.fetchall() or []]
    if poll_ids:
        pin = ",".join([ph for _ in poll_ids])
        pt = tuple(poll_ids)
        cur.execute(f"SELECT id FROM poll_options WHERE poll_id IN ({pin})", pt)
        option_ids = [_row_id(r) for r in cur.fetchall() or []]
        if option_ids:
            oin = ",".join([ph for _ in option_ids])
            sql_pv = f"DELETE FROM poll_votes WHERE option_id IN ({oin})"
            print(f"poll_votes: {sql_pv} count={len(option_ids)}")
            if execute:
                cur.execute(sql_pv, tuple(option_ids))
            sql_po = f"DELETE FROM poll_options WHERE poll_id IN ({pin})"
            print(f"poll_options: {sql_po}")
            if execute:
                cur.execute(sql_po, pt)
        sql_polls = f"DELETE FROM polls WHERE post_id IN ({in_list})"
        print(f"polls: {sql_polls} posts={len(post_ids)}")
        if execute:
            cur.execute(sql_polls, tup)

    for table in ("reactions", "replies", "post_views"):
        sql = f"DELETE FROM {table} WHERE post_id IN ({in_list})"
        print(f"{table}: {len(post_ids)} post(s)")
        if execute:
            cur.execute(sql, tup)

    sql_posts = f"DELETE FROM posts WHERE id IN ({in_list})"
    print(f"posts: DELETE {len(post_ids)} row(s)")
    if execute:
        cur.execute(sql_posts, tup)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--community-id", type=int, required=True)
    ap.add_argument("--post-ids", type=str, help="Comma-separated; default all in community")
    ap.add_argument("--dry-run", action="store_true", help="Print actions only (default if not --execute)")
    ap.add_argument("--execute", action="store_true", help="Perform deletes")
    args = ap.parse_args()
    only: list[int] | None = None
    if args.post_ids:
        only = [int(x.strip()) for x in args.post_ids.split(",") if x.strip().isdigit()]
        if not only:
            print("No valid ids in --post-ids", file=sys.stderr)
            return 2
    execute = bool(args.execute)
    if args.dry_run:
        execute = False

    conn = get_db_connection()
    try:
        c = conn.cursor()
        ids = _post_ids_for_community(c, args.community_id, only)
        print(f"community_id={args.community_id} posts matched: {len(ids)} -> {ids[:50]}{'…' if len(ids) > 50 else ''}")
        _delete_for_posts(c, ids, execute=execute)
        if hasattr(conn, "commit") and execute:
            conn.commit()
    finally:
        try:
            conn.close()
        except Exception:
            pass
    print("Done." + ("" if execute else " (dry-run; pass --execute to delete)"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
