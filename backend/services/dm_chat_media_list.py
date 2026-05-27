"""DM conversation media listing. Extracted from bodybuilding_app monolith."""

from __future__ import annotations

import json
import logging
from typing import Tuple

from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)


def list_dm_chat_media(username: str, *, peer: str) -> Tuple[dict, int]:
    """Get all media (images/videos) from a DM conversation."""
    if not peer:
        return {"success": False, "error": "peer required"}, 400
    try:
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""
                SELECT id, sender, image_path, video_path, media_paths, timestamp
                FROM messages
                WHERE ((sender = {ph} AND receiver = {ph}) OR (sender = {ph} AND receiver = {ph}))
                  AND (image_path IS NOT NULL AND image_path != ''
                       OR video_path IS NOT NULL AND video_path != ''
                       OR media_paths IS NOT NULL AND media_paths != '')
                ORDER BY timestamp DESC
                """,
                (username, peer, peer, username),
            )
            media = []
            mid = 0
            for row in c.fetchall():
                msg_id = row["id"] if hasattr(row, "keys") else row[0]
                sender = row["sender"] if hasattr(row, "keys") else row[1]
                img = row["image_path"] if hasattr(row, "keys") else row[2]
                vid = row["video_path"] if hasattr(row, "keys") else row[3]
                media_paths_raw = row["media_paths"] if hasattr(row, "keys") else row[4]
                ts = row["timestamp"] if hasattr(row, "keys") else row[5]
                seen_urls = set()
                if media_paths_raw:
                    try:
                        paths = json.loads(media_paths_raw)
                        for path in paths:
                            mid += 1
                            is_video = any(
                                path.lower().endswith(ext) for ext in [".mp4", ".mov", ".webm", ".m4v"]
                            )
                            media.append(
                                {
                                    "id": mid,
                                    "message_id": msg_id,
                                    "sender": sender,
                                    "url": path,
                                    "type": "video" if is_video else "image",
                                    "created_at": ts,
                                }
                            )
                            seen_urls.add(path)
                    except Exception:
                        pass
                if img and img not in seen_urls:
                    mid += 1
                    media.append(
                        {
                            "id": mid,
                            "message_id": msg_id,
                            "sender": sender,
                            "url": img,
                            "type": "image",
                            "created_at": ts,
                        }
                    )
                if vid and vid not in seen_urls:
                    mid += 1
                    media.append(
                        {
                            "id": mid,
                            "message_id": msg_id,
                            "sender": sender,
                            "url": vid,
                            "type": "video",
                            "created_at": ts,
                        }
                    )
            return {"success": True, "media": media}, 200
    except Exception as e:
        logger.error("list_dm_chat_media error: %s", e)
        return {"success": False, "error": "Failed to load media"}, 500
