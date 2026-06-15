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

# The platform "admin" account is a silent member of every community; it must
# never be counted in any owner-facing stat. Expects a ``uc`` alias on
# user_communities. The open QR/link invite placeholder is excluded from invite
# stats (it represents a shareable link, not a specific person invited).
_NOT_ADMIN_MEMBER = "uc.user_id NOT IN (SELECT id FROM users WHERE LOWER(username) = 'admin')"
_QR_INVITE_EMAIL_PATTERN = "qr-invite-%@placeholder.local"

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


def _in_clause(ph: str, count: int) -> str:
    return "(" + ", ".join([ph] * count) + ")"


def _distinct_members(cursor, ph: str, ids: List[int], cutoff: Optional[str] = None) -> int:
    """COUNT(DISTINCT user_id) across the scope's communities, 'admin' excluded.
    Deduped: a person in several sub-communities counts once. With ``cutoff`` it
    counts distinct users who have a join event in the window."""
    if not ids:
        return 0
    sql = (
        f"SELECT COUNT(DISTINCT uc.user_id) AS count FROM user_communities uc "
        f"WHERE uc.community_id IN {_in_clause(ph, len(ids))} "
        f"AND uc.user_id NOT IN (SELECT id FROM users WHERE LOWER(username) = 'admin')"
    )
    params: Tuple[Any, ...] = tuple(ids)
    if cutoff is not None:
        sql += f" AND uc.joined_at >= {ph}"
        params = tuple(ids) + (cutoff,)
    return _scalar(cursor, sql, params)


def _active_users(cursor, ph: str, ids: List[int], cutoff: str) -> int:
    """Distinct users active in the scope's communities since ``cutoff``.

    Active = visited the feed (community_visit_history) OR posted/replied in the
    community feed OR posted/replied in a group under it. Group chats are NOT
    community-scoped (no community_id) and are excluded by design. Reactions
    carry no timestamp, so they can't be windowed and are also excluded (a small
    documented undercount). 'admin' excluded.
    """
    if not ids:
        return 0
    n = _in_clause(ph, len(ids))
    sql = f"""
        SELECT COUNT(DISTINCT active.username) AS count FROM (
            SELECT username FROM community_visit_history WHERE community_id IN {n} AND visit_time >= {ph}
            UNION
            SELECT username FROM posts WHERE community_id IN {n} AND timestamp >= {ph}
            UNION
            SELECT username FROM replies WHERE community_id IN {n} AND timestamp >= {ph}
            UNION
            SELECT gp.username FROM group_posts gp JOIN `groups` g ON gp.group_id = g.id
                WHERE g.community_id IN {n} AND gp.created_at >= {ph}
            UNION
            SELECT grp.username FROM group_replies grp
                JOIN group_posts gp ON grp.group_post_id = gp.id
                JOIN `groups` g ON gp.group_id = g.id
                WHERE g.community_id IN {n} AND grp.created_at >= {ph}
        ) AS active
        WHERE LOWER(active.username) <> 'admin'
    """
    params = (tuple(ids) + (cutoff,)) * 5
    return _scalar(cursor, sql, params)


def _scope_member_usernames(cursor, ph: str, ids: List[int]) -> List[str]:
    """Usernames of members across the scope's communities (admin excluded)."""
    if not ids:
        return []
    try:
        cursor.execute(
            f"SELECT u.username FROM user_communities uc JOIN users u ON uc.user_id = u.id "
            f"WHERE uc.community_id IN {_in_clause(ph, len(ids))} AND LOWER(u.username) <> 'admin'",
            tuple(ids),
        )
        return list({(r["username"] if hasattr(r, "keys") else r[0]) for r in cursor.fetchall() or []})
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("_scope_member_usernames failed: %s", exc)
        return []


def _communicating_members(cursor, ph: str, ids: List[int], cutoff: str) -> int:
    """Distinct members who messaged ANOTHER member since ``cutoff`` — via a DM
    to a fellow member, or a group chat that has >=2 members of this scope.

    Chats/DMs aren't community-scoped, so we attribute by MEMBERSHIP OVERLAP.
    Aggregate count only — never who-talked-to-whom, never content (privacy)."""
    members = _scope_member_usernames(cursor, ph, ids)
    if not members:
        return 0
    m = _in_clause(ph, len(members))
    sql = f"""
        SELECT COUNT(DISTINCT comm.username) AS count FROM (
            SELECT msg.sender AS username FROM messages msg
                WHERE msg.timestamp >= {ph} AND msg.sender IN {m} AND msg.receiver IN {m}
            UNION
            SELECT gcm.sender_username AS username FROM group_chat_messages gcm
                WHERE gcm.created_at >= {ph} AND gcm.sender_username IN {m}
                  AND gcm.group_id IN (
                    SELECT group_id FROM group_chat_members WHERE username IN {m}
                    GROUP BY group_id HAVING COUNT(*) >= 2)
        ) AS comm
    """
    mt = tuple(members)
    params = (cutoff,) + mt + mt + (cutoff,) + mt + mt
    return _scalar(cursor, sql, params)


def _top_contributors(cursor, ph: str, ids: List[int], kind: str,
                      cutoff: Optional[str] = None, limit: int = 5) -> List[Dict[str, Any]]:
    """Top members by posts / replies / reactions across the scope's communities
    (summed across the subtree, so cross-network activity is rewarded). Names the
    people — this is the one celebratory naming surface. 'admin' excluded."""
    if not ids:
        return []
    n = _in_clause(ph, len(ids))
    lim = max(1, min(20, int(limit)))
    if kind == "posters":
        sql = (f"SELECT username, COUNT(*) AS count FROM posts WHERE community_id IN {n} "
               f"AND timestamp >= {ph} AND LOWER(username) <> 'admin' "
               f"GROUP BY username ORDER BY count DESC LIMIT {lim}")
        params: Tuple[Any, ...] = tuple(ids) + (cutoff,)
    elif kind == "repliers":
        sql = (f"SELECT username, COUNT(*) AS count FROM replies WHERE community_id IN {n} "
               f"AND timestamp >= {ph} AND LOWER(username) <> 'admin' "
               f"GROUP BY username ORDER BY count DESC LIMIT {lim}")
        params = tuple(ids) + (cutoff,)
    elif kind == "reactors":
        # reactions carry no timestamp → all-time, scoped by the reacted post's community.
        sql = (f"SELECT r.username AS username, COUNT(*) AS count FROM reactions r "
               f"JOIN posts p ON r.post_id = p.id WHERE p.community_id IN {n} "
               f"AND LOWER(r.username) <> 'admin' GROUP BY r.username ORDER BY count DESC LIMIT {lim}")
        params = tuple(ids)
    else:
        return []
    out: List[Dict[str, Any]] = []
    try:
        cursor.execute(sql, params)
        for r in cursor.fetchall() or []:
            out.append({
                "username": r["username"] if hasattr(r, "keys") else r[0],
                "count": int((r["count"] if hasattr(r, "keys") else r[1]) or 0),
            })
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("_top_contributors(%s) failed: %s", kind, exc)
    return out


def _top_active_users(cursor, ph: str, ids: List[int], cutoff: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Top members by total activity *footprint* since ``cutoff`` — the people
    composing DAU/WAU/MAU. Counts every activity event (visit + post + reply +
    group post/reply), so it's broader than the per-type leaderboards. 'admin'
    excluded. Names people (celebratory)."""
    if not ids:
        return []
    n = _in_clause(ph, len(ids))
    lim = max(1, min(20, int(limit)))
    sql = f"""
        SELECT ev.username AS username, COUNT(*) AS count FROM (
            SELECT username FROM community_visit_history WHERE community_id IN {n} AND visit_time >= {ph}
            UNION ALL SELECT username FROM posts WHERE community_id IN {n} AND timestamp >= {ph}
            UNION ALL SELECT username FROM replies WHERE community_id IN {n} AND timestamp >= {ph}
            UNION ALL SELECT gp.username FROM group_posts gp JOIN `groups` g ON gp.group_id = g.id
                WHERE g.community_id IN {n} AND gp.created_at >= {ph}
            UNION ALL SELECT grp.username FROM group_replies grp
                JOIN group_posts gp ON grp.group_post_id = gp.id
                JOIN `groups` g ON gp.group_id = g.id
                WHERE g.community_id IN {n} AND grp.created_at >= {ph}
        ) AS ev
        WHERE LOWER(ev.username) <> 'admin'
        GROUP BY ev.username ORDER BY count DESC LIMIT {lim}
    """
    params = (tuple(ids) + (cutoff,)) * 5
    out: List[Dict[str, Any]] = []
    try:
        cursor.execute(sql, params)
        for r in cursor.fetchall() or []:
            out.append({
                "username": r["username"] if hasattr(r, "keys") else r[0],
                "count": int((r["count"] if hasattr(r, "keys") else r[1]) or 0),
            })
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("_top_active_users failed: %s", exc)
    return out


def _last_activity_days(cursor, ph: str, ids: List[int], now: datetime) -> Optional[int]:
    """Whole days since the most recent activity in the scope, or None if never
    active (drives the per-sub 'dormancy clock')."""
    if not ids:
        return None
    n = _in_clause(ph, len(ids))
    sql = f"""
        SELECT MAX(t) AS last_t FROM (
            SELECT MAX(visit_time) AS t FROM community_visit_history WHERE community_id IN {n}
            UNION ALL SELECT MAX(timestamp) FROM posts WHERE community_id IN {n}
            UNION ALL SELECT MAX(timestamp) FROM replies WHERE community_id IN {n}
            UNION ALL SELECT MAX(gp.created_at) FROM group_posts gp JOIN `groups` g ON gp.group_id = g.id WHERE g.community_id IN {n}
            UNION ALL SELECT MAX(grp.created_at) FROM group_replies grp
                JOIN group_posts gp ON grp.group_post_id = gp.id
                JOIN `groups` g ON gp.group_id = g.id WHERE g.community_id IN {n}
        ) AS m
    """
    try:
        cursor.execute(sql, (tuple(ids)) * 5)
        row = cursor.fetchone()
        last_t = (row["last_t"] if hasattr(row, "keys") else row[0]) if row else None
        if not last_t:
            return None
        if isinstance(last_t, str):
            last_t = datetime.fromisoformat(last_t.replace(" ", "T").split(".")[0])
        if last_t.tzinfo is None:
            last_t = last_t.replace(tzinfo=timezone.utc)
        return max(0, (now - last_t).days)
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("_last_activity_days failed: %s", exc)
        return None


def _activity_band(active_7d: int, members: int) -> str:
    """Per-sub health band from the *share* of members active this week (not a
    raw count — 5 active in a 30-member sub is ~17%, which is not 'thriving').
    Four bands so there's a middle ground between thriving and dormant."""
    if active_7d <= 0:
        return "dormant"
    ratio = active_7d / members if members > 0 else 1.0
    if ratio >= 0.33:
        return "thriving"   # ~1 in 3 members active this week
    if ratio >= 0.10:
        return "active"     # ~1 in 10 — alive, the middle band
    return "quiet"          # some life but most are quiet


def _profile_completion(cursor, ph: str, ids: List[int]) -> Dict[str, int]:
    """Aggregate member profile completion into none/partial/complete buckets,
    deduped across the scope's communities (one person counts once). Reuses the
    canonical per-member section logic from onboarding_session. Aggregate only —
    no member is named (privacy invariant).
    """
    complete = partial = none = 0
    if not ids:
        return {"complete": complete, "partial": partial, "none": none}
    try:
        cursor.execute(
            f"""
            SELECT u.role, u.company, p.bio, u.linkedin,
                   u.professional_about, u.personal_highlight_answers
            FROM (
                SELECT DISTINCT uc.user_id
                FROM user_communities uc
                WHERE uc.community_id IN {_in_clause(ph, len(ids))}
                  AND uc.user_id NOT IN (SELECT id FROM users WHERE LOWER(username) = 'admin')
            ) ducs
            JOIN users u ON ducs.user_id = u.id
            LEFT JOIN user_profiles p ON LOWER(u.username) = LOWER(p.username)
            """,
            tuple(ids),
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


def build_overview(community_id: int, scope: str = "network") -> Optional[Dict[str, Any]]:
    """Build the Owner Dashboard overview payload, or ``None`` if the community
    does not exist. Does NOT authorize — the route authorizes the apex first.

    ``scope`` = "network" (this community + all nested sub-communities, deduped)
    or "self" (this community only). Network rollup is a paid feature: on a free
    community that has sub-communities a network request falls back to self and
    is returned ``locked`` with a subtree member teaser (the upsell hook).
    """
    scope = "network" if str(scope or "").strip().lower() == "network" else "self"
    tier_info = _resolve_tier(community_id)
    is_paid = bool(tier_info["is_paid"])

    from backend.services.community import get_descendant_community_ids

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()

        c.execute(f"SELECT id, name FROM communities WHERE id = {ph}", (community_id,))
        row = c.fetchone()
        if not row:
            return None
        name = row["name"] if hasattr(row, "keys") else row[1]

        # The subtree is the apex + every descendant (multi-level). Authorization
        # already happened on the apex, so this never reaches a sibling network.
        try:
            subtree_ids = [int(cid) for cid in get_descendant_community_ids(c, community_id)] or [community_id]
        except Exception:
            subtree_ids = [community_id]
        has_descendants = len(subtree_ids) > 1

        # Network rollup is paid: free + has subtree → fall back to self, locked.
        network_locked = scope == "network" and has_descendants and not is_paid
        effective_network = scope == "network" and (is_paid or not has_descendants)
        ids = subtree_ids if effective_network else [community_id]
        in_ids = _in_clause(ph, len(ids))

        now = datetime.now(timezone.utc)
        cutoff = (now - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
        members = _distinct_members(c, ph, ids)
        net_new_7d = _distinct_members(c, ph, ids, cutoff=cutoff)
        mau_cut = (now - timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
        dau = _active_users(c, ph, ids, (now - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S"))
        wau = _active_users(c, ph, ids, cutoff)
        mau = _active_users(c, ph, ids, mau_cut)
        communicating = _communicating_members(c, ph, ids, mau_cut)
        top_posters = _top_contributors(c, ph, ids, "posters", cutoff=mau_cut)
        top_repliers = _top_contributors(c, ph, ids, "repliers", cutoff=mau_cut)
        top_reactors = _top_contributors(c, ph, ids, "reactors")
        top_active = _top_active_users(c, ph, ids, mau_cut)

        # Subtree member teaser (the upsell hook): distinct across the WHOLE
        # subtree regardless of effective scope; only meaningful with sub-communities.
        teaser_members = _distinct_members(c, ph, subtree_ids) if has_descendants else None

        if effective_network:
            subcommunities = len(subtree_ids) - 1
        else:
            subcommunities = _scalar(
                c, f"SELECT COUNT(*) AS count FROM communities WHERE parent_community_id = {ph}",
                (community_id,),
            )
        groups = _scalar(
            c, f"SELECT COUNT(*) AS count FROM `groups` WHERE community_id IN {in_ids}",
            tuple(ids),
        )

        # Unique people, not rows: the same person invited (or re-joining)
        # multiple times counts once. Dedup on the invitee identity
        # (username, else email); skip open QR/link invites and 'admin'.
        invites_sent = _scalar(
            c,
            f"""SELECT COUNT(DISTINCT COALESCE(LOWER(invited_username), LOWER(invited_email))) AS count
                FROM community_invitations
                WHERE community_id IN {in_ids}
                  AND NOT (invited_username IS NULL AND invited_email LIKE {ph})
                  AND COALESCE(LOWER(invited_username), LOWER(invited_email)) <> 'admin'""",
            tuple(ids) + (_QR_INVITE_EMAIL_PATTERN,),
        )
        invites_accepted = _scalar(
            c,
            f"""SELECT COUNT(DISTINCT COALESCE(LOWER(invited_username), LOWER(invited_email))) AS count
                FROM community_invitations
                WHERE community_id IN {in_ids} AND LOWER(status) = 'accepted'
                  AND NOT (invited_username IS NULL AND invited_email LIKE {ph})
                  AND COALESCE(LOWER(invited_username), LOWER(invited_email)) <> 'admin'""",
            tuple(ids) + (_QR_INVITE_EMAIL_PATTERN,),
        )

        completion = _profile_completion(c, ph, ids)
        has_posts = _scalar(
            c, f"SELECT COUNT(*) AS count FROM posts WHERE community_id IN {in_ids}",
            tuple(ids),
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
            "id": "active", "group": "overview", "format": "activity", "tier": "free",
            "label_key": "owner.metric.active", "locked": False,
            "value": {"dau": dau, "wau": wau, "mau": mau, "members": members,
                      "top_active": top_active},
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
        {
            "id": "communicating", "group": "overview", "format": "comm", "tier": "free",
            "label_key": "owner.metric.communicating", "owner_only": True, "locked": False,
            "value": {"count": communicating, "total": members},
        },
        {
            "id": "leaderboards", "group": "overview", "format": "leaderboards", "tier": "free",
            "label_key": "owner.metric.leaderboards", "locked": False,
            "value": {"posters": top_posters, "repliers": top_repliers, "reactors": top_reactors},
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
                         completion=completion, members=members,
                         wau=wau, mau=mau, communicating=communicating)

    return {
        "success": True,
        "community": {"id": community_id, "name": name,
                      "tier": tier_info["tier"], "is_paid": is_paid},
        "scope": "network" if effective_network else "self",
        "network": {
            "available": has_descendants,
            "locked": network_locked,
            "teaser_members": teaser_members,
        },
        "metrics": metrics,
        "steve": steve,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def _steve_block(*, low_data: bool, net_new_7d: int, completion: Dict[str, int],
                 members: int, wau: int, mau: int, communicating: int) -> Dict[str, Any]:
    """Pick Steve's narration template + params. Copy lives in the i18n
    catalogs; this only chooses which line and supplies the numbers (zero AI
    cost, payoff-first, never deficit-framed). The default read spans growth,
    weekly + monthly activity, and connection so it isn't one-dimensional."""
    if low_data:
        return {"greeting_key": "owner.steve.greeting",
                "read_key": "owner.steve.read_empty", "read_params": {}, "low_data": True}
    return {
        "greeting_key": "owner.steve.greeting",
        "read_key": "owner.steve.read_default",
        "read_params": {
            "delta": net_new_7d, "wau": wau, "mau": mau,
            "communicating": communicating,
            "complete": completion.get("complete", 0), "total": members,
        },
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

    from backend.services.community import get_descendant_community_ids, get_parent_chain_ids

    found: Dict[int, Dict[str, Any]] = {}
    tops: List[Dict[str, Any]] = []
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

            # One entry per NETWORK: keep only managed nodes that have no managed
            # ancestor (a root the user manages absorbs the subs they manage).
            # Each top carries a subtree summary for the switcher row.
            managed_ids = set(found.keys())
            for cid, info in found.items():
                try:
                    ancestors = get_parent_chain_ids(c, cid)
                except Exception:
                    ancestors = []
                if any(a in managed_ids for a in ancestors):
                    continue
                try:
                    subtree = [int(x) for x in get_descendant_community_ids(c, cid)] or [cid]
                except Exception:
                    subtree = [cid]
                tops.append({
                    "id": cid, "name": info["name"], "is_owner": info["is_owner"],
                    "members": _distinct_members(c, ph, subtree),
                    "spaces": max(0, len(subtree) - 1),
                })
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("list_managed_communities failed: %s", exc)
        return {"success": True, "communities": []}

    communities: List[Dict[str, Any]] = []
    for info in tops:
        tier_info = _resolve_tier(info["id"])
        communities.append({
            "id": info["id"],
            "name": info["name"],
            "is_owner": info["is_owner"],
            "role": "owner" if info["is_owner"] else "admin",
            "tier": tier_info["tier"],
            "is_paid": bool(tier_info["is_paid"]),
            "members": info["members"],
            "spaces": info["spaces"],
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
                        AND uc.user_id NOT IN (SELECT id FROM users WHERE LOWER(username) = 'admin')
                    WHERE sc.parent_community_id = {ph}
                    GROUP BY sc.id, sc.name
                    ORDER BY sc.name
                    """,
                    (community_id,),
                )
                for row in c.fetchall() or []:
                    subcommunities.append({
                        "id": int(row["id"] if hasattr(row, "keys") else row[0]),
                        "name": row["name"] if hasattr(row, "keys") else row[1],
                        "member_count": int((row["member_count"] if hasattr(row, "keys") else row[2]) or 0),
                    })
                # Per-sub breakdown: active-this-week + a dormancy clock + a
                # thriving/quiet/dormant band, so the owner can see where the life
                # is and which rooms need a nudge. Counts only — never names.
                now = datetime.now(timezone.utc)
                wau_cut = (now - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
                for sub in subcommunities:
                    active_7d = _active_users(c, ph, [sub["id"]], wau_cut)
                    sub["active_7d"] = active_7d
                    sub["last_activity_days"] = _last_activity_days(c, ph, [sub["id"]], now)
                    sub["status"] = _activity_band(active_7d, sub.get("member_count") or 0)
                subcommunities.sort(key=lambda s: (-s["active_7d"], -(s.get("member_count") or 0)))
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
