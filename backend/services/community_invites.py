"""Community invite services used by the invite API blueprint."""

from __future__ import annotations

import json
import logging
import os
import re
import secrets
import time
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple

from redis_cache import invalidate_user_cache

from backend.services import community_invite_emails, i18n, user_locale
from backend.services.community import (
    CommunityMembershipLimitError,
    ensure_community_tier_member_capacity,
    ensure_free_parent_member_capacity,
    fetch_community_names,
    get_parent_chain_ids,
    is_community_admin,
    render_member_cap_error,
)
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.email_normalization import canonicalize_with_policy
from backend.services.notifications import create_notification, send_push_to_user
from backend.services.steve_community_welcome import (
    ensure_introduce_yourself_thread,
    mirror_introduce_yourself_thread,
)


def _err(key: str, status: int, **params: Any) -> Tuple[Dict[str, Any], int]:
    """Return the service-layer error tuple with both the legacy ``error``
    string and the new ``message_key`` so callers can switch on either.

    Locale defaults to the current Flask request (when available) so PT-PT
    users see PT text without each blueprint having to pass it in.
    """
    try:
        from flask import request, session as _session

        username = (_session.get("username") if _session else None) or None
        locale = user_locale.resolve_request_locale(request, username)
    except Exception:
        locale = i18n.DEFAULT_LOCALE

    message = i18n.t(key, locale, **params)
    return {
        "success": False,
        "error": message,
        "error_code": key,
        "message_key": key,
        "message": message,
        "message_params": params,
    }, status


logger = logging.getLogger(__name__)
EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")
INVITE_EXPIRY_DAYS = 7
# Bulk invite guardrails: each request handles at most this many emails so a
# big campaign (e.g. a 300-person pilot wave) is sent as several short
# requests instead of one multi-minute request that can hit the Cloud Run
# timeout mid-batch. The admin UI chunks client-side to this size.
MAX_BULK_INVITES_PER_REQUEST = 50
# Resend rate-limits at roughly 2 requests/second; pace sequential sends so
# a full chunk never trips 429s (which would otherwise surface as failures).
BULK_SEND_DELAY_SECONDS = 0.4


@lru_cache(maxsize=1)
def _legacy_helpers():
    from bodybuilding_app import (  # type: ignore import-not-found
        _ensure_invite_single_use_column,
        _send_email_via_resend,
        add_user_to_community,
        ensure_community_invitations_table,
        get_invite_logo_url,
        has_community_management_permission,
        is_app_admin,
        normalize_id_list,
    )

    return {
        "add_user_to_community": add_user_to_community,
        "ensure_community_invitations_table": ensure_community_invitations_table,
        "get_invite_logo_url": get_invite_logo_url,
        "has_community_management_permission": has_community_management_permission,
        "is_app_admin": is_app_admin,
        "normalize_id_list": normalize_id_list,
        "_ensure_invite_single_use_column": _ensure_invite_single_use_column,
        "_send_email_via_resend": _send_email_via_resend,
    }


def _row_value(row: Any, key: str, index: int, default: Any = None) -> Any:
    if row is None:
        return default
    if hasattr(row, "keys") and key in row.keys():
        return row[key]
    if isinstance(row, dict):
        return row.get(key, default)
    if isinstance(row, (list, tuple)) and len(row) > index:
        return row[index]
    return default


def _public_base_url(host_url: Optional[str] = None) -> str:
    configured = (os.environ.get("PUBLIC_BASE_URL") or "").rstrip("/")
    return configured or (host_url or "https://app.c-point.co").rstrip("/")


def _invite_logo_url(base_url: str) -> str:
    # Single bundled logo everywhere (no longer admin-configurable).
    return f"{base_url}/static/cpoint-logo.png"


def _ensure_tables(cursor) -> None:
    _legacy_helpers()["ensure_community_invitations_table"](cursor)


def _invite_expires_at() -> str:
    return (datetime.utcnow() + timedelta(days=INVITE_EXPIRY_DAYS)).strftime("%Y-%m-%d %H:%M:%S")


def _is_expired(value: Any) -> bool:
    if not value:
        return False
    if isinstance(value, datetime):
        return value < datetime.utcnow()
    text = str(value).replace("T", " ").replace("Z", "").split(".")[0]
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt) < datetime.utcnow()
        except ValueError:
            continue
    return False


def _expired_payload() -> Tuple[Dict[str, Any], int]:
    message = i18n.t("communities.invite.expired", i18n.DEFAULT_LOCALE)
    if message == "communities.invite.expired":
        message = "This invitation has expired. Ask the sender to send a new one."
    return {
        "success": False,
        "error": message,
        "error_code": "invite_expired",
        "message_key": "invite_expired",
    }, 410


def _request_locale(username: Optional[str] = None) -> str:
    try:
        from flask import request

        return user_locale.resolve_request_locale(request, username)
    except Exception:
        return i18n.DEFAULT_LOCALE


def _is_qr_invite(invited_email: Optional[str]) -> bool:
    return bool(
        invited_email
        and str(invited_email).startswith("qr-invite-")
        and str(invited_email).endswith("@placeholder.local")
    )


def _canonical_email(value: Optional[str]) -> str:
    return canonicalize_with_policy(value or "") if value else ""


def _emails_match(left: Optional[str], right: Optional[str]) -> bool:
    left_canonical = _canonical_email(left)
    right_canonical = _canonical_email(right)
    return bool(left_canonical and right_canonical and left_canonical == right_canonical)


def _single_use_column(cursor) -> None:
    _legacy_helpers()["_ensure_invite_single_use_column"](cursor)


def _has_manage_permission(username: str, community_id: int) -> bool:
    return bool(_legacy_helpers()["has_community_management_permission"](username, community_id))


def _is_app_admin(username: str) -> bool:
    return bool(_legacy_helpers()["is_app_admin"](username))


def _normalize_id_list(raw) -> List[int]:
    return _legacy_helpers()["normalize_id_list"](raw)


def _add_user_to_community(cursor, user_id: int, community_id: int, *, username: Optional[str]) -> None:
    _legacy_helpers()["add_user_to_community"](
        cursor,
        user_id,
        int(community_id),
        role="member",
        username=username,
    )


def _member_cap_payload(
    cursor,
    community_id: int,
    inviter_username: Optional[str],
    target_username: Optional[str] = None,
    *,
    extra_members: int = 1,
) -> Optional[Tuple[Dict[str, Any], int]]:
    try:
        ensure_free_parent_member_capacity(
            cursor,
            community_id,
            extra_members,
            attempted_username=target_username or inviter_username,
        )
        ensure_community_tier_member_capacity(
            cursor,
            community_id,
            extra_members,
            attempted_username=target_username or inviter_username,
        )
        return None
    except CommunityMembershipLimitError as exc:
        cap = getattr(exc, "cap", None)
        community_name = getattr(exc, "community_name", "") or "This community"
        message = (
            f"Max member limit achieved. {community_name} has reached its {cap}-member limit. "
            "Upgrade the community tier to invite more members."
            if cap
            else "Max member limit achieved. Upgrade the community tier to invite more members."
        )
        return {
            "success": False,
            "error": message,
            "reason_code": "community_member_limit",
            "community_id": community_id,
            "max_members": cap,
            "show_upgrade": True,
            "upgrade_url": f"/subscription_plans?community_id={community_id}",
        }, 403


def _community_invite_join_ids(community_id: int, raw_nested_values=None, raw_parent_values=None) -> List[int]:
    try:
        return [int(community_id)]
    except (TypeError, ValueError):
        return []


def invite_settings(username: str, community_id: int, method: str, payload: Optional[Dict[str, Any]]) -> Tuple[Dict[str, Any], int]:
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            _single_use_column(c)
            ph = get_sql_placeholder()
            if method == "GET":
                c.execute(f"SELECT invite_single_use FROM communities WHERE id = {ph}", (community_id,))
                row = c.fetchone()
                if not row:
                    return {"success": False, "error": "Community not found"}, 404
                return {"success": True, "invite_single_use": bool(_row_value(row, "invite_single_use", 0))}, 200
            if not is_community_admin(username, community_id):
                return {"success": False, "error": "Admin access required"}, 403
            single_use = bool((payload or {}).get("invite_single_use", False))
            c.execute(f"UPDATE communities SET invite_single_use = {ph} WHERE id = {ph}", (1 if single_use else 0, community_id))
            conn.commit()
            return {"success": True, "invite_single_use": single_use}, 200
    except Exception as exc:
        logger.error("Error in community invite settings: %s", exc)
        return {"success": False, "error": "Server error"}, 500


def generate_invite_link(username: str, community_id_raw: Any, host_url: str) -> Tuple[Dict[str, Any], int]:
    if not community_id_raw:
        return {"success": False, "error": "Community ID required"}, 400
    try:
        community_id = int(community_id_raw)
    except (TypeError, ValueError):
        return {"success": False, "error": "Invalid community ID"}, 400
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(
                f"""
                SELECT c.name, c.creator_username, c.parent_community_id
                FROM communities c
                WHERE c.id = {ph}
                """,
                (community_id,),
            )
            community = c.fetchone()
            if not community:
                return {"success": False, "error": "Community not found"}, 404
            if _row_value(community, "parent_community_id", 2):
                return {"success": False, "error": "Invites can only be created from root communities"}, 400
            if not _has_manage_permission(username, community_id):
                return {"success": False, "error": "Only community admins can generate invite links"}, 403
            cap_payload = _member_cap_payload(c, community_id, username)
            if cap_payload:
                return cap_payload
            token = secrets.token_urlsafe(32)
            expires_at = _invite_expires_at()
            _ensure_tables(c)
            c.execute(
                f"""
                INSERT INTO community_invitations
                    (community_id, invited_email, invited_by_username, token, include_nested_ids, include_parent_ids, expires_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                """,
                (
                    community_id,
                    f"qr-invite-{token[:8]}@placeholder.local",
                    username,
                    token,
                    json.dumps([]),
                    json.dumps([]),
                    expires_at,
                ),
            )
            conn.commit()
            return {
                "success": True,
                "invite_url": f"{_public_base_url(host_url)}/invite/{token}",
                "community_name": _row_value(community, "name", 0),
                "expires_at": expires_at,
            }, 200
    except Exception as exc:
        logger.error("Error generating invite link: %s", exc, exc_info=True)
        return {"success": False, "error": "Server error"}, 500


def fetch_manageable_communities(username: str, target_username: Optional[str]) -> Tuple[Dict[str, Any], int]:
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            params: List[Any] = []
            target_join = ""
            target_select = "0 AS target_is_member"
            if target_username:
                target_select = "CASE WHEN tuc.user_id IS NULL THEN 0 ELSE 1 END AS target_is_member"
                target_join = f"""
                    LEFT JOIN users tu ON LOWER(tu.username) = LOWER({ph})
                    LEFT JOIN user_communities tuc ON tuc.community_id = c.id AND tuc.user_id = tu.id
                """
                params.append(target_username)
            if _is_app_admin(username):
                c.execute(
                    f"""
                    SELECT DISTINCT c.id, c.name, c.type, c.parent_community_id, c.creator_username,
                           {target_select}
                    FROM communities c
                    {target_join}
                    WHERE c.parent_community_id IS NULL
                    ORDER BY c.name
                    """,
                    tuple(params),
                )
            else:
                params.extend([username, username])
                c.execute(
                    f"""
                    SELECT DISTINCT c.id, c.name, c.type, c.parent_community_id, c.creator_username,
                           {target_select}
                    FROM communities c
                    {target_join}
                    LEFT JOIN user_communities uc ON uc.community_id = c.id
                    LEFT JOIN users u ON u.id = uc.user_id
                    WHERE c.parent_community_id IS NULL
                      AND (
                        c.creator_username = {ph}
                        OR (LOWER(u.username) = LOWER({ph}) AND LOWER(COALESCE(uc.role, '')) IN ('admin', 'owner'))
                      )
                    ORDER BY c.name
                    """,
                    tuple(params),
                )
            communities = []
            for row in c.fetchall() or []:
                communities.append(
                    {
                        "id": _row_value(row, "id", 0),
                        "name": _row_value(row, "name", 1),
                        "type": _row_value(row, "type", 2),
                        "parent_community_id": _row_value(row, "parent_community_id", 3),
                        "creator_username": _row_value(row, "creator_username", 4),
                        "target_is_member": bool(_row_value(row, "target_is_member", 5)),
                    }
                )
            return {"success": True, "communities": communities}, 200
    except Exception as exc:
        logger.error("Error listing manageable communities for %s: %s", username, exc, exc_info=True)
        return {"success": False, "error": "Server error"}, 500


def invite_username(username: str, data: Dict[str, Any]) -> Tuple[Dict[str, Any], int]:
    target_username = (data.get("username") or "").strip().lstrip("@")
    community_id_raw = data.get("community_id")
    if not community_id_raw:
        return {"success": False, "error": "Community ID required"}, 400
    if not target_username:
        return {"success": False, "error": "Username is required"}, 400
    if target_username.lower() == (username or "").lower():
        return _err("communities.invite.cannot_invite_self", 400)
    try:
        community_id = int(community_id_raw)
    except (TypeError, ValueError):
        return {"success": False, "error": "Invalid community ID"}, 400
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            _ensure_tables(c)
            ph = get_sql_placeholder()
            if not _has_manage_permission(username, community_id):
                return _err("communities.admin_required", 403)
            c.execute(f"SELECT name, parent_community_id FROM communities WHERE id = {ph}", (community_id,))
            community_row = c.fetchone()
            if not community_row:
                return _err("communities.not_found", 404)
            community_name = _row_value(community_row, "name", 0)
            if _row_value(community_row, "parent_community_id", 1):
                return _err("communities.invite.root_only", 400)
            cap_payload = _member_cap_payload(c, community_id, username, target_username)
            if cap_payload:
                return cap_payload
            expires_at = _invite_expires_at()
            generic_payload = {
                "success": True,
                "community_name": community_name,
                "message": i18n.t("communities.invite.if_exists", _request_locale(username)),
                "expires_at": expires_at,
            }
            c.execute(f"SELECT id, username FROM users WHERE LOWER(username) = LOWER({ph})", (target_username,))
            target_row = c.fetchone()
            if not target_row:
                return generic_payload, 200
            target_user_id = _row_value(target_row, "id", 0)
            resolved_target_username = _row_value(target_row, "username", 1)
            c.execute(
                f"SELECT 1 FROM user_communities WHERE user_id = {ph} AND community_id = {ph}",
                (target_user_id, community_id),
            )
            if c.fetchone():
                return generic_payload, 200
            c.execute(
                f"""
                SELECT id, token
                FROM community_invitations
                WHERE community_id = {ph} AND LOWER(invited_username) = LOWER({ph}) AND used = 0 AND COALESCE(status, 'pending') = 'pending'
                LIMIT 1
                """,
                (community_id, resolved_target_username),
            )
            existing_invite = c.fetchone()
            token = secrets.token_urlsafe(32)
            placeholder_email = f"username-invite-{str(resolved_target_username).lower()}@placeholder.local"
            if existing_invite:
                invite_id = _row_value(existing_invite, "id", 0)
                c.execute(
                    f"""
                    UPDATE community_invitations
                    SET invited_by_username = {ph}, invited_email = {ph}, token = {ph}, invited_at = CURRENT_TIMESTAMP,
                        include_nested_ids = {ph}, include_parent_ids = {ph}, status = 'pending', responded_at = NULL,
                        expires_at = {ph}
                    WHERE id = {ph}
                    """,
                    (username, placeholder_email, token, json.dumps([]), json.dumps([]), expires_at, invite_id),
                )
            else:
                c.execute(
                    f"""
                    INSERT INTO community_invitations
                        (community_id, invited_email, invited_username, invited_by_username, token, include_nested_ids, include_parent_ids, status, used, expires_at)
                    VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, 'pending', 0, {ph})
                    """,
                    (
                        community_id,
                        placeholder_email,
                        resolved_target_username,
                        username,
                        token,
                        json.dumps([]),
                        json.dumps([]),
                        expires_at,
                    ),
                )
                invite_id = c.lastrowid
            message = f"{username} invited you to {community_name}"
            create_notification(
                resolved_target_username,
                username,
                "community_invite",
                community_id=community_id,
                message=message,
                link="/notifications?tab=invites",
            )
            try:
                send_push_to_user(
                    resolved_target_username,
                    {
                        "title": "Community invitation",
                        "body": message,
                        "url": "/notifications?tab=invites",
                        "tag": f"community-invite-{community_id}-{resolved_target_username}",
                    },
                )
            except Exception as exc:
                logger.warning("Failed to send username invite push to %s: %s", resolved_target_username, exc)
            conn.commit()
            return generic_payload, 200
    except Exception as exc:
        logger.error("Error creating username invite: %s", exc, exc_info=True)
        return {"success": False, "error": "Server error"}, 500


def list_pending_invites(username: str, *, include_email: bool = False) -> Tuple[Dict[str, Any], int]:
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            _ensure_tables(c)
            ph = get_sql_placeholder()
            c.execute(f"SELECT email, canonical_email FROM users WHERE LOWER(username) = LOWER({ph})", (username,))
            user_row = c.fetchone()
            user_email = (_row_value(user_row, "email", 0, "") or "").strip().lower()
            user_canonical = (_row_value(user_row, "canonical_email", 1, "") or _canonical_email(user_email)).strip().lower()
            email_clause = ""
            params: List[Any] = [username]
            if include_email and user_email:
                email_clause = (
                    f" OR (ci.invited_username IS NULL AND (LOWER(ci.invited_email) = LOWER({ph})"
                    f" OR LOWER(ci.invited_email) = LOWER({ph})))"
                )
                params.extend([user_email, user_canonical])
            c.execute(
                f"""
                SELECT ci.id, ci.community_id, ci.invited_by_username, ci.invited_at,
                       ci.include_nested_ids, ci.include_parent_ids, c.name as community_name,
                       ci.expires_at, ci.token, ci.invited_email
                FROM community_invitations ci
                JOIN communities c ON c.id = ci.community_id
                WHERE (LOWER(ci.invited_username) = LOWER({ph}){email_clause})
                  AND ci.used = 0
                  AND COALESCE(ci.status, 'pending') = 'pending'
                ORDER BY ci.invited_at DESC
                """,
                tuple(params),
            )
            invites = []
            for row in c.fetchall() or []:
                raw_nested = _row_value(row, "include_nested_ids", 4)
                raw_parent = _row_value(row, "include_parent_ids", 5)
                invites.append(
                    {
                        "id": _row_value(row, "id", 0),
                        "community_id": _row_value(row, "community_id", 1),
                        "invited_by_username": _row_value(row, "invited_by_username", 2),
                        "invited_at": str(_row_value(row, "invited_at", 3)),
                        "community_name": _row_value(row, "community_name", 6),
                        "include_nested_ids": _normalize_id_list(raw_nested) if raw_nested else [],
                        "include_parent_ids": _normalize_id_list(raw_parent) if raw_parent else [],
                        "expires_at": str(_row_value(row, "expires_at", 7) or ""),
                        "expired": _is_expired(_row_value(row, "expires_at", 7)),
                        "token": _row_value(row, "token", 8),
                        "invite_type": "email" if _row_value(row, "invited_email", 9) else "username",
                    }
                )
            return {"success": True, "invites": invites}, 200
    except Exception as exc:
        logger.error("Error listing pending username invites for %s: %s", username, exc, exc_info=True)
        return {"success": False, "error": "Server error"}, 500


def accept_invite(username: str, invite_id: int) -> Tuple[Dict[str, Any], int]:
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            _ensure_tables(c)
            ph = get_sql_placeholder()
            c.execute(f"SELECT id, email, canonical_email FROM users WHERE username = {ph}", (username,))
            user_row = c.fetchone()
            if not user_row:
                return {"success": False, "error": "User not found"}, 404
            user_id = _row_value(user_row, "id", 0)
            user_email = (_row_value(user_row, "email", 1, "") or "").strip().lower()
            user_canonical = (_row_value(user_row, "canonical_email", 2, "") or _canonical_email(user_email)).strip().lower()
            c.execute(
                f"""
                SELECT ci.id, ci.community_id, ci.invited_username, ci.used, ci.status,
                       ci.include_nested_ids, ci.include_parent_ids, c.name as community_name,
                       ci.invited_by_username, ci.invited_email, ci.expires_at
                FROM community_invitations ci
                JOIN communities c ON c.id = ci.community_id
                WHERE ci.id = {ph}
                """,
                (invite_id,),
            )
            invite = c.fetchone()
            if not invite:
                return {"success": False, "error": "Invite not found"}, 404
            invited_username = _row_value(invite, "invited_username", 2)
            used = _row_value(invite, "used", 3)
            status = _row_value(invite, "status", 4)
            invited_email = (_row_value(invite, "invited_email", 9, "") or "").strip().lower()
            username_matches = bool(invited_username and str(invited_username).lower() == username.lower())
            email_matches = bool(
                invited_email
                and not _is_qr_invite(invited_email)
                and (_emails_match(user_email, invited_email) or _emails_match(user_canonical, invited_email))
            )
            if not username_matches and not email_matches:
                return {"success": False, "error": "Invite not found"}, 404
            if used or (status and status != "pending"):
                return {"success": False, "error": "Invite is no longer pending"}, 400
            if _is_expired(_row_value(invite, "expires_at", 10)):
                return _expired_payload()
            community_id = int(_row_value(invite, "community_id", 1))
            c.execute(f"SELECT 1 FROM user_communities WHERE user_id = {ph} AND community_id = {ph}", (user_id, community_id))
            if c.fetchone():
                return {"success": False, "error": "You are already a member of this community"}, 400
            for comm_id in _community_invite_join_ids(
                community_id,
                _row_value(invite, "include_nested_ids", 5),
                _row_value(invite, "include_parent_ids", 6),
            ):
                c.execute(f"SELECT 1 FROM user_communities WHERE user_id = {ph} AND community_id = {ph}", (user_id, comm_id))
                if not c.fetchone():
                    try:
                        _add_user_to_community(c, int(user_id), int(comm_id), username=username)
                    except CommunityMembershipLimitError as exc:
                        conn.rollback()
                        return render_member_cap_error(exc, session_username=username)
            now_value = datetime.now().isoformat()
            c.execute(
                f"UPDATE community_invitations SET used = 1, used_at = {ph}, status = 'accepted', responded_at = {ph} WHERE id = {ph}",
                (now_value, now_value, invite_id),
            )
            c.execute(
                f"""
                UPDATE notifications
                SET is_read = 1
                WHERE user_id = {ph} AND type = 'community_invite' AND community_id = {ph} AND is_read = 0
                """,
                (username, community_id),
            )
            introduce_thread_post_id = ensure_introduce_yourself_thread(c, community_id)
            notify_community_new_member(
                community_id,
                username,
                conn,
                introduce_thread_post_id=introduce_thread_post_id,
            )
            conn.commit()
            mirror_introduce_yourself_thread(introduce_thread_post_id, community_id)
            invalidate_user_cache(username)
            community_name = _row_value(invite, "community_name", 7)
            return {
                "success": True,
                "community_id": community_id,
                "community_name": community_name,
                "introduce_thread_post_id": introduce_thread_post_id,
                "next_url": f"/community_feed_react/{community_id}?joined=1",
                "message": f"Joined {community_name}",
            }, 200
    except Exception as exc:
        logger.error("Error accepting username invite %s: %s", invite_id, exc, exc_info=True)
        return {"success": False, "error": "Server error"}, 500


def decline_invite(username: str, invite_id: int) -> Tuple[Dict[str, Any], int]:
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            _ensure_tables(c)
            ph = get_sql_placeholder()
            c.execute(f"SELECT email, canonical_email FROM users WHERE LOWER(username) = LOWER({ph})", (username,))
            user_row = c.fetchone()
            user_email = (_row_value(user_row, "email", 0, "") or "").strip().lower()
            user_canonical = (_row_value(user_row, "canonical_email", 1, "") or _canonical_email(user_email)).strip().lower()
            c.execute(
                f"""
                SELECT id, community_id, invited_username, used, status, invited_email
                FROM community_invitations
                WHERE id = {ph}
                """,
                (invite_id,),
            )
            invite = c.fetchone()
            if not invite:
                return {"success": False, "error": "Invite not found"}, 404
            invited_username = _row_value(invite, "invited_username", 2)
            used = _row_value(invite, "used", 3)
            status = _row_value(invite, "status", 4)
            community_id = _row_value(invite, "community_id", 1)
            invited_email = (_row_value(invite, "invited_email", 5, "") or "").strip().lower()
            username_matches = bool(invited_username and str(invited_username).lower() == username.lower())
            email_matches = bool(
                invited_email
                and not _is_qr_invite(invited_email)
                and (_emails_match(user_email, invited_email) or _emails_match(user_canonical, invited_email))
            )
            if not username_matches and not email_matches:
                return {"success": False, "error": "Invite not found"}, 404
            if used or (status and status != "pending"):
                return {"success": False, "error": "Invite is no longer pending"}, 400
            now_value = datetime.now().isoformat()
            c.execute(
                f"UPDATE community_invitations SET status = 'declined', responded_at = {ph} WHERE id = {ph}",
                (now_value, invite_id),
            )
            c.execute(
                f"""
                UPDATE notifications
                SET is_read = 1
                WHERE user_id = {ph} AND type = 'community_invite' AND community_id = {ph} AND is_read = 0
                """,
                (username, community_id),
            )
            conn.commit()
            return {"success": True}, 200
    except Exception as exc:
        logger.error("Error declining username invite %s: %s", invite_id, exc, exc_info=True)
        return {"success": False, "error": "Server error"}, 500


def decline_token_invite(username: str, invite_token: str) -> Tuple[Dict[str, Any], int]:
    if not invite_token:
        return {"success": False, "error": "Invitation token required"}, 400
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            _ensure_tables(c)
            ph = get_sql_placeholder()
            c.execute(f"SELECT email, canonical_email FROM users WHERE LOWER(username) = LOWER({ph})", (username,))
            user_row = c.fetchone()
            user_email = (_row_value(user_row, "email", 0, "") or "").strip().lower()
            user_canonical = (_row_value(user_row, "canonical_email", 1, "") or _canonical_email(user_email)).strip().lower()
            c.execute(
                f"""
                SELECT id, community_id, invited_email, used, status
                FROM community_invitations
                WHERE token = {ph}
                """,
                (invite_token,),
            )
            invite = c.fetchone()
            if not invite:
                return {"success": False, "error": "Invite not found"}, 404
            invited_email = (_row_value(invite, "invited_email", 2, "") or "").strip().lower()
            if _is_qr_invite(invited_email):
                return {"success": True, "message": "Invitation left pending"}, 200
            if not (_emails_match(user_email, invited_email) or _emails_match(user_canonical, invited_email)):
                return {"success": False, "error": "Invite not found"}, 404
            if _row_value(invite, "used", 3) or (_row_value(invite, "status", 4) and _row_value(invite, "status", 4) != "pending"):
                return {"success": False, "error": "Invite is no longer pending"}, 400
            now_value = datetime.now().isoformat()
            c.execute(
                f"UPDATE community_invitations SET status = 'declined', responded_at = {ph} WHERE token = {ph}",
                (now_value, invite_token),
            )
            conn.commit()
            return {"success": True}, 200
    except Exception as exc:
        logger.error("Error declining token invite: %s", exc, exc_info=True)
        return {"success": False, "error": "Server error"}, 500


def notify_community_new_member(
    community_id: int,
    new_username: str,
    conn,
    *,
    introduce_thread_post_id: Optional[int] = None,
) -> None:
    try:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(f"SELECT name, notify_on_new_member FROM communities WHERE id = {ph}", (community_id,))
        row = c.fetchone()
        if not row or not _row_value(row, "notify_on_new_member", 1):
            return
        community_name = _row_value(row, "name", 0)
        c.execute(
            f"""
            SELECT DISTINCT u.username
            FROM user_communities uc
            JOIN users u ON uc.user_id = u.id
            WHERE uc.community_id = {ph} AND LOWER(u.username) != LOWER({ph})
            """,
            (community_id, new_username),
        )
        message = f"{new_username} just joined {community_name}"
        link = (
            f"/post/{introduce_thread_post_id}?prompt=welcome"
            if introduce_thread_post_id
            else f"/community_feed/{community_id}"
        )
        for member in c.fetchall() or []:
            member_username = _row_value(member, "username", 0)
            try:
                create_notification(
                    member_username,
                    new_username,
                    "new_member",
                    community_id=community_id,
                    message=message,
                    link=link,
                )
                send_push_to_user(
                    member_username,
                    {
                        "title": f"New member in {community_name}",
                        "body": message,
                        "url": link,
                        "tag": f"new_member_{community_id}_{new_username}",
                    },
                )
            except Exception as exc:
                logger.warning("Failed new member notification for %s: %s", member_username, exc)
    except Exception as exc:
        logger.error("Error sending new member notifications: %s", exc, exc_info=True)


def join_with_invite(username: str, invite_token: str) -> Tuple[Dict[str, Any], int]:
    return accept_token_invite(username, invite_token)


def accept_token_invite(username: str, invite_token: str) -> Tuple[Dict[str, Any], int]:
    if not invite_token:
        return _err("communities.invite.token_required", 400)
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(f"SELECT id, email, canonical_email FROM users WHERE username = {ph}", (username,))
            user_row = c.fetchone()
            if not user_row:
                return _err("communities.invite.user_not_found", 404)
            user_id = _row_value(user_row, "id", 0)
            user_email = _row_value(user_row, "email", 1)
            user_canonical = _row_value(user_row, "canonical_email", 2) or _canonical_email(user_email)
            c.execute(
                f"""
                SELECT ci.id, ci.community_id, ci.used, ci.invited_email, c.name as community_name,
                       ci.include_nested_ids, ci.include_parent_ids, ci.status, ci.expires_at
                FROM community_invitations ci
                JOIN communities c ON ci.community_id = c.id
                WHERE ci.token = {ph}
                """,
                (invite_token,),
            )
            invitation = c.fetchone()
            if not invitation:
                return _err("communities.invite.invalid_invitation", 404)
            if _row_value(invitation, "used", 2):
                return _err("communities.join.used_invite", 400)
            status = _row_value(invitation, "status", 7)
            if status and status != "pending":
                return _err("communities.invite.not_pending", 400)
            if _is_expired(_row_value(invitation, "expires_at", 8)):
                return _expired_payload()
            invitation_id = _row_value(invitation, "id", 0)
            community_id = int(_row_value(invitation, "community_id", 1))
            invited_email = _row_value(invitation, "invited_email", 3)
            is_qr_invite = _is_qr_invite(invited_email)
            if not is_qr_invite and not (_emails_match(user_email, invited_email) or _emails_match(user_canonical, invited_email)):
                return _err("communities.invite.email_mismatch", 403)
            c.execute(f"SELECT 1 FROM user_communities WHERE user_id = {ph} AND community_id = {ph}", (user_id, community_id))
            if c.fetchone():
                return _err("communities.invite.already_member", 400)
            join_ids = [community_id]
            for comm_id in join_ids:
                c.execute(f"SELECT 1 FROM user_communities WHERE user_id = {ph} AND community_id = {ph}", (user_id, comm_id))
                if not c.fetchone():
                    try:
                        _add_user_to_community(c, int(user_id), int(comm_id), username=username)
                    except CommunityMembershipLimitError as exc:
                        conn.rollback()
                        return render_member_cap_error(exc, session_username=username)
            now_value = datetime.now().isoformat()
            c.execute(
                f"""
                UPDATE community_invitations
                SET used = 1, used_at = {ph}, status = 'accepted', responded_at = {ph}
                WHERE id = {ph}
                """,
                (now_value, now_value, invitation_id),
            )
            introduce_thread_post_id = ensure_introduce_yourself_thread(c, community_id)
            notify_community_new_member(
                community_id,
                username,
                conn,
                introduce_thread_post_id=introduce_thread_post_id,
            )
            conn.commit()
            mirror_introduce_yourself_thread(introduce_thread_post_id, community_id)
            invalidate_user_cache(username)
            community_name = _row_value(invitation, "community_name", 4)
            try:
                from flask import request, session as _session

                locale = user_locale.resolve_request_locale(request, _session.get("username"))
            except Exception:
                locale = i18n.DEFAULT_LOCALE
            joined_message = i18n.t("communities.join.joined", locale, community_name=community_name)
            return {
                "success": True,
                "community_id": community_id,
                "community_name": community_name,
                "introduce_thread_post_id": introduce_thread_post_id,
                "next_url": f"/community_feed_react/{community_id}?joined=1",
                "message": joined_message,
                "message_key": "communities.join.joined",
            }, 200
    except Exception as exc:
        logger.error("Error joining with invite: %s", exc, exc_info=True)
        return _err("errors.server", 500)


def invite_info(invite_token: str) -> Tuple[Dict[str, Any], int]:
    if not invite_token:
        return {"success": False, "error": "Invitation token required"}, 400
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(
                f"""
                SELECT ci.community_id, c.name as community_name, ci.used, ci.expires_at
                FROM community_invitations ci
                JOIN communities c ON ci.community_id = c.id
                WHERE ci.token = {ph}
                """,
                (invite_token,),
            )
            invitation = c.fetchone()
            if not invitation:
                return {"success": False, "error": "Invalid invitation"}, 404
            if _is_expired(_row_value(invitation, "expires_at", 3)):
                payload, status = _expired_payload()
                payload.update({
                    "community_id": _row_value(invitation, "community_id", 0),
                    "community_name": _row_value(invitation, "community_name", 1),
                })
                return payload, status
            return {
                "success": True,
                "community_id": _row_value(invitation, "community_id", 0),
                "community_name": _row_value(invitation, "community_name", 1),
                "expires_at": str(_row_value(invitation, "expires_at", 3) or ""),
            }, 200
    except Exception as exc:
        logger.error("Error getting invite info: %s", exc, exc_info=True)
        return {"success": False, "error": "Server error"}, 500


def invite_preview(invite_token: str, username: Optional[str] = None) -> Tuple[Dict[str, Any], int]:
    if not invite_token:
        return _err("communities.invite.token_required", 400)
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            _ensure_tables(c)
            ph = get_sql_placeholder()
            c.execute(
                f"""
                SELECT ci.id, ci.community_id, ci.invited_email, ci.invited_username,
                       ci.invited_by_username, ci.invited_at, ci.used, ci.status,
                       ci.expires_at, c.name as community_name
                FROM community_invitations ci
                JOIN communities c ON ci.community_id = c.id
                WHERE ci.token = {ph}
                """,
                (invite_token,),
            )
            invite = c.fetchone()
            if not invite:
                return _err("communities.invite.invalid_invitation", 404)
            invited_email = _row_value(invite, "invited_email", 2)
            invited_username = _row_value(invite, "invited_username", 3)
            expired = _is_expired(_row_value(invite, "expires_at", 8))
            used = bool(_row_value(invite, "used", 6))
            status_value = _row_value(invite, "status", 7) or "pending"
            already_member = False
            can_view_recipient = False
            if username:
                c.execute(f"SELECT email, canonical_email FROM users WHERE LOWER(username) = LOWER({ph})", (username,))
                user_row = c.fetchone()
                user_email = _row_value(user_row, "email", 0, "") if user_row else ""
                user_canonical = _row_value(user_row, "canonical_email", 1, "") if user_row else ""
                can_view_recipient = bool(
                    (invited_username and str(invited_username).lower() == str(username).lower())
                    or (
                        invited_email
                        and not _is_qr_invite(invited_email)
                        and (_emails_match(user_email, invited_email) or _emails_match(user_canonical, invited_email))
                    )
                )
                c.execute(
                    f"""
                    SELECT 1
                    FROM user_communities uc
                    JOIN users u ON u.id = uc.user_id
                    WHERE LOWER(u.username) = LOWER({ph}) AND uc.community_id = {ph}
                    """,
                    (username, _row_value(invite, "community_id", 1)),
                )
                already_member = c.fetchone() is not None
            return {
                "success": True,
                "invite_id": _row_value(invite, "id", 0),
                "community_id": _row_value(invite, "community_id", 1),
                "community_name": _row_value(invite, "community_name", 9),
                "invited_email": invited_email if can_view_recipient else None,
                "invited_username": invited_username if can_view_recipient else None,
                "invited_by_username": _row_value(invite, "invited_by_username", 4),
                "invited_at": str(_row_value(invite, "invited_at", 5) or ""),
                "expires_at": str(_row_value(invite, "expires_at", 8) or ""),
                "used": used,
                "status": status_value,
                "expired": expired,
                "already_member": already_member,
                "recipient_bound": not _is_qr_invite(_row_value(invite, "invited_email", 2)),
            }, 200
    except Exception as exc:
        logger.error("Error previewing invite: %s", exc, exc_info=True)
        return _err("errors.server", 500)


def invite_email(username: str, data: Dict[str, Any], host_url: str) -> Tuple[Dict[str, Any], int]:
    community_id = data.get("community_id")
    invited_email = (data.get("email") or "").strip().lower()
    if not community_id or not invited_email:
        return {"success": False, "error": "Community ID and email are required"}, 400
    if not EMAIL_RE.match(invited_email):
        return {"success": False, "error": "Invalid email format"}, 400
    try:
        community_id = int(community_id)
    except (TypeError, ValueError):
        return {"success": False, "error": "Invalid community ID"}, 400
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(f"SELECT name, parent_community_id FROM communities WHERE id = {ph}", (community_id,))
            community = c.fetchone()
            if not community:
                return {"success": False, "error": "Community not found"}, 404
            community_name = _row_value(community, "name", 0)
            if _row_value(community, "parent_community_id", 1):
                return {"success": False, "error": "Invites can only be created from root communities"}, 400
            if not _has_manage_permission(username, community_id):
                return {"success": False, "error": "Only community admins can send invitations"}, 403
            cap_payload = _member_cap_payload(c, community_id, username, invited_email)
            if cap_payload:
                return cap_payload
            _ensure_tables(c)
            invited_canonical = _canonical_email(invited_email)
            c.execute(
                f"SELECT id, username FROM users WHERE LOWER(email) = LOWER({ph}) OR canonical_email = {ph}",
                (invited_email, invited_canonical),
            )
            existing_user = c.fetchone()
            base_url = _public_base_url(host_url)
            logo_url = _invite_logo_url(base_url)
            existing_username = _row_value(existing_user, "username", 1) if existing_user else None
            if existing_user:
                existing_user_id = _row_value(existing_user, "id", 0)
                c.execute(
                    f"SELECT 1 FROM user_communities WHERE community_id = {ph} AND user_id = {ph}",
                    (community_id, existing_user_id),
                )
                if c.fetchone():
                    return {"success": False, "error": "User is already a member of this community"}, 400
            c.execute(
                f"DELETE FROM community_invitations WHERE community_id = {ph} AND invited_email = {ph} AND used = 0",
                (community_id, invited_email),
            )
            token = secrets.token_urlsafe(32)
            expires_at = _invite_expires_at()
            c.execute(
                f"""
                INSERT INTO community_invitations
                    (community_id, invited_email, invited_username, invited_by_username, token, include_nested_ids, include_parent_ids, expires_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                """,
                (community_id, invited_email, existing_username, username, token, json.dumps([]), json.dumps([]), expires_at),
            )
            conn.commit()
            invite_url = f"{base_url}/invite/{token}"
            html, text = community_invite_emails.render_new_user_invite_email(
                inviter_username=username,
                community_name=community_name,
                invite_url=invite_url,
                nested_names=fetch_community_names(c, []),
                logo_url=logo_url,
                expires_at=expires_at,
            )
            if existing_username:
                create_notification(
                    existing_username,
                    username,
                    "community_invite",
                    community_id=community_id,
                    message=f"{username} invited you to {community_name}",
                    link="/notifications?tab=invites",
                )
            success = _legacy_helpers()["_send_email_via_resend"](
                to_email=invited_email,
                subject=community_invite_emails.invite_subject(
                    kind="new",
                    inviter_username=username,
                    community_name=community_name,
                ),
                html=html,
                text=text,
            )
            if not success:
                return {"success": False, "error": "Failed to send invitation email"}, 500
            return {
                "success": True,
                "message": "Invitation sent successfully. This invitation is valid for 7 days.",
                "expires_at": expires_at,
            }, 200
    except Exception as exc:
        logger.error("Error sending invitation: %s", exc, exc_info=True)
        return {"success": False, "error": "Server error"}, 500


def _count_pending_invites(cursor, community_id: int) -> int:
    """Live (unused, unexpired) invitations for capacity accounting."""
    ph = get_sql_placeholder()
    try:
        cursor.execute(
            f"""
            SELECT COUNT(*) FROM community_invitations
            WHERE community_id = {ph} AND used = 0
              AND COALESCE(status, 'pending') = 'pending'
              AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
            """,
            (community_id,),
        )
        row = cursor.fetchone()
        if not row:
            return 0
        value = list(row.values())[0] if hasattr(row, "keys") else row[0]
        return int(value or 0)
    except Exception:
        return 0


def invite_bulk(username: str, data: Dict[str, Any], host_url: str) -> Tuple[Dict[str, Any], int]:
    community_id = data.get("community_id")
    emails_raw = data.get("emails", "")
    if not community_id:
        return {"success": False, "error": "community_id required"}, 400
    try:
        community_id = int(community_id)
    except (TypeError, ValueError):
        return {"success": False, "error": "Invalid community_id"}, 400
    if not _has_manage_permission(username, community_id):
        return {"success": False, "error": "Only community admins can send invitations"}, 403

    if isinstance(emails_raw, (list, tuple)):
        raw_items = [str(item) for item in emails_raw]
    else:
        raw_items = re.split(r"[\s,;]+", str(emails_raw))
    emails: List[str] = []
    errors: List[Dict[str, str]] = []
    seen = set()
    for item in raw_items:
        email = item.strip().lower()
        if not email or email in seen:
            continue
        seen.add(email)
        if EMAIL_RE.match(email):
            emails.append(email)
        else:
            errors.append({"email": email, "error": "Invalid email format"})
    if not emails:
        return {"success": False, "error": "No valid emails provided"}, 400
    if len(emails) > MAX_BULK_INVITES_PER_REQUEST:
        return {
            "success": False,
            "error": (
                f"Too many emails in one request (max {MAX_BULK_INVITES_PER_REQUEST}). "
                "Send the list in batches."
            ),
            "max_per_request": MAX_BULK_INVITES_PER_REQUEST,
        }, 400

    sent = 0
    failed = len(errors)
    base_url = _public_base_url(host_url)
    logo_url = _invite_logo_url(base_url)
    send_email = _legacy_helpers()["_send_email_via_resend"]
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            _ensure_tables(c)
            c.execute(
                f"SELECT name, parent_community_id FROM communities WHERE id = {ph}",
                (community_id,),
            )
            community = c.fetchone()
            if not community:
                return {"success": False, "error": "Community not found"}, 404
            community_name = _row_value(community, "name", 0, "Community")
            if _row_value(community, "parent_community_id", 1):
                return {"success": False, "error": "Invites can only be created from root communities"}, 400

            # Honest capacity pre-check: members + live pending invites + this
            # batch must fit the community cap, otherwise invitees would only
            # discover the limit when their accept fails days later.
            pending = _count_pending_invites(c, community_id)
            cap_payload = _member_cap_payload(
                c,
                community_id,
                username,
                extra_members=pending + len(emails),
            )
            if cap_payload:
                payload, status_code = cap_payload
                payload["pending_invites"] = pending
                payload["requested_invites"] = len(emails)
                return payload, status_code

            for email in emails:
                try:
                    c.execute(
                        f"SELECT id FROM community_invitations WHERE community_id = {ph} AND invited_email = {ph} AND used = 0",
                        (community_id, email),
                    )
                    if c.fetchone():
                        errors.append({"email": email, "error": "Already invited"})
                        failed += 1
                        continue
                    c.execute(
                        f"SELECT id, username FROM users WHERE LOWER(email) = LOWER({ph}) OR canonical_email = {ph}",
                        (email, _canonical_email(email)),
                    )
                    existing_user = c.fetchone()
                    existing_username = _row_value(existing_user, "username", 1) if existing_user else None
                    if existing_user:
                        existing_user_id = _row_value(existing_user, "id", 0)
                        c.execute(
                            f"SELECT 1 FROM user_communities WHERE community_id = {ph} AND user_id = {ph}",
                            (community_id, existing_user_id),
                        )
                        if c.fetchone():
                            errors.append({"email": email, "error": "Already a member"})
                            failed += 1
                            continue
                    token = secrets.token_urlsafe(32)
                    expires_at = _invite_expires_at()
                    c.execute(
                        f"""
                        INSERT INTO community_invitations
                            (community_id, invited_email, invited_username, invited_by_username, token, include_nested_ids, include_parent_ids, expires_at)
                        VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                        """,
                        (community_id, email, existing_username, username, token, json.dumps([]), json.dumps([]), expires_at),
                    )
                    conn.commit()
                    invite_url = f"{base_url}/invite/{token}"
                    html, text = community_invite_emails.render_new_user_invite_email(
                        inviter_username=username,
                        community_name=community_name,
                        invite_url=invite_url,
                        nested_names=fetch_community_names(c, []),
                        logo_url=logo_url,
                        expires_at=expires_at,
                    )
                    delivered = False
                    send_error = "Email send failed"
                    try:
                        delivered = bool(
                            send_email(
                                to_email=email,
                                subject=community_invite_emails.invite_subject(
                                    kind="new",
                                    inviter_username=username,
                                    community_name=community_name,
                                ),
                                html=html,
                                text=text,
                            )
                        )
                    except Exception as send_exc:  # Resend errors must not abort the batch
                        send_error = str(send_exc) or send_error
                    if existing_username:
                        # Existing accounts also get the in-app invite, which
                        # delivers even when the email bounces — keep the row.
                        try:
                            create_notification(
                                existing_username,
                                username,
                                "community_invite",
                                community_id=community_id,
                                message=f"{username} invited you to {community_name}",
                                link="/notifications?tab=invites",
                            )
                        except Exception:
                            logger.warning("invite_bulk: in-app notification failed for %s", existing_username)
                        sent += 1
                        if not delivered:
                            errors.append({"email": email, "error": "Invited in-app; email delivery failed"})
                    elif delivered:
                        sent += 1
                    else:
                        # No account and no email: the invitee can never see
                        # the token. Drop the row so a retry can re-create it.
                        c.execute(
                            f"DELETE FROM community_invitations WHERE community_id = {ph} AND invited_email = {ph} AND token = {ph}",
                            (community_id, email, token),
                        )
                        conn.commit()
                        errors.append({"email": email, "error": send_error})
                        failed += 1
                    if BULK_SEND_DELAY_SECONDS:
                        time.sleep(BULK_SEND_DELAY_SECONDS)
                except Exception as exc:
                    logger.error("invite_bulk: failed for %s: %s", email, exc, exc_info=True)
                    errors.append({"email": email, "error": str(exc)})
                    failed += 1
    except Exception as exc:
        logger.error("Error in bulk invite: %s", exc, exc_info=True)
        return {"success": False, "error": "Server error"}, 500
    return {
        "success": True,
        "sent": sent,
        "failed": failed,
        "errors": errors if errors else None,
        "message": "Invitations sent. Each invitation is valid for 7 days.",
        "expires_in_days": INVITE_EXPIRY_DAYS,
    }, 200
