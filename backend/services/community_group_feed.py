"""Shared post enrichment for community group and dashboard unread feeds."""

from __future__ import annotations

from typing import Any, Dict, List

from backend.services.poll_hydration import attach_polls_to_posts


def build_group_feed_post_dicts(
    c: Any, rows: List[Any], username: str | None, ph: str, name_map: Dict[int, Any]
) -> List[Dict[str, Any]]:
    """Batch-enrich raw post rows for community group / dashboard unread feeds."""
    if not rows:
        return []
    post_ids = []
    post_usernames = set()
    for row in rows:
        pid = row["id"] if hasattr(row, "keys") else row[0]
        uname = row["username"] if hasattr(row, "keys") else row[1]
        post_ids.append(pid)
        if uname:
            post_usernames.add(uname)
    post_placeholders = ",".join([ph for _ in post_ids])
    reaction_map: Dict[int, Dict[str, int]] = {}
    user_reaction_map: Dict[int, str] = {}
    if post_ids:
        c.execute(
            f"""
            SELECT post_id, reaction_type, COUNT(*) as count
            FROM reactions
            WHERE post_id IN ({post_placeholders})
            GROUP BY post_id, reaction_type
        """,
            tuple(post_ids),
        )
        for r in c.fetchall():
            pid = r["post_id"] if hasattr(r, "keys") else r[0]
            rtype = r["reaction_type"] if hasattr(r, "keys") else r[1]
            cnt = r["count"] if hasattr(r, "keys") else r[2]
            if pid not in reaction_map:
                reaction_map[pid] = {}
            reaction_map[pid][rtype] = cnt
        c.execute(
            f"""
            SELECT post_id, reaction_type
            FROM reactions
            WHERE post_id IN ({post_placeholders}) AND username = {ph}
        """,
            tuple(post_ids) + (username,),
        )
        for r in c.fetchall():
            pid = r["post_id"] if hasattr(r, "keys") else r[0]
            rtype = r["reaction_type"] if hasattr(r, "keys") else r[1]
            user_reaction_map[pid] = rtype
    reply_count_map: Dict[int, int] = {}
    if post_ids:
        c.execute(
            f"""
            SELECT post_id, COUNT(*) as cnt
            FROM replies
            WHERE post_id IN ({post_placeholders})
            GROUP BY post_id
        """,
            tuple(post_ids),
        )
        for r in c.fetchall():
            pid = r["post_id"] if hasattr(r, "keys") else r[0]
            cnt = r["cnt"] if hasattr(r, "keys") else r[1]
            reply_count_map[pid] = cnt
    pp_map: Dict[str, Any] = {}
    if post_usernames:
        user_placeholders = ",".join([ph for _ in post_usernames])
        c.execute(
            f"""
            SELECT username, profile_picture
            FROM user_profiles
            WHERE username IN ({user_placeholders})
        """,
            tuple(post_usernames),
        )
        for r in c.fetchall():
            uname = r["username"] if hasattr(r, "keys") else r[0]
            pp = r["profile_picture"] if hasattr(r, "keys") else r[1]
            pp_map[uname] = pp
    posts: List[Dict[str, Any]] = []
    for row in rows:
        if hasattr(row, "keys"):
            pid = row["id"]
            uname = row.get("username")
            cid = row.get("community_id")
            post_obj = {
                "id": pid,
                "username": uname,
                "content": row.get("content"),
                "community_id": cid,
                "community_name": name_map.get(cid),
                "timestamp": row.get("timestamp"),
                "image_path": row.get("image_path"),
                "video_path": row.get("video_path"),
                "audio_path": row.get("audio_path"),
                "audio_summary": row.get("audio_summary"),
                "profile_picture": pp_map.get(uname),
                "reactions": reaction_map.get(pid, {}),
                "user_reaction": user_reaction_map.get(pid),
                "replies_count": reply_count_map.get(pid, 0),
                "poll": None,
            }
        else:
            (
                pid,
                uname,
                content,
                cid,
                timestamp,
                image_path,
                video_path,
                audio_path,
                audio_summary,
            ) = row[:9]
            post_obj = {
                "id": pid,
                "username": uname,
                "content": content,
                "community_id": cid,
                "community_name": name_map.get(cid),
                "timestamp": timestamp,
                "image_path": image_path,
                "video_path": video_path,
                "audio_path": audio_path,
                "audio_summary": audio_summary,
                "profile_picture": pp_map.get(uname),
                "reactions": reaction_map.get(pid, {}),
                "user_reaction": user_reaction_map.get(pid),
                "replies_count": reply_count_map.get(pid, 0),
                "poll": None,
            }
        posts.append(post_obj)
    attach_polls_to_posts(
        c,
        ph,
        username,
        posts,
        include_inactive=True,
        include_expired=True,
    )
    return posts
