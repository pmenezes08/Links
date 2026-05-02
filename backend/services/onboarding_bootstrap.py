"""
Bootstrap(parent + optional sub-communities) for onboarding — blueprint-only entrypoint.

Uses the same DB rules as ``/create_community`` (free-tier caps, depth, duplicate guard).
Calls ``bodybuilding_app.add_user_to_community`` lazily to avoid import cycles at load time.
"""

from __future__ import annotations

import logging
import random
import string
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.community import (
    CommunityMembershipLimitError,
    get_community_ancestors,
    get_community_basic,
    is_app_admin,
    render_member_cap_error,
)
from backend.services.entitlements import resolve_entitlements

logger = logging.getLogger(__name__)


def _scalar(cursor_row: Any, column_index: int = 0) -> Any:
    if not cursor_row:
        return None
    if hasattr(cursor_row, "keys"):
        vals = list(cursor_row.values())
        return vals[column_index] if column_index < len(vals) else None
    if isinstance(cursor_row, (list, tuple)):
        return cursor_row[column_index] if column_index < len(cursor_row) else None
    return None


def _normalize_subscription(value: Optional[str]) -> str:
    return str(value or "").strip().lower()


def _add_user_legacy(cursor, user_id: int, community_id: int, **kwargs):
    from bodybuilding_app import add_user_to_community  # noqa: WPS433 — intentional lazy import

    return add_user_to_community(cursor, user_id, community_id, **kwargs)


def _welcome_community(community_id: int) -> None:
    try:
        from backend.services.steve_community_welcome import welcome_for_new_community

        welcome_for_new_community(community_id, is_brand_new=True)
    except Exception as exc:
        logger.warning("onboarding_bootstrap welcome_for_new_community failed: %s", exc)


def _create_single_community(
    *,
    username: str,
    name: str,
    community_type: str,
    parent_id_int: Optional[int],
) -> Tuple[bool, Dict[str, Any], int]:
    """
    Returns (ok, body_or_error_dict, http_status).
    On success body includes community_id; on failure body is error json shape.
    """
    name = (name or "").strip()
    if not name:
        return False, {"success": False, "error": "Name is required"}, 400

    requested_type = (community_type or "general").strip().lower() or "general"
    is_admin = is_app_admin(username)

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(f"SELECT email_verified FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        verified = False
        if row is not None:
            verified = bool(row["email_verified"] if hasattr(row, "keys") else row[0])
        if not verified:
            return False, {"success": False, "error": "please verify your email"}, 403

        c.execute(f"SELECT subscription FROM users WHERE username = {ph}", (username,))
        sub_row = c.fetchone()
        subscription = (
            sub_row["subscription"] if hasattr(sub_row, "keys") else (sub_row[0] if sub_row else "free")
        )
        subscription_value = _normalize_subscription(subscription)
        is_premium_user = subscription_value == "premium"
        parent_is_none = parent_id_int is None
        applies_free_limits = not is_admin and not is_premium_user
        normalized_type = requested_type

        if applies_free_limits and parent_is_none:
            normalized_type = "general"

        if normalized_type == "business":
            return False, {"success": False, "error": "Business type is not available from onboarding bootstrap"}, 400

        if applies_free_limits and parent_is_none:
            if normalized_type not in ("general",):
                normalized_type = "general"

        try:
            c.execute(
                f"""
                SELECT id FROM communities
                WHERE creator_username = {ph} AND name = {ph}
                ORDER BY id DESC LIMIT 1
                """,
                (username, name),
            )
            existing = c.fetchone()
            if existing:
                existing_id = existing["id"] if hasattr(existing, "keys") else existing[0]
                return True, {"success": True, "community_id": int(existing_id), "duplicate": True}, 200
        except Exception as dup_err:
            logger.warning("bootstrap duplicate check: %s", dup_err)

        join_code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        description = ""
        location = ""
        template = "default"
        background_color = "#2d3839"
        text_color = "#ffffff"
        accent_color = "#4db6ac"
        card_color = "#1a2526"
        background_path = None

        if applies_free_limits:
            if parent_id_int is None:
                if USE_MYSQL:
                    c.execute(
                        """
                        SELECT COUNT(*) FROM communities
                        WHERE creator_username = %s AND (parent_community_id IS NULL OR parent_community_id = '')
                        """,
                        (username,),
                    )
                else:
                    c.execute(
                        """
                        SELECT COUNT(*) FROM communities
                        WHERE creator_username = ? AND (parent_community_id IS NULL OR parent_community_id = '')
                        """,
                        (username,),
                    )
                parent_count = int(_scalar(c.fetchone(), 0) or 0)
                free_communities_cap = 2
                try:
                    ent = resolve_entitlements(username) or {}
                    cap = ent.get("communities_max")
                    if isinstance(cap, int) and cap > 0:
                        free_communities_cap = cap
                except Exception:
                    logger.exception("bootstrap: resolve_entitlements failed for %s", username)
                if parent_count >= free_communities_cap:
                    return False, {
                        "success": False,
                        "error": (
                            f"Free plan allows up to {free_communities_cap} parent communities. "
                            "Upgrade to create more."
                        ),
                    }, 403
            else:
                parent_info = get_community_basic(c, parent_id_int)
                if not parent_info:
                    return False, {"success": False, "error": "Parent community not found"}, 404
                ancestors = get_community_ancestors(c, parent_id_int)
                depth = len(ancestors)
                top_info = ancestors[-1] if ancestors else parent_info
                top_creator = top_info.get("creator_username")
                if top_creator != username:
                    return False, {
                        "success": False,
                        "error": "Free plan sub-communities must be created under your own parent communities.",
                    }, 403
                if depth > 2:
                    return False, {
                        "success": False,
                        "error": "Free plan communities support only one nested level.",
                    }, 403
                if parent_info.get("parent_community_id") is None:
                    c.execute(
                        f"SELECT COUNT(*) FROM communities WHERE parent_community_id = {ph}",
                        (parent_id_int,),
                    )
                    child_count = int(_scalar(c.fetchone(), 0) or 0)
                    if child_count >= 3:
                        return False, {
                            "success": False,
                            "error": "Free plan parent communities can have up to 3 sub-communities.",
                        }, 403
                else:
                    c.execute(
                        f"SELECT COUNT(*) FROM communities WHERE parent_community_id = {ph}",
                        (parent_id_int,),
                    )
                    nested_count = int(_scalar(c.fetchone(), 0) or 0)
                    if nested_count >= 1:
                        return False, {
                            "success": False,
                            "error": "Free plan sub-communities can have only one nested community.",
                        }, 403

        placeholders = ", ".join([ph] * 14)
        c.execute(
            f"""
            INSERT INTO communities (
                name, type, creator_username, join_code, created_at, description, location,
                background_path, template, background_color, text_color, accent_color, card_color, parent_community_id
            )
            VALUES ({placeholders})
            """,
            (
                name,
                normalized_type,
                username,
                join_code,
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                description,
                location,
                background_path,
                template,
                background_color,
                text_color,
                accent_color,
                card_color,
                parent_id_int,
            ),
        )
        community_id = int(c.lastrowid)

        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        user_row = c.fetchone()
        if user_row:
            user_id = user_row["id"] if hasattr(user_row, "keys") else user_row[0]
            try:
                _add_user_legacy(c, int(user_id), community_id, role="owner")
            except CommunityMembershipLimitError as limit_err:
                conn.rollback()
                payload, status = render_member_cap_error(limit_err, session_username=username)
                return False, payload, status

        c.execute("SELECT id FROM users WHERE username = 'admin'")
        admin_row = c.fetchone()
        if admin_row:
            admin_id = admin_row["id"] if hasattr(admin_row, "keys") else admin_row[0]
            c.execute(
                f"SELECT 1 FROM user_communities WHERE user_id={ph} AND community_id={ph}",
                (admin_id, community_id),
            )
            if not c.fetchone():
                try:
                    _add_user_legacy(
                        c,
                        int(admin_id),
                        community_id,
                        role=None,
                        skip_welcome_post=True,
                    )
                except CommunityMembershipLimitError as limit_err:
                    conn.rollback()
                    payload, status = render_member_cap_error(limit_err, session_username=username)
                    return False, payload, status

        conn.commit()

    try:
        from redis_cache import invalidate_user_cache

        invalidate_user_cache(username)
    except Exception:
        pass

    _welcome_community(community_id)
    return True, {"success": True, "community_id": community_id, "name": name}, 200


def bootstrap_communities_for_onboarding(
    *,
    username: str,
    parent_name: str,
    child_names: Optional[List[str]] = None,
    parent_type: str = "general",
) -> Tuple[bool, Dict[str, Any], int]:
    """
    Create parent then each non-empty child name under the new parent.
    """
    child_names = [n.strip() for n in (child_names or []) if n and str(n).strip()]
    ok, first_body, status = _create_single_community(
        username=username,
        name=parent_name,
        community_type=parent_type,
        parent_id_int=None,
    )
    if not ok:
        return False, first_body, status
    parent_id = int(first_body["community_id"])
    created = [{"name": parent_name, "community_id": parent_id, "duplicate": bool(first_body.get("duplicate"))}]
    for ch in child_names:
        sub_ok, sub_body, sub_status = _create_single_community(
            username=username,
            name=ch,
            community_type="general",
            parent_id_int=parent_id,
        )
        if not sub_ok:
            return False, sub_body, sub_status
        created.append(
            {
                "name": ch,
                "community_id": int(sub_body["community_id"]),
                "duplicate": bool(sub_body.get("duplicate")),
            }
        )
    return True, {"success": True, "communities": created}, 200
