"""Shared persistence and delivery helpers for Steve-generated content."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Iterable, Optional
from urllib.parse import urlparse

from redis_cache import cache, invalidate_community_cache, invalidate_message_cache

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.firestore_writes import write_dm_message, write_post
from backend.services.notifications import fanout_community_post_notifications

logger = logging.getLogger(__name__)


def ensure_steve_user(cursor) -> None:
    """Create the Steve user if it is missing."""
    placeholder = get_sql_placeholder()
    cursor.execute(f"SELECT id FROM users WHERE username = {placeholder}", ("steve",))
    if cursor.fetchone():
        return
    try:
        cursor.execute(
            f"""
            INSERT INTO users (username, password, email, verified)
            VALUES ({placeholder}, {placeholder}, {placeholder}, 1)
            """,
            ("steve", "AI_USER_NO_LOGIN", "steve@c-point.ai"),
        )
    except Exception as exc:
        logger.warning("Unable to ensure Steve user exists: %s", exc)


def _source_label(url: str, fallback_index: int) -> str:
    """Use short, readable source labels while keeping the full URL intact."""
    try:
        domain = urlparse(url).netloc.lower().strip()
        if domain.startswith("www."):
            domain = domain[4:]
        return domain or f"source {fallback_index}"
    except Exception:
        return f"source {fallback_index}"


def _append_sources(content: str, source_links: Optional[Iterable[str]]) -> str:
    stripped = content.strip()
    if "\nSources\n" in stripped or stripped.endswith("\nSources"):
        return stripped
    links = [str(url).strip() for url in (source_links or []) if str(url).strip()]
    if not links:
        return stripped
    source_lines = "\n".join(
        f"- [{_source_label(url, idx)}]({url})"
        for idx, url in enumerate(links, start=1)
    )
    return f"{stripped}\n\nSources\n{source_lines}"


def create_steve_feed_post(
    *,
    community_id: int,
    content: str,
    source_links: Optional[Iterable[str]] = None,
) -> int:
    """Persist a new community feed post by Steve."""
    timestamp = datetime.utcnow()
    timestamp_str = timestamp.strftime("%Y-%m-%d %H:%M:%S")
    final_content = _append_sources(content, source_links)
    with get_db_connection() as conn:
        c = conn.cursor()
        ensure_steve_user(c)
        placeholder = get_sql_placeholder()
        c.execute(
            f"""
            INSERT INTO posts (username, content, timestamp, community_id)
            VALUES ({placeholder}, {placeholder}, {placeholder}, {placeholder})
            """,
            ("steve", final_content, timestamp_str, community_id),
        )
        post_id = c.lastrowid
        try:
            c.execute("UPDATE posts SET created_at = ? WHERE id = ?", (timestamp_str, post_id))
        except Exception:
            pass
        try:
            conn.commit()
        except Exception:
            pass

    try:
        write_post(
            post_id=post_id,
            username="steve",
            content=final_content,
            community_id=community_id,
            timestamp=timestamp,
        )
    except Exception as exc:
        logger.warning("Firestore post write failed for generated Steve post %s: %s", post_id, exc)
    try:
        invalidate_community_cache(community_id)
    except Exception:
        pass
    try:
        fanout_community_post_notifications(
            community_id=community_id,
            post_id=post_id,
            author_username="steve",
            content=final_content,
        )
    except Exception as exc:
        logger.warning(
            "Community post notifications failed for generated Steve post %s: %s",
            post_id,
            exc,
        )
    try:
        from bodybuilding_app import auto_flag_content_if_needed  # type: ignore import-not-found

        auto_flag_content_if_needed(post_id, final_content, "steve", community_id)
    except Exception:
        pass
    return post_id


def send_steve_dm(*, receiver_username: str, content: str) -> int:
    """Persist a new DM from Steve to a member."""
    timestamp = datetime.utcnow()
    timestamp_str = timestamp.strftime("%Y-%m-%d %H:%M:%S")
    receiver = receiver_username.strip()
    with get_db_connection() as conn:
        c = conn.cursor()
        ensure_steve_user(c)
        if USE_MYSQL:
            c.execute(
                """
                INSERT INTO messages (sender, receiver, message, timestamp)
                VALUES (%s, %s, %s, NOW())
                """,
                ("steve", receiver, content),
            )
        else:
            c.execute(
                """
                INSERT INTO messages (sender, receiver, message, timestamp)
                VALUES (?, ?, ?, ?)
                """,
                ("steve", receiver, content, timestamp_str),
            )
        message_id = c.lastrowid
        try:
            conn.commit()
        except Exception:
            pass

    try:
        write_dm_message(
            sender="steve",
            receiver=receiver,
            message_id=message_id,
            text=content,
            timestamp=timestamp,
        )
    except Exception as exc:
        logger.warning("Firestore DM write failed for Steve DM %s: %s", message_id, exc)
    try:
        invalidate_message_cache(receiver, "steve")
        cache.delete(f"chat_threads:{receiver}")
    except Exception:
        pass
    return message_id

