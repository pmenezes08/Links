"""Shared post enrichment for community group and dashboard unread feeds."""

from __future__ import annotations

from typing import Any, Dict, List


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
    poll_map: Dict[int, Dict[str, Any]] = {}
    if post_ids:
        c.execute(
            f"""
            SELECT * FROM polls
            WHERE post_id IN ({post_placeholders}) AND is_active = 1
        """,
            tuple(post_ids),
        )
        poll_rows = c.fetchall()
        poll_ids = []
        poll_post_map: Dict[int, int] = {}
        for pr in poll_rows:
            poll_id = pr["id"] if hasattr(pr, "keys") else pr[0]
            post_id = pr["post_id"] if hasattr(pr, "keys") else pr[1]
            poll_ids.append(poll_id)
            poll_post_map[poll_id] = post_id
            poll_map[post_id] = (
                dict(pr)
                if hasattr(pr, "keys")
                else {
                    "id": poll_id,
                    "post_id": post_id,
                    "question": pr[2] if len(pr) > 2 else "",
                    "is_active": pr[3] if len(pr) > 3 else 1,
                    "single_vote": pr[4] if len(pr) > 4 else 1,
                    "expires_at": pr[5] if len(pr) > 5 else None,
                }
            )
            poll_map[post_id]["options"] = []
        if poll_ids:
            poll_ph = ",".join([ph for _ in poll_ids])
            c.execute(
                f"""
                SELECT * FROM poll_options
                WHERE poll_id IN ({poll_ph})
                ORDER BY poll_id, id
            """,
                tuple(poll_ids),
            )
            option_rows = c.fetchall()
            option_ids = []
            option_poll_map: Dict[int, int] = {}
            for opt in option_rows:
                opt_id = opt["id"] if hasattr(opt, "keys") else opt[0]
                poll_id = opt["poll_id"] if hasattr(opt, "keys") else opt[1]
                option_ids.append(opt_id)
                option_poll_map[opt_id] = poll_id
                post_id = poll_post_map.get(poll_id)
                if post_id and post_id in poll_map:
                    opt_dict = (
                        dict(opt)
                        if hasattr(opt, "keys")
                        else {
                            "id": opt_id,
                            "poll_id": poll_id,
                            "option_text": opt[2] if len(opt) > 2 else "",
                        }
                    )
                    opt_dict["text"] = opt_dict.get("option_text", "")
                    opt_dict["votes"] = 0
                    opt_dict["user_voted"] = False
                    poll_map[post_id]["options"].append(opt_dict)
            if option_ids:
                opt_placeholders = ",".join([ph for _ in option_ids])
                c.execute(
                    f"""
                    SELECT option_id, COUNT(*) as count
                    FROM poll_votes
                    WHERE option_id IN ({opt_placeholders})
                    GROUP BY option_id
                """,
                    tuple(option_ids),
                )
                for vc in c.fetchall():
                    opt_id = vc["option_id"] if hasattr(vc, "keys") else vc[0]
                    cnt = vc["count"] if hasattr(vc, "keys") else vc[1]
                    poll_id = option_poll_map.get(opt_id)
                    post_id = poll_post_map.get(poll_id) if poll_id else None
                    if post_id and post_id in poll_map:
                        for o in poll_map[post_id]["options"]:
                            if o["id"] == opt_id:
                                o["votes"] = cnt
                                break
                c.execute(
                    f"""
                    SELECT option_id
                    FROM poll_votes
                    WHERE option_id IN ({opt_placeholders}) AND username = {ph}
                """,
                    tuple(option_ids) + (username,),
                )
                user_voted_options = set()
                for uv in c.fetchall():
                    opt_id = uv["option_id"] if hasattr(uv, "keys") else uv[0]
                    user_voted_options.add(opt_id)
                for post_id, poll in poll_map.items():
                    total = 0
                    user_vote = None
                    for o in poll.get("options", []):
                        total += o.get("votes", 0)
                        if o["id"] in user_voted_options:
                            o["user_voted"] = True
                            user_vote = o["id"]
                    poll["total_votes"] = total
                    poll["user_vote"] = user_vote
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
                "poll": poll_map.get(pid),
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
                "poll": poll_map.get(pid),
            }
        posts.append(post_obj)
    return posts
