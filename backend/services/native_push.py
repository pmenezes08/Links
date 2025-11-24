"""Native (APNs) push token management and delivery helpers."""

from __future__ import annotations

import logging
import os
import time
from functools import lru_cache
from typing import Dict, Iterable, List, Optional

import collections

# Compatibility shim for older dependencies (hyper/apns2) expecting collections.Iterable/Mapping
if not hasattr(collections, "Iterable"):  # pragma: no cover - Py3.10+
    collections.Iterable = collections.abc.Iterable  # type: ignore[attr-defined]
if not hasattr(collections, "Mapping"):  # pragma: no cover
    collections.Mapping = collections.abc.Mapping  # type: ignore[attr-defined]
if not hasattr(collections, "MutableMapping"):  # pragma: no cover
    collections.MutableMapping = collections.abc.MutableMapping  # type: ignore[attr-defined]
if not hasattr(collections, "MutableSet"):  # pragma: no cover
    collections.MutableSet = collections.abc.MutableSet  # type: ignore[attr-defined]

from apns2.client import APNsClient
from apns2.credentials import TokenCredentials
try:  # apns2 0.7.2 (Python 3.10 compatible fork) may not expose ExceptionRetryableError
    from apns2.errors import ExceptionRetryableError, Unregistered
except ImportError:  # pragma: no cover - best effort compatibility
    from apns2.errors import Unregistered  # type: ignore

    class ExceptionRetryableError(Exception):  # type: ignore
        """Compatibility fallback when apns2.errors lacks ExceptionRetryableError."""
        pass

from apns2.payload import Payload, PayloadAlert

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

APNS_KEY_PATH = os.getenv("APNS_KEY_PATH")
APNS_KEY_ID = os.getenv("APNS_KEY_ID")
APNS_TEAM_ID = os.getenv("APNS_TEAM_ID")
APNS_BUNDLE_ID = os.getenv("APNS_BUNDLE_ID", "co.cpoint.app")
APNS_TOPIC = os.getenv("APNS_TOPIC", APNS_BUNDLE_ID)
APNS_USE_SANDBOX = os.getenv("APNS_USE_SANDBOX", "true").lower() in {"1", "true", "yes", "sandbox"}

DEFAULT_APNS_ENVIRONMENT = "sandbox" if APNS_USE_SANDBOX else "production"


def _apns_credentials_available() -> bool:
    if not APNS_KEY_PATH or not os.path.exists(APNS_KEY_PATH):
        logger.debug("APNS key path missing or unreadable: %s", APNS_KEY_PATH)
        return False
    if not APNS_KEY_ID or not APNS_TEAM_ID:
        logger.debug("APNS key id/team id missing")
        return False
    return True


def _build_credentials() -> Optional[TokenCredentials]:
    if not _apns_credentials_available():
        return None
    try:
        return TokenCredentials(
            auth_key_path=APNS_KEY_PATH,
            auth_key_id=APNS_KEY_ID,
            team_id=APNS_TEAM_ID,
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("Failed to load APNs credentials: %s", exc)
        return None


@lru_cache(maxsize=2)
def _get_apns_client(use_sandbox: bool) -> Optional[APNsClient]:
    creds = _build_credentials()
    if not creds:
        return None
    try:
        logger.debug("Creating APNs client (sandbox=%s)", use_sandbox)
        return APNsClient(
            credentials=creds,
            use_sandbox=use_sandbox,
            use_alternative_port=False,
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("Failed to create APNs client: %s", exc)
        return None


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


def _fetch_tokens(username: str) -> List[Dict[str, str]]:
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        if USE_MYSQL:
            c.execute(
                f"""
                SELECT token, platform, environment, bundle_id
                FROM native_push_tokens
                WHERE username={ph} AND is_active=1
                """,
                (username,),
            )
        else:
            c.execute(
                """
                SELECT token, platform, environment, bundle_id
                FROM native_push_tokens
                WHERE username=? AND is_active=1
                """,
                (username,),
            )
        rows = c.fetchall() or []
        result: List[Dict[str, str]] = []
        for row in rows:
            if hasattr(row, "keys"):
                result.append(
                    {
                        "token": row["token"],
                        "platform": row["platform"],
                        "environment": row["environment"],
                        "bundle_id": row["bundle_id"],
                    }
                )
            else:
                result.append(
                    {
                        "token": row[0],
                        "platform": row[1],
                        "environment": row[2],
                        "bundle_id": row[3],
                    }
                )
        return result


def send_native_push_notification(username: str, payload: Dict) -> None:
    """Deliver a payload via APNs to all tokens registered for the user."""
    tokens = _fetch_tokens(username)
    if not tokens:
        logger.debug("No native tokens for %s", username)
        return
    if not _apns_credentials_available():
        logger.debug("APNs credentials unavailable; native push disabled")
        return

    alert = PayloadAlert(
        title=payload.get("title"),
        body=payload.get("body"),
        subtitle=payload.get("subtitle"),
    )
    custom_data = payload.get("data") or {}
    if payload.get("url"):
        custom_data = {**custom_data, "url": payload["url"]}

    apns_payload = Payload(
        alert=alert,
        sound=payload.get("sound", "default"),
        badge=payload.get("badge"),
        custom=custom_data or None,
    )

    sent = 0
    failures = 0
    for token_info in tokens:
        env = token_info.get("environment") or DEFAULT_APNS_ENVIRONMENT
        client = _get_apns_client(use_sandbox=(env == "sandbox"))
        if not client:
            failures += 1
            continue
        topic = token_info.get("bundle_id") or APNS_TOPIC
        try:
            client.send_notification(
                token_info["token"],
                apns_payload,
                topic=topic,
                priority=payload.get("priority", 10),
                expiration=int(time.time()) + int(payload.get("ttl", 3600)),
            )
            sent += 1
        except Unregistered:
            failures += 1
            logger.info("APNs token unregistered; deleting %s", token_info["token"])
            try:
                unregister_native_push_token(username, token_info["token"])
            except Exception as cleanup_err:  # pragma: no cover - defensive
                logger.warning("Failed to delete invalid APNs token: %s", cleanup_err)
        except ExceptionRetryableError as retry_err:
            failures += 1
            logger.warning("APNs retryable error for %s: %s", username, retry_err)
        except Exception as exc:  # pragma: no cover - best effort
            failures += 1
            logger.warning("APNs send failed for %s: %s", username, exc)

    if sent:
        logger.info("APNs: sent %d notifications to %s", sent, username)
    if failures and not sent:
        logger.debug("APNs: all deliveries failed for %s", username)


__all__ = [
    "DEFAULT_APNS_ENVIRONMENT",
    "register_native_push_token",
    "unregister_native_push_token",
    "send_native_push_notification",
    "associate_install_tokens_with_user",
]
