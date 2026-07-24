"""Put a community on the Enterprise tier (and record its Steve clause).

Enterprise is sales-assisted: there is no self-serve checkout and no admin-web
screen, so promoting a community is an operator action. This script is the
safe way to do it — it prints the full before/after picture (tier, owner plan,
member count, Steve package state) and refuses to write unless you pass
``--commit``.

Two independent clauses:

  * **tier = enterprise** lifts the member cap unconditionally. Both cap
    helpers (``ensure_community_tier_member_capacity`` on the community's own
    tier and ``ensure_free_parent_member_capacity`` on the owner's personal
    plan) short-circuit on Enterprise.
  * **--steve on|off|default** records ``communities.enterprise_steve_included``.
    ``off`` means the deal buys the size only: joining members get **no**
    Enterprise seat (no free Premium Steve), and the owner still sees the
    normal Steve Community Package add-on path. ``default`` clears the
    override so the ``community-tiers`` KB policy decides.

Community-feed Steve is not affected by the tier either way — it keys off the
``steve_package_*`` subscription columns, so an expired package trial stays
expired.

Usage (dry run first — the default):

    python scripts/set_community_enterprise.py --community TAPAIRPORTUGAL --steve off
    python scripts/set_community_enterprise.py --community TAPAIRPORTUGAL --steve off --commit

``--community`` matches the display name or the @handle (case-insensitive);
``--community-id`` takes the numeric id when the name is ambiguous.
"""

from __future__ import annotations

import argparse
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("set_enterprise")

_STEVE_CHOICES = {"on": True, "off": False, "default": None}


def _rows_to_dicts(cursor, rows):
    if not rows:
        return []
    if hasattr(rows[0], "keys"):
        return [dict(r) for r in rows]
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, r)) for r in rows]


def _find_communities(cursor, ph: str, *, name: str | None, community_id: int | None):
    if community_id:
        cursor.execute(
            "SELECT id, name, tier, creator_username, parent_community_id "
            f"FROM communities WHERE id = {ph}",
            (community_id,),
        )
    else:
        cursor.execute(
            "SELECT id, name, tier, creator_username, parent_community_id "
            "FROM communities "
            f"WHERE LOWER(name) = LOWER({ph}) OR LOWER(COALESCE(handle, '')) = LOWER({ph})",
            (name, (name or "").lstrip("@")),
        )
    return _rows_to_dicts(cursor, cursor.fetchall() or [])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--community", help="Display name or @handle.")
    ap.add_argument("--community-id", type=int, help="Numeric community id.")
    ap.add_argument(
        "--steve",
        choices=sorted(_STEVE_CHOICES),
        default="off",
        help="Does this Enterprise deal include Steve? (default: off)",
    )
    ap.add_argument("--commit", action="store_true", help="Actually write (default is dry-run).")
    args = ap.parse_args()

    if not args.community and not args.community_id:
        ap.error("pass --community or --community-id")

    from backend.services import community_billing, enterprise_membership
    from backend.services.database import get_db_connection, get_sql_placeholder

    # Guarantees tier + enterprise_steve_included exist before we write.
    enterprise_membership.ensure_tables()
    community_billing.ensure_tables()

    ph = get_sql_placeholder()
    steve_included = _STEVE_CHOICES[args.steve]

    with get_db_connection() as conn:
        cur = conn.cursor()
        matches = _find_communities(
            cur, ph, name=args.community, community_id=args.community_id
        )
        if not matches:
            log.error("No community matched %r.", args.community or args.community_id)
            return 1
        if len(matches) > 1:
            log.error("Ambiguous — %d communities matched. Re-run with --community-id:", len(matches))
            for m in matches:
                log.error("  id=%s name=%r tier=%s owner=%s", m["id"], m["name"], m["tier"], m["creator_username"])
            return 1

        community = matches[0]
        cid = int(community["id"])
        if community.get("parent_community_id"):
            log.error(
                "id=%s is a sub-community of %s — tier lives on the root network.",
                cid, community["parent_community_id"],
            )
            return 1

        cur.execute(f"SELECT COUNT(*) FROM user_communities WHERE community_id = {ph}", (cid,))
        row = cur.fetchone()
        member_count = int((list(row.values())[0] if hasattr(row, "keys") else row[0]) or 0)

        owner = community.get("creator_username") or ""
        owner_sub = "?"
        if owner:
            cur.execute(f"SELECT subscription FROM users WHERE username = {ph}", (owner,))
            orow = cur.fetchone()
            if orow:
                owner_sub = str((orow["subscription"] if hasattr(orow, "keys") else orow[0]) or "free")

        cur.execute(
            f"SELECT COUNT(*) FROM user_enterprise_seats WHERE community_id = {ph} AND ended_at IS NULL",
            (cid,),
        )
        srow = cur.fetchone()
        live_seats = int((list(srow.values())[0] if hasattr(srow, "keys") else srow[0]) or 0)

    state = community_billing.get_billing_state(cid) or {}

    log.info("Community          : %s (id=%s)", community["name"], cid)
    log.info("Owner              : %s (personal plan: %s)", owner or "—", owner_sub)
    log.info("Members            : %s", member_count)
    log.info("Tier               : %s  ->  enterprise", community.get("tier") or "free")
    log.info(
        "Steve clause       : %s  ->  %s",
        enterprise_membership.steve_override_for(cid),
        steve_included if steve_included is not None else "KB policy",
    )
    log.info("Live seats today   : %s", live_seats)
    log.info(
        "Steve package      : %s (status=%s, ends=%s, active=%s)",
        state.get("steve_package_stripe_subscription_id") or "none",
        state.get("steve_package_subscription_status") or "—",
        state.get("steve_package_current_period_end") or "—",
        bool(state.get("steve_package_subscription_active")),
    )

    if live_seats and steve_included is False:
        log.warning(
            "NOTE: %s live seat(s) exist. This script does not close them — use "
            "POST /api/admin/enterprise/communities/%s/tier with steve_included=off "
            "so each seat ends with the standard grace window.",
            live_seats, cid,
        )

    if not args.commit:
        log.info("")
        log.info("Dry run — nothing written. Re-run with --commit to apply.")
        return 0

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE communities SET tier = 'enterprise', enterprise_steve_included = {ph} WHERE id = {ph}",
            (None if steve_included is None else (1 if steve_included else 0), cid),
        )
        try:
            conn.commit()
        except Exception:
            pass

    log.info("")
    log.info(
        "Applied: id=%s is now tier=enterprise, enterprise_steve_included=%s.",
        cid, enterprise_membership.steve_override_for(cid),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
