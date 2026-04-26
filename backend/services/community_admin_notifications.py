"""Owner notifications for platform-admin community actions."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from backend.services import subscription_audit
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.notifications import create_notification, truncate_notification_preview


logger = logging.getLogger(__name__)

_NOTIFICATION_TYPE = "community_admin_action"
_FROM_USER = "admin"
_SUPPORT_CONTACT = "support@c-point.co"

_ACTION_VERBS = {
    "deleted": "deleted",
    "frozen": "froze",
    "unfrozen": "unfroze",
    "tier_upgraded": "upgraded the subscription tier for",
    "tier_downgraded": "downgraded the subscription tier for",
    "stripe_cancelled": "cancelled the Stripe subscription for",
}


def get_community_context(community_id: int) -> Optional[Dict[str, Any]]:
    """Return owner/name context before destructive operations remove rows."""
    if not community_id:
        return None
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""
                SELECT id, name, creator_username
                FROM communities
                WHERE id = {ph}
                """,
                (community_id,),
            )
            row = c.fetchone()
    except Exception:
        logger.exception("get_community_context failed for %s", community_id)
        return None
    if not row:
        return None
    return {
        "community_id": int(_value(row, "id", 0) or community_id),
        "community_name": str(_value(row, "name", 1) or "this community"),
        "owner_username": str(_value(row, "creator_username", 2) or ""),
    }


def notify_owner_of_admin_action(
    *,
    community_id: int,
    action: str,
    actor_username: str,
    extra: Optional[Dict[str, Any]] = None,
) -> bool:
    """Notify the community owner when a platform admin changes lifecycle/billing."""
    context = dict(extra or {})
    if not context.get("owner_username") or not context.get("community_name"):
        fetched = get_community_context(community_id) or {}
        context = {**fetched, **context}

    owner = str(context.get("owner_username") or "").strip()
    if not owner:
        return False
    actor = _normalize_actor(actor_username)
    if actor.strip("@").lower() == owner.strip("@").lower():
        return False

    name = str(context.get("community_name") or "this community")
    message = _owner_message(action=action, actor=actor, community_name=name)
    _create(
        recipient=owner,
        community_id=community_id,
        message=message,
        link=f"/edit_community/{community_id}",
    )
    _audit(owner=owner, action=action, actor=actor, community_id=community_id, context=context)
    return True


def notify_platform_admins_of_stripe_cancellation(
    *,
    community_id: int,
    extra: Optional[Dict[str, Any]] = None,
) -> int:
    """Notify platform admins that Stripe cancelled a community subscription."""
    context = dict(extra or {})
    if not context.get("community_name"):
        fetched = get_community_context(community_id) or {}
        context = {**fetched, **context}
    name = str(context.get("community_name") or f"community #{community_id}")
    owner = str(context.get("owner_username") or "unknown owner")
    message = (
        f'Stripe-side cancellation detected for community "{name}" '
        f"(owner @{owner})."
    )
    recipients = list_platform_admin_usernames()
    sent = 0
    for username in recipients:
        _create(
            recipient=username,
            community_id=community_id,
            message=message,
            link="/admin/subscriptions",
        )
        sent += 1
    return sent


def list_platform_admin_usernames() -> List[str]:
    """Return app-admin usernames, always including legacy `admin` if present."""
    ph = get_sql_placeholder()
    usernames: List[str] = []
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            try:
                c.execute("SELECT username FROM users WHERE COALESCE(is_admin, 0) = 1")
            except Exception:
                c.execute(f"SELECT username FROM users WHERE LOWER(username) = LOWER({ph})", ("admin",))
            rows = c.fetchall() or []
    except Exception:
        logger.exception("list_platform_admin_usernames failed")
        rows = []

    for row in rows:
        username = str(_value(row, "username", 0) or "").strip()
        if username and username.lower() not in {u.lower() for u in usernames}:
            usernames.append(username)
    if "admin" not in {u.lower() for u in usernames}:
        usernames.append("admin")
    return usernames


def _owner_message(*, action: str, actor: str, community_name: str) -> str:
    if action == "stripe_cancelled":
        return (
            f'Your subscription for community "{community_name}" was cancelled in Stripe. '
            f"For additional information please reach out to {_SUPPORT_CONTACT}."
        )
    verb = _ACTION_VERBS.get(action, "updated")
    return (
        f'{actor} {verb} your community "{community_name}". '
        f"For further information please contact {_SUPPORT_CONTACT}."
    )


def _create(*, recipient: str, community_id: int, message: str, link: str) -> None:
    try:
        create_notification(
            recipient,
            _FROM_USER,
            _NOTIFICATION_TYPE,
            community_id=community_id,
            message=message,
            link=link,
            preview_text=truncate_notification_preview(message, 160),
        )
    except Exception:
        logger.exception("community admin notification failed for %s", recipient)


def _audit(
    *,
    owner: str,
    action: str,
    actor: str,
    community_id: int,
    context: Dict[str, Any],
) -> None:
    try:
        subscription_audit.log(
            username=owner,
            action=f"community_admin_{action}",
            source="admin_action",
            community_id=community_id,
            actor_username=actor,
            metadata={
                "community_name": context.get("community_name"),
                "owner_username": owner,
                "action": action,
            },
        )
    except Exception:
        logger.exception("community admin audit failed for %s", community_id)


def _normalize_actor(username: str) -> str:
    value = str(username or "admin").strip().lstrip("@") or "admin"
    return f"@{value}"


def _value(row: Any, key: str, idx: int) -> Any:
    if hasattr(row, "keys") and key in row.keys():
        return row[key]
    if isinstance(row, dict):
        return row.get(key)
    if isinstance(row, (list, tuple)) and len(row) > idx:
        return row[idx]
    return None
