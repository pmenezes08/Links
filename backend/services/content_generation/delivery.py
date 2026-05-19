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


def _truncate_dm_preview(text: str, max_len: int = 160) -> str:
    if not text:
        return ""
    s = " ".join(str(text).replace("\r", " ").replace("\n", " ").split())
    if len(s) <= max_len:
        return s
    return s[: max_len - 1].rstrip() + "…"


def format_reminder_push_preview(reminder_text: str) -> str:
    """Push / in-app notification body for vault nudges: ``Reminder: "…"``."""
    inner = " ".join((reminder_text or "").replace("\r", "").replace("\n", " ").split())
    inner = inner.replace('"', "'").strip()
    if len(inner) > 140:
        inner = inner[:139].rstrip() + "…"
    return f'Reminder: "{inner}"'


def _notify_steve_dm_recipient_push(
    *,
    receiver_username: str,
    message_id: int,
    preview_for_notif: str,
    push_title: str,
) -> None:
    """Mirror ``send_message``: notifications row + FCM/Web push unless muted/in-thread."""
    from backend.services.notifications import send_push_to_user

    receiver = receiver_username.strip()
    _dm_link = "/user_chat/chat/steve"
    _preview = _truncate_dm_preview((preview_for_notif or "").strip()) or push_title

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            summary = "You have new messages from steve"
            try:
                if USE_MYSQL:
                    c.execute(
                        f"""
                        INSERT INTO notifications (user_id, from_user, type, post_id, community_id, message, created_at, is_read, link, preview_text)
                        VALUES ({ph}, {ph}, 'message', NULL, NULL, {ph}, NOW(), 0, {ph}, {ph})
                        ON DUPLICATE KEY UPDATE
                            created_at = NOW(),
                            message = VALUES(message),
                            is_read = 0,
                            link = VALUES(link),
                            preview_text = VALUES(preview_text)
                        """,
                        (receiver, "steve", summary, _dm_link, _preview),
                    )
                else:
                    c.execute(
                        f"""
                        INSERT INTO notifications (user_id, from_user, type, post_id, community_id, message, created_at, is_read, link, preview_text)
                        VALUES ({ph}, {ph}, 'message', NULL, NULL, {ph}, datetime('now'), 0, {ph}, {ph})
                        ON CONFLICT(user_id, from_user, type, post_id, community_id)
                        DO UPDATE SET created_at = datetime('now'), is_read = 0, message = excluded.message,
                          link = excluded.link, preview_text = excluded.preview_text
                        """,
                        (receiver, "steve", summary, _dm_link, _preview),
                    )
                conn.commit()
            except Exception as notif_e:
                logger.warning("Steve DM notification insert failed: %s", notif_e)

        should_push = True
        try:
            with get_db_connection() as conn2:
                c2 = conn2.cursor()
                if USE_MYSQL:
                    c2.execute(
                        """
                        SELECT 1 FROM active_chat_status
                        WHERE user=%s AND peer=%s AND updated_at > DATE_SUB(NOW(), INTERVAL 20 SECOND)
                        LIMIT 1
                        """,
                        (receiver, "steve"),
                    )
                else:
                    c2.execute(
                        """
                        SELECT 1 FROM active_chat_status
                        WHERE user=? AND peer=? AND datetime(updated_at) > datetime('now','-20 seconds')
                        LIMIT 1
                        """,
                        (receiver, "steve"),
                    )
                if c2.fetchone():
                    should_push = False
        except Exception as pe:
            logger.warning("active_chat_status for Steve DM push failed: %s", pe)

        if should_push:
            try:
                with get_db_connection() as conn3:
                    c3 = conn3.cursor()
                    phm = get_sql_placeholder()
                    c3.execute(
                        f"SELECT 1 FROM user_muted_chats WHERE username={phm} AND chat_key={phm}",
                        (receiver, "dm:steve"),
                    )
                    if c3.fetchone():
                        should_push = False
                        logger.debug("Suppressing Steve DM push — thread muted")
            except Exception as mute_err:
                logger.warning("Mute check Steve DM push: %s", mute_err)

        if should_push:
            send_push_to_user(
                receiver,
                {
                    "title": push_title,
                    "body": _preview,
                    "url": _dm_link,
                    "tag": f"message-steve-{message_id}",
                },
            )
    except Exception as exc:
        logger.warning("Steve DM push pipeline failed: %s", exc)


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


def _append_sources(
    content: str,
    source_links: Optional[Iterable[str]],
    *,
    enabled: bool = True,
) -> str:
    stripped = content.strip()
    if not enabled:
        return stripped
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
    append_sources: bool = True,
) -> int:
    """Persist a new community feed post by Steve."""
    timestamp = datetime.utcnow()
    timestamp_str = timestamp.strftime("%Y-%m-%d %H:%M:%S")
    final_content = _append_sources(content, source_links, enabled=append_sources)
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


def send_steve_dm(
    *,
    receiver_username: str,
    content: str,
    push_preview_text: Optional[str] = None,
    push_title: Optional[str] = None,
) -> int:
    """Persist a new DM from Steve to a member and notify like a normal DM (in-app + push when appropriate)."""
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

    try:
        _title = (push_title or "").strip() or "Message from steve"
        if push_preview_text is not None:
            _pv = push_preview_text.strip()
        else:
            _pv = _truncate_dm_preview(content.strip()) or _title
        _notify_steve_dm_recipient_push(
            receiver_username=receiver,
            message_id=message_id,
            preview_for_notif=_pv,
            push_title=_title,
        )
    except Exception as exc:
        logger.warning("Steve DM notification/push skipped: %s", exc)

    return message_id

