"""Community media asset accounting and quota summaries."""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any, Dict, Optional
from urllib.parse import urlparse

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.media import resolve_upload_abspath
from backend.services.r2_storage import R2_PUBLIC_URL, delete_from_r2


logger = logging.getLogger(__name__)


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


def _dt(value: Optional[datetime]) -> Optional[str]:
    return value.strftime("%Y-%m-%d %H:%M:%S") if isinstance(value, datetime) else None


def object_key_from_path(path: Optional[str]) -> Optional[str]:
    """Return an R2/local object key for a saved upload path or CDN URL."""
    if not path:
        return None
    text = str(path).strip()
    if not text:
        return None
    public_base = (R2_PUBLIC_URL or "").rstrip("/")
    if public_base and text.startswith(public_base + "/"):
        return text[len(public_base) + 1 :]
    if text.startswith(("http://", "https://")):
        parsed = urlparse(text)
        return parsed.path.lstrip("/") or None
    if text.startswith("uploads/"):
        return text[len("uploads/") :]
    if text.startswith("/uploads/"):
        return text[len("/uploads/") :]
    return text.lstrip("/")


def resolve_root_community_id(cursor: Any, community_id: int) -> int:
    """Resolve the billing/root community id for quota aggregation."""
    ph = get_sql_placeholder()
    current = int(community_id)
    visited: set[int] = set()
    for _ in range(16):
        if current in visited:
            break
        visited.add(current)
        cursor.execute(f"SELECT parent_community_id FROM communities WHERE id = {ph}", (current,))
        row = cursor.fetchone()
        parent = _row_value(row, "parent_community_id", 0)
        if parent in (None, ""):
            break
        try:
            current = int(parent)
        except (TypeError, ValueError):
            break
    return current


def ensure_tables(cursor: Optional[Any] = None) -> None:
    """Ensure the media asset ledger table exists."""
    owns_connection = cursor is None
    conn = None
    if cursor is None:
        conn = get_db_connection()
        cursor = conn.cursor()

    try:
        if USE_MYSQL:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS community_media_assets (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    community_id INT NOT NULL,
                    root_community_id INT NOT NULL,
                    source_type VARCHAR(32) NOT NULL,
                    source_id VARCHAR(64),
                    media_type VARCHAR(32),
                    object_key VARCHAR(512),
                    path VARCHAR(1024),
                    original_bytes BIGINT NOT NULL DEFAULT 0,
                    stored_bytes BIGINT NOT NULL DEFAULT 0,
                    duration_seconds INT,
                    status VARCHAR(32) NOT NULL DEFAULT 'active',
                    created_at DATETIME NOT NULL,
                    expires_at DATETIME,
                    retain_until DATETIME,
                    deleted_at DATETIME,
                    UNIQUE KEY uniq_cma_source_path (source_type, source_id, path(255)),
                    INDEX idx_cma_root_status (root_community_id, status, deleted_at),
                    INDEX idx_cma_expiry (expires_at),
                    INDEX idx_cma_retain (retain_until)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS community_media_assets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    community_id INTEGER NOT NULL,
                    root_community_id INTEGER NOT NULL,
                    source_type TEXT NOT NULL,
                    source_id TEXT,
                    media_type TEXT,
                    object_key TEXT,
                    path TEXT,
                    original_bytes INTEGER NOT NULL DEFAULT 0,
                    stored_bytes INTEGER NOT NULL DEFAULT 0,
                    duration_seconds INTEGER,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TEXT NOT NULL,
                    expires_at TEXT,
                    retain_until TEXT,
                    deleted_at TEXT
                )
                """
            )
            cursor.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uniq_cma_source_path
                ON community_media_assets (source_type, source_id, path)
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_cma_root_status
                ON community_media_assets (root_community_id, status, deleted_at)
                """
            )
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_cma_expiry ON community_media_assets (expires_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_cma_retain ON community_media_assets (retain_until)")
        if owns_connection and conn is not None:
            conn.commit()
    finally:
        if owns_connection and conn is not None:
            conn.close()


def register_asset(
    cursor: Any,
    *,
    community_id: int,
    source_type: str,
    source_id: Optional[Any],
    media_type: Optional[str],
    path: Optional[str],
    original_bytes: Optional[int] = None,
    stored_bytes: Optional[int] = None,
    duration_seconds: Optional[int] = None,
    created_at: Optional[datetime] = None,
    expires_at: Optional[datetime] = None,
    retain_until: Optional[datetime] = None,
    status: str = "active",
) -> None:
    """Insert or refresh one media ledger row for quota reporting."""
    if not path:
        return
    ensure_tables(cursor)
    ph = get_sql_placeholder()
    root_id = resolve_root_community_id(cursor, community_id)
    created = created_at or datetime.utcnow()
    original = max(0, int(original_bytes or 0))
    stored = max(0, int(stored_bytes or original))
    source_value = str(source_id) if source_id is not None else None
    values = (
        int(community_id),
        int(root_id),
        source_type,
        source_value,
        media_type,
        object_key_from_path(path),
        path,
        original,
        stored,
        duration_seconds,
        status,
        _dt(created) or datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
        _dt(expires_at),
        _dt(retain_until),
    )
    if USE_MYSQL:
        cursor.execute(
            f"""
            INSERT INTO community_media_assets
            (community_id, root_community_id, source_type, source_id, media_type, object_key, path,
             original_bytes, stored_bytes, duration_seconds, status, created_at, expires_at, retain_until)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            ON DUPLICATE KEY UPDATE
                root_community_id = VALUES(root_community_id),
                media_type = VALUES(media_type),
                object_key = VALUES(object_key),
                original_bytes = VALUES(original_bytes),
                stored_bytes = VALUES(stored_bytes),
                duration_seconds = VALUES(duration_seconds),
                status = VALUES(status),
                expires_at = VALUES(expires_at),
                retain_until = VALUES(retain_until),
                deleted_at = NULL
            """,
            values,
        )
    else:
        cursor.execute(
            f"""
            INSERT OR REPLACE INTO community_media_assets
            (community_id, root_community_id, source_type, source_id, media_type, object_key, path,
             original_bytes, stored_bytes, duration_seconds, status, created_at, expires_at, retain_until, deleted_at)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, NULL)
            """,
            values,
        )


def usage_summary(root_community_id: int) -> Dict[str, Any]:
    """Return active media usage for the root community."""
    ensure_tables()
    ph = get_sql_placeholder()
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        ensure_tables(cursor)
        cursor.execute(
            f"""
            SELECT
                COUNT(*) AS asset_count,
                COALESCE(SUM(CASE
                    WHEN status = 'active'
                     AND deleted_at IS NULL
                     AND (expires_at IS NULL OR expires_at > {ph})
                    THEN COALESCE(NULLIF(stored_bytes, 0), original_bytes, 0)
                    ELSE 0
                END), 0) AS active_bytes,
                COALESCE(SUM(COALESCE(NULLIF(stored_bytes, 0), original_bytes, 0)), 0) AS tracked_bytes
            FROM community_media_assets
            WHERE root_community_id = {ph}
              AND deleted_at IS NULL
            """,
            (now, int(root_community_id)),
        )
        row = cursor.fetchone()
    active_bytes = int(_row_value(row, "active_bytes", 1, 0) or 0)
    tracked_bytes = int(_row_value(row, "tracked_bytes", 2, 0) or 0)
    asset_count = int(_row_value(row, "asset_count", 0, 0) or 0)
    return {
        "active_bytes": active_bytes,
        "tracked_bytes": tracked_bytes,
        "asset_count": asset_count,
    }


def purge_retained_story_media(*, dry_run: bool = False, limit: int = 200) -> Dict[str, Any]:
    """Delete story media whose 7-day retention window has elapsed."""
    ensure_tables()
    ph = get_sql_placeholder()
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    limit = max(1, min(int(limit or 200), 1000))
    with get_db_connection() as conn:
        cursor = conn.cursor()
        ensure_tables(cursor)
        cursor.execute(
            f"""
            SELECT id, object_key, path
            FROM community_media_assets
            WHERE source_type = 'story'
              AND deleted_at IS NULL
              AND retain_until IS NOT NULL
              AND retain_until <= {ph}
            ORDER BY retain_until ASC
            LIMIT {limit}
            """,
            (now,),
        )
        rows = cursor.fetchall() or []
        purged = 0
        failed = 0
        candidates = []
        for row in rows:
            asset_id = _row_value(row, "id", 0)
            object_key = _row_value(row, "object_key", 1)
            path = _row_value(row, "path", 2)
            candidates.append({"id": asset_id, "object_key": object_key, "path": path})
            if dry_run:
                continue

            deleted = False
            if object_key:
                deleted = delete_from_r2(str(object_key))
            local_path = resolve_upload_abspath(path)
            if local_path and os.path.exists(local_path):
                try:
                    os.remove(local_path)
                    deleted = True
                except Exception:
                    logger.warning("Could not delete local retained media %s", local_path)
            if deleted or not object_key:
                cursor.execute(
                    f"""
                    UPDATE community_media_assets
                    SET status = 'deleted', deleted_at = {ph}
                    WHERE id = {ph}
                    """,
                    (now, asset_id),
                )
                purged += 1
            else:
                failed += 1
        if not dry_run:
            conn.commit()
    return {
        "dry_run": dry_run,
        "candidate_count": len(candidates),
        "purged_count": purged,
        "failed_count": failed,
        "candidates": candidates[:25],
    }

