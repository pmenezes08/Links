"""Native push token management helpers.

Note: Actual push notification sending is handled by backend.services.notifications
using the modern HTTP/2 APNs API (httpx + PyJWT). This module only manages token storage.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

# Default to production for App Store/TestFlight builds
# Set APNS_USE_SANDBOX=true for Xcode debug builds only
APNS_USE_SANDBOX = os.getenv("APNS_USE_SANDBOX", "false").lower() in {"1", "true", "yes", "sandbox"}
DEFAULT_APNS_ENVIRONMENT = "sandbox" if APNS_USE_SANDBOX else "production"
APNS_BUNDLE_ID = os.getenv("APNS_BUNDLE_ID", "co.cpoint.app")

PUSH_REGISTRATION_BLOCKED_KEY = "push_registration_blocked"


def block_push_registration_in_session(session_obj) -> None:
    """Set after logout unregister so in-flight register_fcm cannot reactivate rows."""
    session_obj[PUSH_REGISTRATION_BLOCKED_KEY] = True
    session_obj.modified = True


def clear_push_registration_block(session_obj) -> None:
    session_obj.pop(PUSH_REGISTRATION_BLOCKED_KEY, None)
    session_obj.modified = True


def push_registration_may_activate(session_obj, username: Optional[str]) -> bool:
    return bool((username or "").strip()) and not session_obj.get(PUSH_REGISTRATION_BLOCKED_KEY)


def upsert_fcm_token_row(
    cursor,
    token: str,
    username: Optional[str],
    platform: str,
    device_name: Optional[str],
    *,
    activate: bool,
) -> None:
    ph = get_sql_placeholder()
    if activate and username:
        if USE_MYSQL:
            cursor.execute(
                f"""
                INSERT INTO fcm_tokens (token, username, platform, device_name, last_seen, is_active)
                VALUES ({ph}, {ph}, {ph}, {ph}, NOW(), 1)
                ON DUPLICATE KEY UPDATE
                    username=VALUES(username),
                    platform=VALUES(platform),
                    device_name=VALUES(device_name),
                    last_seen=NOW(),
                    is_active=1
                """,
                (token, username, platform, device_name),
            )
        else:
            cursor.execute(
                """
                INSERT INTO fcm_tokens (token, username, platform, device_name, last_seen, is_active)
                VALUES (?, ?, ?, ?, datetime('now'), 1)
                ON CONFLICT(token) DO UPDATE SET
                    username=excluded.username,
                    platform=excluded.platform,
                    device_name=excluded.device_name,
                    last_seen=excluded.last_seen,
                    is_active=1
                """,
                (token, username, platform, device_name),
            )
    else:
        if USE_MYSQL:
            cursor.execute(
                f"""
                INSERT INTO fcm_tokens (token, username, platform, device_name, last_seen, is_active)
                VALUES ({ph}, NULL, {ph}, {ph}, NOW(), 0)
                ON DUPLICATE KEY UPDATE
                    username=NULL,
                    platform=VALUES(platform),
                    device_name=VALUES(device_name),
                    last_seen=NOW(),
                    is_active=0
                """,
                (token, platform, device_name),
            )
        else:
            cursor.execute(
                """
                INSERT INTO fcm_tokens (token, username, platform, device_name, last_seen, is_active)
                VALUES (?, NULL, ?, ?, datetime('now'), 0)
                ON CONFLICT(token) DO UPDATE SET
                    username=NULL,
                    platform=excluded.platform,
                    device_name=excluded.device_name,
                    last_seen=excluded.last_seen,
                    is_active=0
                """,
                (token, platform, device_name),
            )


def upsert_native_push_token_row(
    cursor,
    token: str,
    username: Optional[str],
    install_id: Optional[str],
    platform: str,
    environment: str,
    bundle_id: str,
    device_name: Optional[str],
    *,
    activate: bool,
) -> None:
    ph = get_sql_placeholder()
    params_active = (
        token,
        username,
        install_id,
        platform,
        environment,
        bundle_id,
        device_name,
    )
    if activate and username:
        if USE_MYSQL:
            cursor.execute(
                f"""
                INSERT INTO native_push_tokens (token, username, install_id, platform, environment, bundle_id, device_name, last_seen, is_active)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, NOW(), 1)
                ON DUPLICATE KEY UPDATE
                    username=VALUES(username),
                    install_id=IFNULL(VALUES(install_id), install_id),
                    platform=VALUES(platform),
                    environment=VALUES(environment),
                    bundle_id=VALUES(bundle_id),
                    device_name=VALUES(device_name),
                    last_seen=NOW(),
                    is_active=1
                """,
                params_active,
            )
        else:
            cursor.execute(
                """
                INSERT INTO native_push_tokens (token, username, install_id, platform, environment, bundle_id, device_name, last_seen, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
                ON CONFLICT(token) DO UPDATE SET
                    username=excluded.username,
                    install_id=COALESCE(excluded.install_id, install_id),
                    platform=excluded.platform,
                    environment=excluded.environment,
                    bundle_id=excluded.bundle_id,
                    device_name=excluded.device_name,
                    last_seen=excluded.last_seen,
                    is_active=1
                """,
                params_active,
            )
    else:
        params_inactive = (
            token,
            install_id,
            platform,
            environment,
            bundle_id,
            device_name,
        )
        if USE_MYSQL:
            cursor.execute(
                f"""
                INSERT INTO native_push_tokens (token, username, install_id, platform, environment, bundle_id, device_name, last_seen, is_active)
                VALUES ({ph}, NULL, {ph}, {ph}, {ph}, {ph}, {ph}, NOW(), 0)
                ON DUPLICATE KEY UPDATE
                    username=NULL,
                    install_id=IFNULL(VALUES(install_id), install_id),
                    platform=VALUES(platform),
                    environment=VALUES(environment),
                    bundle_id=VALUES(bundle_id),
                    device_name=VALUES(device_name),
                    last_seen=NOW(),
                    is_active=0
                """,
                params_inactive,
            )
        else:
            cursor.execute(
                """
                INSERT INTO native_push_tokens (token, username, install_id, platform, environment, bundle_id, device_name, last_seen, is_active)
                VALUES (?, NULL, ?, ?, ?, ?, ?, datetime('now'), 0)
                ON CONFLICT(token) DO UPDATE SET
                    username=NULL,
                    install_id=COALESCE(excluded.install_id, install_id),
                    platform=excluded.platform,
                    environment=excluded.environment,
                    bundle_id=excluded.bundle_id,
                    device_name=excluded.device_name,
                    last_seen=excluded.last_seen,
                    is_active=0
                """,
                params_inactive,
            )


def register_native_push_token(
    token: str,
    username: Optional[str] = None,
    install_id: Optional[str] = None,
    platform: str = "ios",
    environment: str = DEFAULT_APNS_ENVIRONMENT,
    bundle_id: Optional[str] = None,
    device_name: Optional[str] = None,
    *,
    activate: bool = True,
) -> None:
    """Upsert a native push token for the given user or anonymous install."""
    normalized_token = (token or "").strip()
    if not normalized_token:
        raise ValueError("token required")

    environment = (environment or DEFAULT_APNS_ENVIRONMENT).lower()
    if environment not in {"production", "sandbox"}:
        environment = DEFAULT_APNS_ENVIRONMENT

    platform_norm = (platform or "ios").lower()
    bind_user = username if activate and username else None

    with get_db_connection() as conn:
        c = conn.cursor()
        upsert_native_push_token_row(
            c,
            normalized_token,
            bind_user,
            install_id,
            platform_norm,
            environment,
            bundle_id or APNS_BUNDLE_ID,
            device_name,
            activate=activate and bool(bind_user),
        )
        conn.commit()

    logger.info(
        "Registered native push token (user=%s install=%s platform=%s env=%s active=%s)",
        bind_user or "anonymous",
        install_id or "none",
        platform_norm,
        environment,
        activate and bool(bind_user),
    )


def unregister_native_push_token(username: Optional[str], token: str) -> None:
    """Remove a native push token for the given user."""
    normalized_token = token.strip()
    if not normalized_token:
        return
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        if USE_MYSQL:
            c.execute(
                f"DELETE FROM native_push_tokens WHERE token={ph} AND ({'username IS NULL' if username is None else f'username={ph}'})",
                (normalized_token,) if username is None else (normalized_token, username),
            )
        else:
            if username is None:
                c.execute("DELETE FROM native_push_tokens WHERE token=?", (normalized_token,))
            else:
                c.execute(
                    "DELETE FROM native_push_tokens WHERE token=? AND username=?",
                    (normalized_token, username),
                )
        conn.commit()
    logger.info("Unregistered native push token for %s", username)


def associate_install_tokens_with_user(install_id: str, username: str) -> int:
    """Assign any anonymous tokens from the install to the authenticated user."""
    if not install_id or not username:
        return 0

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        if USE_MYSQL:
            c.execute(
                f"""
                UPDATE native_push_tokens
                SET username={ph}, last_seen=NOW()
                WHERE install_id={ph} AND (username IS NULL OR username!={ph})
                """,
                (username, install_id, username),
            )
        else:
            c.execute(
                """
                UPDATE native_push_tokens
                SET username=?, last_seen=datetime('now')
                WHERE install_id=? AND (username IS NULL OR username<>?)
                """,
                (username, install_id, username),
            )
        conn.commit()
        updated = c.rowcount or 0

    if updated:
        logger.info("Associated %d native push token(s) with %s", updated, username)
    return updated


def associate_fcm_tokens_for_install(install_id: str, username: str) -> int:
    """Attach anonymous fcm_tokens rows to the logged-in user by matching token rows in native_push_tokens."""
    install_id = (install_id or "").strip()
    if not install_id or not username:
        return 0

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        if USE_MYSQL:
            c.execute(
                f"""
                UPDATE fcm_tokens AS f
                INNER JOIN native_push_tokens AS n ON n.token = f.token AND n.install_id = {ph}
                SET f.username = {ph}, f.last_seen = NOW()
                WHERE f.username IS NULL
                """,
                (install_id, username),
            )
        else:
            c.execute(
                f"""
                UPDATE fcm_tokens
                SET username = {ph}, last_seen = datetime('now')
                WHERE username IS NULL
                  AND token IN (
                    SELECT token FROM native_push_tokens WHERE install_id = {ph}
                  )
                """,
                (username, install_id),
            )
        conn.commit()
        rows = c.rowcount or 0

    if rows:
        logger.info("Associated %d fcm_tokens row(s) with %s (install)", rows, username)
    return int(rows)


def deactivate_for_install(install_id: Optional[str]) -> dict[str, int]:
    """Deactivate all push rows tied to a native install id.

    ``fcm_tokens`` does not currently store ``install_id`` directly, so those
    rows are matched through the APNs/native token rows that do carry it.
    """
    install_id = (install_id or "").strip()
    if not install_id:
        return {"native_push_tokens": 0, "fcm_tokens": 0}

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()

        if USE_MYSQL:
            c.execute(
                f"""
                UPDATE fcm_tokens
                SET is_active = 0, username = NULL
                WHERE token IN (
                    SELECT token FROM native_push_tokens WHERE install_id = {ph}
                )
                """,
                (install_id,),
            )
            fcm_rows = c.rowcount or 0
            c.execute(
                f"""
                UPDATE native_push_tokens
                SET is_active = 0, username = NULL
                WHERE install_id = {ph}
                """,
                (install_id,),
            )
            native_rows = c.rowcount or 0
        else:
            c.execute(
                """
                UPDATE fcm_tokens
                SET is_active = 0, username = NULL
                WHERE token IN (
                    SELECT token FROM native_push_tokens WHERE install_id = ?
                )
                """,
                (install_id,),
            )
            fcm_rows = c.rowcount or 0
            c.execute(
                """
                UPDATE native_push_tokens
                SET is_active = 0, username = NULL
                WHERE install_id = ?
                """,
                (install_id,),
            )
            native_rows = c.rowcount or 0

        conn.commit()

    logger.info(
        "native_push.deactivate_for_install id=%s rows_native=%d rows_fcm=%d",
        install_id[:8],
        native_rows,
        fcm_rows,
    )
    return {"native_push_tokens": int(native_rows), "fcm_tokens": int(fcm_rows)}


def deactivate_all_push_for_user(username: Optional[str]) -> dict[str, int]:
    """Deactivate FCM/native rows and remove web push subscriptions for a user (logout)."""
    username = (username or "").strip()
    if not username:
        return {"native_push_tokens": 0, "fcm_tokens": 0, "push_subscriptions": 0}

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()

        if USE_MYSQL:
            c.execute(
                f"UPDATE fcm_tokens SET is_active = 0, username = NULL WHERE username = {ph}",
                (username,),
            )
        else:
            c.execute(
                "UPDATE fcm_tokens SET is_active = 0, username = NULL WHERE username = ?",
                (username,),
            )
        fcm_rows = c.rowcount or 0

        try:
            if USE_MYSQL:
                c.execute(
                    f"UPDATE native_push_tokens SET is_active = 0, username = NULL WHERE username = {ph}",
                    (username,),
                )
            else:
                c.execute(
                    "UPDATE native_push_tokens SET is_active = 0, username = NULL WHERE username = ?",
                    (username,),
                )
            native_rows = c.rowcount or 0
        except Exception as exc:
            logger.warning("native_push_tokens deactivate for user %s: %s", username, exc)
            native_rows = 0

        web_rows = 0
        try:
            if USE_MYSQL:
                c.execute(
                    f"DELETE FROM push_subscriptions WHERE username = {ph}",
                    (username,),
                )
            else:
                c.execute(
                    "DELETE FROM push_subscriptions WHERE username = ?",
                    (username,),
                )
            web_rows = c.rowcount or 0
        except Exception as exc:
            logger.warning("push_subscriptions delete for user %s: %s", username, exc)

        conn.commit()

    logger.info(
        "native_push.deactivate_all_for_user user=%s native=%d fcm=%d web=%d",
        username,
        native_rows,
        fcm_rows,
        web_rows,
    )
    return {
        "native_push_tokens": int(native_rows),
        "fcm_tokens": int(fcm_rows),
        "push_subscriptions": int(web_rows),
    }


__all__ = [
    "DEFAULT_APNS_ENVIRONMENT",
    "PUSH_REGISTRATION_BLOCKED_KEY",
    "block_push_registration_in_session",
    "clear_push_registration_block",
    "push_registration_may_activate",
    "upsert_fcm_token_row",
    "upsert_native_push_token_row",
    "register_native_push_token",
    "unregister_native_push_token",
    "associate_install_tokens_with_user",
    "associate_fcm_tokens_for_install",
    "deactivate_for_install",
    "deactivate_all_push_for_user",
]
