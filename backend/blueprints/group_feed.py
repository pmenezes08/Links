"""HTTP surface for exclusive group feeds (not group chat)."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from functools import wraps

from flask import Blueprint, jsonify, request, session

from backend.services import auth_session, session_identity
from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.group_feed_access import (
    check_group_feed_access,
)
from backend.services.community import is_app_admin, is_community_admin, is_community_owner

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
            return jsonify({"success": True, "starred": not existing})
    except Exception as e:
        logger.error("toggle_group_key_post error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": "server error"}), 500


@group_feed_bp.route("/api/toggle_group_community_key_post", methods=["POST"])
@_login_required
def api_toggle_group_community_key_post():
    username = session.get("username")
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
            return jsonify({"success": True, "starred": not existing})
    except Exception as e:
        logger.error("toggle_group_community_key_post error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": "server error"}), 500


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
