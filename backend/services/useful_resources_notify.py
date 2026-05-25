"""In-app and push notifications when community useful resources change."""

from __future__ import annotations

import logging
from typing import Any

from backend.services.notifications import send_push_to_user

logger = logging.getLogger(__name__)


def notify_community_new_resource(
    community_id: int,
    username: str,
    resource_type: str,
    description: str,
    conn: Any,
) -> None:
    """Notify community members (except uploader) about a new link or document."""
    if not community_id:
        return
    try:
        c = conn.cursor()
        c.execute("SELECT name FROM communities WHERE id = ?", (community_id,))
        comm_row = c.fetchone()
        if not comm_row:
            return
        community_name = comm_row["name"] if hasattr(comm_row, "keys") else comm_row[0]

        c.execute(
            """
            SELECT DISTINCT u.username
            FROM user_communities uc
            JOIN users u ON uc.user_id = u.id
            WHERE uc.community_id = ? AND u.username != ?
            """,
            (community_id, username),
        )
        members = c.fetchall()

        resource_label = "document" if resource_type == "doc" else "link"
        desc_preview = (description[:50] + "...") if len(description) > 50 else description
        message = f'{username} added a new {resource_label} to "{community_name}": {desc_preview}'
        notification_link = f"/community/{community_id}/useful_links_react"

        for member in members:
            member_username = member["username"] if hasattr(member, "keys") else member[0]
            try:
                c.execute(
                    """
                    INSERT INTO notifications (user_id, from_user, type, community_id, message, link)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        member_username,
                        username,
                        "new_resource",
                        community_id,
                        message,
                        notification_link,
                    ),
                )
            except Exception as notify_err:
                logger.warning("Failed to create in-app notification for %s: %s", member_username, notify_err)

            try:
                send_push_to_user(
                    member_username,
                    {
                        "title": f"New {resource_label} in {community_name}",
                        "body": f"{username}: {desc_preview}",
                        "url": notification_link,
                        "tag": f"new-resource-{community_id}-{resource_type}",
                    },
                )
            except Exception as push_err:
                logger.warning("Failed to send push notification to %s: %s", member_username, push_err)

        logger.info(
            "Sent new %s notifications to %s members in %s",
            resource_type,
            len(members),
            community_name,
        )
    except Exception as e:
        logger.error("Error sending new resource notifications: %s", e)
