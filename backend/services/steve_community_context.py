"""Scoped community corpus builders for Steve feed surfaces.

Community resources are exact-scope: a call from community B may read B rows
only, not parent/root or sibling community rows. Profile/KB access is handled
separately by ``steve_profiling_gates``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import io
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple

import requests

from backend.services.database import USE_MYSQL
from backend.services.group_feed_access import check_group_feed_access
from backend.services.steve_document_memory import build_doc_memory_context

logger = logging.getLogger(__name__)

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp")
VIDEO_EXT = (".mp4", ".mov", ".m4v", ".webm", ".avi")
DOC_CONTEXT_RE = re.compile(
    r"\b(document|documents|doc|docs|file|files|pdf|attachment|attachments|upload|uploaded|"
    r"paper|report|deck|brief|whitepaper|proposal|section|chapter|page|pages|summary|summarize)\b",
    re.IGNORECASE,
)


@dataclass
class SteveCommunityCorpus:
    """Text + authorized image URLs assembled for one Steve turn."""

    text: str = ""
    image_urls: List[str] = field(default_factory=list)
    community_id: Optional[int] = None
    group_id: Optional[int] = None
    counts: Dict[str, int] = field(default_factory=dict)


def _row_value(row: Any, key: str, index: int, default: Any = None) -> Any:
    if row is None:
        return default
    try:
        if hasattr(row, "keys") and key in row.keys():
            return row[key]
    except Exception:
        pass
    try:
        return row[index]
    except Exception:
        return default


def _full_media_url(path: Any) -> Optional[str]:
    if not path:
        return None
    value = str(path).strip()
    if not value:
        return None
    if value.startswith("http://") or value.startswith("https://"):
        return value
    base_url = (os.environ.get("PUBLIC_BASE_URL") or "https://app.c-point.co").rstrip("/")
    media_base = (os.environ.get("CLOUDFLARE_R2_PUBLIC_URL") or "").rstrip("/")
    if media_base and not value.startswith("/"):
        return f"{media_base}/{value.lstrip('/')}"
    if value.startswith("/uploads") or value.startswith("/static"):
        return f"{base_url}{value}"
    return f"{base_url}/uploads/{value.lstrip('/')}"


def _append_media_url(out: List[str], path: Any, *, images_only: bool = True) -> None:
    if not path:
        return
    lower = str(path).split("?", 1)[0].lower()
    if images_only and not lower.endswith(IMAGE_EXT):
        return
    url = _full_media_url(path)
    if url and url not in out:
        out.append(url)


def _thread_requests_document_context(*texts: Any) -> bool:
    return any(DOC_CONTEXT_RE.search(str(text or "")) for text in texts if text)


def _image_urls_from_media_paths(raw: Any) -> List[str]:
    if not raw:
        return []
    try:
        media_items = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        media_items = []
    out: List[str] = []
    if not isinstance(media_items, list):
        return out
    for item in media_items:
        if isinstance(item, dict):
            path = item.get("path") or item.get("url") or item.get("image_url")
            kind = str(item.get("type") or "").lower()
            if kind and kind != "image":
                continue
            _append_media_url(out, path, images_only=True)
        elif isinstance(item, str):
            _append_media_url(out, item, images_only=True)
    return out


def _is_app_admin_cursor(cursor: Any, ph: str, username: str) -> bool:
    norm = (username or "").strip().lower()
    if not norm:
        return False
    if norm == "admin":
        return True
    try:
        cursor.execute(
            f"SELECT is_admin FROM users WHERE LOWER(username) = LOWER({ph})",
            (username,),
        )
        row = cursor.fetchone()
        return bool(_row_value(row, "is_admin", 0, 0))
    except Exception:
        return False


def user_can_read_exact_community(cursor: Any, ph: str, username: str, community_id: int) -> bool:
    """Authorize reading rows owned by exactly ``community_id``."""
    if not username or community_id is None:
        return False
    if _is_app_admin_cursor(cursor, ph, username):
        return True
    try:
        cursor.execute(
            f"""
            SELECT 1
            FROM communities c
            LEFT JOIN community_admins ca
              ON ca.community_id = c.id AND LOWER(ca.username) = LOWER({ph})
            LEFT JOIN user_communities uc
              ON uc.community_id = c.id
            LEFT JOIN users u
              ON u.id = uc.user_id AND LOWER(u.username) = LOWER({ph})
            WHERE c.id = {ph}
              AND (
                LOWER(c.creator_username) = LOWER({ph})
                OR ca.username IS NOT NULL
                OR u.id IS NOT NULL
              )
            LIMIT 1
            """,
            (username, username, community_id, username),
        )
    except Exception:
        cursor.execute(
            f"""
            SELECT 1
            FROM communities c
            LEFT JOIN user_communities uc
              ON uc.community_id = c.id
            LEFT JOIN users u
              ON u.id = uc.user_id AND LOWER(u.username) = LOWER({ph})
            WHERE c.id = {ph}
              AND (
                LOWER(c.creator_username) = LOWER({ph})
                OR u.id IS NOT NULL
              )
            LIMIT 1
            """,
            (username, community_id, username),
        )
    return cursor.fetchone() is not None


def _safe_post_row(cursor: Any, ph: str, post_id: int) -> Optional[Dict[str, Any]]:
    try:
        cursor.execute(
            f"""
            SELECT id, content, username, community_id, image_path, video_path, media_paths, audio_summary
            FROM posts
            WHERE id = {ph}
            """,
            (post_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "id": _row_value(row, "id", 0),
            "content": _row_value(row, "content", 1, ""),
            "username": _row_value(row, "username", 2, ""),
            "community_id": _row_value(row, "community_id", 3),
            "image_path": _row_value(row, "image_path", 4),
            "video_path": _row_value(row, "video_path", 5),
            "media_paths": _row_value(row, "media_paths", 6),
            "audio_summary": _row_value(row, "audio_summary", 7),
        }
    except Exception:
        cursor.execute(
            f"SELECT id, content, username, community_id, image_path FROM posts WHERE id = {ph}",
            (post_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "id": _row_value(row, "id", 0),
            "content": _row_value(row, "content", 1, ""),
            "username": _row_value(row, "username", 2, ""),
            "community_id": _row_value(row, "community_id", 3),
            "image_path": _row_value(row, "image_path", 4),
        }


def _safe_group_post_row(cursor: Any, ph: str, group_post_id: int) -> Optional[Dict[str, Any]]:
    gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
    try:
        cursor.execute(
            f"""
            SELECT gp.id, gp.content, gp.username, gp.image_path, gp.video_path, gp.media_paths, gp.group_id, g.community_id
            FROM {gp_t} gp
            JOIN {'`groups`' if USE_MYSQL else 'groups'} g ON g.id = gp.group_id
            WHERE gp.id = {ph}
            """,
            (group_post_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "id": _row_value(row, "id", 0),
            "content": _row_value(row, "content", 1, ""),
            "username": _row_value(row, "username", 2, ""),
            "image_path": _row_value(row, "image_path", 3),
            "video_path": _row_value(row, "video_path", 4),
            "media_paths": _row_value(row, "media_paths", 5),
            "group_id": _row_value(row, "group_id", 6),
            "community_id": _row_value(row, "community_id", 7),
        }
    except Exception:
        cursor.execute(
            f"""
            SELECT gp.id, gp.content, gp.username, gp.image_path, gp.group_id, g.community_id
            FROM {gp_t} gp
            JOIN {'`groups`' if USE_MYSQL else 'groups'} g ON g.id = gp.group_id
            WHERE gp.id = {ph}
            """,
            (group_post_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "id": _row_value(row, "id", 0),
            "content": _row_value(row, "content", 1, ""),
            "username": _row_value(row, "username", 2, ""),
            "image_path": _row_value(row, "image_path", 3),
            "group_id": _row_value(row, "group_id", 4),
            "community_id": _row_value(row, "community_id", 5),
        }


def extract_pdf_text_for_steve(file_path: str, max_chars: int = 4000) -> Optional[str]:
    """Extract text from an authorized Useful Docs PDF path or URL."""
    if not file_path:
        return None
    try:
        pdf_bytes = None
        if str(file_path).startswith("http"):
            resp = requests.get(str(file_path), timeout=30)
            resp.raise_for_status()
            pdf_bytes = resp.content
        else:
            base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            candidates = [
                os.path.join(base_dir, "static", "uploads", str(file_path).lstrip("/")),
                os.path.join(base_dir, "uploads", str(file_path).lstrip("/")),
            ]
            for full_path in candidates:
                if os.path.exists(full_path):
                    with open(full_path, "rb") as fh:
                        pdf_bytes = fh.read()
                    break
        if not pdf_bytes:
            return None
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(pdf_bytes))
        parts: List[str] = []
        for i in range(min(len(reader.pages), 15)):
            try:
                page_text = reader.pages[i].extract_text() or ""
            except Exception:
                page_text = ""
            if page_text.strip():
                parts.append(page_text)
        text = " ".join("\n".join(parts).split())
        return text[:max_chars] if text.strip() else None
    except Exception as exc:
        logger.warning("Steve PDF extraction failed for %s: %s", file_path, exc)
        return None


def _link_excerpt(url: str, max_chars: int = 1200) -> str:
    if not url or not str(url).startswith("http"):
        return ""
    try:
        from backend.services.steve_content_enrichment import fetch_article_for_reader

        result = fetch_article_for_reader(str(url))
        if not result.get("success") or not result.get("content"):
            return ""
        text = " ".join(str(result["content"]).split())
        return text[:max_chars]
    except Exception as exc:
        logger.debug("Steve link text skipped for %s: %s", url, exc)
        return ""


def build_steve_community_resource_context(
    cursor: Any,
    community_id: int,
    ph: str,
    *,
    max_doc_chars_total: int = 2000,
    events_limit: int = 10,
    links_limit: int = 10,
    docs_limit: int = 10,
    polls_limit: int = 5,
    tasks_limit: int = 10,
    include_link_text: bool = False,
) -> str:
    """Build exact-community resources for Steve; no parent/sibling expansion."""
    parts: List[str] = []
    cid = int(community_id)
    try:
        from backend.services.steve_community_memory import get_compact_community_memory

        memory = get_compact_community_memory(cid)
        if memory:
            parts.append("Compact community memory:\n" + memory)
    except Exception as exc:
        logger.debug("Steve exact community memory context failed: %s", exc)

    try:
        if int(events_limit or 0) > 0:
            date_filter = "CURDATE()" if USE_MYSQL else "date('now')"
            cursor.execute(
                f"""
                SELECT title, date, start_time, end_time, description
                FROM calendar_events
                WHERE community_id = {ph}
                  AND (group_id IS NULL OR COALESCE(group_id, 0) = 0)
                  AND date >= {date_filter}
                ORDER BY date ASC
                LIMIT {int(events_limit)}
                """,
                (cid,),
            )
            lines = []
            for evt in cursor.fetchall() or []:
                title = _row_value(evt, "title", 0, "")
                date = _row_value(evt, "date", 1, "")
                start_time = _row_value(evt, "start_time", 2, "")
                desc = (_row_value(evt, "description", 4, "") or "")[:160]
                lines.append(f"- {title} | Date: {date}" + (f" | Time: {start_time}" if start_time else "") + (f" | {desc}" if desc else ""))
            if lines:
                parts.append("Upcoming events in this community:\n" + "\n".join(lines))
    except Exception as exc:
        logger.warning("Steve exact community events context failed: %s", exc)

    try:
        if int(tasks_limit or 0) > 0:
            cursor.execute(
                f"""
                SELECT title, description, due_date, assigned_to_username, status, completed
                FROM tasks
                WHERE community_id = {ph}
                  AND (group_id IS NULL OR COALESCE(group_id, 0) = 0)
                ORDER BY (CASE WHEN due_date IS NULL THEN 1 ELSE 0 END), due_date ASC, id DESC
                LIMIT {int(tasks_limit)}
                """,
                (cid,),
            )
            lines = []
            for task in cursor.fetchall() or []:
                title = _row_value(task, "title", 0, "")
                desc = (_row_value(task, "description", 1, "") or "")[:160]
                due = _row_value(task, "due_date", 2, "")
                assignee = _row_value(task, "assigned_to_username", 3, "") or "community"
                status = _row_value(task, "status", 4, "") or ("completed" if _row_value(task, "completed", 5, 0) else "not_started")
                lines.append(f"- {title} | Status: {status} | Assigned: {assignee}" + (f" | Due: {due}" if due else "") + (f" | {desc}" if desc else ""))
            if lines:
                parts.append("Tasks in this community:\n" + "\n".join(lines))
    except Exception as exc:
        logger.debug("Steve exact community tasks context skipped: %s", exc)

    try:
        if int(links_limit or 0) > 0:
            cursor.execute(
                f"""
                SELECT url, description
                FROM useful_links
                WHERE community_id = {ph}
                  AND (group_id IS NULL OR COALESCE(group_id, 0) = 0)
                ORDER BY created_at DESC
                LIMIT {int(links_limit)}
                """,
                (cid,),
            )
            lines = []
            for link in cursor.fetchall() or []:
                url = _row_value(link, "url", 0, "")
                desc = _row_value(link, "description", 1, "") or url
                line = f"- {desc} ({url})"
                if include_link_text:
                    excerpt = _link_excerpt(str(url))
                    if excerpt:
                        line += f"\n  Excerpt: {excerpt}"
                lines.append(line)
            if lines:
                parts.append("Useful links in this community:\n" + "\n".join(lines))
    except Exception as exc:
        logger.warning("Steve exact community links context failed: %s", exc)

    try:
        if int(docs_limit or 0) > 0 and int(max_doc_chars_total or 0) > 0:
            skip_legacy_docs = False
            doc_memory, doc_meta = build_doc_memory_context(
                "",
                community_id=cid,
                manifest_limit=int(docs_limit),
                chunk_limit=3,
                max_chars=int(max_doc_chars_total),
            )
            if doc_memory:
                parts.append("Community document memory:\n" + doc_memory)
                skip_legacy_docs = True
            if not skip_legacy_docs:
                cursor.execute(
                    f"""
                    SELECT file_path, description
                    FROM useful_docs
                    WHERE community_id = {ph}
                      AND (group_id IS NULL OR COALESCE(group_id, 0) = 0)
                    ORDER BY created_at DESC
                    LIMIT {int(docs_limit)}
                    """,
                    (cid,),
                )
                lines = []
                chars_remaining = int(max_doc_chars_total)
                for doc in cursor.fetchall() or []:
                    fp = _row_value(doc, "file_path", 0, "")
                    desc = _row_value(doc, "description", 1, "") or fp
                    text = extract_pdf_text_for_steve(str(fp), max_chars=min(4000, chars_remaining))
                    excerpt = text if text else "(Could not read document.)"
                    lines.append(f"Document: {desc}\nContent (excerpt): {excerpt}")
                    if text:
                        chars_remaining -= len(text)
                    if chars_remaining <= 0:
                        break
                if lines:
                    parts.append("Community documents:\n" + "\n\n---\n\n".join(lines))
    except Exception as exc:
        logger.warning("Steve exact community docs context failed: %s", exc)

    try:
        if int(polls_limit or 0) > 0:
            cursor.execute(
                f"""
                SELECT p.id, p.question
                FROM polls p
                JOIN posts po ON p.post_id = po.id
                WHERE po.community_id = {ph}
                  AND (po.group_id IS NULL OR COALESCE(po.group_id, 0) = 0)
                  AND p.is_active = 1
                ORDER BY po.timestamp DESC
                LIMIT {int(polls_limit)}
                """,
                (cid,),
            )
            lines = []
            for poll in cursor.fetchall() or []:
                pid = _row_value(poll, "id", 0)
                q = _row_value(poll, "question", 1, "")
                try:
                    cursor.execute(f"SELECT option_text, votes FROM poll_options WHERE poll_id = {ph} ORDER BY id", (pid,))
                    opts = cursor.fetchall() or []
                    opt_strs = [f"{_row_value(o, 'option_text', 0, '')} ({_row_value(o, 'votes', 1, 0)} votes)" for o in opts]
                    lines.append(f"- Poll: {q} | Options: {', '.join(opt_strs)}")
                except Exception:
                    lines.append(f"- Poll: {q}")
            if lines:
                parts.append("Active polls in this community:\n" + "\n".join(lines))
    except Exception as exc:
        logger.warning("Steve exact community polls context failed: %s", exc)

    return "\n\n".join(parts)


def build_steve_group_resource_context(
    cursor: Any,
    group_id: int,
    ph: str,
    *,
    max_doc_chars_total: int = 2000,
    events_limit: int = 10,
    links_limit: int = 10,
    docs_limit: int = 10,
    polls_limit: int = 5,
    tasks_limit: int = 10,
    include_link_text: bool = False,
) -> str:
    """Build exact-group resources for Steve; no parent-community rows."""
    parts: List[str] = []
    gid = int(group_id)

    try:
        if int(events_limit or 0) > 0:
            date_filter = "CURDATE()" if USE_MYSQL else "date('now')"
            cursor.execute(
                f"""
                SELECT title, date, start_time, end_time, description
                FROM calendar_events
                WHERE group_id = {ph} AND date >= {date_filter}
                ORDER BY date ASC
                LIMIT {int(events_limit)}
                """,
                (gid,),
            )
            lines = []
            for evt in cursor.fetchall() or []:
                title = _row_value(evt, "title", 0, "")
                date = _row_value(evt, "date", 1, "")
                start_time = _row_value(evt, "start_time", 2, "")
                desc = (_row_value(evt, "description", 4, "") or "")[:160]
                lines.append(f"- {title} | Date: {date}" + (f" | Time: {start_time}" if start_time else "") + (f" | {desc}" if desc else ""))
            if lines:
                parts.append("Upcoming events in this group:\n" + "\n".join(lines))
    except Exception as exc:
        logger.warning("Steve exact group events context failed: %s", exc)

    try:
        if int(tasks_limit or 0) > 0:
            cursor.execute(
                f"""
                SELECT title, description, due_date, assigned_to_username, status, completed
                FROM tasks
                WHERE group_id = {ph}
                ORDER BY (CASE WHEN due_date IS NULL THEN 1 ELSE 0 END), due_date ASC, id DESC
                LIMIT {int(tasks_limit)}
                """,
                (gid,),
            )
            lines = []
            for task in cursor.fetchall() or []:
                title = _row_value(task, "title", 0, "")
                desc = (_row_value(task, "description", 1, "") or "")[:160]
                due = _row_value(task, "due_date", 2, "")
                assignee = _row_value(task, "assigned_to_username", 3, "") or "group"
                status = _row_value(task, "status", 4, "") or ("completed" if _row_value(task, "completed", 5, 0) else "not_started")
                lines.append(f"- {title} | Status: {status} | Assigned: {assignee}" + (f" | Due: {due}" if due else "") + (f" | {desc}" if desc else ""))
            if lines:
                parts.append("Tasks in this group:\n" + "\n".join(lines))
    except Exception as exc:
        logger.debug("Steve exact group tasks context skipped: %s", exc)

    try:
        if int(links_limit or 0) > 0:
            cursor.execute(
                f"""
                SELECT url, description
                FROM useful_links
                WHERE group_id = {ph}
                ORDER BY created_at DESC
                LIMIT {int(links_limit)}
                """,
                (gid,),
            )
            lines = []
            for link in cursor.fetchall() or []:
                url = _row_value(link, "url", 0, "")
                desc = _row_value(link, "description", 1, "") or url
                line = f"- {desc} ({url})"
                if include_link_text:
                    excerpt = _link_excerpt(str(url))
                    if excerpt:
                        line += f"\n  Excerpt: {excerpt}"
                lines.append(line)
            if lines:
                parts.append("Useful links in this group:\n" + "\n".join(lines))
    except Exception as exc:
        logger.warning("Steve exact group links context failed: %s", exc)

    try:
        if int(docs_limit or 0) > 0 and int(max_doc_chars_total or 0) > 0:
            skip_legacy_docs = False
            doc_memory, doc_meta = build_doc_memory_context(
                "",
                group_id=gid,
                manifest_limit=int(docs_limit),
                chunk_limit=3,
                max_chars=int(max_doc_chars_total),
            )
            if doc_memory:
                parts.append("Group document memory:\n" + doc_memory)
                skip_legacy_docs = True
            if not skip_legacy_docs:
                cursor.execute(
                    f"""
                    SELECT file_path, description
                    FROM useful_docs
                    WHERE group_id = {ph}
                    ORDER BY created_at DESC
                    LIMIT {int(docs_limit)}
                    """,
                    (gid,),
                )
                lines = []
                chars_remaining = int(max_doc_chars_total)
                for doc in cursor.fetchall() or []:
                    fp = _row_value(doc, "file_path", 0, "")
                    desc = _row_value(doc, "description", 1, "") or fp
                    text = extract_pdf_text_for_steve(str(fp), max_chars=min(4000, chars_remaining))
                    excerpt = text if text else "(Could not read document.)"
                    lines.append(f"Document: {desc}\nContent (excerpt): {excerpt}")
                    if text:
                        chars_remaining -= len(text)
                    if chars_remaining <= 0:
                        break
                if lines:
                    parts.append("Group documents:\n" + "\n\n---\n\n".join(lines))
    except Exception as exc:
        logger.warning("Steve exact group docs context failed: %s", exc)

    try:
        if int(polls_limit or 0) > 0:
            from backend.services.group_polls_data import ensure_group_poll_tables, poll_expired

            ensure_group_poll_tables(cursor)
            gp_t = "`group_polls`" if USE_MYSQL else "group_polls"
            gpo_t = "`group_poll_options`" if USE_MYSQL else "group_poll_options"
            cursor.execute(
                f"""
                SELECT id, question, expires_at
                FROM {gp_t}
                WHERE group_id = {ph} AND is_active = 1
                ORDER BY created_at DESC
                LIMIT {int(polls_limit)}
                """,
                (gid,),
            )
            lines = []
            for poll in cursor.fetchall() or []:
                pid = _row_value(poll, "id", 0)
                q = _row_value(poll, "question", 1, "")
                if poll_expired(_row_value(poll, "expires_at", 2)):
                    continue
                try:
                    cursor.execute(f"SELECT option_text, votes FROM {gpo_t} WHERE group_poll_id = {ph} ORDER BY id", (pid,))
                    opts = cursor.fetchall() or []
                    opt_strs = [f"{_row_value(o, 'option_text', 0, '')} ({_row_value(o, 'votes', 1, 0)} votes)" for o in opts]
                    lines.append(f"- Poll: {q} | Options: {', '.join(opt_strs)}")
                except Exception:
                    lines.append(f"- Poll: {q}")
            if lines:
                parts.append("Active polls in this group:\n" + "\n".join(lines))
    except Exception as exc:
        logger.warning("Steve exact group polls context failed: %s", exc)

    return "\n\n".join(parts)


def build_steve_feed_corpus(
    cursor: Any,
    ph: str,
    *,
    viewer_username: str,
    post_id: int,
    user_message: str = "",
    include_resources: bool = False,
    max_doc_chars_total: int = 2000,
    recent_comments_limit: int = 8,
    events_limit: int = 10,
    links_limit: int = 10,
    docs_limit: int = 10,
    polls_limit: int = 5,
    tasks_limit: int = 10,
) -> SteveCommunityCorpus:
    post = _safe_post_row(cursor, ph, int(post_id))
    if not post:
        return SteveCommunityCorpus()
    community_id = int(post.get("community_id") or 0)
    if not user_can_read_exact_community(cursor, ph, viewer_username, community_id):
        logger.warning("Steve feed corpus denied viewer=%s community_id=%s post_id=%s", viewer_username, community_id, post_id)
        return SteveCommunityCorpus(community_id=community_id, counts={"denied": 1})

    image_urls: List[str] = []
    _append_media_url(image_urls, post.get("image_path"), images_only=True)
    for url in _image_urls_from_media_paths(post.get("media_paths")):
        if url not in image_urls:
            image_urls.append(url)

    parts: List[str] = [f"Original post by {post.get('username')}: {post.get('content') or ''}"]
    if image_urls and post.get("video_path"):
        parts[-1] += f"\n[This post includes {len(image_urls)} image(s) and a video]"
    elif image_urls:
        parts[-1] += f"\n[This post includes {len(image_urls)} image(s)]"
    elif post.get("video_path"):
        parts[-1] += "\n[This post includes a video]"
    if post.get("audio_summary"):
        parts.append(f"Audio summary on original post: {post.get('audio_summary')}")

    comments_limit = max(0, min(50, int(recent_comments_limit or 0)))
    comment_count = 0
    recent_comment_texts: List[str] = []
    if comments_limit:
        try:
            try:
                cursor.execute(
                    f"""
                    SELECT username, content, id, parent_reply_id, timestamp, image_path, video_path, audio_path
                    FROM replies
                    WHERE post_id = {ph} AND community_id = {ph}
                    ORDER BY timestamp ASC
                    LIMIT {comments_limit}
                    """,
                    (post_id, community_id),
                )
            except Exception:
                cursor.execute(
                    f"""
                    SELECT username, content, id, parent_reply_id, timestamp
                    FROM replies
                    WHERE post_id = {ph} AND community_id = {ph}
                    ORDER BY timestamp ASC
                    LIMIT {comments_limit}
                    """,
                    (post_id, community_id),
                )
            rows = cursor.fetchall() or []
            if rows:
                parts.append("\n--- All comments on this post (same community scope) ---")
                for comment in rows:
                    cu = _row_value(comment, "username", 0, "")
                    cc = _row_value(comment, "content", 1, "")
                    if cc:
                        recent_comment_texts.append(str(cc))
                        label = "[Steve (AI) replied]" if str(cu).lower() == "steve" else str(cu)
                        media_note = ""
                        img = _row_value(comment, "image_path", 5)
                        vid = _row_value(comment, "video_path", 6)
                        aud = _row_value(comment, "audio_path", 7)
                        if img:
                            _append_media_url(image_urls, img, images_only=True)
                            media_note += " [image attached]"
                        if vid:
                            media_note += " [video attached]"
                        if aud:
                            media_note += " [audio attached]"
                        parts.append(f"{label}: {cc}{media_note}")
                        comment_count += 1
                parts.append("--- End of comments ---\n")
        except Exception as exc:
            logger.warning("Steve exact feed comments context failed: %s", exc)

    if user_message:
        parts.append(f"User {viewer_username} now says: {user_message}")
    current_datetime = datetime.utcnow()
    parts.append(f"\n[Current date and time: {current_datetime.strftime('%A, %B %d, %Y at %H:%M UTC')}]")

    if include_resources or _thread_requests_document_context(user_message, post.get("content"), *recent_comment_texts[-4:]):
        try:
            doc_memory, doc_meta = build_doc_memory_context(
                user_message,
                community_id=community_id,
                original_post=str(post.get("content") or ""),
                recent_comments=recent_comment_texts,
                manifest_limit=docs_limit,
                chunk_limit=5,
                max_chars=max_doc_chars_total,
            )
            if doc_memory:
                parts.append("Document memory for this exact community only:\n" + doc_memory)
                if doc_meta.get("include_chunks"):
                    include_resources = True
        except Exception as exc:
            logger.debug("Steve feed document memory skipped: %s", exc)

    if include_resources:
        resources = build_steve_community_resource_context(
            cursor,
            community_id,
            ph,
            max_doc_chars_total=max_doc_chars_total,
            events_limit=events_limit,
            links_limit=links_limit,
            docs_limit=docs_limit,
            polls_limit=polls_limit,
            tasks_limit=tasks_limit,
            include_link_text=True,
        )
        if resources:
            parts.append("Community context for this exact community only:\n" + resources)

    counts = {"comments": comment_count, "images": len(image_urls)}
    logger.info(
        "Steve feed corpus built viewer=%s community_id=%s post_id=%s counts=%s",
        viewer_username,
        community_id,
        post_id,
        counts,
    )
    return SteveCommunityCorpus(
        text="\n\n".join(parts),
        image_urls=image_urls,
        community_id=community_id,
        counts=counts,
    )


def build_steve_group_corpus(
    cursor: Any,
    ph: str,
    *,
    viewer_username: str,
    group_post_id: int,
    user_message: str = "",
    include_resources: bool = False,
    max_doc_chars_total: int = 2000,
    recent_comments_limit: int = 8,
    events_limit: int = 10,
    links_limit: int = 10,
    docs_limit: int = 10,
    polls_limit: int = 5,
    tasks_limit: int = 10,
) -> SteveCommunityCorpus:
    post = _safe_group_post_row(cursor, ph, int(group_post_id))
    if not post:
        return SteveCommunityCorpus()
    group_id = int(post.get("group_id") or 0)
    community_id = int(post.get("community_id") or 0)
    ok, err = check_group_feed_access(cursor, ph, viewer_username, group_id)
    if not ok:
        logger.warning("Steve group corpus denied viewer=%s group_id=%s post_id=%s err=%s", viewer_username, group_id, group_post_id, err)
        return SteveCommunityCorpus(community_id=community_id, group_id=group_id, counts={"denied": 1})

    image_urls: List[str] = []
    _append_media_url(image_urls, post.get("image_path"), images_only=True)
    for url in _image_urls_from_media_paths(post.get("media_paths")):
        if url not in image_urls:
            image_urls.append(url)

    parts: List[str] = [f"Original group post by {post.get('username')}: {post.get('content') or ''}"]
    if image_urls and post.get("video_path"):
        parts[-1] += f"\n[This post includes {len(image_urls)} image(s) and a video]"
    elif image_urls:
        parts[-1] += f"\n[This post includes {len(image_urls)} image(s)]"
    elif post.get("video_path"):
        parts[-1] += "\n[This post includes a video]"

    gr_t = "`group_replies`" if USE_MYSQL else "group_replies"
    comments_limit = max(0, min(50, int(recent_comments_limit or 0)))
    comment_count = 0
    recent_comment_texts: List[str] = []
    if comments_limit:
        try:
            try:
                cursor.execute(
                    f"""
                    SELECT username, content, id, parent_reply_id, created_at, image_path, video_path
                    FROM {gr_t}
                    WHERE group_post_id = {ph}
                    ORDER BY id ASC
                    LIMIT {comments_limit}
                    """,
                    (group_post_id,),
                )
            except Exception:
                cursor.execute(
                    f"""
                    SELECT username, content, id, parent_reply_id, created_at
                    FROM {gr_t}
                    WHERE group_post_id = {ph}
                    ORDER BY id ASC
                    LIMIT {comments_limit}
                    """,
                    (group_post_id,),
                )
            rows = cursor.fetchall() or []
            if rows:
                parts.append("\n--- All comments on this group post (same group scope) ---")
                for comment in rows:
                    cu = _row_value(comment, "username", 0, "")
                    cc = _row_value(comment, "content", 1, "")
                    if cc:
                        recent_comment_texts.append(str(cc))
                        label = "[Steve (AI) replied]" if str(cu).lower() == "steve" else str(cu)
                        media_note = ""
                        img = _row_value(comment, "image_path", 5)
                        vid = _row_value(comment, "video_path", 6)
                        if img:
                            _append_media_url(image_urls, img, images_only=True)
                            media_note += " [image attached]"
                        if vid:
                            media_note += " [video attached]"
                        parts.append(f"{label}: {cc}{media_note}")
                        comment_count += 1
                parts.append("--- End of comments ---\n")
        except Exception as exc:
            logger.warning("Steve exact group comments context failed: %s", exc)

    if user_message:
        parts.append(f"User {viewer_username} now says: {user_message}")
    current_datetime = datetime.utcnow()
    parts.append(f"\n[Current date and time: {current_datetime.strftime('%A, %B %d, %Y at %H:%M UTC')}]")

    if include_resources or _thread_requests_document_context(user_message, post.get("content"), *recent_comment_texts[-4:]):
        try:
            doc_memory, doc_meta = build_doc_memory_context(
                user_message,
                group_id=group_id,
                original_post=str(post.get("content") or ""),
                recent_comments=recent_comment_texts,
                manifest_limit=docs_limit,
                chunk_limit=5,
                max_chars=max_doc_chars_total,
            )
            if doc_memory:
                parts.append("Document memory for this exact group only:\n" + doc_memory)
                if doc_meta.get("include_chunks"):
                    include_resources = True
        except Exception as exc:
            logger.debug("Steve group document memory skipped: %s", exc)

    if include_resources:
        resources = build_steve_group_resource_context(
            cursor,
            group_id,
            ph,
            max_doc_chars_total=max_doc_chars_total,
            events_limit=events_limit,
            links_limit=links_limit,
            docs_limit=docs_limit,
            polls_limit=polls_limit,
            tasks_limit=tasks_limit,
            include_link_text=True,
        )
        if resources:
            parts.append("Group context for this exact group only:\n" + resources)

    counts = {"comments": comment_count, "images": len(image_urls)}
    logger.info(
        "Steve group corpus built viewer=%s community_id=%s group_id=%s post_id=%s counts=%s",
        viewer_username,
        community_id,
        group_id,
        group_post_id,
        counts,
    )
    return SteveCommunityCorpus(
        text="\n\n".join(parts),
        image_urls=image_urls,
        community_id=community_id,
        group_id=group_id,
        counts=counts,
    )
