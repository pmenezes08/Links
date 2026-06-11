"""Find-by-handle lookup and member-initiated join requests.

The member-in mirror of the owner-out invite flow. Invariants:

* **Non-enumerating lookup** — a handle that doesn't exist, belongs to a
  non-discoverable community, or belongs to a sub-community returns the
  same body and status. The closed door is the product working.
* **Lookup payload allowlist** — name, @handle, short description, and a
  *bucketed* member count. Never owner, members, structure, or tier.
* **Silent expiry on decline** — the requester's state is identical to
  no-action-yet; after the cooldown window the request quietly resets.
  No reason, no decline notification, ever.
* **Accept parity** — accepting routes through the same membership write,
  cap checks (CommunityMembershipLimitError → render_member_cap_error),
  introduce-thread + new-member notification hooks, and cache
  invalidation as invite acceptance.
* **Rate limited** — lookups and request creation run through the shared
  fixed-window limiter (Redis-backed via redis_cache, memory fallback).
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from redis_cache import cache as _shared_cache, invalidate_user_cache

from backend.services import notification_copy
from backend.services.community import (
    CommunityMembershipLimitError,
    render_member_cap_error,
)
from backend.services.community_handles import ensure_handle_columns
from backend.services.community_invites import (
    _add_user_to_community,
    _has_manage_permission,
    notify_community_new_member,
)
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.notifications import create_notification, send_push_to_user
from backend.services.steve_community_welcome import (
    ensure_introduce_yourself_thread,
    mirror_introduce_yourself_thread,
)

logger = logging.getLogger(__name__)

# Requester may knock again this many days after a decline. Enforced
# silently: within the window a re-request reports the pending state.
REJECT_COOLDOWN_DAYS = 30

LOOKUP_RATE_LIMIT = (20, 60)          # 20 lookups / minute / user
REQUEST_RATE_LIMIT = (10, 86_400)     # 10 join requests / day / user

_NOT_FOUND: Tuple[Dict[str, Any], int] = ({"success": False, "error": "Community not found"}, 404)

_TABLES_ENSURED = False


def ensure_tables() -> None:
    global _TABLES_ENSURED
    if _TABLES_ENSURED:
        return
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS community_join_requests (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    community_id INT NOT NULL,
                    username VARCHAR(191) NOT NULL,
                    status VARCHAR(16) NOT NULL DEFAULT 'pending',
                    decided_by VARCHAR(191) NULL,
                    decided_at DATETIME NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_join_request (community_id, username),
                    INDEX idx_join_requests_pending (community_id, status)
                )
                """
            )
            try:
                conn.commit()
            except Exception:
                pass
        _TABLES_ENSURED = True
    except Exception as err:
        logger.warning("community_join_requests ensure_tables failed: %s", err)


# ── Shared fixed-window rate limiter ────────────────────────────────────


def rate_limit_allow(name: str, actor: str, limit: int, window_seconds: int) -> bool:
    """Best-effort fixed window via the shared cache. Fails open — an
    unavailable cache must not take the feature down, the gate is a
    scanning deterrent, not a security boundary (authz is)."""
    window = int(time.time() // window_seconds)
    key = f"rl:{name}:{actor}:{window}"
    try:
        count = int(_shared_cache.get(key) or 0)
        if count >= limit:
            return False
        _shared_cache.set(key, count + 1, window_seconds)
        return True
    except Exception:
        return True


def _member_bucket(count: int) -> str:
    """Outside-visible member count is bucketed — exact counts leak
    growth/churn to non-members."""
    for floor in (500, 250, 100, 50, 25, 10):
        if count >= floor:
            return f"{floor}+"
    return "<10"


# ── Lookup ──────────────────────────────────────────────────────────────


def lookup_by_handle(username: str, handle: str) -> Tuple[Dict[str, Any], int]:
    if not rate_limit_allow("handle_lookup", username, *LOOKUP_RATE_LIMIT):
        return {"success": False, "error": "Too many lookups. Try again shortly."}, 429

    normalized = (handle or "").strip().lstrip("@").lower()
    if not normalized:
        return _NOT_FOUND

    ensure_handle_columns()
    ensure_tables()
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"""
            SELECT id, name, handle, description, discoverable, parent_community_id
            FROM communities WHERE handle = {ph}
            """,
            (normalized,),
        )
        row = c.fetchone()
        get = (lambda k, i: row[k] if hasattr(row, "keys") else row[i])
        # One door for all three: nonexistent, sub-community, not findable.
        if not row or get("parent_community_id", 5) is not None or not (get("discoverable", 4) or 0):
            return _NOT_FOUND

        community_id = int(get("id", 0))
        c.execute(
            f"""
            SELECT COUNT(*) AS n FROM user_communities uc
            JOIN users u ON uc.user_id = u.id
            WHERE uc.community_id = {ph}
            """,
            (community_id,),
        )
        count_row = c.fetchone()
        member_count = int((count_row["n"] if hasattr(count_row, "keys") else count_row[0]) or 0)

        c.execute(
            f"""
            SELECT 1 FROM user_communities uc JOIN users u ON uc.user_id = u.id
            WHERE uc.community_id = {ph} AND u.username = {ph}
            """,
            (community_id, username),
        )
        already_member = c.fetchone() is not None

        request_status = None
        if not already_member:
            c.execute(
                f"SELECT status, decided_at FROM community_join_requests WHERE community_id = {ph} AND username = {ph}",
                (community_id, username),
            )
            req = c.fetchone()
            if req:
                status = req["status"] if hasattr(req, "keys") else req[0]
                decided_at = req["decided_at"] if hasattr(req, "keys") else req[1]
                # Silent expiry: a recent decline reads as still pending;
                # past the window it resets to "can ask again".
                if status == "pending":
                    request_status = "pending"
                elif status == "rejected" and _within_cooldown(decided_at):
                    request_status = "pending"

    description = (get("description", 3) or "").strip()
    return {
        "success": True,
        "community": {
            "id": community_id,
            "name": get("name", 1),
            "handle": get("handle", 2),
            "description": description[:200],
            "member_bucket": _member_bucket(member_count),
            "already_member": already_member,
            "request_status": request_status,
        },
    }, 200


def _within_cooldown(decided_at) -> bool:
    if not decided_at:
        return False
    try:
        parsed = decided_at if hasattr(decided_at, "year") else datetime.strptime(str(decided_at), "%Y-%m-%d %H:%M:%S")
        return datetime.utcnow() < parsed + timedelta(days=REJECT_COOLDOWN_DAYS)
    except Exception:
        return False


# ── Requester side ──────────────────────────────────────────────────────


def create_request(username: str, community_id: int) -> Tuple[Dict[str, Any], int]:
    if not rate_limit_allow("join_request", username, *REQUEST_RATE_LIMIT):
        return {"success": False, "error": "Too many requests today. Try again tomorrow."}, 429

    ensure_handle_columns()
    ensure_tables()
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"SELECT id, name, discoverable, parent_community_id FROM communities WHERE id = {ph}",
            (int(community_id),),
        )
        row = c.fetchone()
        get = (lambda k, i: row[k] if hasattr(row, "keys") else row[i])
        # Requests only through the open door — same non-enumerating 404
        # whether the community is missing, nested, or not findable.
        if not row or get("parent_community_id", 3) is not None or not (get("discoverable", 2) or 0):
            return _NOT_FOUND
        community_name = get("name", 1)

        c.execute(
            f"""
            SELECT 1 FROM user_communities uc JOIN users u ON uc.user_id = u.id
            WHERE uc.community_id = {ph} AND u.username = {ph}
            """,
            (int(community_id), username),
        )
        if c.fetchone():
            return {"success": False, "error": "Already a member"}, 400

        c.execute(
            f"SELECT id, status, decided_at FROM community_join_requests WHERE community_id = {ph} AND username = {ph}",
            (int(community_id), username),
        )
        existing = c.fetchone()
        now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        notify_admins = False
        if existing:
            ex = (lambda k, i: existing[k] if hasattr(existing, "keys") else existing[i])
            status = ex("status", 1)
            if status == "pending":
                return {"success": True, "request_status": "pending"}, 200
            if status == "rejected" and _within_cooldown(ex("decided_at", 2)):
                # Silent cooldown: report pending, change nothing.
                return {"success": True, "request_status": "pending"}, 200
            c.execute(
                f"""
                UPDATE community_join_requests
                SET status = 'pending', decided_by = NULL, decided_at = NULL, created_at = {ph}
                WHERE id = {ph}
                """,
                (now_str, ex("id", 0)),
            )
            notify_admins = True
        else:
            c.execute(
                f"INSERT INTO community_join_requests (community_id, username, status, created_at) VALUES ({ph}, {ph}, 'pending', {ph})",
                (int(community_id), username, now_str),
            )
            notify_admins = True

        admin_usernames: List[str] = []
        if notify_admins:
            admin_usernames = _manager_usernames(c, ph, int(community_id))
        conn.commit()

    for admin in admin_usernames:
        _notify_join_request(admin, username, int(community_id), community_name)

    return {"success": True, "request_status": "pending"}, 200


def withdraw_request(username: str, community_id: int) -> Tuple[Dict[str, Any], int]:
    ensure_tables()
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"""
            UPDATE community_join_requests SET status = 'withdrawn', decided_at = {ph}
            WHERE community_id = {ph} AND username = {ph} AND status = 'pending'
            """,
            (datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"), int(community_id), username),
        )
        conn.commit()
    return {"success": True, "request_status": None}, 200


# ── Owner/admin side ────────────────────────────────────────────────────


def _manager_usernames(c, ph: str, community_id: int) -> List[str]:
    """Owner + admins of a community — the join-request audience."""
    names: List[str] = []
    c.execute(f"SELECT creator_username FROM communities WHERE id = {ph}", (community_id,))
    row = c.fetchone()
    creator = (row["creator_username"] if hasattr(row, "keys") else row[0]) if row else None
    if creator:
        names.append(str(creator))
    c.execute(
        f"""
        SELECT u.username FROM user_communities uc
        JOIN users u ON uc.user_id = u.id
        WHERE uc.community_id = {ph} AND uc.role IN ('owner', 'admin')
        """,
        (community_id,),
    )
    for r in c.fetchall() or []:
        uname = r["username"] if hasattr(r, "keys") else r[0]
        if uname and uname not in names:
            names.append(str(uname))
    return names


def _notify_join_request(admin: str, requester: str, community_id: int, community_name: str) -> None:
    try:
        locale = notification_copy.recipient_locale(admin)
        message = notification_copy.in_app_text(
            "community_join_request", locale, username=requester, community=community_name
        )
        create_notification(
            admin,
            requester,
            "community_join_request",
            community_id=community_id,
            message=message,
            link="/notifications?tab=invites",
        )
        push = notification_copy.push_payload(
            "community_join_request", locale, username=requester, community=community_name
        )
        send_push_to_user(
            admin,
            {
                "title": push["title"],
                "body": push["body"],
                "url": "/notifications?tab=invites",
                "tag": f"join-request-{community_id}-{requester}",
            },
        )
    except Exception as err:
        logger.warning("join-request notify failed for %s: %s", admin, err)


def list_pending_for_manager(username: str) -> Tuple[Dict[str, Any], int]:
    """All pending requests across communities ``username`` can manage."""
    ensure_tables()
    out: List[Dict[str, Any]] = []
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"""
            SELECT r.id, r.community_id, r.username, r.created_at,
                   c2.name AS community_name,
                   u.first_name, u.last_name, up.profile_picture
            FROM community_join_requests r
            JOIN communities c2 ON c2.id = r.community_id
            JOIN users u ON u.username = r.username
            LEFT JOIN user_profiles up ON up.username = r.username
            WHERE r.status = 'pending'
              AND (
                    c2.creator_username = {ph}
                    OR EXISTS (
                        SELECT 1 FROM user_communities uc JOIN users au ON uc.user_id = au.id
                        WHERE uc.community_id = r.community_id AND au.username = {ph}
                          AND uc.role IN ('owner', 'admin')
                    )
                  )
            ORDER BY r.created_at DESC
            """,
            (username, username),
        )
        for r in c.fetchall() or []:
            g = (lambda k, i, row=r: row[k] if hasattr(row, "keys") else row[i])
            first = (g("first_name", 5) or "").strip()
            last = (g("last_name", 6) or "").strip()
            display = f"{first} {last}".strip() or str(g("username", 2))
            out.append({
                "id": g("id", 0),
                "community_id": g("community_id", 1),
                "community_name": g("community_name", 4),
                "username": g("username", 2),
                "display_name": display,
                "profile_picture": g("profile_picture", 7),
                "created_at": str(g("created_at", 3)),
            })
    return {"success": True, "requests": out}, 200


def pending_count_for_community(username: str, community_id: int) -> Tuple[Dict[str, Any], int]:
    """Pending count + avatar stack for the feed admin row (manage-gated)."""
    if not _has_manage_permission(username, community_id):
        return {"success": False, "error": "Forbidden"}, 403
    ensure_tables()
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"""
            SELECT r.username, up.profile_picture
            FROM community_join_requests r
            LEFT JOIN user_profiles up ON up.username = r.username
            WHERE r.community_id = {ph} AND r.status = 'pending'
            ORDER BY r.created_at DESC
            """,
            (int(community_id),),
        )
        rows = c.fetchall() or []
    requesters = [
        {
            "username": (r["username"] if hasattr(r, "keys") else r[0]),
            "profile_picture": (r["profile_picture"] if hasattr(r, "keys") else r[1]),
        }
        for r in rows
    ]
    return {"success": True, "count": len(requesters), "requesters": requesters[:3]}, 200


def decide_request(
    deciding_username: str, community_id: int, requester: str, action: str
) -> Tuple[Dict[str, Any], int]:
    """Accept or decline a pending request (manage-gated).

    Accept runs the invite-parity join path: cap checks, introduce-thread,
    new-member notification, cache invalidation. Decline is silent for the
    requester — status flips, nothing is sent, the lookup keeps reporting
    "pending" until the cooldown lapses.
    """
    if action not in ("accept", "reject"):
        return {"success": False, "error": "Invalid action"}, 400
    if not _has_manage_permission(deciding_username, community_id):
        return {"success": False, "error": "Forbidden"}, 403

    ensure_tables()
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"""
            SELECT r.id, r.status, c2.name AS community_name
            FROM community_join_requests r JOIN communities c2 ON c2.id = r.community_id
            WHERE r.community_id = {ph} AND r.username = {ph}
            """,
            (int(community_id), requester),
        )
        row = c.fetchone()
        if not row:
            return {"success": False, "error": "Request not found"}, 404
        g = (lambda k, i: row[k] if hasattr(row, "keys") else row[i])
        if g("status", 1) != "pending":
            return {"success": False, "error": "Request is no longer pending"}, 400
        community_name = g("community_name", 2)

        if action == "reject":
            c.execute(
                f"UPDATE community_join_requests SET status = 'rejected', decided_by = {ph}, decided_at = {ph} WHERE id = {ph}",
                (deciding_username, now_str, g("id", 0)),
            )
            conn.commit()
            return {"success": True, "status": "rejected"}, 200

        c.execute(f"SELECT id FROM users WHERE username = {ph}", (requester,))
        user_row = c.fetchone()
        if not user_row:
            return {"success": False, "error": "Request not found"}, 404
        user_id = user_row["id"] if hasattr(user_row, "keys") else user_row[0]

        c.execute(
            f"SELECT 1 FROM user_communities WHERE user_id = {ph} AND community_id = {ph}",
            (int(user_id), int(community_id)),
        )
        if not c.fetchone():
            try:
                _add_user_to_community(c, int(user_id), int(community_id), username=requester)
            except CommunityMembershipLimitError as exc:
                conn.rollback()
                # Cap reached: the request stays pending so the owner can
                # accept after upgrading; they get the canonical cap error.
                return render_member_cap_error(exc, session_username=deciding_username)

        c.execute(
            f"UPDATE community_join_requests SET status = 'accepted', decided_by = {ph}, decided_at = {ph} WHERE id = {ph}",
            (deciding_username, now_str, g("id", 0)),
        )
        c.execute(
            f"""
            UPDATE notifications SET is_read = 1
            WHERE type = 'community_join_request' AND community_id = {ph} AND from_user = {ph} AND is_read = 0
            """,
            (int(community_id), requester),
        )
        introduce_thread_post_id = ensure_introduce_yourself_thread(c, int(community_id))
        notify_community_new_member(
            int(community_id), requester, conn, introduce_thread_post_id=introduce_thread_post_id
        )
        conn.commit()

    mirror_introduce_yourself_thread(introduce_thread_post_id, int(community_id))
    invalidate_user_cache(requester)

    try:
        locale = notification_copy.recipient_locale(requester)
        message = notification_copy.in_app_text(
            "community_join_request_accepted", locale, community=community_name
        )
        create_notification(
            requester,
            deciding_username,
            "community_join_request_accepted",
            community_id=int(community_id),
            message=message,
            link=f"/community_feed_react/{int(community_id)}?joined=1",
        )
        push = notification_copy.push_payload(
            "community_join_request_accepted", locale, community=community_name
        )
        send_push_to_user(
            requester,
            {
                "title": push["title"],
                "body": push["body"],
                "url": f"/community_feed_react/{int(community_id)}?joined=1",
                "tag": f"join-accepted-{int(community_id)}-{requester}",
            },
        )
    except Exception as err:
        logger.warning("join-request accept notify failed for %s: %s", requester, err)

    return {"success": True, "status": "accepted", "community_id": int(community_id)}, 200
