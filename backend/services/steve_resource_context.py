"""Steve resource context for community and group post replies.

This module owns the **resource** section of the Steve prompt: calendar
events, useful links, useful documents (with Firestore-indexed memory
plus legacy PDF text fallback) and active polls — scoped exactly to one
``community_id`` or one ``group_id`` and never widened.

It intentionally lives outside ``bodybuilding_app`` so reply paths and
crons can compose Steve context without dragging in the monolith. The
text it returns is concatenated directly into the system prompt; nothing
here calls an LLM.

Privacy: see ``AGENTS.md`` (Steve community corpus is exact-scope).
"""

from __future__ import annotations

import logging
import os
from typing import Any, Iterable, Optional, Sequence

logger = logging.getLogger(__name__)


def scope_has_useful_docs(
    c: Any,
    placeholder: str,
    *,
    community_id: Optional[int] = None,
    group_id: Optional[int] = None,
) -> bool:
    """Return True when the exact scope has at least one useful_docs row."""
    try:
        if group_id is not None:
            c.execute(
                f"SELECT 1 FROM useful_docs WHERE group_id = {placeholder} LIMIT 1",
                (int(group_id),),
            )
        elif community_id is not None:
            c.execute(
                f"""
                SELECT 1 FROM useful_docs
                WHERE community_id = {placeholder}
                  AND (group_id IS NULL OR COALESCE(group_id, 0) = 0)
                LIMIT 1
                """,
                (int(community_id),),
            )
        else:
            return False
        return c.fetchone() is not None
    except Exception as e:
        logger.debug("scope_has_useful_docs failed: %s", e)
        return False


def _memory_context_is_usable(memory_text: str, info: dict) -> bool:
    """Prefer Firestore memory when dossier or readable chunk text was retrieved."""
    if not (memory_text or "").strip():
        return False
    if (info.get("chunk_count") or 0) > 0:
        return True
    if (info.get("dossier_chars") or 0) > 0:
        return True
    if "Relevant document excerpts" in memory_text:
        return True
    if "Document dossier" in memory_text:
        return True
    return False


def extract_pdf_text_for_steve(file_path: str, max_chars: int = 4000) -> Optional[str]:
    """Legacy on-the-fly PDF text extraction for Steve context.

    Kept as a fallback for documents that have not been indexed into the
    Firestore memory (``steve_document_memory``). Returns ``None`` on any
    failure so callers can skip the document cleanly.
    """
    try:
        import io

        pdf_bytes: Optional[bytes] = None
        if file_path.startswith("http"):
            import requests as _req

            resp = _req.get(file_path, timeout=30)
            resp.raise_for_status()
            pdf_bytes = resp.content
        else:
            base_dir = os.path.dirname(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
            full_path = os.path.join(base_dir, "static", "uploads", file_path.lstrip("/"))
            if not os.path.exists(full_path):
                full_path = os.path.join(base_dir, "uploads", file_path.lstrip("/"))
            if not os.path.exists(full_path):
                return None
            with open(full_path, "rb") as f:
                pdf_bytes = f.read()
        if not pdf_bytes:
            return None
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(pdf_bytes))
        text = ""
        for i in range(min(len(reader.pages), 15)):
            page_text = reader.pages[i].extract_text() or ""
            text += page_text + "\n"
        text = " ".join(text.split())
        return text[:max_chars] if text.strip() else None
    except Exception as e:
        logger.warning("PDF extraction failed for %s: %s", file_path, e)
        return None


def _docs_section_from_memory_or_legacy(
    c: Any,
    placeholder: str,
    *,
    scope_sql: str,
    scope_params: tuple,
    docs_limit: int,
    max_doc_chars_total: int,
    community_id: Optional[int],
    group_id: Optional[int],
    query: str,
    original_post: str,
    recent_comments: Optional[Iterable[str]],
    section_label: str,
) -> Optional[str]:
    """Build the documents section preferring Firestore memory, falling back to legacy.

    Tries ``build_doc_memory_context`` first (manifest + retrieved chunks). If
    memory has not indexed any docs for this scope, falls back to the legacy
    per-doc PDF extraction using ``useful_docs`` rows.
    """
    if docs_limit <= 0 or max_doc_chars_total <= 0:
        return None

    try:
        from backend.services.steve_document_memory import build_doc_memory_context

        memory_text, info = build_doc_memory_context(
            query or original_post or "",
            community_id=community_id,
            group_id=group_id,
            original_post=original_post,
            recent_comments=recent_comments,
            manifest_limit=max(1, docs_limit),
            max_chars=max(500, int(max_doc_chars_total)),
        )
    except Exception as mem_err:
        logger.debug("Steve doc memory unavailable, falling back to legacy: %s", mem_err)
        memory_text = ""
        info = {"manifest_count": 0}

    if _memory_context_is_usable(memory_text, info):
        return f"{section_label}:\n{memory_text}"

    try:
        c.execute(
            f"SELECT file_path, description FROM useful_docs WHERE {scope_sql} ORDER BY created_at DESC LIMIT {int(docs_limit)}",
            scope_params,
        )
        docs = c.fetchall()
    except Exception as e:
        logger.warning("Steve docs legacy query failed: %s", e)
        return None
    if not docs:
        return None

    doc_lines = []
    chars_remaining = int(max_doc_chars_total)
    for doc in docs:
        fp = doc["file_path"] if hasattr(doc, "keys") else doc[0]
        desc = (doc["description"] if hasattr(doc, "keys") else doc[1]) or fp
        text = extract_pdf_text_for_steve(fp, max_chars=min(4000, chars_remaining))
        excerpt = text if text else "(Could not read document.)"
        doc_lines.append(f"Document: {desc}\nContent (excerpt): {excerpt}")
        if text:
            chars_remaining -= len(text)
        if chars_remaining <= 0:
            break
    return f"{section_label}:\n" + "\n\n---\n\n".join(doc_lines)


def build_steve_community_context(
    c: Any,
    community_id: int,
    placeholder: str,
    max_doc_chars_total: int = 2000,
    *,
    events_limit: int = 10,
    links_limit: int = 10,
    docs_limit: int = 10,
    polls_limit: int = 5,
    user_message: str = "",
    original_post: str = "",
    recent_comments: Optional[Sequence[str]] = None,
) -> str:
    """Build community resource context: memory + calendar + links + docs + polls.

    All sections are bounded by the supplied limits; any failure logs and
    skips that section rather than failing the whole context build.
    """
    from backend.services.database import USE_MYSQL

    parts: list[str] = []
    events_limit = max(0, int(events_limit or 0))
    links_limit = max(0, int(links_limit or 0))
    docs_limit = max(0, int(docs_limit or 0))
    polls_limit = max(0, int(polls_limit or 0))

    try:
        from backend.services.steve_community_memory import get_compact_community_memory

        memory = get_compact_community_memory(int(community_id))
        if memory:
            parts.append("Compact community memory:\n" + memory)
    except Exception as e:
        logger.debug("Steve community memory context failed: %s", e)

    try:
        if events_limit > 0:
            if USE_MYSQL:
                c.execute(
                    f"SELECT title, date, start_time, end_time, description FROM calendar_events WHERE community_id = {placeholder} AND date >= CURDATE() ORDER BY date ASC LIMIT {events_limit}",
                    (community_id,),
                )
            else:
                c.execute(
                    f"SELECT title, date, start_time, end_time, description FROM calendar_events WHERE community_id = {placeholder} AND date >= date('now') ORDER BY date ASC LIMIT {events_limit}",
                    (community_id,),
                )
            events = c.fetchall()
            if events:
                lines = []
                for evt in events:
                    t = evt["title"] if hasattr(evt, "keys") else evt[0]
                    d = evt["date"] if hasattr(evt, "keys") else evt[1]
                    st = evt["start_time"] if hasattr(evt, "keys") else evt[2]
                    desc = (evt["description"] if hasattr(evt, "keys") else evt[4]) or ""
                    lines.append(
                        f"- {t} | Date: {d}"
                        + (f" | Time: {st}" if st else "")
                        + (f" | {desc[:100]}" if desc else "")
                    )
                parts.append("Upcoming events in this community:\n" + "\n".join(lines))
    except Exception as e:
        logger.warning("Steve calendar context failed: %s", e)

    try:
        if links_limit > 0:
            c.execute(
                f"SELECT url, description FROM useful_links WHERE community_id = {placeholder} ORDER BY created_at DESC LIMIT {links_limit}",
                (community_id,),
            )
            links = c.fetchall()
            if links:
                lines = []
                for lnk in links:
                    url = lnk["url"] if hasattr(lnk, "keys") else lnk[0]
                    desc = (lnk["description"] if hasattr(lnk, "keys") else lnk[1]) or url
                    lines.append(f"- {desc} ({url})")
                parts.append("Useful links in this community:\n" + "\n".join(lines))
    except Exception as e:
        logger.warning("Steve links context failed: %s", e)

    docs_section = _docs_section_from_memory_or_legacy(
        c,
        placeholder,
        scope_sql=f"community_id = {placeholder} AND (group_id IS NULL OR COALESCE(group_id, 0) = 0)",
        scope_params=(community_id,),
        docs_limit=docs_limit,
        max_doc_chars_total=max_doc_chars_total,
        community_id=int(community_id),
        group_id=None,
        query=user_message,
        original_post=original_post,
        recent_comments=recent_comments,
        section_label="Community documents",
    )
    if docs_section:
        parts.append(docs_section)

    try:
        if polls_limit > 0:
            c.execute(
                f"SELECT p.id, p.question FROM polls p JOIN posts po ON p.post_id = po.id WHERE po.community_id = {placeholder} AND p.is_active = 1 ORDER BY po.timestamp DESC LIMIT {polls_limit}",
                (community_id,),
            )
            polls = c.fetchall()
            if polls:
                poll_lines = []
                for poll in polls:
                    pid = poll["id"] if hasattr(poll, "keys") else poll[0]
                    q = poll["question"] if hasattr(poll, "keys") else poll[1]
                    try:
                        c.execute(
                            f"SELECT option_text, votes FROM poll_options WHERE poll_id = {placeholder} ORDER BY id",
                            (pid,),
                        )
                        opts = c.fetchall()
                        opt_strs = [
                            f"{(o['option_text'] if hasattr(o, 'keys') else o[0])} ({(o['votes'] if hasattr(o, 'keys') else o[1])} votes)"
                            for o in opts
                        ]
                        poll_lines.append(f"- Poll: {q} | Options: {', '.join(opt_strs)}")
                    except Exception:
                        poll_lines.append(f"- Poll: {q}")
                parts.append("Active polls in this community:\n" + "\n".join(poll_lines))
    except Exception as e:
        logger.warning("Steve polls context failed: %s", e)

    return "\n\n".join(parts)


def build_steve_group_resource_context(
    c: Any,
    group_id: int,
    placeholder: str,
    max_doc_chars_total: int = 2000,
    *,
    events_limit: int = 10,
    links_limit: int = 10,
    docs_limit: int = 10,
    polls_limit: int = 5,
    user_message: str = "",
    original_post: str = "",
    recent_comments: Optional[Sequence[str]] = None,
) -> str:
    """Build group-scoped resource context (calendar, links, docs, polls).

    Loads only rows where ``group_id`` matches; never widens to the parent
    community.
    """
    from backend.services.database import USE_MYSQL
    from backend.services.group_polls_data import ensure_group_poll_tables, poll_expired

    parts: list[str] = []
    gid = int(group_id)
    events_limit = max(0, int(events_limit or 0))
    links_limit = max(0, int(links_limit or 0))
    docs_limit = max(0, int(docs_limit or 0))
    polls_limit = max(0, int(polls_limit or 0))

    try:
        if events_limit > 0:
            if USE_MYSQL:
                c.execute(
                    f"""
                    SELECT title, date, start_time, end_time, description
                    FROM calendar_events
                    WHERE group_id = {placeholder} AND date >= CURDATE()
                    ORDER BY date ASC
                    LIMIT {events_limit}
                    """,
                    (gid,),
                )
            else:
                c.execute(
                    f"""
                    SELECT title, date, start_time, end_time, description
                    FROM calendar_events
                    WHERE group_id = {placeholder} AND date >= date('now')
                    ORDER BY date ASC
                    LIMIT {events_limit}
                    """,
                    (gid,),
                )
            events = c.fetchall()
            if events:
                lines = []
                for evt in events:
                    t = evt["title"] if hasattr(evt, "keys") else evt[0]
                    d = evt["date"] if hasattr(evt, "keys") else evt[1]
                    st = evt["start_time"] if hasattr(evt, "keys") else evt[2]
                    desc = (evt["description"] if hasattr(evt, "keys") else evt[4]) or ""
                    lines.append(
                        f"- {t} | Date: {d}"
                        + (f" | Time: {st}" if st else "")
                        + (f" | {desc[:100]}" if desc else "")
                    )
                parts.append("Upcoming events in this group:\n" + "\n".join(lines))
    except Exception as e:
        logger.warning("Steve group calendar context failed: %s", e)

    try:
        if links_limit > 0:
            c.execute(
                f"""
                SELECT url, description FROM useful_links
                WHERE group_id = {placeholder}
                ORDER BY created_at DESC
                LIMIT {links_limit}
                """,
                (gid,),
            )
            links = c.fetchall()
            if links:
                lines = []
                for lnk in links:
                    url = lnk["url"] if hasattr(lnk, "keys") else lnk[0]
                    desc = (lnk["description"] if hasattr(lnk, "keys") else lnk[1]) or url
                    lines.append(f"- {desc} ({url})")
                parts.append("Useful links in this group:\n" + "\n".join(lines))
    except Exception as e:
        logger.warning("Steve group links context failed: %s", e)

    docs_section = _docs_section_from_memory_or_legacy(
        c,
        placeholder,
        scope_sql=f"group_id = {placeholder}",
        scope_params=(gid,),
        docs_limit=docs_limit,
        max_doc_chars_total=max_doc_chars_total,
        community_id=None,
        group_id=gid,
        query=user_message,
        original_post=original_post,
        recent_comments=recent_comments,
        section_label="Group documents",
    )
    if docs_section:
        parts.append(docs_section)

    try:
        if polls_limit > 0:
            ensure_group_poll_tables(c)
            gp_t = "`group_polls`" if USE_MYSQL else "group_polls"
            gpo_t = "`group_poll_options`" if USE_MYSQL else "group_poll_options"
            c.execute(
                f"""
                SELECT id, question, expires_at FROM {gp_t}
                WHERE group_id = {placeholder} AND is_active = 1
                ORDER BY created_at DESC
                LIMIT {polls_limit}
                """,
                (gid,),
            )
            polls = c.fetchall()
            if polls:
                poll_lines = []
                for poll in polls:
                    pid = poll["id"] if hasattr(poll, "keys") else poll[0]
                    q = poll["question"] if hasattr(poll, "keys") else poll[1]
                    exp_raw = poll["expires_at"] if hasattr(poll, "keys") else poll[2]
                    if poll_expired(exp_raw):
                        continue
                    try:
                        c.execute(
                            f"SELECT option_text, votes FROM {gpo_t} WHERE group_poll_id = {placeholder} ORDER BY id",
                            (pid,),
                        )
                        opts = c.fetchall()
                        opt_strs = [
                            f"{(o['option_text'] if hasattr(o, 'keys') else o[0])} ({(o['votes'] if hasattr(o, 'keys') else o[1])} votes)"
                            for o in opts
                        ]
                        poll_lines.append(f"- Poll: {q} | Options: {', '.join(opt_strs)}")
                    except Exception:
                        poll_lines.append(f"- Poll: {q}")
                if poll_lines:
                    parts.append("Active polls in this group:\n" + "\n".join(poll_lines))
    except Exception as e:
        logger.warning("Steve group polls context failed: %s", e)

    return "\n\n".join(parts)
