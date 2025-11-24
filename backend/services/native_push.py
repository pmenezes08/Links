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

APNS_USE_SANDBOX = os.getenv("APNS_USE_SANDBOX", "true").lower() in {"1", "true", "yes", "sandbox"}
DEFAULT_APNS_ENVIRONMENT = "sandbox" if APNS_USE_SANDBOX else "production"
APNS_BUNDLE_ID = os.getenv("APNS_BUNDLE_ID", "co.cpoint.app")


def register_native_push_token(
    token: str,
    username: Optional[str] = None,
    install_id: Optional[str] = None,
    platform: str = "ios",
    environment: str = DEFAULT_APNS_ENVIRONMENT,
    bundle_id: Optional[str] = None,
    device_name: Optional[str] = None,
) -> None:
    """Upsert a native push token for the given user or anonymous install."""
    normalized_token = (token or "").strip()
    if not normalized_token:
        raise ValueError("token required")

    environment = (environment or DEFAULT_APNS_ENVIRONMENT).lower()
    if environment not in {"production", "sandbox"}:
        environment = DEFAULT_APNS_ENVIRONMENT

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        params = (
            normalized_token,
            username,
            install_id,
            (platform or "ios").lower(),
            environment,
            bundle_id or APNS_BUNDLE_ID,
            device_name,
        )
        if USE_MYSQL:
            c.execute(
                f"""
                INSERT INTO native_push_tokens (token, username, install_id, platform, environment, bundle_id, device_name, last_seen, is_active)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, NOW(), 1)
                ON DUPLICATE KEY UPDATE
                    username=IFNULL(VALUES(username), username),
                    install_id=IFNULL(VALUES(install_id), install_id),
                    platform=VALUES(platform),
                    environment=VALUES(environment),
                    bundle_id=VALUES(bundle_id),
                    device_name=VALUES(device_name),
                    last_seen=NOW(),
                    is_active=1
                """,
                params,
            )
        else:
            c.execute(
                """
                INSERT INTO native_push_tokens (token, username, install_id, platform, environment, bundle_id, device_name, last_seen, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
                ON CONFLICT(token) DO UPDATE SET
                    username=COALESCE(excluded.username, username),
                    install_id=COALESCE(excluded.install_id, install_id),
                    platform=excluded.platform,
                    environment=excluded.environment,
                    bundle_id=excluded.bundle_id,
                    device_name=excluded.device_name,
                    last_seen=excluded.last_seen,
                    is_active=1
                """,
                params,
            )
        conn.commit()

    logger.info(
        "Registered native push token (user=%s install=%s platform=%s env=%s)",
        username or "anonymous",
        install_id or "none",
        platform,
        environment,
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


__all__ = [
    "DEFAULT_APNS_ENVIRONMENT",
    "register_native_push_token",
    "unregister_native_push_token",
    "associate_install_tokens_with_user",
]
