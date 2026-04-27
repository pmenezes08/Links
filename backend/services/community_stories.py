"""Community story data and workflow services."""

from __future__ import annotations

import json
import logging
import os
import tempfile
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from redis_cache import invalidate_community_cache

from backend.services.community import get_parent_chain_ids, is_community_owner
from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services import media_assets
from backend.services.media import (
    get_public_upload_url,
    normalize_upload_reference,
    save_uploaded_file,
)
from backend.services.notifications import (
    create_notification,
    send_push_to_user,
    truncate_notification_preview,
)


logger = logging.getLogger(__name__)

STORY_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "gif", "webp"}
STORY_VIDEO_EXTENSIONS = {"mp4", "mov", "m4v", "webm", "avi"}
STORY_ALLOWED_EXTENSIONS = STORY_IMAGE_EXTENSIONS | STORY_VIDEO_EXTENSIONS
STORY_DEFAULT_LIFESPAN_HOURS = 24
STORY_MAX_CAPTION_LENGTH = 2000
STORY_MAX_DESCRIPTION_LENGTH = 2000
STORY_MAX_COMMENT_LENGTH = 2000
STORY_VIDEO_MAX_SECONDS = 15
STORY_ALLOWED_REACTIONS: Set[str] = {"❤️", "🔥", "👏", "😂", "😮", "👍"}


def _row_value(row: Any, key: str, index: int, default: Any = None) -> Any:
    if row is None:
        return default
    if hasattr(row, "keys") and key in row.keys():
        return row[key]
    if isinstance(row, dict):
        return row.get(key, default)
    if isinstance(row, (list, tuple)) and len(row) > index:
        return row[index]
    return default


def _public_url(raw_path: Any) -> Optional[str]:
    if not raw_path:
        return None
    text = str(raw_path)
    if text.startswith(("http://", "https://")):
        return text
    norm = normalize_upload_reference(text)
    return get_public_upload_url(norm) if norm else None


def _coerce_timestamp(value: Any) -> Optional[str]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def ensure_story_tables(c) -> bool:
    """Ensure community story tables exist."""
    try:
        if USE_MYSQL:
            c.execute("SHOW TABLES LIKE 'community_stories'")
            stories_exist = c.fetchone()
            if not stories_exist:
                c.execute(
                    """
                    CREATE TABLE IF NOT EXISTS community_stories (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        community_id INT NOT NULL,
                        username VARCHAR(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
                        media_path VARCHAR(512) NOT NULL,
                        media_type VARCHAR(16) NOT NULL,
                        caption TEXT,
                        duration_seconds INT,
                        status VARCHAR(32) NOT NULL DEFAULT 'active',
                        created_at DATETIME NOT NULL,
                        expires_at DATETIME NOT NULL,
                        view_count INT NOT NULL DEFAULT 0,
                        last_viewed_at DATETIME,
                        text_overlays JSON,
                        location_data JSON,
                        story_group_id VARCHAR(64),
                        description TEXT,
                        INDEX idx_cs_comm_expires (community_id, expires_at),
                        INDEX idx_cs_user_created (username, created_at),
                        INDEX idx_cs_group (story_group_id),
                        CONSTRAINT fk_cs_community FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
                        CONSTRAINT fk_cs_user FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
                    """
                )
            else:
                for col, col_def in [
                    ("story_group_id", "VARCHAR(64)"),
                    ("description", "TEXT"),
                ]:
                    try:
                        c.execute(f"ALTER TABLE community_stories ADD COLUMN {col} {col_def}")
                    except Exception:
                        pass
                try:
                    c.execute("CREATE INDEX idx_cs_group ON community_stories (story_group_id)")
                except Exception:
                    pass

            c.execute("SHOW TABLES LIKE 'community_story_views'")
            if not c.fetchone():
                c.execute(
                    """
                    CREATE TABLE IF NOT EXISTS community_story_views (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        story_id INT NOT NULL,
                        username VARCHAR(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
                        viewed_at DATETIME NOT NULL,
                        UNIQUE KEY uniq_story_viewer (story_id, username),
                        INDEX idx_csv_story (story_id),
                        INDEX idx_csv_user (username),
                        CONSTRAINT fk_csv_story FOREIGN KEY (story_id) REFERENCES community_stories(id) ON DELETE CASCADE,
                        CONSTRAINT fk_csv_user FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
                    """
                )
            c.execute("SHOW TABLES LIKE 'community_story_reactions'")
            if not c.fetchone():
                c.execute(
                    """
                    CREATE TABLE IF NOT EXISTS community_story_reactions (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        story_id INT NOT NULL,
                        username VARCHAR(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
                        reaction VARCHAR(16) NOT NULL,
                        created_at DATETIME NOT NULL,
                        UNIQUE KEY uniq_story_reaction (story_id, username),
                        INDEX idx_csr_story (story_id),
                        INDEX idx_csr_reaction (reaction),
                        CONSTRAINT fk_csr_story FOREIGN KEY (story_id) REFERENCES community_stories(id) ON DELETE CASCADE,
                        CONSTRAINT fk_csr_user FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
                    """
                )
            c.execute("SHOW TABLES LIKE 'community_story_comments'")
            if not c.fetchone():
                c.execute(
                    """
                    CREATE TABLE IF NOT EXISTS community_story_comments (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        story_id INT NOT NULL,
                        username VARCHAR(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
                        content TEXT NOT NULL,
                        created_at DATETIME NOT NULL,
                        INDEX idx_csc_story (story_id),
                        INDEX idx_csc_user (username),
                        CONSTRAINT fk_csc_story FOREIGN KEY (story_id) REFERENCES community_stories(id) ON DELETE CASCADE,
                        CONSTRAINT fk_csc_user FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
                    """
                )
        else:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS community_stories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    community_id INTEGER NOT NULL,
                    username TEXT NOT NULL,
                    media_path TEXT NOT NULL,
                    media_type TEXT NOT NULL,
                    caption TEXT,
                    duration_seconds INTEGER,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    view_count INTEGER NOT NULL DEFAULT 0,
                    last_viewed_at TEXT,
                    text_overlays TEXT,
                    location_data TEXT,
                    story_group_id TEXT,
                    description TEXT
                )
                """
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS community_story_views (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    story_id INTEGER NOT NULL,
                    username TEXT NOT NULL,
                    viewed_at TEXT NOT NULL
                )
                """
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_cs_comm_expires ON community_stories (community_id, expires_at)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_cs_user_created ON community_stories (username, created_at)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_cs_group ON community_stories (story_group_id)")
            c.execute("CREATE UNIQUE INDEX IF NOT EXISTS uniq_story_viewer ON community_story_views (story_id, username)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_csv_user ON community_story_views (username)")
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS community_story_reactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    story_id INTEGER NOT NULL,
                    username TEXT NOT NULL,
                    reaction TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            c.execute("CREATE UNIQUE INDEX IF NOT EXISTS uniq_story_reaction ON community_story_reactions (story_id, username)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_csr_story ON community_story_reactions (story_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_csr_reaction ON community_story_reactions (reaction)")
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS community_story_comments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    story_id INTEGER NOT NULL,
                    username TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_csc_story ON community_story_comments (story_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_csc_user ON community_story_comments (username)")
        return True
    except Exception as exc:
        logger.error("Could not ensure community story tables: %s", exc)
        return False


def normalize_story_reaction(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    token = str(value).strip()
    return token if token in STORY_ALLOWED_REACTIONS else None


def fetch_story_reaction_maps(
    c,
    story_ids: Sequence[int],
    username: Optional[str] = None,
) -> Tuple[Dict[int, Dict[str, int]], Dict[int, Optional[str]]]:
    if not story_ids:
        return {}, {}
    ensure_story_tables(c)
    ph = get_sql_placeholder()
    placeholders = ",".join([ph] * len(story_ids))
    reaction_counts: Dict[int, Dict[str, int]] = {}
    user_reactions: Dict[int, Optional[str]] = {}
    try:
        c.execute(
            f"""
            SELECT story_id, reaction, COUNT(*) as cnt
            FROM community_story_reactions
            WHERE story_id IN ({placeholders})
            GROUP BY story_id, reaction
            """,
            tuple(story_ids),
        )
        for row in c.fetchall() or []:
            story_id = _row_value(row, "story_id", 0)
            reaction = _row_value(row, "reaction", 1)
            count = _row_value(row, "cnt", 2, 0)
            if story_id is not None and reaction is not None:
                reaction_counts.setdefault(int(story_id), {})[reaction] = int(count or 0)
    except Exception as exc:
        logger.warning("Failed to aggregate story reactions: %s", exc)

    if username:
        try:
            params = list(story_ids) + [username]
            c.execute(
                f"""
                SELECT story_id, reaction
                FROM community_story_reactions
                WHERE story_id IN ({placeholders}) AND LOWER(username) = LOWER({ph})
                """,
                tuple(params),
            )
            for row in c.fetchall() or []:
                story_id = _row_value(row, "story_id", 0)
                reaction = _row_value(row, "reaction", 1)
                if story_id is not None:
                    user_reactions[int(story_id)] = reaction
        except Exception as exc:
            logger.warning("Failed to fetch user story reactions: %s", exc)
    return reaction_counts, user_reactions


def user_has_story_access(c, username: Optional[str], community_id: int, creator_username: Optional[str] = None) -> bool:
    if not username or not community_id:
        return False
    norm_username = str(username).strip().lower()
    if norm_username == "admin":
        return True
    creator_norm = str(creator_username).strip().lower() if creator_username else None
    if creator_norm and norm_username == creator_norm:
        return True

    ph = get_sql_placeholder()
    try:
        c.execute(
            f"""
            SELECT 1
            FROM user_communities uc
            JOIN users u ON uc.user_id = u.id
            WHERE LOWER(u.username) = LOWER({ph}) AND uc.community_id = {ph}
            LIMIT 1
            """,
            (username, community_id),
        )
        if c.fetchone():
            return True
    except Exception as exc:
        logger.warning("story access membership check failed for community %s: %s", community_id, exc)

    try:
        parent_ids = get_parent_chain_ids(c, community_id)
    except Exception as exc:
        logger.warning("story access parent chain failed for community %s: %s", community_id, exc)
        parent_ids = []

    for parent_id in parent_ids:
        try:
            c.execute(
                f"""
                SELECT uc.role, c.creator_username
                FROM user_communities uc
                JOIN users u ON uc.user_id = u.id
                JOIN communities c ON c.id = uc.community_id
                WHERE LOWER(u.username) = LOWER({ph}) AND uc.community_id = {ph}
                LIMIT 1
                """,
                (username, parent_id),
            )
            row = c.fetchone()
        except Exception as exc:
            logger.warning("story access ancestor check failed for %s: %s", parent_id, exc)
            row = None
        if not row:
            continue
        role_norm = str(_row_value(row, "role", 0, "") or "").strip().lower()
        if role_norm in {"admin", "owner", "manager", "moderator"}:
            return True
        if is_community_owner(username, parent_id):
            return True
    return False


def record_story_view(c, story_id: int, username: str) -> Optional[int]:
    ensure_story_tables(c)
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    try:
        if USE_MYSQL:
            c.execute(
                """
                INSERT INTO community_story_views (story_id, username, viewed_at)
                VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE viewed_at = VALUES(viewed_at)
                """,
                (story_id, username, now_str),
            )
        else:
            c.execute(
                "INSERT OR REPLACE INTO community_story_views (story_id, username, viewed_at) VALUES (?,?,?)",
                (story_id, username, now_str),
            )
    except Exception as exc:
        logger.warning("Failed recording story view for %s: %s", story_id, exc)
    try:
        ph = get_sql_placeholder()
        c.execute(f"SELECT COUNT(*) as cnt FROM community_story_views WHERE story_id = {ph}", (story_id,))
        row = c.fetchone()
        count = _row_value(row, "cnt", 0, 0)
        c.execute(
            f"UPDATE community_stories SET view_count = {ph}, last_viewed_at = {ph} WHERE id = {ph}",
            (int(count or 0), now_str, story_id),
        )
        return int(count or 0)
    except Exception as exc:
        logger.warning("Failed updating story view count for %s: %s", story_id, exc)
        return None


def list_community_stories(username: str, community_id: int) -> Tuple[Dict[str, Any], int]:
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_story_tables(c)
            ph = get_sql_placeholder()
            c.execute(
                f"SELECT id, name, creator_username, parent_community_id FROM communities WHERE id = {ph}",
                (community_id,),
            )
            community_row = c.fetchone()
            if not community_row:
                return {"success": False, "error": "Community not found"}, 404
            community_name = _row_value(community_row, "name", 1)
            creator_username = _row_value(community_row, "creator_username", 2)
            if not user_has_story_access(c, username, community_id, creator_username):
                return {"success": False, "error": "Forbidden"}, 403

            now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
            c.execute(
                f"""
                SELECT cs.id, cs.community_id, cs.username, cs.media_path, cs.media_type,
                       cs.caption, cs.duration_seconds, cs.status, cs.created_at,
                       cs.expires_at, cs.view_count, cs.last_viewed_at, up.profile_picture,
                       cs.text_overlays, cs.story_group_id, cs.description
                FROM community_stories cs
                LEFT JOIN user_profiles up ON up.username = cs.username
                WHERE cs.community_id = {ph}
                  AND cs.status = 'active'
                  AND cs.expires_at > {ph}
                ORDER BY cs.created_at DESC
                LIMIT 200
                """,
                (community_id, now_str),
            )
            rows = c.fetchall() or []
            story_ids = [int(_row_value(row, "id", 0)) for row in rows if _row_value(row, "id", 0)]

            viewed_ids: Set[int] = set()
            if story_ids:
                placeholders = ",".join([ph] * len(story_ids))
                c.execute(
                    f"""
                    SELECT story_id FROM community_story_views
                    WHERE story_id IN ({placeholders}) AND LOWER(username) = LOWER({ph})
                    """,
                    tuple(list(story_ids) + [username]),
                )
                for row in c.fetchall() or []:
                    story_id = _row_value(row, "story_id", 0)
                    if story_id is not None:
                        viewed_ids.add(int(story_id))

            reaction_counts, user_reactions = fetch_story_reaction_maps(c, story_ids, username)
            groups_map: Dict[str, Dict[str, Any]] = {}
            stories_payload: List[Dict[str, Any]] = []
            for row in rows:
                story_id_raw = _row_value(row, "id", 0)
                author = _row_value(row, "username", 2)
                if not story_id_raw or not author:
                    continue
                story_id = int(story_id_raw)
                media_path = _row_value(row, "media_path", 3)
                text_overlays_raw = _row_value(row, "text_overlays", 13)
                text_overlays = None
                if text_overlays_raw:
                    try:
                        text_overlays = json.loads(text_overlays_raw) if isinstance(text_overlays_raw, str) else text_overlays_raw
                    except Exception:
                        pass

                has_viewed = story_id in viewed_ids
                story_payload = {
                    "id": story_id,
                    "community_id": community_id,
                    "username": author,
                    "media_type": _row_value(row, "media_type", 4) or "image",
                    "media_path": media_path,
                    "media_url": _public_url(media_path),
                    "caption": _row_value(row, "caption", 5),
                    "duration_seconds": _row_value(row, "duration_seconds", 6),
                    "created_at": _coerce_timestamp(_row_value(row, "created_at", 8)),
                    "expires_at": _coerce_timestamp(_row_value(row, "expires_at", 9)),
                    "view_count": int(_row_value(row, "view_count", 10, 0) or 0),
                    "has_viewed": has_viewed,
                    "profile_picture": _public_url(_row_value(row, "profile_picture", 12)),
                    "reactions": reaction_counts.get(story_id, {}),
                    "user_reaction": user_reactions.get(story_id),
                    "text_overlays": text_overlays,
                    "story_group_id": _row_value(row, "story_group_id", 14),
                    "description": _row_value(row, "description", 15),
                }
                stories_payload.append(story_payload)
                group = groups_map.setdefault(
                    author,
                    {
                        "username": author,
                        "profile_picture": story_payload["profile_picture"],
                        "stories": [],
                        "has_unseen": False,
                    },
                )
                group["stories"].append(story_payload)
                if not has_viewed:
                    group["has_unseen"] = True

            groups = list(groups_map.values())
            groups.sort(key=lambda g: g["stories"][0]["created_at"] if g["stories"] else "", reverse=True)
            return {
                "success": True,
                "community": {"id": community_id, "name": community_name},
                "has_new": any(not story["has_viewed"] for story in stories_payload),
                "groups": groups,
                "stories": stories_payload,
            }, 200
    except Exception as exc:
        logger.error("Error loading community stories for %s: %s", community_id, exc)
        return {"success": False, "error": "Server error"}, 500


def _parse_json_field(raw: str, expected_type: type) -> Any:
    if not raw:
        return None if expected_type is dict else []
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, expected_type) else (None if expected_type is dict else [])
    except Exception:
        return None if expected_type is dict else []


def _probe_video_duration_seconds(path: str) -> Optional[float]:
    try:
        from backend.services.media_processing import probe_duration_seconds

        return probe_duration_seconds(path)
    except Exception:
        return None


def _probe_uploaded_video_duration_seconds(file_storage: Any) -> Optional[float]:
    """Probe an uploaded video before R2 upload so duration checks are reliable."""
    suffix = os.path.splitext(getattr(file_storage, "filename", "") or "")[1] or ".mp4"
    stream = getattr(file_storage, "stream", None)
    original_pos = None
    try:
        if stream is not None and hasattr(stream, "tell"):
            original_pos = stream.tell()
    except Exception:
        original_pos = None

    temp_path = None
    try:
        fd, temp_path = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        file_storage.save(temp_path)
        return _probe_video_duration_seconds(temp_path)
    except Exception:
        return None
    finally:
        if stream is not None and hasattr(stream, "seek"):
            try:
                stream.seek(original_pos or 0)
            except Exception:
                pass


def _uploaded_file_size_bytes(file_storage: Any) -> int:
    size = getattr(file_storage, "content_length", None)
    if isinstance(size, int) and size > 0:
        return size
    stream = getattr(file_storage, "stream", None)
    if stream is None or not hasattr(stream, "tell") or not hasattr(stream, "seek"):
        return 0
    try:
        pos = stream.tell()
        stream.seek(0, os.SEEK_END)
        end = stream.tell()
        stream.seek(pos)
        return int(end)
    except Exception:
        try:
            stream.seek(0)
        except Exception:
            pass
        return 0
        if temp_path:
            try:
                os.remove(temp_path)
            except Exception:
                pass


def create_community_story(username: str, form: Any, files: Any) -> Tuple[Dict[str, Any], int]:
    community_id = form.get("community_id", type=int)
    if not community_id:
        return {"success": False, "error": "community_id required"}, 400
    media_files = files.getlist("media") or files.getlist("media[]")
    single_media = files.get("media")
    if single_media and single_media.filename and not media_files:
        media_files = [single_media]
    media_files = [item for item in media_files if item and item.filename]
    if not media_files:
        return {"success": False, "error": "Media file(s) required"}, 400

    caption = (form.get("caption") or "").strip()[:STORY_MAX_CAPTION_LENGTH]
    text_overlays = _parse_json_field(form.get("text_overlays", ""), list)
    per_file_meta = _parse_json_field(form.get("per_file_metadata", ""), list) or []
    duration_seconds = form.get("duration_seconds", type=int)
    if isinstance(duration_seconds, int) and duration_seconds < 0:
        duration_seconds = None
    description = (form.get("description") or "").strip()[:STORY_MAX_DESCRIPTION_LENGTH]
    story_group_id = str(uuid.uuid4())
    created_stories: List[Dict[str, Any]] = []
    upload_errors: List[str] = []
    base_created_at = datetime.utcnow()

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_story_tables(c)
            ph = get_sql_placeholder()
            c.execute(f"SELECT creator_username FROM communities WHERE id = {ph}", (community_id,))
            row = c.fetchone()
            if not row:
                return {"success": False, "error": "Community not found"}, 404
            creator_username = _row_value(row, "creator_username", 0)
            if not user_has_story_access(c, username, community_id, creator_username):
                return {"success": False, "error": "Forbidden"}, 403

            for idx, media_file in enumerate(media_files):
                try:
                    ext = os.path.splitext(media_file.filename)[1].lower().lstrip(".")
                    if ext not in STORY_ALLOWED_EXTENSIONS:
                        upload_errors.append(f"File {idx+1} ({media_file.filename}): unsupported format '{ext}'")
                        continue
                    media_type = "image" if ext in STORY_IMAGE_EXTENSIONS else "video"
                    original_bytes = _uploaded_file_size_bytes(media_file)

                    file_caption = caption
                    file_text_overlays = text_overlays
                    file_duration = duration_seconds
                    if idx < len(per_file_meta) and isinstance(per_file_meta[idx], dict):
                        meta = per_file_meta[idx]
                        if "caption" in meta:
                            file_caption = str(meta["caption"])[:STORY_MAX_CAPTION_LENGTH]
                        if "text_overlays" in meta and isinstance(meta["text_overlays"], list):
                            file_text_overlays = meta["text_overlays"]
                        if "duration_seconds" in meta:
                            try:
                                file_duration = int(float(meta["duration_seconds"]))
                            except Exception:
                                pass
                    if media_type == "video":
                        probed_duration = _probe_uploaded_video_duration_seconds(media_file)
                        if probed_duration is not None:
                            file_duration = int(round(probed_duration))
                    if media_type == "video" and file_duration and file_duration > STORY_VIDEO_MAX_SECONDS:
                        upload_errors.append(
                            f"File {idx+1} ({media_file.filename}): videos can be up to {STORY_VIDEO_MAX_SECONDS} seconds. Please trim it or upload separate 15-second clips."
                        )
                        continue

                    stored_file = save_uploaded_file(
                        media_file,
                        subfolder="community_stories",
                        allowed_extensions=STORY_ALLOWED_EXTENSIONS,
                        optimize_profile="story",
                        transcode_video=media_type == "video",
                        return_file_info=True,
                    )
                    stored_path = stored_file.get("path") if isinstance(stored_file, dict) else stored_file
                    if not stored_path:
                        upload_errors.append(f"File {idx+1} ({media_file.filename}): failed to save")
                        continue
                    stored_bytes = (
                        int(stored_file.get("stored_bytes") or 0)
                        if isinstance(stored_file, dict)
                        else original_bytes
                    )

                    if media_type == "video":
                        if file_duration and file_duration > STORY_VIDEO_MAX_SECONDS:
                            upload_errors.append(
                                f"File {idx+1} ({media_file.filename}): videos can be up to {STORY_VIDEO_MAX_SECONDS} seconds. Please trim it or upload separate 15-second clips."
                            )
                            continue
                    created_at = base_created_at + timedelta(milliseconds=idx * 100)
                    expires_at = created_at + timedelta(hours=STORY_DEFAULT_LIFESPAN_HOURS)
                    c.execute(
                        f"""
                        INSERT INTO community_stories
                        (community_id, username, media_path, media_type, caption, duration_seconds, status, created_at, expires_at, text_overlays, story_group_id, description)
                        VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                        """,
                        (
                            community_id,
                            username,
                            stored_path,
                            media_type,
                            file_caption if file_caption else None,
                            file_duration,
                            "active",
                            created_at.strftime("%Y-%m-%d %H:%M:%S"),
                            expires_at.strftime("%Y-%m-%d %H:%M:%S"),
                            json.dumps(file_text_overlays) if file_text_overlays else None,
                            story_group_id,
                            description if description else None,
                        ),
                    )
                    story_id = getattr(c, "lastrowid", None)
                    media_assets.register_asset(
                        c,
                        community_id=community_id,
                        source_type="story",
                        source_id=story_id,
                        media_type=media_type,
                        path=stored_path,
                        original_bytes=original_bytes,
                        stored_bytes=stored_bytes,
                        duration_seconds=file_duration,
                        created_at=created_at,
                        expires_at=expires_at,
                        retain_until=expires_at + timedelta(days=7),
                    )
                    created_stories.append(
                        {
                            "id": story_id,
                            "community_id": community_id,
                            "username": username,
                            "media_type": media_type,
                            "media_path": stored_path,
                            "media_url": _public_url(stored_path),
                            "caption": file_caption,
                            "text_overlays": file_text_overlays,
                            "duration_seconds": file_duration,
                            "story_group_id": story_group_id,
                            "description": description if description else None,
                            "created_at": created_at.isoformat(),
                            "expires_at": expires_at.isoformat(),
                            "view_count": 0,
                            "has_viewed": True,
                        }
                    )
                except Exception as exc:
                    logger.error("Error processing story file %s (%s): %s", idx + 1, media_file.filename, exc)
                    upload_errors.append(f"File {idx+1} ({media_file.filename}): {str(exc)[:100]}")
            conn.commit()

        if not created_stories:
            error_detail = "; ".join(upload_errors) if upload_errors else "No valid media files were uploaded"
            return {"success": False, "error": error_detail}, 400
        invalidate_community_cache(community_id)
        _notify_story_created(username, community_id, created_stories)
        response = {
            "success": True,
            "story": created_stories[0] if created_stories else None,
            "stories": created_stories,
            "count": len(created_stories),
            "story_group_id": story_group_id,
        }
        if upload_errors:
            response["warnings"] = upload_errors
        return response, 200
    except Exception as exc:
        logger.error("Error creating community story for community %s: %s", community_id, exc)
        return {"success": False, "error": "Server error"}, 500


def _notify_story_created(username: str, community_id: int, created_stories: List[Dict[str, Any]]) -> None:
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(
                f"""
                SELECT DISTINCT u.username
                FROM users u
                JOIN user_communities uc ON u.id = uc.user_id
                WHERE uc.community_id = {ph} AND LOWER(u.username) != LOWER({ph})
                """,
                (community_id, username),
            )
            members = [_row_value(row, "username", 0) for row in c.fetchall() or []]
            community_name = None
            try:
                c.execute(f"SELECT name FROM communities WHERE id = {ph}", (community_id,))
                community_name = _row_value(c.fetchone(), "name", 0)
            except Exception:
                pass
            story_count = len(created_stories)
            message = (
                f"{username} shared {story_count} new {'story' if story_count == 1 else 'stories'}"
                + (f" in {community_name}" if community_name else "")
            )
            link = f"/community_feed_react/{community_id}"
            first_story_id = created_stories[0]["id"] if created_stories else None
            for member in members:
                try:
                    now_expr = "NOW()" if USE_MYSQL else "datetime('now')"
                    c.execute(
                        f"""
                        INSERT INTO notifications (user_id, from_user, type, post_id, community_id, message, created_at, is_read, link)
                        VALUES ({ph}, {ph}, 'new_story', {ph}, {ph}, {ph}, {now_expr}, 0, {ph})
                        """,
                        (member, username, first_story_id, community_id, message, link),
                    )
                    conn.commit()
                except Exception as exc:
                    logger.warning("Story notification db error for %s: %s", member, exc)
                try:
                    send_push_to_user(
                        member,
                        {
                            "title": f"New story in {community_name}" if community_name else "New story",
                            "body": message,
                            "url": link,
                            "tag": f"community-story-{community_id}-{first_story_id}",
                        },
                    )
                except Exception as exc:
                    logger.warning("Push notify story error for %s: %s", member, exc)
    except Exception as exc:
        logger.warning("Story notification block error: %s", exc)


def mark_story_view(username: str, story_id: int) -> Tuple[Dict[str, Any], int]:
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_story_tables(c)
            ph = get_sql_placeholder()
            c.execute(
                f"""
                SELECT cs.id, cs.community_id, c.creator_username
                FROM community_stories cs
                JOIN communities c ON c.id = cs.community_id
                WHERE cs.id = {ph}
                """,
                (story_id,),
            )
            row = c.fetchone()
            if not row:
                return {"success": False, "error": "Story not found"}, 404
            community_id = _row_value(row, "community_id", 1)
            creator_username = _row_value(row, "creator_username", 2)
            if not user_has_story_access(c, username, community_id, creator_username):
                return {"success": False, "error": "Forbidden"}, 403
            view_count = record_story_view(c, story_id, username)
            conn.commit()
            return {"success": True, "story_id": story_id, "view_count": view_count}, 200
    except Exception as exc:
        logger.error("Error recording view for story %s: %s", story_id, exc)
        return {"success": False, "error": "Server error"}, 500


def get_story_viewers(username: str, story_id: int) -> Tuple[Dict[str, Any], int]:
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_story_tables(c)
            ph = get_sql_placeholder()
            c.execute(
                f"""
                SELECT cs.community_id, c.creator_username
                FROM community_stories cs
                JOIN communities c ON c.id = cs.community_id
                WHERE cs.id = {ph}
                """,
                (story_id,),
            )
            row = c.fetchone()
            if not row:
                return {"success": False, "error": "Story not found"}, 404
            community_id = _row_value(row, "community_id", 0)
            creator_username = _row_value(row, "creator_username", 1)
            if not user_has_story_access(c, username, community_id, creator_username):
                return {"success": False, "error": "Forbidden"}, 403
            c.execute(
                f"""
                SELECT csv.username, csv.viewed_at, up.profile_picture
                FROM community_story_views csv
                LEFT JOIN user_profiles up ON up.username = csv.username
                WHERE csv.story_id = {ph}
                ORDER BY csv.viewed_at DESC
                LIMIT 500
                """,
                (story_id,),
            )
            viewers = [
                {
                    "username": _row_value(row, "username", 0),
                    "profile_picture": _public_url(_row_value(row, "profile_picture", 2)),
                    "viewed_at": _row_value(row, "viewed_at", 1),
                }
                for row in c.fetchall() or []
            ]
            return {"success": True, "story_id": story_id, "viewers": viewers}, 200
    except Exception as exc:
        logger.error("Error fetching viewers for story %s: %s", story_id, exc)
        return {"success": False, "error": "Server error"}, 500


def get_story(story_id: int) -> Tuple[Dict[str, Any], int]:
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_story_tables(c)
            ph = get_sql_placeholder()
            c.execute(
                f"""
                SELECT id, username, community_id, media_type, media_path, caption, created_at, expires_at
                FROM community_stories
                WHERE id = {ph}
                """,
                (story_id,),
            )
            row = c.fetchone()
            if not row:
                return {"success": False, "error": "Story not found"}, 404
            media_path = _row_value(row, "media_path", 4)
            return {
                "success": True,
                "story": {
                    "id": _row_value(row, "id", 0),
                    "username": _row_value(row, "username", 1),
                    "community_id": _row_value(row, "community_id", 2),
                    "media_type": _row_value(row, "media_type", 3),
                    "media_url": _public_url(media_path),
                    "media_path": _public_url(media_path),
                    "caption": _row_value(row, "caption", 5),
                    "created_at": _row_value(row, "created_at", 6),
                    "expires_at": _row_value(row, "expires_at", 7),
                },
            }, 200
    except Exception as exc:
        logger.error("Error fetching story %s: %s", story_id, exc)
        return {"success": False, "error": "Server error"}, 500


def delete_story(username: str, story_id: int) -> Tuple[Dict[str, Any], int]:
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_story_tables(c)
            ph = get_sql_placeholder()
            c.execute(
                f"""
                SELECT cs.id, cs.username as story_owner, cs.community_id, c.creator_username
                FROM community_stories cs
                JOIN communities c ON c.id = cs.community_id
                WHERE cs.id = {ph}
                """,
                (story_id,),
            )
            row = c.fetchone()
            if not row:
                return {"success": False, "error": "Story not found"}, 404
            story_owner = _row_value(row, "story_owner", 1)
            community_creator = _row_value(row, "creator_username", 3)
            can_delete = (
                username.lower() == str(story_owner).lower()
                or username.lower() == str(community_creator or "").lower()
                or username.lower() == "admin"
            )
            if not can_delete:
                return {"success": False, "error": "You can only delete your own stories"}, 403
            c.execute(f"DELETE FROM community_story_views WHERE story_id = {ph}", (story_id,))
            c.execute(f"DELETE FROM community_story_reactions WHERE story_id = {ph}", (story_id,))
            c.execute(f"DELETE FROM community_story_comments WHERE story_id = {ph}", (story_id,))
            c.execute(f"DELETE FROM community_stories WHERE id = {ph}", (story_id,))
            conn.commit()
            return {"success": True, "message": "Story deleted"}, 200
    except Exception as exc:
        logger.error("Error deleting story %s: %s", story_id, exc)
        return {"success": False, "error": "Server error"}, 500


def delete_story_group(username: str, story_group_id: str) -> Tuple[Dict[str, Any], int]:
    if not story_group_id:
        return {"success": False, "error": "story_group_id required"}, 400
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_story_tables(c)
            ph = get_sql_placeholder()
            c.execute(
                f"""
                SELECT cs.id, cs.username, cs.community_id, c.creator_username
                FROM community_stories cs
                JOIN communities c ON c.id = cs.community_id
                WHERE cs.story_group_id = {ph}
                LIMIT 1
                """,
                (story_group_id,),
            )
            row = c.fetchone()
            if not row:
                return {"success": False, "error": "Story group not found"}, 404
            story_owner = _row_value(row, "username", 1)
            community_creator = _row_value(row, "creator_username", 3)
            can_delete = (
                username.lower() == str(story_owner).lower()
                or username.lower() == str(community_creator or "").lower()
                or username.lower() == "admin"
            )
            if not can_delete:
                return {"success": False, "error": "You can only delete your own stories"}, 403
            c.execute(f"SELECT id FROM community_stories WHERE story_group_id = {ph}", (story_group_id,))
            story_ids = [_row_value(row, "id", 0) for row in c.fetchall() or []]
            if story_ids:
                placeholders = ", ".join([ph] * len(story_ids))
                c.execute(f"DELETE FROM community_story_views WHERE story_id IN ({placeholders})", tuple(story_ids))
                c.execute(f"DELETE FROM community_story_reactions WHERE story_id IN ({placeholders})", tuple(story_ids))
                c.execute(f"DELETE FROM community_story_comments WHERE story_id IN ({placeholders})", tuple(story_ids))
                c.execute(f"DELETE FROM community_stories WHERE story_group_id = {ph}", (story_group_id,))
            conn.commit()
            return {"success": True, "message": f"Deleted {len(story_ids)} stories", "deleted_ids": story_ids}, 200
    except Exception as exc:
        logger.error("Error deleting story group %s: %s", story_group_id, exc)
        return {"success": False, "error": "Server error"}, 500


def react_to_story(username: str, story_id: int, reaction: Optional[str]) -> Tuple[Dict[str, Any], int]:
    normalized_reaction = normalize_story_reaction(reaction) if reaction else None
    if reaction and not normalized_reaction:
        return {"success": False, "error": "Invalid reaction"}, 400
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_story_tables(c)
            ph = get_sql_placeholder()
            c.execute(
                f"""
                SELECT cs.community_id, cs.username AS story_username, c.creator_username
                FROM community_stories cs
                JOIN communities c ON c.id = cs.community_id
                WHERE cs.id = {ph}
                """,
                (story_id,),
            )
            row = c.fetchone()
            if not row:
                return {"success": False, "error": "Story not found"}, 404
            community_id = _row_value(row, "community_id", 0)
            story_author = _row_value(row, "story_username", 1)
            creator_username = _row_value(row, "creator_username", 2)
            if not user_has_story_access(c, username, community_id, creator_username):
                return {"success": False, "error": "Forbidden"}, 403
            now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
            c.execute(
                f"""
                SELECT reaction FROM community_story_reactions
                WHERE story_id = {ph} AND LOWER(username) = LOWER({ph})
                """,
                (story_id, username),
            )
            existing_reaction = _row_value(c.fetchone(), "reaction", 0)
            should_notify_author = False
            if not normalized_reaction or existing_reaction == normalized_reaction:
                if existing_reaction:
                    c.execute(
                        f"DELETE FROM community_story_reactions WHERE story_id = {ph} AND LOWER(username) = LOWER({ph})",
                        (story_id, username),
                    )
            else:
                if USE_MYSQL:
                    c.execute(
                        """
                        INSERT INTO community_story_reactions (story_id, username, reaction, created_at)
                        VALUES (%s, %s, %s, %s)
                        ON DUPLICATE KEY UPDATE reaction = VALUES(reaction), created_at = VALUES(created_at)
                        """,
                        (story_id, username, normalized_reaction, now_str),
                    )
                else:
                    c.execute(
                        """
                        INSERT INTO community_story_reactions (story_id, username, reaction, created_at)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(story_id, username)
                        DO UPDATE SET reaction = excluded.reaction, created_at = excluded.created_at
                        """,
                        (story_id, username, normalized_reaction, now_str),
                    )
                should_notify_author = True
            conn.commit()
            if should_notify_author and story_author and story_author.lower() != username.lower():
                _notify_story_interaction(
                    story_author,
                    username,
                    "story_reaction",
                    story_id,
                    community_id,
                    f"{username} reacted to your story",
                    f"New reaction from {username}",
                    f"story-reaction-{story_id}-{story_author}",
                )
            reaction_counts, user_reactions = fetch_story_reaction_maps(c, [story_id], username)
            return {
                "success": True,
                "story_id": story_id,
                "reactions": reaction_counts.get(story_id, {}),
                "user_reaction": user_reactions.get(story_id),
            }, 200
    except Exception as exc:
        logger.error("Error reacting to story %s: %s", story_id, exc)
        return {"success": False, "error": "Server error"}, 500


def get_story_comments(username: str, story_id: int) -> Tuple[Dict[str, Any], int]:
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            access_payload = _story_access_payload(c, username, story_id)
            if access_payload:
                return access_payload
            ph = get_sql_placeholder()
            c.execute(
                f"""
                SELECT sc.id, sc.username, sc.content, sc.created_at, up.profile_picture
                FROM community_story_comments sc
                LEFT JOIN user_profiles up ON up.username = sc.username
                WHERE sc.story_id = {ph}
                ORDER BY sc.created_at ASC
                LIMIT 200
                """,
                (story_id,),
            )
            comments = []
            for row in c.fetchall() or []:
                comments.append(
                    {
                        "id": _row_value(row, "id", 0),
                        "username": _row_value(row, "username", 1),
                        "content": _row_value(row, "content", 2),
                        "created_at": str(_row_value(row, "created_at", 3)),
                        "profile_picture": _public_url(_row_value(row, "profile_picture", 4)),
                    }
                )
            return {"success": True, "comments": comments, "count": len(comments)}, 200
    except Exception as exc:
        logger.error("Error fetching story comments for %s: %s", story_id, exc)
        return {"success": False, "error": "Server error"}, 500


def add_story_comment(username: str, story_id: int, content: str) -> Tuple[Dict[str, Any], int]:
    content = (content or "").strip()
    if not content:
        return {"success": False, "error": "Comment content required"}, 400
    content = content[:STORY_MAX_COMMENT_LENGTH]
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_story_tables(c)
            ph = get_sql_placeholder()
            c.execute(
                f"""
                SELECT cs.community_id, cs.username AS story_username, co.creator_username
                FROM community_stories cs
                JOIN communities co ON co.id = cs.community_id
                WHERE cs.id = {ph} AND cs.status = 'active'
                """,
                (story_id,),
            )
            row = c.fetchone()
            if not row:
                return {"success": False, "error": "Story not found"}, 404
            community_id = _row_value(row, "community_id", 0)
            story_author = _row_value(row, "story_username", 1)
            creator = _row_value(row, "creator_username", 2)
            if not user_has_story_access(c, username, community_id, creator):
                return {"success": False, "error": "Forbidden"}, 403
            now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
            c.execute(
                f"""
                INSERT INTO community_story_comments (story_id, username, content, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph})
                """,
                (story_id, username, content, now_str),
            )
            comment_id = getattr(c, "lastrowid", None)
            conn.commit()
            _notify_story_comment_participants(c, username, story_id, community_id, story_author, content)
            profile_picture = None
            try:
                c.execute(f"SELECT profile_picture FROM user_profiles WHERE username = {ph}", (username,))
                profile_picture = _public_url(_row_value(c.fetchone(), "profile_picture", 0))
            except Exception:
                pass
            return {
                "success": True,
                "comment": {
                    "id": comment_id,
                    "username": username,
                    "content": content,
                    "created_at": now_str,
                    "profile_picture": profile_picture,
                },
            }, 200
    except Exception as exc:
        logger.error("Error adding story comment for %s: %s", story_id, exc)
        return {"success": False, "error": "Server error"}, 500


def delete_story_comment(username: str, comment_id: int) -> Tuple[Dict[str, Any], int]:
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_story_tables(c)
            ph = get_sql_placeholder()
            c.execute(f"SELECT username FROM community_story_comments WHERE id = {ph}", (comment_id,))
            row = c.fetchone()
            if not row:
                return {"success": False, "error": "Comment not found"}, 404
            comment_author = _row_value(row, "username", 0)
            if str(comment_author).lower() != username.lower() and username.lower() != "admin":
                return {"success": False, "error": "Forbidden"}, 403
            c.execute(f"DELETE FROM community_story_comments WHERE id = {ph}", (comment_id,))
            conn.commit()
            return {"success": True}, 200
    except Exception as exc:
        logger.error("Error deleting story comment %s: %s", comment_id, exc)
        return {"success": False, "error": "Server error"}, 500


def _story_access_payload(c, username: str, story_id: int) -> Optional[Tuple[Dict[str, Any], int]]:
    ensure_story_tables(c)
    ph = get_sql_placeholder()
    c.execute(
        f"""
        SELECT cs.community_id, co.creator_username
        FROM community_stories cs
        JOIN communities co ON co.id = cs.community_id
        WHERE cs.id = {ph}
        """,
        (story_id,),
    )
    row = c.fetchone()
    if not row:
        return {"success": False, "error": "Story not found"}, 404
    community_id = _row_value(row, "community_id", 0)
    creator = _row_value(row, "creator_username", 1)
    if not user_has_story_access(c, username, community_id, creator):
        return {"success": False, "error": "Forbidden"}, 403
    return None


def _notify_story_interaction(
    recipient: str,
    username: str,
    notif_type: str,
    story_id: int,
    community_id: int,
    message: str,
    title: str,
    tag: str,
    *,
    preview_text: Optional[str] = None,
) -> None:
    link = f"/community_feed_react/{community_id}"
    try:
        create_notification(
            recipient,
            username,
            notif_type,
            post_id=story_id,
            community_id=community_id,
            message=message,
            link=link,
            preview_text=preview_text,
        )
    except Exception as exc:
        logger.warning("Story interaction notification error for %s: %s", recipient, exc)
    try:
        send_push_to_user(recipient, {"title": title, "body": preview_text or message, "url": link, "tag": tag})
    except Exception as exc:
        logger.warning("Story interaction push error for %s: %s", recipient, exc)


def _notify_story_comment_participants(
    c,
    username: str,
    story_id: int,
    community_id: int,
    story_author: Optional[str],
    content: str,
) -> None:
    recipients = set()
    if story_author and story_author.lower() != username.lower():
        recipients.add(story_author)
    try:
        ph = get_sql_placeholder()
        c.execute(
            f"""
            SELECT DISTINCT username
            FROM community_story_comments
            WHERE story_id = {ph} AND LOWER(username) != LOWER({ph})
            """,
            (story_id, username),
        )
        for row in c.fetchall() or []:
            recipient = _row_value(row, "username", 0)
            if recipient and recipient.lower() != username.lower():
                recipients.add(recipient)
    except Exception as exc:
        logger.warning("Story comment recipient lookup failed for %s: %s", story_id, exc)

    preview = truncate_notification_preview(content)
    for recipient in recipients:
        is_story_author = bool(story_author and recipient.lower() == story_author.lower())
        message = (
            f"{username} commented on your story"
            if is_story_author
            else f"{username} also commented on a story you commented on"
        )
        _notify_story_interaction(
            recipient,
            username,
            "story_comment",
            story_id,
            community_id,
            message,
            f"New story comment from {username}",
            f"story-comment-{story_id}-{recipient}",
            preview_text=preview or None,
        )
