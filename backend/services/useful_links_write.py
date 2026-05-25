"""Write helpers for useful links."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional, Tuple

from backend.services.community import is_app_admin
from backend.services.community_access import check_useful_resource_mutation_access
from backend.services.useful_resources_notify import notify_community_new_resource


def add_useful_link(
    conn: Any,
    cursor: Any,
    ph: str,
    *,
    username: str,
    url: str,
    description: str,
    community_id_raw: str | None,
    group_id_int: int | None,
) -> Tuple[bool, dict]:
    url = (url or "").strip()
    description = (description or "").strip()
    if not url or not description:
        return False, {"success": False, "message": "URL and description are required"}
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    ok, err = check_useful_resource_mutation_access(
        cursor,
        ph,
        username,
        community_id_raw=community_id_raw,
        group_id_int=group_id_int,
    )
    if not ok:
        return False, {"success": False, "error": err or "Forbidden"}

    community_id = (community_id_raw or "").strip() or None
    cursor.execute(
        f"""
        INSERT INTO useful_links (community_id, group_id, username, url, description, created_at)
        VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph})
        """,
        (
            community_id if community_id else None,
            group_id_int,
            username,
            url,
            description,
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        ),
    )
    if community_id and group_id_int is None:
        notify_community_new_resource(int(community_id), username, "link", description, conn)
    conn.commit()
    return True, {"success": True, "message": "Link added successfully"}


def delete_useful_link(
    conn: Any,
    cursor: Any,
    ph: str,
    *,
    username: str,
    link_id_raw: str | None,
) -> Tuple[bool, dict]:
    if not link_id_raw:
        return False, {"success": False, "message": "Link ID is required"}

    cursor.execute(f"SELECT username FROM useful_links WHERE id = {ph}", (link_id_raw,))
    link = cursor.fetchone()
    if not link:
        return False, {"success": False, "message": "Link not found"}

    owner = link["username"] if hasattr(link, "keys") else link[0]
    if owner != username and not is_app_admin(username):
        return False, {"success": False, "message": "You can only delete your own links"}

    cursor.execute(f"DELETE FROM useful_links WHERE id = {ph}", (link_id_raw,))
    conn.commit()
    return True, {"success": True, "message": "Link deleted successfully"}
