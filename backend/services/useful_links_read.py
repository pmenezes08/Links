"""Query useful links and docs with optional community / group scoping."""

from __future__ import annotations

from typing import Any

from backend.services.community import is_app_admin
from backend.services.group_feed_access import check_group_feed_access


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

    if community_id:
        if group_id is not None:
            cursor.execute(
                f"""
                SELECT id, username, url, description, created_at
                FROM useful_links
                WHERE community_id = {ph} AND group_id = {ph}
                ORDER BY created_at DESC
                """,
                (community_id, group_id),
            )
        else:
            cursor.execute(
                f"""
                SELECT id, username, url, description, created_at
                FROM useful_links
                WHERE community_id = {ph} AND group_id IS NULL
                ORDER BY created_at DESC
                """,
                (community_id,),
            )
    else:
        cursor.execute(
            """
            SELECT id, username, url, description, created_at
            FROM useful_links
            WHERE community_id IS NULL
            ORDER BY created_at DESC
            """
        )

    links_raw = cursor.fetchall()
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
        if community_id:
            if group_id is not None:
                cursor.execute(
                    f"""
                    SELECT id, username, file_path, description, created_at
                    FROM useful_docs
                    WHERE community_id = {ph} AND group_id = {ph}
                    ORDER BY created_at DESC
                    """,
                    (community_id, group_id),
                )
            else:
                cursor.execute(
                    f"""
                    SELECT id, username, file_path, description, created_at
                    FROM useful_docs
                    WHERE community_id = {ph} AND group_id IS NULL
                    ORDER BY created_at DESC
                    """,
                    (community_id,),
                )
        else:
            cursor.execute(
                """
                SELECT id, username, file_path, description, created_at
                FROM useful_docs
                WHERE community_id IS NULL
                ORDER BY created_at DESC
                """
            )
        for d in cursor.fetchall() or []:
            docs.append(
                {
                    "id": d["id"] if hasattr(d, "keys") else d[0],
                    "username": d["username"] if hasattr(d, "keys") else d[1],
                    "file_path": d["file_path"] if hasattr(d, "keys") else d[2],
                    "description": d["description"] if hasattr(d, "keys") else d[3],
                    "created_at": d["created_at"] if hasattr(d, "keys") else d[4],
                }
            )
    except Exception:
        docs = []

    return {"success": True, "links": links, "docs": docs}
