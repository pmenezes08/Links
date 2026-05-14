"""Build JSON payloads for exclusive group feeds (group_posts)."""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.services.community import is_app_admin, is_community_admin, is_community_owner
from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.group_feed_access import check_group_feed_access
from backend.services.group_polls_data import ensure_group_poll_tables, load_polls_for_group_posts
from backend.services.group_post_views import batch_group_post_view_counts_excluding_admin

logger = logging.getLogger(__name__)


def build_group_feed_response(username: str, group_id: int) -> tuple[dict[str, Any], int]:
    """Return (json-serializable dict, http_status)."""
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            g_tbl = "`groups`" if USE_MYSQL else "groups"
            c.execute(f"SELECT g.id, g.name, g.community_id, g.created_by FROM {g_tbl} g WHERE g.id = {ph}", (group_id,))
            g = c.fetchone()
            if not g:
                return {"success": False, "error": "Group not found"}, 404
            community_id = g["community_id"] if hasattr(g, "keys") else g[2]
            group_name = g["name"] if hasattr(g, "keys") else g[1]
            group_owner = g["created_by"] if hasattr(g, "keys") else (g[3] if len(g) > 3 else None)

            c.execute("SELECT name, type FROM communities WHERE id = ?", (community_id,))
            cm = c.fetchone() or {}
            community_name = cm["name"] if hasattr(cm, "keys") else (cm[0] if cm else None)
            community_type = cm["type"] if hasattr(cm, "keys") else (cm[1] if cm else None)

            ok, err = check_group_feed_access(c, ph, username, group_id)
            if not ok:
                code = 404 if (err or "").lower().find("not found") >= 0 else 403
                return {"success": False, "error": err or "Forbidden"}, code

            is_manager = (
                is_app_admin(username)
                or is_community_owner(username, community_id)
                or is_community_admin(username, community_id)
                or (group_owner is not None and username == group_owner)
            )

            gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
            # Optional columns (video, link_urls, etc.)
            for alter in (
                f"ALTER TABLE {gp_t} ADD COLUMN video_path TEXT",
                f"ALTER TABLE {gp_t} ADD COLUMN media_paths TEXT",
                f"ALTER TABLE {gp_t} ADD COLUMN link_urls TEXT",
            ):
                try:
                    c.execute(alter)
                except Exception:
                    pass

            c.execute(
                f"""
                SELECT gp.id, gp.username, gp.content, gp.image_path, gp.created_at,
                       up.profile_picture, gp.video_path, gp.media_paths, gp.link_urls
                FROM {gp_t} gp
                LEFT JOIN user_profiles up ON up.username = gp.username
                WHERE gp.group_id = {ph}
                ORDER BY gp.id DESC
                LIMIT 50
                """,
                (group_id,),
            )
            rows = c.fetchall() or []
            post_ids: list[int] = []
            for r in rows:
                pid = r["id"] if hasattr(r, "keys") else r[0]
                post_ids.append(pid)

            user_starred: set[int] = set()
            comm_starred: set[int] = set()
            if post_ids:
                placeholders = ",".join([ph] * len(post_ids))
                gck = "`group_community_key_posts`" if USE_MYSQL else "group_community_key_posts"
                guk = "`group_user_key_posts`" if USE_MYSQL else "group_user_key_posts"
                try:
                    c.execute(
                        f"SELECT group_post_id FROM {guk} WHERE group_id = {ph} AND username = {ph} "
                        f"AND group_post_id IN ({placeholders})",
                        (group_id, username) + tuple(post_ids),
                    )
                    for r in c.fetchall() or []:
                        pid = r["group_post_id"] if hasattr(r, "keys") else r[0]
                        if pid is not None:
                            user_starred.add(int(pid))
                    c.execute(
                        f"SELECT group_post_id FROM {gck} WHERE group_id = {ph} "
                        f"AND group_post_id IN ({placeholders})",
                        (group_id,) + tuple(post_ids),
                    )
                    for r in c.fetchall() or []:
                        pid = r["group_post_id"] if hasattr(r, "keys") else r[0]
                        if pid is not None:
                            comm_starred.add(int(pid))
                except Exception as ex:
                    logger.warning("group feed key post batch: %s", ex)

            ensure_group_poll_tables(c)
            if not USE_MYSQL:
                conn.commit()
            try:
                poll_map = load_polls_for_group_posts(c, ph, username, post_ids) if post_ids else {}
            except Exception as e:
                err_s = str(e).lower()
                if "1146" in str(e) or "doesn't exist" in err_s:
                    logger.error(
                        "group_feed_detail: poll tables missing or unreadable; continuing without polls: %s",
                        e,
                    )
                else:
                    logger.exception("group_feed_detail: load_polls_for_group_posts failed")
                poll_map = {}
            gr_t = "`group_replies`" if USE_MYSQL else "group_replies"
            gpr_t = "`group_post_reactions`" if USE_MYSQL else "group_post_reactions"
            grr_t = "`group_reply_reactions`" if USE_MYSQL else "group_reply_reactions"

            reply_count_map: dict[int, int] = {int(p): 0 for p in post_ids}
            if post_ids:
                placeholders = ",".join([ph] * len(post_ids))
                try:
                    c.execute(
                        f"""
                        SELECT group_post_id, COUNT(*) as cnt FROM {gr_t}
                        WHERE group_post_id IN ({placeholders})
                        GROUP BY group_post_id
                        """,
                        tuple(post_ids),
                    )
                    for row in c.fetchall() or []:
                        gpid = row["group_post_id"] if hasattr(row, "keys") else row[0]
                        cnt = row["cnt"] if hasattr(row, "keys") else row[1]
                        if gpid is not None:
                            reply_count_map[int(gpid)] = int(cnt or 0)
                except Exception as ex:
                    logger.warning("group feed reply_count batch: %s", ex)

            view_count_map = batch_group_post_view_counts_excluding_admin(c, ph, post_ids)

            posts: list[dict[str, Any]] = []
            for r in rows:
                pid = r["id"] if hasattr(r, "keys") else r[0]
                uname = r["username"] if hasattr(r, "keys") else r[1]
                content = r["content"] if hasattr(r, "keys") else r[2]
                image_path = r["image_path"] if hasattr(r, "keys") else r[3]
                created_at = r["created_at"] if hasattr(r, "keys") else r[4]
                profile_picture = r["profile_picture"] if hasattr(r, "keys") else r[5]
                video_path = r["video_path"] if hasattr(r, "keys") else (r[6] if len(r) > 6 else None)
                link_urls_raw = r["link_urls"] if hasattr(r, "keys") else (r[8] if len(r) > 8 else None)

                link_urls_out = None
                if link_urls_raw:
                    try:
                        link_urls_out = json.loads(link_urls_raw) if isinstance(link_urls_raw, str) else link_urls_raw
                    except Exception:
                        link_urls_out = None

                c.execute(
                    f"SELECT reaction, COUNT(*) as c FROM {gpr_t} WHERE group_post_id = {ph} GROUP BY reaction",
                    (pid,),
                )
                rx = c.fetchall() or []
                reactions = {
                    (row["reaction"] if hasattr(row, "keys") else row[0]): (
                        row["c"] if hasattr(row, "keys") else row[1]
                    )
                    for row in rx
                }
                c.execute(
                    f"SELECT reaction FROM {gpr_t} WHERE group_post_id = {ph} AND username = {ph}",
                    (pid, username),
                )
                urr = c.fetchone()
                user_reaction = urr["reaction"] if hasattr(urr, "keys") else (urr[0] if urr else None)

                c.execute(
                    f"""
                    SELECT gr.id, gr.username, gr.content, gr.image_path, gr.created_at,
                           up.profile_picture
                    FROM {gr_t} gr
                    LEFT JOIN user_profiles up ON up.username = gr.username
                    WHERE gr.group_post_id = {ph}
                    ORDER BY gr.id DESC
                    LIMIT 25
                    """,
                    (pid,),
                )
                rep_rows = c.fetchall() or []
                replies = []
                for rr in rep_rows:
                    rid = rr["id"] if hasattr(rr, "keys") else rr[0]
                    c.execute(
                        f"SELECT reaction, COUNT(*) as c FROM {grr_t} WHERE group_reply_id = {ph} GROUP BY reaction",
                        (rid,),
                    )
                    rrx = c.fetchall() or []
                    rreactions = {
                        (row["reaction"] if hasattr(row, "keys") else row[0]): (
                            row["c"] if hasattr(row, "keys") else row[1]
                        )
                        for row in rrx
                    }
                    c.execute(
                        f"SELECT reaction FROM {grr_t} WHERE group_reply_id = {ph} AND username = {ph}",
                        (rid, username),
                    )
                    rur = c.fetchone()
                    reply_user_reaction = rur["reaction"] if hasattr(rur, "keys") else (rur[0] if rur else None)
                    replies.append(
                        {
                            "id": rid,
                            "username": rr["username"] if hasattr(rr, "keys") else rr[1],
                            "content": rr["content"] if hasattr(rr, "keys") else rr[2],
                            "image_path": rr["image_path"] if hasattr(rr, "keys") else rr[3],
                            "timestamp": rr["created_at"] if hasattr(rr, "keys") else rr[4],
                            "profile_picture": rr["profile_picture"] if hasattr(rr, "keys") else rr[5],
                            "reactions": rreactions,
                            "user_reaction": reply_user_reaction,
                        }
                    )
                can_manage = bool(is_manager or (uname == username))
                can_toggle_community_key = bool(is_app_admin(username))
                if community_id is not None:
                    can_toggle_community_key = can_toggle_community_key or is_community_owner(
                        username, int(community_id)
                    ) or is_community_admin(username, int(community_id))
                if group_owner is not None and username == group_owner:
                    can_toggle_community_key = True

                posts.append(
                    {
                        "id": pid,
                        "username": uname,
                        "content": content,
                        "image_path": image_path,
                        "video_path": video_path,
                        "link_urls": link_urls_out,
                        "timestamp": created_at,
                        "reactions": reactions,
                        "user_reaction": user_reaction,
                        "profile_picture": profile_picture,
                        "replies": replies,
                        "can_edit": can_manage,
                        "can_delete": can_manage,
                        "is_starred": int(pid) in user_starred,
                        "is_community_starred": int(pid) in comm_starred,
                        "can_toggle_community_key": can_toggle_community_key,
                        "poll": poll_map.get(int(pid)),
                        "reply_count": reply_count_map.get(int(pid), 0),
                        "view_count": view_count_map.get(int(pid), 0),
                    }
                )
            return (
                {
                    "success": True,
                    "group": {"id": group_id, "name": group_name},
                    "community": {
                        "id": community_id,
                        "name": community_name,
                        "type": community_type,
                    },
                    "capabilities": {"can_post_announcements": bool(is_manager)},
                    "posts": posts,
                },
                200,
            )
    except Exception as e:
        logger.error("build_group_feed_response error: %s", e, exc_info=True)
        return {"success": False, "error": "Server error"}, 500
