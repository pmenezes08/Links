"""About-page tutorial video URLs (public read, app-admin write)."""

from __future__ import annotations

import logging
from typing import Dict, List

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

_SCHEMA_READY = False

# Must match stable card ids in client/src/content/aboutCPoint.ts
ALLOWED_SLOTS: frozenset[str] = frozenset(
    {
        "create_community",
        "invite_members",
        "engagement_posts",
        "direct_messages",
        "group_chats",
        "steve_dm",
        "steve_in_feed",
        "steve_summaries",
    }
)


def ensure_tables() -> None:
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS about_tutorial_videos (
                    slot_id VARCHAR(64) NOT NULL PRIMARY KEY,
                    public_url VARCHAR(2048) NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
                """
            )
        else:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS about_tutorial_videos (
                    slot_id TEXT NOT NULL PRIMARY KEY,
                    public_url TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        try:
            conn.commit()
        except Exception:
            pass
    _SCHEMA_READY = True


def list_urls_for_slots() -> Dict[str, str | None]:
    """Return map slot_id -> public_url for all allowed slots; null if unset."""
    ensure_tables()
    out: Dict[str, str | None] = {s: None for s in ALLOWED_SLOTS}
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT slot_id, public_url FROM about_tutorial_videos WHERE slot_id IN ({','.join([ph] * len(ALLOWED_SLOTS))})",
                tuple(ALLOWED_SLOTS),
            )
            for row in c.fetchall():
                sid = row["slot_id"] if hasattr(row, "keys") else row[0]
                url = row["public_url"] if hasattr(row, "keys") else row[1]
                if sid in out and url:
                    out[str(sid)] = str(url).strip() or None
        except Exception as exc:
            logger.warning("about_tutorial_videos list failed: %s", exc)
    return out


def set_slot_url(slot_id: str, public_url: str) -> bool:
    """Upsert URL for slot. Caller must validate slot_id and URL."""
    ensure_tables()
    sid = (slot_id or "").strip()
    url = (public_url or "").strip()
    if sid not in ALLOWED_SLOTS or not url:
        return False
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
            c.execute(
                f"""
                INSERT INTO about_tutorial_videos (slot_id, public_url)
                VALUES ({ph}, {ph})
                ON DUPLICATE KEY UPDATE public_url = VALUES(public_url), updated_at = CURRENT_TIMESTAMP
                """,
                (sid, url),
            )
        else:
            c.execute(
                f"SELECT 1 FROM about_tutorial_videos WHERE slot_id = {ph}",
                (sid,),
            )
            if c.fetchone():
                c.execute(
                    f"UPDATE about_tutorial_videos SET public_url = {ph}, updated_at = datetime('now') WHERE slot_id = {ph}",
                    (url, sid),
                )
            else:
                c.execute(
                    f"INSERT INTO about_tutorial_videos (slot_id, public_url) VALUES ({ph}, {ph})",
                    (sid, url),
                )
        try:
            conn.commit()
        except Exception as exc:
            logger.warning("about_tutorial_videos upsert failed: %s", exc)
            return False
    return True


def allowed_slots_ordered() -> List[str]:
    return sorted(ALLOWED_SLOTS)
