"""HTTP surface for exclusive group feeds (not group chat)."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from functools import wraps

from flask import Blueprint, jsonify, request, session

from backend.services import auth_session, session_identity
from backend.services.basic_profile_gate import require_basic_profile_payload
from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.group_feed_access import (
    check_group_feed_access,
    check_group_feed_access_for_group_post,
    fetch_group_id_for_group_reply,
)
from backend.services.group_post_views import upsert_group_post_view
from backend.services.group_reply_thread import (
    assemble_group_reply_thread,
    count_group_reply_views_excluding_admin,
    ensure_group_reply_views_table,
    upsert_group_reply_view,
)
from backend.services.community import is_app_admin, is_community_admin, is_community_owner
from backend.services.group_feed_detail import build_group_feed_response
from backend.services.group_polls_data import (
    create_group_poll,
    ensure_group_poll_tables,
    vote_group_poll,
)
from backend.services.poll_hydration import invalidate_group_poll_post_detail

group_feed_bp = Blueprint("group_feed", __name__)
logger = logging.getLogger(__name__)


@group_feed_bp.after_request
def _no_store_user_scoped_responses(response):
    return auth_session.no_store(response)


def _login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if not session_identity.valid_session_username(session):
            return jsonify({"success": False, "error": "Login required"}), 401
        return view_func(*args, **kwargs)

    return wrapper


def _basic_profile_required_response(username: str | None):
    gated = require_basic_profile_payload(username)
    if gated is None:
        return None
    payload, status = gated
    return jsonify(payload), status


def _ensure_group_key_post_tables(cursor):
    from backend.services.database import USE_MYSQL

    if USE_MYSQL:
        try:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS `group_community_key_posts` (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    group_id INTEGER NOT NULL,
                    group_post_id INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_gck (group_id, group_post_id),
                    FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
                    FOREIGN KEY (group_post_id) REFERENCES `group_posts`(id) ON DELETE CASCADE
                )
                """
            )
        except Exception as e:
            logger.warning("group_community_key_posts ensure: %s", e)
        try:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS `group_user_key_posts` (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    username VARCHAR(150) NOT NULL,
                    group_id INTEGER NOT NULL,
                    group_post_id INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_guk (username, group_id, group_post_id),
                    FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
                    FOREIGN KEY (group_post_id) REFERENCES `group_posts`(id) ON DELETE CASCADE,
                    FOREIGN KEY (username) REFERENCES users(username)
                )
                """
            )
        except Exception as e:
            logger.warning("group_user_key_posts ensure: %s", e)
    else:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS group_community_key_posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                group_post_id INTEGER NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(group_id, group_post_id),
                FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
                FOREIGN KEY (group_post_id) REFERENCES group_posts(id) ON DELETE CASCADE
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS group_user_key_posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                group_id INTEGER NOT NULL,
                group_post_id INTEGER NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(username, group_id, group_post_id),
                FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
                FOREIGN KEY (group_post_id) REFERENCES group_posts(id) ON DELETE CASCADE,
                FOREIGN KEY (username) REFERENCES users(username)
            )
            """
        )


def _normalize_media_url(path: str | None) -> str | None:
    if not path:
        return None
    path = str(path).strip()
    if path.startswith("http"):
        return path
    if path.startswith("/static") or path.startswith("/uploads"):
        return path
    if path.startswith("uploads/"):
        return "/" + path
    return f"/uploads/{path}"


def _ensure_group_announcements_table(cursor):
    if USE_MYSQL:
        try:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS `group_announcements` (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    group_id INT NOT NULL,
                    content TEXT NOT NULL,
                    created_by VARCHAR(191) NOT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    KEY idx_g_ann_group (group_id),
                    CONSTRAINT fk_g_ann_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE
                )
                """
            )
        except Exception as e:
            logger.warning("group_announcements ensure: %s", e)
    else:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS group_announcements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
            )
            """
        )


def _can_manage_group_announcements(
    _cursor, _ph: str, username: str, _group_id: int, community_id, group_owner
) -> bool:
    if is_app_admin(username):
        return True
    if group_owner and username == group_owner:
        return True
    if community_id is not None:
        if is_community_owner(username, int(community_id)) or is_community_admin(
            username, int(community_id)
        ):
            return True
    return False


@group_feed_bp.route("/api/group_feed", methods=["GET"])
@_login_required
def api_group_feed():
    username = session["username"]
    try:
        group_id = int(request.args.get("group_id", "0"))
    except Exception:
        return jsonify({"success": False, "error": "Invalid group_id"}), 400
    payload, code = build_group_feed_response(username, group_id)
    return jsonify(payload), code


@group_feed_bp.route("/api/group_post_view", methods=["POST"])
@_login_required
def api_group_post_view():
    """Record a unique view for a group post (not community ``post_views``)."""
    username = session["username"]
    payload = request.get_json(silent=True) or {}
    gpid = payload.get("group_post_id")
    if gpid is None:
        gpid = request.form.get("group_post_id", type=int)
    try:
        gpid = int(gpid)
    except Exception:
        return jsonify({"success": False, "error": "group_post_id required"}), 400
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ok, err, _ = check_group_feed_access_for_group_post(c, ph, username, gpid)
            if not ok:
                code = 404 if err and "not found" in (err or "").lower() else 403
                return jsonify({"success": False, "error": err or "Forbidden"}), code
            view_count = upsert_group_post_view(c, ph, gpid, username)
            conn.commit()
            return jsonify({"success": True, "view_count": view_count})
    except Exception as e:
        logger.error("api_group_post_view error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": "Server error"}), 500


@group_feed_bp.route("/api/group_announcements/<int:group_id>", methods=["GET"])
@_login_required
def api_group_announcements_list(group_id: int):
    username = session["username"]
    ph = get_sql_placeholder()
    ga = "`group_announcements`" if USE_MYSQL else "group_announcements"
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            _ensure_group_announcements_table(c)
            if not USE_MYSQL:
                conn.commit()
            ok, err = check_group_feed_access(c, ph, username, group_id)
            if not ok:
                return jsonify({"success": False, "error": err or "Forbidden"}), 403
            c.execute(
                f"""
                SELECT id, content, created_by, created_at
                FROM {ga}
                WHERE group_id = {ph}
                ORDER BY id DESC
                LIMIT 50
                """,
                (group_id,),
            )
            rows = c.fetchall() or []
            items = []
            for r in rows:
                items.append(
                    {
                        "id": r["id"] if hasattr(r, "keys") else r[0],
                        "content": (r["content"] if hasattr(r, "keys") else r[1]) or "",
                        "created_by": r["created_by"] if hasattr(r, "keys") else r[2],
                        "created_at": r["created_at"] if hasattr(r, "keys") else r[3],
                    }
                )
            return jsonify({"success": True, "announcements": items})
    except Exception as e:
        logger.error("api_group_announcements_list error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": "Server error"}), 500


@group_feed_bp.route("/api/group_announcements/<int:group_id>", methods=["POST"])
@_login_required
def api_group_announcements_create(group_id: int):
    username = session["username"]
    gate_resp = _basic_profile_required_response(username)
    if gate_resp is not None:
        return gate_resp
    ph = get_sql_placeholder()
    data = request.get_json(silent=True) or {}
    content = (data.get("content") or request.form.get("content") or "").strip()
    if not content:
        return jsonify({"success": False, "error": "content required"}), 400
    ga = "`group_announcements`" if USE_MYSQL else "group_announcements"
    g_t = "`groups`" if USE_MYSQL else "groups"
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            _ensure_group_announcements_table(c)
            ok, err = check_group_feed_access(c, ph, username, group_id)
            if not ok:
                return jsonify({"success": False, "error": err or "Forbidden"}), 403
            c.execute(
                f"SELECT community_id, created_by FROM {g_t} WHERE id = {ph}",
                (group_id,),
            )
            gr = c.fetchone()
            if not gr:
                return jsonify({"success": False, "error": "Group not found"}), 404
            community_id = gr["community_id"] if hasattr(gr, "keys") else gr[0]
            created_by = gr["created_by"] if hasattr(gr, "keys") else gr[1]
            if not _can_manage_group_announcements(c, ph, username, group_id, community_id, created_by):
                return jsonify({"success": False, "error": "Forbidden"}), 403
            now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
            c.execute(
                f"""
                INSERT INTO {ga} (group_id, content, created_by, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph})
                """,
                (group_id, content, username, now),
            )
            conn.commit()
            return jsonify({"success": True})
    except Exception as e:
        logger.error("api_group_announcements_create error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": "Server error"}), 500


@group_feed_bp.route("/api/group_posts_search", methods=["GET"])
@_login_required
def api_group_posts_search():
    """Full-text-ish search within one group's posts (hashtag / substring)."""
    username = session["username"]
    group_id = request.args.get("group_id", type=int)
    raw_q = (request.args.get("q") or "").strip().lstrip("#")
    if not group_id or not raw_q:
        return jsonify({"success": False, "error": "group_id and q required"}), 400
    ph = get_sql_placeholder()
    like = f"%{raw_q}%"
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ok, err = check_group_feed_access(c, ph, username, group_id)
            if not ok:
                return jsonify({"success": False, "error": err or "Forbidden"}), 403
            gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
            c.execute(
                f"""
                SELECT id, username, content, created_at
                FROM {gp_t}
                WHERE group_id = {ph} AND LOWER(content) LIKE LOWER({ph})
                ORDER BY id DESC
                LIMIT 50
                """,
                (group_id, like),
            )
            rows = c.fetchall() or []
            posts = []
            for r in rows:
                posts.append(
                    {
                        "id": r["id"] if hasattr(r, "keys") else r[0],
                        "username": r["username"] if hasattr(r, "keys") else r[1],
                        "content": (r["content"] if hasattr(r, "keys") else r[2]) or "",
                        "timestamp": r["created_at"] if hasattr(r, "keys") else r[3],
                    }
                )
            return jsonify({"success": True, "posts": posts})
    except Exception as e:
        logger.error("api_group_posts_search error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": "Server error"}), 500


@group_feed_bp.route("/api/group_photos/<int:group_id>", methods=["GET"])
@_login_required
def api_group_photos(group_id: int):
    username = session["username"]
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ok, err = check_group_feed_access(c, ph, username, group_id)
            if not ok:
                return jsonify({"success": False, "error": err or "Forbidden"}), 403

            gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
            gr_t = "`group_replies`" if USE_MYSQL else "group_replies"
            # Ensure optional columns on group_posts (best effort)
            for alter in (
                f"ALTER TABLE {gp_t} ADD COLUMN video_path TEXT",
                f"ALTER TABLE {gp_t} ADD COLUMN media_paths TEXT",
                f"ALTER TABLE {gr_t} ADD COLUMN video_path TEXT",
            ):
                try:
                    c.execute(alter)
                except Exception:
                    pass

            c.execute(
                f"""
                SELECT
                    gp.id as post_id,
                    NULL as reply_id,
                    gp.username,
                    gp.content,
                    gp.image_path,
                    gp.video_path,
                    gp.media_paths,
                    gp.created_at,
                    up.profile_picture
                FROM {gp_t} gp
                LEFT JOIN user_profiles up ON gp.username = up.username
                WHERE gp.group_id = {ph}
                  AND (
                    (gp.image_path IS NOT NULL AND gp.image_path != '')
                    OR (gp.video_path IS NOT NULL AND gp.video_path != '')
                    OR (gp.media_paths IS NOT NULL AND gp.media_paths != '')
                  )

                UNION ALL

                SELECT
                    gp.id as post_id,
                    gr.id as reply_id,
                    gr.username,
                    gr.content,
                    gr.image_path,
                    gr.video_path,
                    NULL as media_paths,
                    gr.created_at,
                    up.profile_picture
                FROM {gr_t} gr
                JOIN {gp_t} gp ON gp.id = gr.group_post_id
                LEFT JOIN user_profiles up ON gr.username = up.username
                WHERE gp.group_id = {ph}
                  AND (
                    (gr.image_path IS NOT NULL AND gr.image_path != '')
                    OR (gr.video_path IS NOT NULL AND gr.video_path != '')
                  )
                ORDER BY created_at DESC
                """,
                (group_id, group_id),
            )
            posts_raw = c.fetchall() or []
            posts = [dict(row) for row in posts_raw] if posts_raw and hasattr(posts_raw[0], "keys") else [
                {
                    "post_id": r[0],
                    "reply_id": r[1],
                    "username": r[2],
                    "content": r[3],
                    "image_path": r[4],
                    "video_path": r[5] if len(r) > 5 else None,
                    "media_paths": r[6] if len(r) > 6 else None,
                    "created_at": r[7] if len(r) > 7 else None,
                    "profile_picture": r[8] if len(r) > 8 else None,
                }
                for r in posts_raw
            ]

            photos = []
            media_id = 0
            for post in posts:
                post_id = post.get("post_id")
                username_val = post.get("username")
                image_path = post.get("image_path")
                video_path = post.get("video_path")
                media_paths_raw = post.get("media_paths")
                ts = post.get("created_at") or ""
                reply_id = post.get("reply_id")

                if media_paths_raw:
                    try:
                        paths = json.loads(media_paths_raw) if isinstance(media_paths_raw, str) else media_paths_raw
                        if isinstance(paths, list):
                            for mp in paths:
                                raw = mp if isinstance(mp, str) else (mp.get("path") if isinstance(mp, dict) else None)
                                url = _normalize_media_url(raw)
                                if url:
                                    media_id += 1
                                    is_video = bool(
                                        raw
                                        and str(raw).lower().endswith((".mp4", ".mov", ".webm", ".m4v"))
                                    )
                                    photos.append(
                                        {
                                            "id": f"{post_id}_{reply_id or 'p'}_mp_{media_id}",
                                            "post_id": post_id,
                                            "reply_id": reply_id,
                                            "username": username_val,
                                            "image_url": url,
                                            "type": "video" if is_video else "image",
                                            "created_at": ts,
                                        }
                                    )
                    except Exception:
                        pass

                if image_path:
                    url = _normalize_media_url(image_path)
                    if url:
                        media_id += 1
                        photos.append(
                            {
                                "id": f"{post_id}_{reply_id or 'p'}_img_{media_id}",
                                "post_id": post_id,
                                "reply_id": reply_id,
                                "username": username_val,
                                "image_url": url,
                                "type": "image",
                                "created_at": ts,
                            }
                        )

                if video_path:
                    url = _normalize_media_url(video_path)
                    if url:
                        media_id += 1
                        photos.append(
                            {
                                "id": f"{post_id}_{reply_id or 'p'}_vid_{media_id}",
                                "post_id": post_id,
                                "reply_id": reply_id,
                                "username": username_val,
                                "image_url": url,
                                "type": "video",
                                "created_at": ts,
                            }
                        )

            photos.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
            return jsonify({"success": True, "photos": photos})
    except Exception as e:
        logger.error("api_group_photos error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": "Failed to load photos"}), 500


def _enrich_group_posts_for_key_list(c, posts: list, username: str, ph: str):
    gpr_t = "`group_post_reactions`" if USE_MYSQL else "group_post_reactions"
    for post in posts:
        pid = post["id"]
        try:
            c.execute("SELECT profile_picture FROM user_profiles WHERE username = ?", (post["username"],))
            pp = c.fetchone()
            post["profile_picture"] = (
                pp["profile_picture"] if pp and hasattr(pp, "keys") else (pp[0] if pp else None)
            )
        except Exception:
            post["profile_picture"] = None
        try:
            c.execute(
                f"SELECT reaction, COUNT(*) AS count FROM {gpr_t} WHERE group_post_id = {ph} GROUP BY reaction",
                (pid,),
            )
            post["reactions"] = {
                row["reaction"] if hasattr(row, "keys") else row[0]: row["count"] if hasattr(row, "keys") else row[1]
                for row in (c.fetchall() or [])
            }
        except Exception:
            post["reactions"] = {}
        try:
            c.execute(
                f"SELECT reaction FROM {gpr_t} WHERE group_post_id = {ph} AND username = {ph}",
                (pid, username),
            )
            ur = c.fetchone()
            post["user_reaction"] = ur["reaction"] if ur and hasattr(ur, "keys") else (ur[0] if ur else None)
        except Exception:
            post["user_reaction"] = None


@group_feed_bp.route("/api/group_key_posts/<int:group_id>", methods=["GET"])
@_login_required
def api_group_key_posts(group_id: int):
    username = session["username"]
    ph = get_sql_placeholder()
    tab = (request.args.get("tab") or "community").strip().lower()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            _ensure_group_key_post_tables(c)
            if not USE_MYSQL:
                conn.commit()

            ok, err = check_group_feed_access(c, ph, username, group_id)
            if not ok:
                return jsonify({"success": False, "error": err or "Forbidden"}), 403

            gck = "`group_community_key_posts`" if USE_MYSQL else "group_community_key_posts"
            guk = "`group_user_key_posts`" if USE_MYSQL else "group_user_key_posts"
            gp_t = "`group_posts`" if USE_MYSQL else "group_posts"

            if tab == "yours":
                c.execute(
                    f"SELECT group_post_id FROM {guk} WHERE group_id = {ph} AND username = {ph} ORDER BY id DESC",
                    (group_id, username),
                )
            else:
                c.execute(
                    f"SELECT group_post_id FROM {gck} WHERE group_id = {ph} ORDER BY id DESC",
                    (group_id,),
                )
            rows = c.fetchall() or []
            post_ids = [
                (r["group_post_id"] if hasattr(r, "keys") else r[0]) for r in rows if r is not None
            ]
            if not post_ids:
                return jsonify({"success": True, "posts": []})

            placeholders = ",".join([ph] * len(post_ids))
            c.execute(
                f"SELECT * FROM {gp_t} WHERE id IN ({placeholders}) AND group_id = {ph} ORDER BY id DESC",
                (*tuple(post_ids), group_id),
            )
            posts = []
            for r in c.fetchall() or []:
                if hasattr(r, "keys"):
                    posts.append({k: r[k] for k in r.keys()})
                else:
                    posts.append({})
            # filter kept only rows in group
            _enrich_group_posts_for_key_list(c, posts, username, ph)
            for post in posts:
                post["is_starred"] = True
                post["timestamp"] = post.get("created_at")
            return jsonify({"success": True, "posts": posts})
    except Exception as e:
        logger.error("api_group_key_posts error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": "server error"}), 500


@group_feed_bp.route("/api/toggle_group_key_post", methods=["POST"])
@_login_required
def api_toggle_group_key_post():
    username = session.get("username")
    gate_resp = _basic_profile_required_response(username)
    if gate_resp is not None:
        return gate_resp
    group_id = request.form.get("group_id", type=int)
    group_post_id = request.form.get("group_post_id", type=int)
    if not group_id or not group_post_id:
        return jsonify({"success": False, "error": "group_id and group_post_id required"}), 400
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            _ensure_group_key_post_tables(c)
            ok, err = check_group_feed_access(c, ph, username, group_id)
            if not ok:
                return jsonify({"success": False, "error": err or "Forbidden"}), 403

            gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
            c.execute(
                f"SELECT id FROM {gp_t} WHERE id = {ph} AND group_id = {ph}",
                (group_post_id, group_id),
            )
            if not c.fetchone():
                return jsonify({"success": False, "error": "Post not found"}), 404

            guk = "`group_user_key_posts`" if USE_MYSQL else "group_user_key_posts"
            c.execute(
                f"SELECT id FROM {guk} WHERE username = {ph} AND group_id = {ph} AND group_post_id = {ph}",
                (username, group_id, group_post_id),
            )
            existing = c.fetchone()
            if existing:
                c.execute(
                    f"DELETE FROM {guk} WHERE username = {ph} AND group_id = {ph} AND group_post_id = {ph}",
                    (username, group_id, group_post_id),
                )
            else:
                now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
                c.execute(
                    f"INSERT INTO {guk} (username, group_id, group_post_id, created_at) VALUES ({ph}, {ph}, {ph}, {ph})",
                    (username, group_id, group_post_id, now),
                )
            if not USE_MYSQL:
                conn.commit()
            else:
                conn.commit()
            try:
                from backend.services.post_detail_cache import invalidate_post_detail_viewer
                invalidate_post_detail_viewer(group_post_id, username, scope="group")
            except Exception:
                pass
            return jsonify({"success": True, "starred": not existing})
    except Exception as e:
        logger.error("toggle_group_key_post error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": "server error"}), 500


@group_feed_bp.route("/api/toggle_group_community_key_post", methods=["POST"])
@_login_required
def api_toggle_group_community_key_post():
    username = session.get("username")
    gate_resp = _basic_profile_required_response(username)
    if gate_resp is not None:
        return gate_resp
    group_id = request.form.get("group_id", type=int)
    group_post_id = request.form.get("group_post_id", type=int)
    if not group_id or not group_post_id:
        return jsonify({"success": False, "error": "group_id and group_post_id required"}), 400
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            _ensure_group_key_post_tables(c)

            gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
            g_t = "`groups`" if USE_MYSQL else "groups"
            c.execute(
                f"SELECT gp.group_id, g.community_id, g.created_by FROM {gp_t} gp "
                f"JOIN {g_t} g ON g.id = gp.group_id WHERE gp.id = {ph} AND gp.group_id = {ph}",
                (group_post_id, group_id),
            )
            row = c.fetchone()
            if not row:
                return jsonify({"success": False, "error": "Post not found"}), 404
            community_id = row["community_id"] if hasattr(row, "keys") else row[1]
            created_by = row["created_by"] if hasattr(row, "keys") else row[2]

            can_toggle = is_app_admin(username) or (
                community_id is not None
                and (
                    is_community_owner(username, int(community_id))
                    or is_community_admin(username, int(community_id))
                )
            )
            if created_by and username == created_by:
                can_toggle = True
            if not can_toggle:
                return jsonify({"success": False, "error": "Forbidden"}), 403

            gck = "`group_community_key_posts`" if USE_MYSQL else "group_community_key_posts"
            c.execute(
                f"SELECT id FROM {gck} WHERE group_id = {ph} AND group_post_id = {ph}",
                (group_id, group_post_id),
            )
            existing = c.fetchone()
            if existing:
                c.execute(
                    f"DELETE FROM {gck} WHERE group_id = {ph} AND group_post_id = {ph}",
                    (group_id, group_post_id),
                )
            else:
                now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
                c.execute(
                    f"INSERT INTO {gck} (group_id, group_post_id, created_at) VALUES ({ph}, {ph}, {ph})",
                    (group_id, group_post_id, now),
                )
            conn.commit()
            try:
                from backend.services.post_detail_cache import invalidate_post_detail
                invalidate_post_detail(group_post_id, scope="group")
            except Exception:
                pass
            return jsonify({"success": True, "starred": not existing})
    except Exception as e:
        logger.error("toggle_group_community_key_post error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": "server error"}), 500


@group_feed_bp.route("/api/group_poll_vote", methods=["POST"])
@_login_required
def api_group_poll_vote():
    username = session["username"]
    gate_resp = _basic_profile_required_response(username)
    if gate_resp is not None:
        return gate_resp
    data = request.get_json(silent=True) or {}
    group_poll_id = data.get("group_poll_id")
    option_id = data.get("option_id")
    try:
        group_poll_id = int(group_poll_id)
        option_id = int(option_id)
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "group_poll_id and option_id required"}), 400
    ph = get_sql_placeholder()
    gp = "`group_polls`" if USE_MYSQL else "group_polls"
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(f"SELECT group_id FROM {gp} WHERE id = {ph}", (group_poll_id,))
            row = c.fetchone()
            if not row:
                return jsonify({"success": False, "error": "Poll not found"}), 404
            gid = row["group_id"] if hasattr(row, "keys") else row[0]
            ok, err = check_group_feed_access(c, ph, username, int(gid))
            if not ok:
                return jsonify({"success": False, "error": err or "Forbidden"}), 403
            ok_vote, message, poll_results = vote_group_poll(c, ph, username, group_poll_id, option_id)
            if not ok_vote:
                return jsonify({"success": False, "error": message}), 400
            conn.commit()
            invalidate_group_poll_post_detail(c, ph, group_poll_id)
        return jsonify({"success": True, "message": message, "poll_results": poll_results})
    except Exception as e:
        logger.error("api_group_poll_vote error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": "Server error"}), 500


@group_feed_bp.route("/api/group_polls/create", methods=["POST"])
@_login_required
def api_group_polls_create():
    username = session["username"]
    gate_resp = _basic_profile_required_response(username)
    if gate_resp is not None:
        return gate_resp
    data = request.get_json(silent=True) or {}
    try:
        group_id = int(data.get("group_id") or request.form.get("group_id") or 0)
        group_post_id = int(data.get("group_post_id") or request.form.get("group_post_id") or 0)
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "group_id and group_post_id required"}), 400
    question = (data.get("question") or request.form.get("question") or "").strip()
    options_raw = data.get("options") or request.form.getlist("options[]")
    if isinstance(options_raw, str):
        options_raw = [options_raw]
    options = [str(o).strip() for o in (options_raw or []) if str(o).strip()]
    sv_raw = data.get("single_vote", True)
    if isinstance(sv_raw, str):
        single_vote = sv_raw.lower() not in ("false", "0", "no")
    else:
        single_vote = bool(sv_raw)
    expires_at_sql = None
    exp_raw = (data.get("expires_at") or request.form.get("expires_at") or "").strip()
    if exp_raw:
        try:
            if "T" in exp_raw:
                dt = datetime.strptime(exp_raw, "%Y-%m-%dT%H:%M")
            else:
                dt = datetime.strptime(exp_raw, "%Y-%m-%d")
            if dt <= datetime.utcnow():
                return jsonify({"success": False, "error": "Expiry must be in the future"}), 400
            expires_at_sql = dt.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            expires_at_sql = None
    if not question or len(options) < 2:
        return jsonify({"success": False, "error": "Question and at least 2 options required"}), 400
    if len(options) > 6:
        return jsonify({"success": False, "error": "Maximum 6 options"}), 400
    ph = get_sql_placeholder()
    gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
    g_t = "`groups`" if USE_MYSQL else "groups"
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_group_poll_tables(c)
            ok, err = check_group_feed_access(c, ph, username, group_id)
            if not ok:
                return jsonify({"success": False, "error": err or "Forbidden"}), 403
            c.execute(
                f"SELECT gp.username, g.community_id, g.created_by FROM {gp_t} gp "
                f"JOIN {g_t} g ON g.id = gp.group_id WHERE gp.id = {ph} AND gp.group_id = {ph}",
                (group_post_id, group_id),
            )
            row = c.fetchone()
            if not row:
                return jsonify({"success": False, "error": "Post not found"}), 404
            post_username = row["username"] if hasattr(row, "keys") else row[0]
            community_id = row["community_id"] if hasattr(row, "keys") else row[1]
            group_owner = row["created_by"] if hasattr(row, "keys") else row[2]
            can_create = post_username == username or _can_manage_group_announcements(
                c, ph, username, group_id, community_id, group_owner
            )
            if not can_create:
                return jsonify({"success": False, "error": "Forbidden"}), 403
            poll_id, err_c = create_group_poll(
                c, ph, username, group_id, group_post_id, question, options, single_vote, expires_at_sql
            )
            if err_c:
                return jsonify({"success": False, "error": err_c}), 400
            conn.commit()
            try:
                from backend.services.post_detail_cache import invalidate_post_detail

                invalidate_post_detail(group_post_id, scope="group")
            except Exception:
                pass
        return jsonify({"success": True, "group_poll_id": poll_id})
    except Exception as e:
        logger.error("api_group_polls_create error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": "Server error"}), 500


@group_feed_bp.route("/api/group_reply/<int:reply_id>")
@_login_required
def api_group_get_reply(reply_id: int):
    """Thread payload for a group feed reply (do not use /api/reply — ID namespaces differ)."""
    username = session["username"]
    ph = get_sql_placeholder()
    gr_t = "`group_replies`" if USE_MYSQL else "group_replies"
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(f"SELECT id FROM {gr_t} WHERE id = {ph}", (reply_id,))
            if not c.fetchone():
                return jsonify({"success": False, "error": "Reply not found"}), 404
            gid = fetch_group_id_for_group_reply(c, ph, reply_id)
            if gid is None:
                return jsonify({"success": False, "error": "Reply not found"}), 404
            ok, err = check_group_feed_access(c, ph, username, gid)
            if not ok:
                return jsonify({"success": False, "error": err or "Forbidden"}), 403
            payload = assemble_group_reply_thread(c, ph, reply_id, username)
            return jsonify(payload)
    except Exception as e:
        logger.error("api_group_get_reply error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": "Server error"}), 500


@group_feed_bp.route("/api/group_reply_view", methods=["POST"])
@_login_required
def api_group_reply_view():
    """Record a unique view for a group reply (separate from community ``reply_views``)."""
    username = session["username"]
    payload = request.get_json(silent=True) or {}
    reply_id = payload.get("reply_id")
    if reply_id is None:
        reply_id = request.form.get("reply_id", type=int)
    try:
        reply_id = int(reply_id)
    except Exception:
        return jsonify({"success": False, "error": "reply_id required"}), 400
    ph = get_sql_placeholder()
    gr_t = "`group_replies`" if USE_MYSQL else "group_replies"
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(f"SELECT id FROM {gr_t} WHERE id = {ph}", (reply_id,))
            if not c.fetchone():
                return jsonify({"success": False, "error": "Reply not found"}), 404
            gid = fetch_group_id_for_group_reply(c, ph, reply_id)
            if gid is None:
                return jsonify({"success": False, "error": "Reply not found"}), 404
            ok, err = check_group_feed_access(c, ph, username, gid)
            if not ok:
                return jsonify({"success": False, "error": err or "Forbidden"}), 403
            view_count = upsert_group_reply_view(c, ph, reply_id, username)
            conn.commit()
            return jsonify({"success": True, "view_count": view_count})
    except Exception as e:
        logger.error("api_group_reply_view error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": "Server error"}), 500


@group_feed_bp.route("/api/group_reply_reactors/<int:reply_id>")
@_login_required
def api_group_reply_reactors(reply_id: int):
    """Users who reacted to a group reply plus viewers (parity with ``get_reply_reactors``)."""
    username = session["username"]
    ph = get_sql_placeholder()
    gr_t = "`group_replies`" if USE_MYSQL else "group_replies"
    grr_t = "`group_reply_reactions`" if USE_MYSQL else "group_reply_reactions"
    grv_t = "`group_reply_views`" if USE_MYSQL else "group_reply_views"
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(f"SELECT id FROM {gr_t} WHERE id = {ph}", (reply_id,))
            if not c.fetchone():
                return jsonify({"success": False, "error": "Reply not found"}), 404
            gid = fetch_group_id_for_group_reply(c, ph, reply_id)
            if gid is None:
                return jsonify({"success": False, "error": "Reply not found"}), 404
            ok, err = check_group_feed_access(c, ph, username, gid)
            if not ok:
                return jsonify({"success": False, "error": err or "Forbidden"}), 403

            c.execute(
                f"""
                SELECT grr.reaction AS reaction_type, grr.username, up.profile_picture
                FROM {grr_t} grr
                LEFT JOIN user_profiles up ON up.username = grr.username
                WHERE grr.group_reply_id = {ph}
                ORDER BY grr.reaction, grr.username
                """,
                (reply_id,),
            )
            rows = c.fetchall() or []
            by_type: dict = {}
            for row in rows:
                if hasattr(row, "keys"):
                    rt = row["reaction_type"]
                    uname = row["username"]
                    pic = row.get("profile_picture") if "profile_picture" in row.keys() else None
                else:
                    rt, uname = row[0], row[1]
                    pic = row[2] if len(row) > 2 else None
                by_type.setdefault(rt, []).append({"username": uname, "profile_picture": pic})

            groups = [{"reaction_type": k, "users": v} for k, v in by_type.items()]
            order = {"heart": 0, "thumbs-up": 1, "thumbs-down": 2}
            groups.sort(key=lambda g: order.get(g["reaction_type"], 99))

            def _normalize_pic(value):
                if not value:
                    return None
                s = str(value).strip()
                if s.startswith(("http://", "https://", "/uploads", "/static")):
                    return s
                if s.startswith("uploads/"):
                    return "/" + s
                return f"/uploads/{s}"

            for g in groups:
                for u in g["users"]:
                    u["profile_picture"] = _normalize_pic(u.get("profile_picture"))

            ensure_group_reply_views_table(c)
            view_count = count_group_reply_views_excluding_admin(c, ph, reply_id)
            viewers: list = []
            try:
                c.execute(
                    f"""
                    SELECT rv.username, rv.viewed_at, up.profile_picture
                    FROM {grv_t} rv
                    LEFT JOIN user_profiles up ON up.username = rv.username
                    WHERE rv.group_reply_id = {ph}
                      AND LOWER(rv.username) <> LOWER({ph})
                    ORDER BY rv.viewed_at DESC
                    LIMIT 100
                    """,
                    (reply_id, "admin"),
                )
                viewer_rows = c.fetchall() or []
            except Exception:
                viewer_rows = []

            for vr in viewer_rows:
                if hasattr(vr, "keys"):
                    uname = vr.get("username")
                    viewed_at_raw = vr.get("viewed_at")
                    pic = vr.get("profile_picture")
                else:
                    uname = vr[0] if len(vr) > 0 else None
                    viewed_at_raw = vr[1] if len(vr) > 1 else None
                    pic = vr[2] if len(vr) > 2 else None
                if not uname:
                    continue
                viewed_at_str = (
                    viewed_at_raw.isoformat()
                    if isinstance(viewed_at_raw, datetime)
                    else (str(viewed_at_raw).strip() if viewed_at_raw else None)
                )
                viewers.append(
                    {
                        "username": uname,
                        "profile_picture": _normalize_pic(pic),
                        "viewed_at": viewed_at_str,
                    }
                )

            return jsonify(
                {
                    "success": True,
                    "groups": groups,
                    "view_count": int(view_count or 0),
                    "viewers": viewers,
                }
            )
    except Exception as e:
        logger.error("api_group_reply_reactors error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": "Server error"}), 500


@group_feed_bp.route("/api/group_replies/edit", methods=["POST"])
@_login_required
def api_group_replies_edit():
    username = session["username"]
    gate_resp = _basic_profile_required_response(username)
    if gate_resp is not None:
        return gate_resp
    reply_id = request.form.get("reply_id", type=int)
    new_content = (request.form.get("content") or "").strip()
    if not reply_id:
        return jsonify({"success": False, "error": "reply_id required"}), 400
    if new_content == "":
        return jsonify({"success": False, "error": "content required"}), 400
    ph = get_sql_placeholder()
    gr_t = "`group_replies`" if USE_MYSQL else "group_replies"
    gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
    g_t = "`groups`" if USE_MYSQL else "groups"
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"SELECT gr.username, gp.group_id, g.community_id, g.created_by "
                f"FROM {gr_t} gr JOIN {gp_t} gp ON gp.id = gr.group_post_id "
                f"JOIN {g_t} g ON g.id = gp.group_id WHERE gr.id = {ph}",
                (reply_id,),
            )
            row = c.fetchone()
            if not row:
                return jsonify({"success": False, "error": "Reply not found"}), 404
            owner = row["username"] if hasattr(row, "keys") else row[0]
            group_id = row["group_id"] if hasattr(row, "keys") else row[1]
            community_id = row["community_id"] if hasattr(row, "keys") else row[2]
            group_creator = row["created_by"] if hasattr(row, "keys") else row[3]

            ok, err = check_group_feed_access(c, ph, username, int(group_id))
            if not ok:
                return jsonify({"success": False, "error": err or "Forbidden"}), 403

            can_edit = owner == username or is_app_admin(username)
            if not can_edit and community_id is not None:
                can_edit = is_community_owner(username, int(community_id)) or is_community_admin(
                    username, int(community_id)
                )
            if not can_edit and group_creator == username:
                can_edit = True
            if not can_edit:
                return jsonify({"success": False, "error": "Forbidden"}), 403

            c.execute(f"UPDATE {gr_t} SET content={ph} WHERE id={ph}", (new_content, reply_id))
            conn.commit()
            return jsonify({"success": True, "reply": {"id": reply_id, "content": new_content}})
    except Exception as e:
        logger.error("api_group_replies_edit error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": "Server error"}), 500


@group_feed_bp.route("/api/group_replies/delete", methods=["POST"])
@_login_required
def api_group_replies_delete():
    username = session["username"]
    reply_id = request.form.get("reply_id", type=int) or request.form.get("group_reply_id", type=int)
    if not reply_id:
        return jsonify({"success": False, "error": "reply_id required"}), 400

    ph = get_sql_placeholder()

    def _collect_subtree_ids(root: int):
        ids = [root]
        pending = [root]
        seen = {root}
        gr_t = "`group_replies`" if USE_MYSQL else "group_replies"
        while pending:
            pl = ",".join([ph] * len(pending))
            c.execute(
                f"SELECT id FROM {gr_t} WHERE parent_reply_id IN ({pl})",
                tuple(pending),
            )
            pending = []
            for r in c.fetchall() or []:
                cid = r["id"] if hasattr(r, "keys") else r[0]
                if cid and cid not in seen:
                    seen.add(cid)
                    ids.append(cid)
                    pending.append(cid)
        return ids

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            gr_t = "`group_replies`" if USE_MYSQL else "group_replies"
            grr_t = "`group_reply_reactions`" if USE_MYSQL else "group_reply_reactions"
            gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
            g_t = "`groups`" if USE_MYSQL else "groups"

            c.execute(
                f"SELECT gr.id, gr.username, gr.image_path, gr.group_post_id, gp.group_id, "
                f"g.community_id, g.created_by FROM {gr_t} gr "
                f"JOIN {gp_t} gp ON gp.id = gr.group_post_id "
                f"JOIN {g_t} g ON g.id = gp.group_id WHERE gr.id = {ph}",
                (reply_id,),
            )
            reply = c.fetchone()
            if not reply:
                return jsonify({"success": False, "error": "Reply not found"}), 404

            reply_owner = reply["username"] if hasattr(reply, "keys") else reply[1]
            group_post_id = reply["group_post_id"] if hasattr(reply, "keys") else reply[3]
            group_id = reply["group_id"] if hasattr(reply, "keys") else reply[4]
            community_id = reply["community_id"] if hasattr(reply, "keys") else reply[5]
            group_creator = reply["created_by"] if hasattr(reply, "keys") else reply[6]

            ok, err = check_group_feed_access(c, ph, username, int(group_id))
            if not ok:
                return jsonify({"success": False, "error": err or "Forbidden"}), 403

            can_delete = reply_owner == username or is_app_admin(username)
            if not can_delete and community_id is not None:
                can_delete = is_community_owner(username, int(community_id)) or is_community_admin(
                    username, int(community_id)
                )
            if not can_delete and group_creator == username:
                can_delete = True
            if not can_delete:
                return jsonify({"success": False, "error": "Unauthorized to delete this reply!"}), 403

            ids_to_delete = _collect_subtree_ids(reply_id)
            for rid in ids_to_delete:
                c.execute(f"DELETE FROM {grr_t} WHERE group_reply_id = {ph}", (rid,))
            for rid in reversed(ids_to_delete):
                c.execute(f"DELETE FROM {gr_t} WHERE id = {ph}", (rid,))
            conn.commit()
            return jsonify({"success": True})
    except Exception as e:
        logger.error("api_group_replies_delete error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": "Server error"}), 500
