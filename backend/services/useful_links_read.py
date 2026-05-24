"""Query useful links and docs with optional community / group scoping.

Read path is intentionally defensive about optional columns:
 - ``useful_docs.details`` may be missing on older deployments. We retry
   without that column rather than dropping the whole docs list.
 - ``useful_docs.group_id`` / ``useful_links.group_id`` may be missing on
   freshly recovered MySQL instances before the startup migration runs.
   We log a warning and degrade to ``community-scope`` rather than
   silently returning no rows.

We never swallow exceptions silently — clients need to know when a row
set genuinely failed so the UI can surface it instead of pretending the
community has no documents.
"""

from __future__ import annotations

import logging
from typing import Any, Iterable, Tuple

from backend.services.community import is_app_admin
from backend.services.group_feed_access import check_group_feed_access

logger = logging.getLogger(__name__)


def _is_missing_group_column_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return "group_id" in text and (
        "unknown column" in text
        or "no such column" in text
        or "has no column" in text
        or "does not exist" in text
        or "doesn't exist" in text
    )


def _query_links(
    cursor,
    ph: str,
    community_id: str | None,
    group_id: int | None,
) -> list[tuple[Any, Any, Any, Any, Any]] | Iterable[Any]:
    if community_id and group_id is not None:
        try:
            cursor.execute(
                f"""
                SELECT id, username, url, description, created_at
                FROM useful_links
                WHERE community_id = {ph} AND group_id = {ph}
                ORDER BY created_at DESC
                """,
                (community_id, group_id),
            )
            return cursor.fetchall() or []
        except Exception as exc:
            if _is_missing_group_column_error(exc):
                logger.warning(
                    "useful_links.group_id missing; returning empty group-scoped links for community=%s group=%s",
                    community_id,
                    group_id,
                )
                return []
            raise
    if community_id:
        try:
            cursor.execute(
                f"""
                SELECT id, username, url, description, created_at
                FROM useful_links
                WHERE community_id = {ph} AND group_id IS NULL
                ORDER BY created_at DESC
                """,
                (community_id,),
            )
            return cursor.fetchall() or []
        except Exception as exc:
            if _is_missing_group_column_error(exc):
                logger.warning(
                    "useful_links.group_id missing; falling back to community-only filter for community=%s",
                    community_id,
                )
                cursor.execute(
                    f"""
                    SELECT id, username, url, description, created_at
                    FROM useful_links
                    WHERE community_id = {ph}
                    ORDER BY created_at DESC
                    """,
                    (community_id,),
                )
                return cursor.fetchall() or []
            raise
    cursor.execute(
        """
        SELECT id, username, url, description, created_at
        FROM useful_links
        WHERE community_id IS NULL
        ORDER BY created_at DESC
        """
    )
    return cursor.fetchall() or []


def _build_doc_where(
    ph: str, community_id: str | None, group_id: int | None
) -> Tuple[str, tuple]:
    if community_id and group_id is not None:
        return f"WHERE community_id = {ph} AND group_id = {ph}", (community_id, group_id)
    if community_id:
        return f"WHERE community_id = {ph} AND group_id IS NULL", (community_id,)
    return "WHERE community_id IS NULL", ()


def _query_docs(
    cursor,
    ph: str,
    community_id: str | None,
    group_id: int | None,
) -> Tuple[list[Any], bool]:
    """Returns ``(rows, has_doc_details)``.

    Tries the full column set first, retries without ``details`` if
    that column is missing on the deployed schema, then falls back to a
    community-only filter if ``group_id`` is missing.
    """
    has_doc_details = True
    where_clause, params = _build_doc_where(ph, community_id, group_id)

    select_full = f"""
        SELECT id, username, file_path, description, details, created_at
        FROM useful_docs
        {where_clause}
        ORDER BY created_at DESC
    """
    select_no_details = f"""
        SELECT id, username, file_path, description, created_at
        FROM useful_docs
        {where_clause}
        ORDER BY created_at DESC
    """

    def _execute_with_fallback(query_full: str, query_basic: str, q_params: tuple) -> list[Any]:
        nonlocal has_doc_details
        try:
            cursor.execute(query_full, q_params)
            return cursor.fetchall() or []
        except Exception as exc:
            text = str(exc).lower()
            if "details" in text and (
                "unknown column" in text
                or "no such column" in text
                or "has no column" in text
                or "does not exist" in text
                or "doesn't exist" in text
            ):
                has_doc_details = False
                logger.warning(
                    "useful_docs.details missing; retrying without details column"
                )
                cursor.execute(query_basic, q_params)
                return cursor.fetchall() or []
            raise

    try:
        rows = _execute_with_fallback(select_full, select_no_details, params)
    except Exception as exc:
        if _is_missing_group_column_error(exc) and community_id:
            logger.warning(
                "useful_docs.group_id missing; falling back to community-only filter for community=%s",
                community_id,
            )
            community_only_where = f"WHERE community_id = {ph}"
            fallback_full = f"""
                SELECT id, username, file_path, description, details, created_at
                FROM useful_docs
                {community_only_where}
                ORDER BY created_at DESC
            """
            fallback_basic = f"""
                SELECT id, username, file_path, description, created_at
                FROM useful_docs
                {community_only_where}
                ORDER BY created_at DESC
            """
            rows = _execute_with_fallback(fallback_full, fallback_basic, (community_id,))
        else:
            raise

    return rows, has_doc_details


def fetch_useful_links_payload(
    cursor,
    username: str,
    community_id_raw: str | None,
    group_id_raw: str | None,
    ph: str,
) -> dict[str, Any]:
    """Return ``{success, links, docs}`` or ``{success, error}``."""
    community_id = (community_id_raw or "").strip() or None
    group_id: int | None = None
    if group_id_raw and str(group_id_raw).strip():
        try:
            group_id = int(group_id_raw)
        except (TypeError, ValueError):
            return {"success": False, "error": "Invalid group_id"}
        ok, err = check_group_feed_access(cursor, ph, username, group_id)
        if not ok:
            return {"success": False, "error": err or "Forbidden"}

    try:
        links_raw = _query_links(cursor, ph, community_id, group_id)
    except Exception as exc:
        logger.warning(
            "useful_links read failed for user=%s community=%s group=%s: %s",
            username,
            community_id,
            group_id,
            exc,
        )
        return {
            "success": False,
            "error": "Failed to load links",
            "links": [],
            "docs": [],
        }

    links: list[dict[str, Any]] = []
    for link in links_raw or []:
        links.append(
            {
                "id": link["id"] if hasattr(link, "keys") else link[0],
                "username": link["username"] if hasattr(link, "keys") else link[1],
                "url": link["url"] if hasattr(link, "keys") else link[2],
                "description": link["description"] if hasattr(link, "keys") else link[3],
                "created_at": link["created_at"] if hasattr(link, "keys") else link[4],
                "can_delete": (link["username"] if hasattr(link, "keys") else link[1]) == username
                or is_app_admin(username),
            }
        )

    docs: list[dict[str, Any]] = []
    try:
        doc_rows, has_doc_details = _query_docs(cursor, ph, community_id, group_id)
    except Exception as exc:
        logger.warning(
            "useful_docs read failed for user=%s community=%s group=%s: %s",
            username,
            community_id,
            group_id,
            exc,
        )
        return {
            "success": True,
            "links": links,
            "docs": [],
            "docs_error": "Failed to load documents",
        }

    for d in doc_rows or []:
        docs.append(
            {
                "id": d["id"] if hasattr(d, "keys") else d[0],
                "username": d["username"] if hasattr(d, "keys") else d[1],
                "file_path": d["file_path"] if hasattr(d, "keys") else d[2],
                "description": d["description"] if hasattr(d, "keys") else d[3],
                "details": (d["details"] if hasattr(d, "keys") else d[4]) if has_doc_details else "",
                "created_at": (d["created_at"] if hasattr(d, "keys") else d[5])
                if has_doc_details
                else (d["created_at"] if hasattr(d, "keys") else d[4]),
            }
        )

    return {"success": True, "links": links, "docs": docs}
