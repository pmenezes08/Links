"""Re-parent a community under a new parent (operator action).

Built for the TAP Air Portugal reorg (2026-07-24): the owner's existing
"PNT" community must become a sub-community of "TAP Air Portugal", and the
in-app path (Edit Community → Parent community) isn't workable for him.
This does exactly what that form does — set ``parent_community_id`` — plus
the invariant the form relies on the server for: **sub-communities carry no
@handle**, so when a root becomes a sub its handle is cleared (the address
frees up; a future re-root gets a fresh handle from the backfill).

Checks before writing:
  * both communities exist; prints name/owner/parent/handle for each
  * refuses to create a cycle (new parent must not be a descendant of the
    community being moved, or itself)
  * warns when the community has billing rows (tier/Stripe state lives on
    roots; moving a paying root under another root is almost never right)

Dry-run by default; ``--commit`` writes.

Usage:
    python scripts/move_community_parent.py --community-id 301 --new-parent-id 303
    python scripts/move_community_parent.py --community-id 301 --new-parent-id 303 --commit
"""

from __future__ import annotations

import argparse
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("move_parent")


def _row_to_dict(cursor, row):
    if row is None:
        return None
    if hasattr(row, "keys"):
        return dict(row)
    cols = [d[0] for d in cursor.description]
    return dict(zip(cols, row))


def _fetch(cursor, ph, community_id: int):
    cursor.execute(
        "SELECT id, name, creator_username, parent_community_id, handle, tier, "
        "stripe_subscription_id, subscription_status "
        f"FROM communities WHERE id = {ph}",
        (community_id,),
    )
    return _row_to_dict(cursor, cursor.fetchone())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--community-id", type=int, required=True, help="Community to move.")
    ap.add_argument("--new-parent-id", type=int, required=True, help="New parent community id.")
    ap.add_argument("--commit", action="store_true", help="Actually write (default is dry-run).")
    args = ap.parse_args()

    if args.community_id == args.new_parent_id:
        log.error("A community cannot be its own parent.")
        return 1

    from backend.services.community import resolve_root_community_id
    from backend.services.database import get_db_connection, get_sql_placeholder

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        cur = conn.cursor()
        child = _fetch(cur, ph, args.community_id)
        parent = _fetch(cur, ph, args.new_parent_id)

    if not child:
        log.error("Community %s not found.", args.community_id)
        return 1
    if not parent:
        log.error("New parent %s not found.", args.new_parent_id)
        return 1

    # Cycle guard: the new parent's root walk must not pass through the child.
    probe = parent
    hops = 0
    with get_db_connection() as conn:
        cur = conn.cursor()
        while probe and probe.get("parent_community_id") and hops < 16:
            if int(probe["parent_community_id"]) == int(child["id"]):
                log.error(
                    "Refusing: %s is a descendant of %s — this move would create a cycle.",
                    parent["id"], child["id"],
                )
                return 1
            probe = _fetch(cur, ph, int(probe["parent_community_id"]))
            hops += 1

    root_id, _ = resolve_root_community_id(int(parent["id"]))

    log.info("Move       : %r (id=%s, owner=%s)", child["name"], child["id"], child["creator_username"])
    log.info("Old parent : %s", child.get("parent_community_id") or "— (root community)")
    log.info("New parent : %r (id=%s, owner=%s)", parent["name"], parent["id"], parent["creator_username"])
    log.info("New root   : %s", root_id)

    clears_handle = bool(child.get("handle"))
    if clears_handle:
        log.info(
            "Handle     : @%s will be CLEARED — sub-communities carry no handle; "
            "the address frees up for reuse.",
            child["handle"],
        )
    if child.get("stripe_subscription_id") or (child.get("tier") or "free") != "free":
        log.warning(
            "WARNING: community %s has billing state (tier=%s, stripe sub=%s). "
            "Billing lives on roots — moving it under another root will make the "
            "tree inherit %s's billing instead. Double-check this is intended.",
            child["id"], child.get("tier"), child.get("stripe_subscription_id"), root_id,
        )

    if not args.commit:
        log.info("")
        log.info("Dry run — nothing written. Re-run with --commit to apply.")
        return 0

    with get_db_connection() as conn:
        cur = conn.cursor()
        if clears_handle:
            cur.execute(
                f"UPDATE communities SET parent_community_id = {ph}, handle = NULL WHERE id = {ph}",
                (int(parent["id"]), int(child["id"])),
            )
        else:
            cur.execute(
                f"UPDATE communities SET parent_community_id = {ph} WHERE id = {ph}",
                (int(parent["id"]), int(child["id"])),
            )
        try:
            conn.commit()
        except Exception:
            pass
        moved = _fetch(cur, ph, int(child["id"]))

    log.info("")
    log.info(
        "Applied: %r (id=%s) now has parent_community_id=%s%s.",
        moved["name"], moved["id"], moved["parent_community_id"],
        ", handle cleared" if clears_handle else "",
    )
    log.info("Members may need a pull-to-refresh for cached dashboards to update.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
