"""Mobile store purchase links.

The store webhooks identify purchases by Apple ``originalTransactionId``
or Google Play ``purchaseToken``. This module maps those provider IDs back
to C-Point users and, for community tiers, the community being billed.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from backend.services.database import get_db_connection, get_sql_placeholder


logger = logging.getLogger(__name__)

PROVIDER_APPLE = "apple"
PROVIDER_GOOGLE = "google"
SKU_PREMIUM = "premium"
SKU_COMMUNITY_TIER = "community_tier"
SKU_STEVE_PACKAGE = "steve_package"


def ensure_tables() -> None:
    """Create the store-link table if it does not exist."""
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS iap_links (
                    provider VARCHAR(16) NOT NULL,
                    purchase_key VARCHAR(255) NOT NULL,
                    username VARCHAR(255) NOT NULL,
                    sku VARCHAR(64) NOT NULL,
                    community_id INT NULL,
                    tier_code VARCHAR(32) NULL,
                    product_id VARCHAR(128) NOT NULL,
                    status VARCHAR(32) NULL,
                    environment VARCHAR(32) NULL,
                    expires_at DATETIME NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_iap_provider_purchase (provider, purchase_key),
                    KEY idx_iap_username (username),
                    KEY idx_iap_community (community_id)
                )
                """
            )
        except Exception:
            try:
                c.execute(
                    """
                    CREATE TABLE IF NOT EXISTS iap_links (
                        provider TEXT NOT NULL,
                        purchase_key TEXT NOT NULL,
                        username TEXT NOT NULL,
                        sku TEXT NOT NULL,
                        community_id INTEGER NULL,
                        tier_code TEXT NULL,
                        product_id TEXT NOT NULL,
                        status TEXT NULL,
                        environment TEXT NULL,
                        expires_at TEXT NULL,
                        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(provider, purchase_key)
                    )
                    """
                )
            except Exception:
                logger.exception("iap_links.ensure_tables: create failed")
                return
        try:
            conn.commit()
        except Exception:
            pass


def upsert_link(
    *,
    provider: str,
    purchase_key: str,
    username: str,
    sku: str,
    product_id: str,
    community_id: Optional[int] = None,
    tier_code: Optional[str] = None,
    status: Optional[str] = "active",
    environment: Optional[str] = None,
    expires_at: Any = None,
) -> bool:
    """Insert or update a mobile-store purchase link."""
    if not provider or not purchase_key or not username or not sku or not product_id:
        return False
    ensure_tables()
    provider = provider.strip().lower()
    purchase_key = purchase_key.strip()
    ph = get_sql_placeholder()

    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT 1 FROM iap_links WHERE provider = {ph} AND purchase_key = {ph} LIMIT 1",
                (provider, purchase_key),
            )
            exists = bool(c.fetchone())
            if exists:
                c.execute(
                    f"""
                    UPDATE iap_links
                    SET username = {ph}, sku = {ph}, community_id = {ph},
                        tier_code = {ph}, product_id = {ph}, status = {ph},
                        environment = {ph}, expires_at = {ph},
                        updated_at = CURRENT_TIMESTAMP
                    WHERE provider = {ph} AND purchase_key = {ph}
                    """,
                    (
                        username,
                        sku,
                        community_id,
                        tier_code,
                        product_id,
                        status,
                        environment,
                        expires_at,
                        provider,
                        purchase_key,
                    ),
                )
            else:
                c.execute(
                    f"""
                    INSERT INTO iap_links
                        (provider, purchase_key, username, sku, community_id,
                         tier_code, product_id, status, environment, expires_at)
                    VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                    """,
                    (
                        provider,
                        purchase_key,
                        username,
                        sku,
                        community_id,
                        tier_code,
                        product_id,
                        status,
                        environment,
                        expires_at,
                    ),
                )
            conn.commit()
            return True
        except Exception:
            logger.exception("iap_links.upsert_link failed for %s/%s", provider, purchase_key)
            return False


def find(provider: str, purchase_key: Optional[str]) -> Optional[Dict[str, Any]]:
    if not provider or not purchase_key:
        return None
    ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT provider, purchase_key, username, sku, community_id,
                       tier_code, product_id, status, environment, expires_at
                FROM iap_links
                WHERE provider = {ph} AND purchase_key = {ph}
                LIMIT 1
                """,
                (provider.strip().lower(), purchase_key.strip()),
            )
            row = c.fetchone()
        except Exception:
            return None
    return _row_to_dict(row) if row else None


def find_username(provider: str, purchase_key: Optional[str]) -> Optional[str]:
    row = find(provider, purchase_key)
    return str(row.get("username")) if row else None


def active_community_for_user(provider: str, username: str) -> Optional[Dict[str, Any]]:
    """Return the user's active store-billed community for this provider."""
    if not provider or not username:
        return None
    ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT provider, purchase_key, username, sku, community_id,
                       tier_code, product_id, status, environment, expires_at
                FROM iap_links
                WHERE provider = {ph}
                  AND LOWER(username) = LOWER({ph})
                  AND sku = {ph}
                  AND COALESCE(status, 'active') IN ('active', 'trialing')
                  AND community_id IS NOT NULL
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (provider.strip().lower(), username, SKU_COMMUNITY_TIER),
            )
            row = c.fetchone()
        except Exception:
            return None
    return _row_to_dict(row) if row else None


def list_for_user(username: str, provider: Optional[str] = None) -> List[Dict[str, Any]]:
    if not username:
        return []
    ensure_tables()
    ph = get_sql_placeholder()
    clauses = [f"LOWER(username) = LOWER({ph})"]
    params: List[Any] = [username]
    if provider:
        clauses.append(f"provider = {ph}")
        params.append(provider.strip().lower())
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT provider, purchase_key, username, sku, community_id,
                       tier_code, product_id, status, environment, expires_at
                FROM iap_links
                WHERE {' AND '.join(clauses)}
                ORDER BY updated_at DESC
                """,
                tuple(params),
            )
            rows = c.fetchall() or []
        except Exception:
            return []
    return [_row_to_dict(row) for row in rows]


def list_for_community(community_id: int, provider: Optional[str] = None) -> List[Dict[str, Any]]:
    if not community_id:
        return []
    ensure_tables()
    ph = get_sql_placeholder()
    clauses = [f"community_id = {ph}"]
    params: List[Any] = [int(community_id)]
    if provider:
        clauses.append(f"provider = {ph}")
        params.append(provider.strip().lower())
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT provider, purchase_key, username, sku, community_id,
                       tier_code, product_id, status, environment, expires_at
                FROM iap_links
                WHERE {' AND '.join(clauses)}
                ORDER BY updated_at DESC
                """,
                tuple(params),
            )
            rows = c.fetchall() or []
        except Exception:
            return []
    return [_row_to_dict(row) for row in rows]


def _row_to_dict(row: Any) -> Dict[str, Any]:
    if hasattr(row, "keys"):
        return {key: row[key] for key in row.keys()}
    keys = (
        "provider",
        "purchase_key",
        "username",
        "sku",
        "community_id",
        "tier_code",
        "product_id",
        "status",
        "environment",
        "expires_at",
    )
    return {key: row[idx] if idx < len(row) else None for idx, key in enumerate(keys)}
