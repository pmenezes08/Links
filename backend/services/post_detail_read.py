"""Post-detail read service: community and group post detail assembly.

This is the single read path used by ``/get_post`` and ``/api/group_post``.
The monolith routes are thin wrappers; everything below — Firestore dual-read,
MySQL hydration, reply tree, reactions, view counts, viewer-specific flags
(``user_reaction``, ``is_starred``, ``is_community_starred``,
``is_community_admin``) — lives here so PR 4 can wrap a single function with
viewer-scoped Redis caching and PR 5 can build a unified client API on top.

Returns ``(response_body: dict, http_status: int)`` — never a Flask Response,
so the same callable is reusable from background workers and tests.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Tuple

from backend.services.poll_hydration import attach_group_polls_to_posts, attach_polls_to_posts
from backend.services.profile_pictures import fetch_profile_picture_map

logger = logging.getLogger(__name__)


def _community_admin_helpers():
    """Lazy import of monolith authorization helpers to avoid circular imports."""
    import bodybuilding_app as _ba

    return _ba.is_app_admin, _ba.is_community_owner, _ba.is_community_admin


def read_community_post_detail(post_id: int, username: str) -> Tuple[Dict[str, Any], int]:
    """Read a community/general post detail (matches the legacy ``/get_post`` body).

    Tries Firestore + MySQL hydration first (when ``USE_FIRESTORE_READS`` is on),
    falls back to a full MySQL read.
    """
    if not post_id:
        return {"success": False, "error": "Post ID is required"}, 400

    import bodybuilding_app as _ba  # lazy import; runtime resolves to loaded module

    get_db_connection = _ba.get_db_connection
    get_sql_placeholder = _ba.get_sql_placeholder
    is_app_admin, is_community_owner, is_community_admin = _community_admin_helpers()
    ensure_reply_views_table = _ba.ensure_reply_views_table
    _count_reply_views_excluding_admin = _ba._count_reply_views_excluding_admin
    get_post_reaction_summary = _ba.get_post_reaction_summary
    get_reply_reaction_summary = _ba.get_reply_reaction_summary

    try:
        from backend.services.firestore_reads import USE_FIRESTORE_READS

        if USE_FIRESTORE_READS:
            from backend.services.firestore_reads import get_post_detail as fs_get_post

            fs_post = fs_get_post(post_id, username)
            if fs_post:
                # SECURITY (privacy IDOR): apply the same membership gate as the
                # MySQL branch below before hydrating/returning the Firestore
                # body. The community is derived from the post; general / home-
                # feed posts (no community) stay public; non-members get a
                # non-enumerating 404 so post visibility cannot be probed by id.
                from backend.services.community_access import can_view_community_content

                _fs_comm = fs_post.get("community_id") if isinstance(fs_post, dict) else None
                if _fs_comm:
                    with get_db_connection() as _gconn:
                        _gallowed, _ = can_view_community_content(
                            _gconn.cursor(), get_sql_placeholder(), username, _fs_comm
                        )
                    if not _gallowed:
                        return {"success": False, "error": "Post not found"}, 404
                _hydrate_fs_post_with_mysql(
                    fs_post=fs_post,
                    post_id=post_id,
                    username=username,
                    get_db_connection=get_db_connection,
                    get_sql_placeholder=get_sql_placeholder,
                    is_app_admin=is_app_admin,
                    is_community_owner=is_community_owner,
                    is_community_admin=is_community_admin,
                    ensure_reply_views_table=ensure_reply_views_table,
                )
                logger.info("Firestore+MySQL hybrid post read: post %s", post_id)
                return {"success": True, "post": fs_post}, 200
    except Exception as fs_err:
        logger.warning("Firestore post read failed, falling back to MySQL: %s", fs_err)

    try:
        with get_db_connection() as conn:
            c = conn.cursor()

            c.execute("SELECT * FROM posts WHERE id = ?", (post_id,))
            post_raw = c.fetchone()
            if not post_raw:
                return {"success": False, "error": "Post not found"}, 404

            post: Dict[str, Any] = dict(post_raw)
            try:
                lu = post.get("link_urls")
                if isinstance(lu, str) and lu.strip():
                    post["link_urls"] = json.loads(lu)
            except Exception:
                pass

            allow_nsfw_imagine = False
            community_id = post.get("community_id") if isinstance(post, dict) else None

            # SECURITY (privacy IDOR): community-scoped posts are readable only by
            # members (mirrors the community feed's access policy); general /
            # home-feed posts (no community_id) stay public. Non-members get a
            # non-enumerating 404 — identical to a missing post — so post
            # visibility cannot be probed by id.
            from backend.services.community_access import can_view_community_content

            _allowed, _ = can_view_community_content(
                c, get_sql_placeholder(), username, community_id
            )
            if not _allowed:
                return {"success": False, "error": "Post not found"}, 404

            if community_id:
                try:
                    c.execute("SELECT allow_nsfw_imagine FROM communities WHERE id = ?", (community_id,))
                    allow_row = c.fetchone()
                    if allow_row is not None:
                        allow_nsfw_imagine = bool(
                            allow_row["allow_nsfw_imagine"] if hasattr(allow_row, "keys") else allow_row[0]
                        )
                except Exception as allow_err:
                    logger.warning(
                        "Failed to fetch allow_nsfw_imagine for community %s: %s", community_id, allow_err
                    )
            post["allow_nsfw_imagine"] = allow_nsfw_imagine

            try:
                c.execute("SELECT profile_picture FROM user_profiles WHERE username = ?", (post["username"],))
                pp = c.fetchone()
                post["profile_picture"] = (
                    pp["profile_picture"] if pp and "profile_picture" in pp.keys() else None
                )
            except Exception:
                post["profile_picture"] = None

            c.execute("SELECT * FROM replies WHERE post_id = ? ORDER BY timestamp DESC", (post_id,))
            replies_raw = [dict(row) for row in c.fetchall()]
            children_map: Dict[Any, list] = {}
            for r in replies_raw:
                children_map.setdefault(r.get("parent_reply_id"), []).append(r)

            def build_tree(parent_id=None):
                arr = []
                for r in children_map.get(parent_id, []):
                    r["children"] = build_tree(r["id"])
                    arr.append(r)
                return arr

            post["replies"] = build_tree(None)

            reaction_counts, user_reaction = get_post_reaction_summary(c, post_id, username)
            post["reactions"] = reaction_counts
            post["user_reaction"] = user_reaction

            def hydrate_reply_metrics(reply):
                try:
                    c.execute("SELECT profile_picture FROM user_profiles WHERE username = ?", (reply["username"],))
                    pr = c.fetchone()
                    reply["profile_picture"] = (
                        pr["profile_picture"] if pr and "profile_picture" in pr.keys() else None
                    )
                except Exception:
                    reply["profile_picture"] = None
                counts, reply_user_reaction = get_reply_reaction_summary(c, reply["id"], username)
                reply["reactions"] = counts
                reply["user_reaction"] = reply_user_reaction
                try:
                    ensure_reply_views_table(c)
                    reply["view_count"] = _count_reply_views_excluding_admin(c, reply["id"])
                except Exception:
                    reply["view_count"] = 0
                try:
                    c.execute("SELECT COUNT(*) as cnt FROM replies WHERE parent_reply_id = ?", (reply["id"],))
                    cnt_row = c.fetchone()
                    reply["reply_count"] = (
                        cnt_row["cnt"] if cnt_row and hasattr(cnt_row, "keys") else (cnt_row[0] if cnt_row else 0)
                    )
                except Exception:
                    reply["reply_count"] = len(reply.get("children", []))
                for ch in reply.get("children", []):
                    hydrate_reply_metrics(ch)

            for reply in post["replies"]:
                hydrate_reply_metrics(reply)

            c.execute(
                """
                SELECT ij.result_path, ij.created_by, ij.created_at, ij.style
                FROM imagine_jobs ij
                WHERE ij.target_type = 'post'
                  AND ij.target_id = ?
                  AND ij.status = 'completed'
                  AND ij.result_path IS NOT NULL
                ORDER BY ij.created_at ASC
                """,
                (post_id,),
            )
            ai_videos_raw = c.fetchall()
            post["ai_videos"] = [
                {
                    "video_path": row["result_path"],
                    "generated_by": row["created_by"],
                    "created_at": row["created_at"],
                    "style": row["style"],
                }
                for row in ai_videos_raw
            ]

            try:
                c.execute("SELECT COUNT(*) as cnt FROM post_views WHERE post_id = ?", (post_id,))
                view_row = c.fetchone()
                post["view_count"] = (
                    view_row["cnt"] if view_row and hasattr(view_row, "keys") else (view_row[0] if view_row else 0)
                )
            except Exception as view_err:
                logger.warning("Failed to get view count for post %s: %s", post_id, view_err)
                post["view_count"] = 0

            post_community_id = post.get("community_id")
            post["is_community_admin"] = bool(
                post_community_id
                and (
                    is_app_admin(username)
                    or is_community_owner(username, post_community_id)
                    or is_community_admin(username, post_community_id)
                )
            )
            post["is_starred"] = False
            post["is_community_starred"] = False
            if post_community_id:
                try:
                    c.execute(
                        "SELECT id FROM key_posts WHERE username = ? AND post_id = ?",
                        (username, post_id),
                    )
                    post["is_starred"] = c.fetchone() is not None
                except Exception:
                    pass
                try:
                    c.execute(
                        "SELECT id FROM community_key_posts WHERE community_id = ? AND post_id = ?",
                        (post_community_id, post_id),
                    )
                    post["is_community_starred"] = c.fetchone() is not None
                except Exception:
                    pass

            attach_polls_to_posts(
                c,
                get_sql_placeholder(),
                username,
                [post],
                include_inactive=True,
                include_expired=True,
            )

            return {"success": True, "post": post}, 200
    except Exception as e:
        logger.error("Error fetching post %s: %s", post_id, e)
        return {"success": False, "error": "Server error"}, 500


def _hydrate_fs_post_with_mysql(
    *,
    fs_post: Dict[str, Any],
    post_id: int,
    username: str,
    get_db_connection,
    get_sql_placeholder,
    is_app_admin,
    is_community_owner,
    is_community_admin,
    ensure_reply_views_table,
) -> None:
    """Hydrate a Firestore post payload with MySQL truth.

    Mutates ``fs_post`` in place. Failures are logged and swallowed — the
    caller still serves the Firestore body.
    """
    try:
        with get_db_connection() as hconn:
            hc = hconn.cursor()
            mysql_row = None
            try:
                hc.execute("SELECT content, link_urls, community_id FROM posts WHERE id = ?", (post_id,))
                mysql_row = hc.fetchone()
            except Exception:
                try:
                    hc.execute("SELECT content, community_id FROM posts WHERE id = ?", (post_id,))
                    mysql_row = hc.fetchone()
                except Exception:
                    mysql_row = None

            if mysql_row:
                mysql_content = (
                    mysql_row["content"] if hasattr(mysql_row, "keys") else mysql_row[0]
                )
                if mysql_content:
                    fs_post["content"] = mysql_content
                fs_community_id = None
                lu = None
                try:
                    if hasattr(mysql_row, "keys"):
                        fs_community_id = mysql_row.get("community_id")
                        lu = mysql_row.get("link_urls")
                    elif len(mysql_row) >= 3:
                        lu = mysql_row[1]
                        fs_community_id = mysql_row[2]
                    else:
                        fs_community_id = mysql_row[1]
                    if isinstance(lu, str) and lu.strip():
                        fs_post["link_urls"] = json.loads(lu)
                    elif isinstance(lu, list):
                        fs_post["link_urls"] = lu
                except Exception:
                    fs_community_id = (
                        mysql_row.get("community_id")
                        if hasattr(mysql_row, "keys")
                        else (mysql_row[2] if len(mysql_row) > 2 else mysql_row[1])
                    )
            else:
                fs_community_id = fs_post.get("community_id")

            try:
                hc.execute("SELECT COUNT(*) as cnt FROM post_views WHERE post_id = ?", (post_id,))
                vr = hc.fetchone()
                fs_post["view_count"] = int((vr["cnt"] if hasattr(vr, "keys") else vr[0]) if vr else 0)
            except Exception:
                pass

            fs_post["is_community_admin"] = bool(
                fs_community_id
                and (
                    is_app_admin(username)
                    or is_community_owner(username, fs_community_id)
                    or is_community_admin(username, fs_community_id)
                )
            )
            fs_post["is_starred"] = False
            fs_post["is_community_starred"] = False
            if fs_community_id:
                try:
                    hc.execute(
                        "SELECT id FROM key_posts WHERE username = ? AND post_id = ?",
                        (username, post_id),
                    )
                    fs_post["is_starred"] = hc.fetchone() is not None
                except Exception:
                    pass
                try:
                    hc.execute(
                        "SELECT id FROM community_key_posts WHERE community_id = ? AND post_id = ?",
                        (fs_community_id, post_id),
                    )
                    fs_post["is_community_starred"] = hc.fetchone() is not None
                except Exception:
                    pass

            all_reply_ids = []

            def _collect_reply_ids(replies):
                for r in replies:
                    all_reply_ids.append(r["id"])
                    _collect_reply_ids(r.get("children", []))

            _collect_reply_ids(fs_post.get("replies", []))

            if all_reply_ids:
                ph = get_sql_placeholder()
                phs = ",".join([ph] * len(all_reply_ids))

                valid_reply_ids = set(all_reply_ids)
                try:
                    hc.execute(f"SELECT id FROM replies WHERE id IN ({phs})", tuple(all_reply_ids))
                    valid_reply_ids = {
                        int(row["id"] if hasattr(row, "keys") else row[0])
                        for row in (hc.fetchall() or [])
                    }
                except Exception:
                    valid_reply_ids = set(all_reply_ids)

                if valid_reply_ids != set(all_reply_ids):
                    def _filter_existing_replies(replies):
                        visible = []
                        for reply in replies:
                            rid = int(reply.get("id") or 0)
                            if rid not in valid_reply_ids:
                                continue
                            children = _filter_existing_replies(reply.get("children", []))
                            reply["children"] = children
                            reply["reply_count"] = len(children)
                            visible.append(reply)
                        return visible

                    fs_post["replies"] = _filter_existing_replies(fs_post.get("replies", []))
                    all_reply_ids = [rid for rid in all_reply_ids if rid in valid_reply_ids]
                    if not all_reply_ids:
                        fs_post["replies"] = []
                    phs = ",".join([ph] * len(all_reply_ids)) if all_reply_ids else ""

                reply_vcs: Dict[int, int] = {}
                try:
                    ensure_reply_views_table(hc)
                    params_rv = list(all_reply_ids) + ["admin"]
                    hc.execute(
                        f"SELECT reply_id, COUNT(*) as cnt FROM reply_views WHERE reply_id IN ({phs}) AND LOWER(username) <> LOWER({ph}) GROUP BY reply_id",
                        tuple(params_rv),
                    )
                    for row in hc.fetchall():
                        rid = row["reply_id"] if hasattr(row, "keys") else row[0]
                        cnt = row["cnt"] if hasattr(row, "keys") else row[1]
                        reply_vcs[int(rid)] = int(cnt or 0)
                except Exception:
                    pass

                reply_authors = set()

                def _collect_authors(replies):
                    for r in replies:
                        if r.get("username"):
                            reply_authors.add(r["username"])
                        _collect_authors(r.get("children", []))

                _collect_authors(fs_post.get("replies", []))
                # Case-insensitive map: Firestore reply docs carry the session
                # spelling, which can differ from user_profiles.username.
                pp_map = fetch_profile_picture_map(hc, reply_authors)

                reply_rxs: Dict[int, Dict[str, int]] = {}
                user_reply_rxs: Dict[int, str] = {}
                try:
                    hc.execute(
                        f"SELECT reply_id, reaction_type, COUNT(*) as count FROM reply_reactions WHERE reply_id IN ({phs}) GROUP BY reply_id, reaction_type",
                        tuple(all_reply_ids),
                    )
                    for row in hc.fetchall():
                        rid = row["reply_id"] if hasattr(row, "keys") else row[0]
                        rtype = row["reaction_type"] if hasattr(row, "keys") else row[1]
                        cnt = row["count"] if hasattr(row, "keys") else row[2]
                        reply_rxs.setdefault(int(rid), {})[rtype] = cnt
                except Exception:
                    pass
                try:
                    params_urx = list(all_reply_ids) + [username]
                    hc.execute(
                        f"SELECT reply_id, reaction_type FROM reply_reactions WHERE reply_id IN ({phs}) AND username = {ph}",
                        tuple(params_urx),
                    )
                    for row in hc.fetchall():
                        rid = row["reply_id"] if hasattr(row, "keys") else row[0]
                        rtype = row["reaction_type"] if hasattr(row, "keys") else row[1]
                        user_reply_rxs[int(rid)] = rtype
                except Exception:
                    pass

                reply_media: Dict[int, Dict[str, Any]] = {}
                try:
                    hc.execute(
                        f"SELECT id, image_path, video_path, audio_path, audio_summary FROM replies WHERE id IN ({phs})",
                        tuple(all_reply_ids),
                    )
                    for row in hc.fetchall() or []:
                        if hasattr(row, "keys"):
                            rid = int(row["id"])
                            reply_media[rid] = {
                                "image_path": row.get("image_path"),
                                "video_path": row.get("video_path"),
                                "audio_path": row.get("audio_path"),
                                "audio_summary": row.get("audio_summary"),
                            }
                        else:
                            rid = int(row[0])
                            reply_media[rid] = {
                                "image_path": row[1] if len(row) > 1 else None,
                                "video_path": row[2] if len(row) > 2 else None,
                                "audio_path": row[3] if len(row) > 3 else None,
                                "audio_summary": row[4] if len(row) > 4 else None,
                            }
                except Exception:
                    pass

                def _hydrate(replies):
                    for r in replies:
                        rid = r["id"]
                        r["view_count"] = reply_vcs.get(rid, 0)
                        r["profile_picture"] = pp_map.get(r.get("username"))
                        r["reactions"] = reply_rxs.get(rid, {})
                        r["user_reaction"] = user_reply_rxs.get(rid)
                        media = reply_media.get(int(rid))
                        if media:
                            if media.get("image_path"):
                                r["image_path"] = media["image_path"]
                            if media.get("video_path"):
                                r["video_path"] = media["video_path"]
                            if media.get("audio_path"):
                                r["audio_path"] = media["audio_path"]
                            if media.get("audio_summary") is not None:
                                r["audio_summary"] = media["audio_summary"]
                        _hydrate(r.get("children", []))

                _hydrate(fs_post.get("replies", []))

            try:
                hc.execute("SELECT profile_picture FROM user_profiles WHERE username = ?", (fs_post.get("username", ""),))
                pp = hc.fetchone()
                fs_post["profile_picture"] = pp["profile_picture"] if pp and "profile_picture" in pp.keys() else None
            except Exception:
                pass
            try:
                attach_polls_to_posts(
                    hc,
                    get_sql_placeholder(),
                    username,
                    [fs_post],
                    include_inactive=True,
                    include_expired=True,
                )
            except Exception as poll_err:
                logger.warning("MySQL poll hydration of Firestore post failed: %s", poll_err)
    except Exception as hydrate_err:
        logger.warning("MySQL hydration of Firestore post failed (serving Firestore as-is): %s", hydrate_err)


def read_group_post_detail(post_id: int, username: str) -> Tuple[Dict[str, Any], int]:
    """Read a group post detail (matches the legacy ``/api/group_post`` body)."""
    if not post_id:
        return {"success": False, "error": "Invalid post_id"}, 200

    import bodybuilding_app as _ba

    get_db_connection = _ba.get_db_connection
    get_sql_placeholder = _ba.get_sql_placeholder
    USE_MYSQL = _ba.USE_MYSQL
    is_app_admin, is_community_owner, is_community_admin = _community_admin_helpers()
    check_group_feed_access = _ba.check_group_feed_access
    count_group_post_views_excluding_admin = _ba.count_group_post_views_excluding_admin

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
            g_t = "`groups`" if USE_MYSQL else "groups"

            c.execute(
                f"""
                SELECT gp.id, gp.group_id, gp.username, gp.content, gp.image_path, gp.created_at,
                       g.name as group_name, g.community_id, g.created_by
                FROM {gp_t} gp
                JOIN {g_t} g ON g.id = gp.group_id
                WHERE gp.id = {ph}
                """,
                (post_id,),
            )
            row = c.fetchone()
            if not row:
                return {"success": False, "error": "Post not found"}, 404
            group_id = row["group_id"] if hasattr(row, "keys") else row[1]
            community_id = row["community_id"] if hasattr(row, "keys") else row[7]
            group_owner = row["created_by"] if hasattr(row, "keys") else (row[8] if len(row) > 8 else None)

            ok_access, err_access = check_group_feed_access(c, ph, username, int(group_id))
            if not ok_access:
                code = 404 if (err_access or "").lower().find("not found") >= 0 else 403
                return {"success": False, "error": err_access or "Forbidden"}, code

            pid = row["id"] if hasattr(row, "keys") else row[0]
            uname = row["username"] if hasattr(row, "keys") else row[2]
            content = row["content"] if hasattr(row, "keys") else row[3]
            image_path = row["image_path"] if hasattr(row, "keys") else row[4]
            created_at = row["created_at"] if hasattr(row, "keys") else row[5]
            group_name = row["group_name"] if hasattr(row, "keys") else row[6]

            is_manager = (
                is_app_admin(username)
                or is_community_owner(username, community_id)
                or is_community_admin(username, community_id)
                or (group_owner is not None and username == group_owner)
            )

            gpr_t = "`group_post_reactions`" if USE_MYSQL else "group_post_reactions"
            c.execute(f"SELECT reaction, COUNT(*) as c FROM {gpr_t} WHERE group_post_id = {ph} GROUP BY reaction", (pid,))
            rx = c.fetchall() or []
            reactions = {(r2["reaction"] if hasattr(r2, "keys") else r2[0]): (r2["c"] if hasattr(r2, "keys") else r2[1]) for r2 in rx}
            c.execute(f"SELECT reaction FROM {gpr_t} WHERE group_post_id = {ph} AND username = {ph}", (pid, username))
            urr = c.fetchone()
            user_reaction = urr["reaction"] if hasattr(urr, "keys") else (urr[0] if urr else None)

            gr_table = "`group_replies`" if USE_MYSQL else "group_replies"
            grr_table = "`group_reply_reactions`" if USE_MYSQL else "group_reply_reactions"
            try:
                c.execute(f"ALTER TABLE {gr_table} ADD COLUMN audio_path TEXT")
            except Exception:
                pass
            try:
                c.execute(f"ALTER TABLE {gr_table} ADD COLUMN audio_summary TEXT")
            except Exception:
                pass

            c.execute(
                f"""
                SELECT gr.id, gr.username, gr.content, gr.image_path, gr.created_at,
                       gr.parent_reply_id, up.profile_picture,
                       gr.audio_path, gr.audio_summary
                FROM {gr_table} gr
                LEFT JOIN user_profiles up ON up.username = gr.username
                WHERE gr.group_post_id = {ph}
                ORDER BY gr.id ASC
                """,
                (pid,),
            )
            rep_rows = c.fetchall() or []
            all_replies = []
            for rr in rep_rows:
                if hasattr(rr, "keys"):
                    rid = rr["id"]
                    parent_rid = rr["parent_reply_id"]
                    apath = rr.get("audio_path")
                    asum = rr.get("audio_summary")
                    r_uname = rr["username"]
                    rcontent = rr["content"]
                    rimg = rr["image_path"]
                    rts = rr["created_at"]
                    rpp = rr.get("profile_picture")
                else:
                    rid = rr[0]
                    r_uname = rr[1]
                    rcontent = rr[2]
                    rimg = rr[3]
                    rts = rr[4]
                    parent_rid = rr[5]
                    rpp = rr[6] if len(rr) > 6 else None
                    apath = rr[7] if len(rr) > 7 else None
                    asum = rr[8] if len(rr) > 8 else None
                c.execute(
                    f"SELECT reaction, COUNT(*) as c FROM {grr_table} WHERE group_reply_id = {ph} GROUP BY reaction",
                    (rid,),
                )
                rrx = c.fetchall() or []
                rreactions = {(r3["reaction"] if hasattr(r3, "keys") else r3[0]): (r3["c"] if hasattr(r3, "keys") else r3[1]) for r3 in rrx}
                c.execute(
                    f"SELECT reaction FROM {grr_table} WHERE group_reply_id = {ph} AND username = {ph}",
                    (rid, username),
                )
                rur = c.fetchone()
                reply_user_reaction = rur["reaction"] if hasattr(rur, "keys") else (rur[0] if rur else None)
                c.execute(f"SELECT COUNT(*) as cnt FROM {gr_table} WHERE parent_reply_id = {ph}", (rid,))
                cnt_row = c.fetchone()
                reply_count = (cnt_row["cnt"] if hasattr(cnt_row, "keys") else cnt_row[0]) if cnt_row else 0
                all_replies.append(
                    {
                        "id": rid,
                        "username": r_uname,
                        "content": rcontent,
                        "image_path": rimg,
                        "audio_path": apath,
                        "audio_summary": asum,
                        "timestamp": rts,
                        "parent_reply_id": parent_rid,
                        "profile_picture": rpp,
                        "reactions": rreactions,
                        "user_reaction": reply_user_reaction,
                        "reply_count": reply_count,
                        "children": [],
                    }
                )

            reply_map = {r["id"]: r for r in all_replies}
            root_replies = []
            for r in all_replies:
                parent_id = r.get("parent_reply_id")
                if parent_id and parent_id in reply_map:
                    reply_map[parent_id]["children"].append(r)
                else:
                    root_replies.append(r)
            root_replies.reverse()

            post = {
                "id": pid,
                "username": uname,
                "content": content,
                "image_path": image_path,
                "timestamp": created_at,
                "reactions": reactions,
                "user_reaction": user_reaction,
                "replies": root_replies,
                "can_edit": bool(is_manager or (uname == username)),
                "can_delete": bool(is_manager or (uname == username)),
                "is_group_post": True,
                "group_id": group_id,
                "community_id": community_id,
            }

            can_toggle_community_key = bool(is_app_admin(username))
            if community_id is not None:
                can_toggle_community_key = (
                    can_toggle_community_key
                    or is_community_owner(username, int(community_id))
                    or is_community_admin(username, int(community_id))
                )
            if group_owner is not None and username == group_owner:
                can_toggle_community_key = True
            post["can_toggle_community_key"] = can_toggle_community_key

            post["is_starred"] = False
            post["is_community_starred"] = False
            try:
                gck_tbl = "`group_community_key_posts`" if USE_MYSQL else "group_community_key_posts"
                guk_tbl = "`group_user_key_posts`" if USE_MYSQL else "group_user_key_posts"
                c.execute(
                    f"SELECT id FROM {gck_tbl} WHERE group_id = {ph} AND group_post_id = {ph}",
                    (int(group_id), int(pid)),
                )
                post["is_community_starred"] = c.fetchone() is not None
                c.execute(
                    f"SELECT id FROM {guk_tbl} WHERE username = {ph} AND group_id = {ph} AND group_post_id = {ph}",
                    (username, int(group_id), int(pid)),
                )
                post["is_starred"] = c.fetchone() is not None
            except Exception:
                pass

            allow_nsfw_imagine = False
            if community_id:
                try:
                    c.execute("SELECT allow_nsfw_imagine FROM communities WHERE id = ?", (community_id,))
                    allow_row = c.fetchone()
                    if allow_row is not None:
                        allow_nsfw_imagine = bool(
                            allow_row["allow_nsfw_imagine"] if hasattr(allow_row, "keys") else allow_row[0]
                        )
                except Exception as allow_err:
                    logger.warning("Failed to fetch allow_nsfw_imagine for community %s: %s", community_id, allow_err)
            post["allow_nsfw_imagine"] = allow_nsfw_imagine
            post["reply_count"] = len(all_replies)
            post["view_count"] = count_group_post_views_excluding_admin(c, ph, int(pid))
            try:
                from backend.services.group_polls_data import ensure_group_poll_tables

                ensure_group_poll_tables(c)
                attach_group_polls_to_posts(
                    c,
                    ph,
                    username,
                    [post],
                    include_inactive=True,
                    include_expired=True,
                )
            except Exception as poll_err:
                logger.warning("Group post poll hydration failed for %s: %s", pid, poll_err)

            return (
                {
                    "success": True,
                    "post": post,
                    "group": {"id": group_id, "name": group_name},
                    "community_id": community_id,
                },
                200,
            )
    except Exception as e:
        logger.error("api_group_post error: %s", e)
        return {"success": False, "error": "Server error"}, 200
