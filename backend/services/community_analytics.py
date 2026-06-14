"""Owner-facing per-community analytics — the metric registry.

Read-only. Every number the Owner Dashboard shows is a *descriptor* produced
by :func:`build_overview`; the endpoint returns a flat ``metrics`` list so the
client renders declaratively. **Adding a metric later is additive**: append a
descriptor here (+ one i18n label key) and it appears on the dashboard with no
client changes — that is the whole point, so the surface can grow as community
owners give feedback.

Free vs paid is a property of each descriptor (``tier``). Paid metrics on a
free community come back ``locked: true`` with **no value computed** (we never
compute or leak a number the owner hasn't paid for); the client renders the
blurred teaser shell from the descriptor alone. Pricing/tier is read from the
community billing state — never hardcoded here (the KB ``community-tiers`` page
stays the source of truth for what each tier costs and unlocks).

Authorization is the route's job (``is_community_admin`` / owner / app-admin).
This module assumes the caller is already allowed to see ``community_id`` and
only computes aggregates — it does not enforce access.

Steve narration: this module returns the *numbers* and a chosen template key
(``steve``); the client interpolates Steve's voice from the i18n catalogs.
That keeps it zero-AI-cost and free-tier safe. The genuine LLM "Steve's read"
is a separate, entitlement-gated paid surface (later phase), not this.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.onboarding_session import (
    durable_personal_section_complete_from_row,
    durable_professional_section_complete_from_row,
)

logger = logging.getLogger(__name__)

# A brand-new community shows an encouraging "just getting started" state
# instead of a wall of zeros (members at/under this, and no posts yet).
LOW_DATA_MEMBER_THRESHOLD = 5

# Paid teaser metrics shown locked-but-visible on the free tier. These are
# *built* in a later phase; here they only carry their shell so the client can
# render the blurred upgrade teaser. Add/rename freely — additive.
PAID_TEASERS = (
    {"id": "activation", "format": "locked", "label_key": "owner.metric.activation",
     "hint_key": "owner.metric.activation_hint"},
    {"id": "sticking", "format": "locked", "label_key": "owner.metric.sticking",
     "hint_key": "owner.metric.sticking_hint"},
)


def _scalar(cursor, sql: str, params: tuple) -> int:
    """Run a COUNT-style query, returning 0 on any error (missing table, etc.)
    so one absent feature never 500s the whole dashboard."""
    try:
        cursor.execute(sql, params)
        row = cursor.fetchone()
        if not row:
            return 0
        value = row["count"] if hasattr(row, "keys") and "count" in row.keys() else (
            list(row.values())[0] if hasattr(row, "keys") else row[0]
        )
        return int(value or 0)
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("community_analytics scalar failed: %s", exc)
        return 0


def _resolve_tier(community_id: int) -> Dict[str, Any]:
    """Tier + paid flag for the community (root-inherited via billing state).

    Reads the canonical billing state; never hardcodes prices/caps. Returns a
    dict so callers can also surface the member cap when present.
    """
    try:
        from backend.services import community_billing

        state = community_billing.get_billing_state(community_id) or {}
        tier = str(state.get("tier") or "free").strip().lower()
        status = str(state.get("subscription_status") or "").strip().lower()
        is_paid = tier not in ("", "free") and status in ("active", "trialing")
        cap = state.get("member_cap") or state.get("members_cap")
        return {"tier": tier, "is_paid": is_paid, "member_cap": cap}
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("community_analytics tier resolve failed: %s", exc)
        return {"tier": "free", "is_paid": False, "member_cap": None}


def _profile_completion(cursor, ph: str, community_id: int) -> Dict[str, int]:
    """Aggregate member profile completion into none/partial/complete buckets.

    Reuses the canonical per-member section logic from onboarding_session so
    the dashboard and Steve's profile asks agree on what "complete" means.
    Aggregate only — no member is named (privacy invariant).
    """
    complete = partial = none = 0
    try:
        cursor.execute(
            f"""
            SELECT u.role, u.company, p.bio, u.linkedin,
                   u.professional_about, u.personal_highlight_answers
            FROM user_communities uc
            JOIN users u ON uc.user_id = u.id
            LEFT JOIN user_profiles p ON LOWER(u.username) = LOWER(p.username)
            WHERE uc.community_id = {ph}
            """,
            (community_id,),
        )
        for row in cursor.fetchall() or []:
            personal = durable_personal_section_complete_from_row(row)
            professional = durable_professional_section_complete_from_row(row)
            if personal and professional:
                complete += 1
            elif personal or professional:
                partial += 1
            else:
                none += 1
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("community_analytics profile completion failed: %s", exc)
    return {"complete": complete, "partial": partial, "none": none}


def build_overview(community_id: int) -> Optional[Dict[str, Any]]:
    """Build the Owner Dashboard overview payload, or ``None`` if the community
    does not exist. Does NOT authorize — the route must do that first."""
    tier_info = _resolve_tier(community_id)
    is_paid = bool(tier_info["is_paid"])

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()

        c.execute(f"SELECT id, name FROM communities WHERE id = {ph}", (community_id,))
        row = c.fetchone()
        if not row:
            return None
        name = row["name"] if hasattr(row, "keys") else row[1]

        members = _scalar(
            c, f"SELECT COUNT(*) AS count FROM user_communities WHERE community_id = {ph}",
            (community_id,),
        )

        cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
        net_new_7d = _scalar(
            c,
            f"SELECT COUNT(*) AS count FROM user_communities "
            f"WHERE community_id = {ph} AND joined_at >= {ph}",
            (community_id, cutoff),
        )

        subcommunities = _scalar(
            c, f"SELECT COUNT(*) AS count FROM communities WHERE parent_community_id = {ph}",
            (community_id,),
        )
        groups = _scalar(
            c, f"SELECT COUNT(*) AS count FROM `groups` WHERE community_id = {ph}",
            (community_id,),
        )

        invites_sent = _scalar(
            c, f"SELECT COUNT(*) AS count FROM community_invitations WHERE community_id = {ph}",
            (community_id,),
        )
        invites_accepted = _scalar(
            c,
            f"SELECT COUNT(*) AS count FROM community_invitations "
            f"WHERE community_id = {ph} AND LOWER(status) = 'accepted'",
            (community_id,),
        )

        completion = _profile_completion(c, ph, community_id)
        has_posts = _scalar(
            c, f"SELECT COUNT(*) AS count FROM posts WHERE community_id = {ph}",
            (community_id,),
        )

    low_data = members <= LOW_DATA_MEMBER_THRESHOLD and has_posts == 0

    metrics: List[Dict[str, Any]] = [
        {
            "id": "members", "group": "overview", "format": "stat", "tier": "free",
            "label_key": "owner.metric.members", "locked": False,
            "value": {"count": members, "delta_7d": net_new_7d,
                      "cap": tier_info.get("member_cap")},
        },
        {
            "id": "spaces", "group": "overview", "format": "stat", "tier": "free",
            "label_key": "owner.metric.spaces", "locked": False,
            "value": {"subcommunities": subcommunities, "groups": groups},
        },
        {
            "id": "invites", "group": "overview", "format": "funnel", "tier": "free",
            "label_key": "owner.metric.invites", "locked": False,
            "value": {"sent": invites_sent, "accepted": invites_accepted},
        },
        {
            "id": "profile_completion", "group": "overview", "format": "segments",
            "tier": "free", "label_key": "owner.metric.profile_completion",
            "owner_only": True, "locked": False,
            "value": {**completion, "total": members},
        },
    ]

    # Paid teasers: locked-but-visible on free; the value stays None (never
    # computed) until the paid suite lands and the community is paid.
    for teaser in PAID_TEASERS:
        metrics.append({
            "id": teaser["id"], "group": "overview", "format": teaser["format"],
            "tier": "paid", "label_key": teaser["label_key"],
            "hint_key": teaser.get("hint_key"),
            "locked": not is_paid, "value": None,
        })

    steve = _steve_block(low_data=low_data, net_new_7d=net_new_7d,
                         completion=completion, members=members)

    return {
        "success": True,
        "community": {"id": community_id, "name": name,
                      "tier": tier_info["tier"], "is_paid": is_paid},
        "metrics": metrics,
        "steve": steve,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def _steve_block(*, low_data: bool, net_new_7d: int, completion: Dict[str, int],
                 members: int) -> Dict[str, Any]:
    """Pick Steve's narration template + params. Copy lives in the i18n
    catalogs; this only chooses which line and supplies the numbers (zero AI
    cost, payoff-first, never deficit-framed)."""
    if low_data:
        return {"greeting_key": "owner.steve.greeting",
                "read_key": "owner.steve.read_empty", "read_params": {}, "low_data": True}
    return {
        "greeting_key": "owner.steve.greeting",
        "read_key": "owner.steve.read_default",
        "read_params": {"delta": net_new_7d,
                        "complete": completion.get("complete", 0), "total": members},
        "low_data": False,
    }


def list_managed_communities(username: str) -> Dict[str, Any]:
    """Communities the user owns or is a delegated admin of, each with its tier
    — backs the Owner Dashboard community switcher. Owned = ``creator_username``
    match; delegated = an admin-ish role in ``user_communities`` or a row in
    ``community_admins``. ``is_owner`` gates the owner-only upgrade CTA client-side.
    """
    norm = (username or "").strip().lower()
    if not norm:
        return {"success": True, "communities": []}

    found: Dict[int, Dict[str, Any]] = {}
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()

            c.execute(
                f"SELECT id, name FROM communities WHERE LOWER(creator_username) = {ph}",
                (norm,),
            )
            for row in c.fetchall() or []:
                cid = int(row["id"] if hasattr(row, "keys") else row[0])
                name = row["name"] if hasattr(row, "keys") else row[1]
                found[cid] = {"id": cid, "name": name, "is_owner": True}

            try:
                c.execute(
                    f"""
                    SELECT c.id, c.name
                    FROM user_communities uc
                    JOIN users u ON uc.user_id = u.id
                    JOIN communities c ON uc.community_id = c.id
                    WHERE LOWER(u.username) = {ph}
                      AND LOWER(uc.role) IN ('admin', 'owner', 'moderator', 'manager')
                    """,
                    (norm,),
                )
                for row in c.fetchall() or []:
                    cid = int(row["id"] if hasattr(row, "keys") else row[0])
                    if cid not in found:
                        name = row["name"] if hasattr(row, "keys") else row[1]
                        found[cid] = {"id": cid, "name": name, "is_owner": False}
            except Exception as exc:  # pragma: no cover - defensive
                logger.debug("list_managed_communities role join failed: %s", exc)

            try:
                c.execute(
                    f"""
                    SELECT c.id, c.name
                    FROM community_admins ca
                    JOIN communities c ON ca.community_id = c.id
                    WHERE LOWER(ca.username) = {ph}
                    """,
                    (norm,),
                )
                for row in c.fetchall() or []:
                    cid = int(row["id"] if hasattr(row, "keys") else row[0])
                    if cid not in found:
                        name = row["name"] if hasattr(row, "keys") else row[1]
                        found[cid] = {"id": cid, "name": name, "is_owner": False}
            except Exception as exc:  # pragma: no cover - defensive
                logger.debug("list_managed_communities community_admins failed: %s", exc)
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("list_managed_communities failed: %s", exc)
        return {"success": True, "communities": []}

    communities: List[Dict[str, Any]] = []
    for info in found.values():
        tier_info = _resolve_tier(info["id"])
        communities.append({
            "id": info["id"],
            "name": info["name"],
            "is_owner": info["is_owner"],
            "role": "owner" if info["is_owner"] else "admin",
            "tier": tier_info["tier"],
            "is_paid": bool(tier_info["is_paid"]),
        })
    communities.sort(key=lambda x: str(x["name"] or "").lower())
    return {"success": True, "communities": communities}


def list_spaces(community_id: int) -> Dict[str, Any]:
    """Sub-communities and groups under a community, for the Spaces tab —
    name + id (+ member count where cheap), so the owner can tap straight in."""
    subcommunities: List[Dict[str, Any]] = []
    groups: List[Dict[str, Any]] = []
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            try:
                c.execute(
                    f"""
                    SELECT sc.id, sc.name, COUNT(uc.id) AS member_count
                    FROM communities sc
                    LEFT JOIN user_communities uc ON uc.community_id = sc.id
                    WHERE sc.parent_community_id = {ph}
                    GROUP BY sc.id, sc.name
                    ORDER BY sc.name
                    """,
                    (community_id,),
                )
                for row in c.fetchall() or []:
                    subcommunities.append({
                        "id": row["id"] if hasattr(row, "keys") else row[0],
                        "name": row["name"] if hasattr(row, "keys") else row[1],
                        "member_count": int((row["member_count"] if hasattr(row, "keys") else row[2]) or 0),
                    })
            except Exception as exc:  # pragma: no cover - defensive
                logger.debug("list_spaces subcommunities failed: %s", exc)
            try:
                c.execute(
                    f"SELECT id, name FROM `groups` WHERE community_id = {ph} ORDER BY name",
                    (community_id,),
                )
                for row in c.fetchall() or []:
                    groups.append({
                        "id": row["id"] if hasattr(row, "keys") else row[0],
                        "name": row["name"] if hasattr(row, "keys") else row[1],
                    })
            except Exception as exc:  # pragma: no cover - defensive
                logger.debug("list_spaces groups failed: %s", exc)
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("list_spaces failed: %s", exc)
    return {"success": True, "subcommunities": subcommunities, "groups": groups}
