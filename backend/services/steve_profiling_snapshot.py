"""
Build and refresh Firestore profiling snapshot fields for Steve profiles.

These fields are kept separate from the Grok `analysis` payload:
- profilingPlatformActivity: user's own authored posts, replies, starred posts
- profilingSharedExternals: third-party URLs/content the user chose to share
"""

from __future__ import annotations

import logging
import re
import threading
from datetime import datetime
from typing import Any, Dict, List, Tuple
from urllib.parse import urlparse

from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

URL_PATTERN = re.compile(r'https?://[^\s<>"\')\]]+')
SHARED_EXTERNALS_NOTE = (
    "Third-party links and external content the user chose to share. "
    "Sharing is treated as a reputational signal about what they value, endorse, "
    "or think is worth the network's attention."
)


def _row_to_dict(row: Any, fallback_keys: List[str]) -> Dict[str, Any]:
    if row is None:
        return {}
    if hasattr(row, "keys"):
        return dict(row)
    return {
        key: (row[idx] if idx < len(row) else None)
        for idx, key in enumerate(fallback_keys)
    }


def _safe_date(value: Any) -> str:
    if value is None:
        return ""
    return str(value)[:10]


def _domains_from_urls(urls: List[str]) -> List[str]:
    seen: List[str] = []
    for url in urls:
        try:
            host = (urlparse(url).netloc or "").lower()
        except Exception:
            host = ""
        if host and host not in seen:
            seen.append(host)
    return seen


def build_steve_profiling_firestore_payloads(
    username: str,
    post_limit: int = 30,
    reply_limit: int = 20,
    starred_limit: int = 20,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Build the top-level profiling Firestore payloads for a user.

    Returns:
        (profiling_platform_activity, profiling_shared_externals)
    """
    authored_posts: List[Dict[str, Any]] = []
    replies: List[Dict[str, Any]] = []
    starred_posts: List[Dict[str, Any]] = []
    shared_items: List[Dict[str, Any]] = []

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()

            c.execute(
                f"""
                SELECT p.id, p.content, p.timestamp, p.image_path, p.video_path, p.audio_path,
                       c.name AS community_name
                FROM posts p
                LEFT JOIN communities c ON p.community_id = c.id
                WHERE p.username = {ph}
                  AND p.content IS NOT NULL
                  AND TRIM(p.content) != ''
                ORDER BY p.timestamp DESC
                LIMIT {int(post_limit)}
                """,
                (username,),
            )
            raw_posts = c.fetchall()

            for row in raw_posts or []:
                post = _row_to_dict(
                    row,
                    [
                        "id",
                        "content",
                        "timestamp",
                        "image_path",
                        "video_path",
                        "audio_path",
                        "community_name",
                    ],
                )
                content = (post.get("content") or "").strip()
                urls = URL_PATTERN.findall(content)
                base = {
                    "postId": post.get("id"),
                    "date": _safe_date(post.get("timestamp")),
                    "community": post.get("community_name") or "",
                    "userCaption": content[:500],
                    "hasMedia": bool(
                        post.get("image_path")
                        or post.get("video_path")
                        or post.get("audio_path")
                    ),
                }
                if urls:
                    shared_items.append(
                        {
                            **base,
                            "urls": urls[:5],
                            "domains": _domains_from_urls(urls[:5]),
                            "signal": "third_party_share",
                        }
                    )
                else:
                    authored_posts.append(
                        {
                            "postId": post.get("id"),
                            "snippet": content[:250],
                            "date": _safe_date(post.get("timestamp")),
                            "community": post.get("community_name") or "",
                            "hasMedia": base["hasMedia"],
                        }
                    )

            c.execute(
                f"""
                SELECT r.id, r.post_id, r.content, r.timestamp, c.name AS community_name,
                       SUBSTRING(p.content, 1, 120) AS parent_snippet
                FROM replies r
                LEFT JOIN posts p ON r.post_id = p.id
                LEFT JOIN communities c ON r.community_id = c.id
                WHERE r.username = {ph}
                  AND r.content IS NOT NULL
                  AND TRIM(r.content) != ''
                ORDER BY r.timestamp DESC
                LIMIT {int(reply_limit)}
                """,
                (username,),
            )
            raw_replies = c.fetchall()

            for row in raw_replies or []:
                reply = _row_to_dict(
                    row,
                    ["id", "post_id", "content", "timestamp", "community_name", "parent_snippet"],
                )
                replies.append(
                    {
                        "replyId": reply.get("id"),
                        "postId": reply.get("post_id"),
                        "content": (reply.get("content") or "").strip()[:200],
                        "date": _safe_date(reply.get("timestamp")),
                        "community": reply.get("community_name") or "",
                        "replyingTo": (reply.get("parent_snippet") or "").strip()[:120],
                    }
                )

            try:
                c.execute(
                    f"""
                    SELECT kp.post_id, kp.created_at, p.content, c.name AS community_name
                    FROM key_posts kp
                    LEFT JOIN posts p ON kp.post_id = p.id
                    LEFT JOIN communities c ON kp.community_id = c.id
                    WHERE kp.username = {ph}
                    ORDER BY kp.created_at DESC
                    LIMIT {int(starred_limit)}
                    """,
                    (username,),
                )
                raw_starred = c.fetchall()
                for row in raw_starred or []:
                    starred = _row_to_dict(
                        row,
                        ["post_id", "created_at", "content", "community_name"],
                    )
                    starred_posts.append(
                        {
                            "postId": starred.get("post_id"),
                            "date": _safe_date(starred.get("created_at")),
                            "community": starred.get("community_name") or "",
                            "snippet": (starred.get("content") or "").strip()[:160],
                        }
                    )
            except Exception as starred_err:
                logger.debug(
                    "Could not fetch key_posts snapshot for %s: %s",
                    username,
                    starred_err,
                )

    except Exception as e:
        logger.warning(
            "Failed to build profiling snapshot payloads for %s: %s",
            username,
            e,
        )

    now_iso = datetime.utcnow().isoformat() + "Z"
    profiling_platform_activity = {
        "updatedAt": now_iso,
        "authoredPosts": authored_posts,
        "replies": replies,
        "starredPosts": starred_posts,
    }
    profiling_shared_externals = {
        "updatedAt": now_iso,
        "note": SHARED_EXTERNALS_NOTE,
        "items": shared_items,
    }
    return profiling_platform_activity, profiling_shared_externals


def schedule_steve_profiling_snapshot_refresh(username: str) -> None:
    """Refresh profiling snapshot fields asynchronously."""

    def _run() -> None:
        try:
            from backend.services.firestore_writes import (
                merge_steve_user_profiling_fields,
            )

            platform_activity, shared_externals = (
                build_steve_profiling_firestore_payloads(username)
            )
            merge_steve_user_profiling_fields(
                username,
                platform_activity=platform_activity,
                shared_externals=shared_externals,
            )
        except Exception as e:
            logger.debug(
                "Profiling snapshot refresh failed for %s: %s",
                username,
                e,
            )

    threading.Thread(target=_run, daemon=True).start()
