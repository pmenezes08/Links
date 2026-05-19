"""In-app + push fan-out for exclusive group feed (group_posts / group_replies)."""

from __future__ import annotations

import logging
from typing import Optional

from backend.services import notification_copy
from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.notifications import (
    create_notification,
    send_push_to_user,
    truncate_notification_preview,
)

logger = logging.getLogger(__name__)

GROUPS_T = "`groups`" if USE_MYSQL else "groups"
GROUP_MEMBERS_T = "`group_members`" if USE_MYSQL else "group_members"
GROUP_POSTS_T = "`group_posts`" if USE_MYSQL else "group_posts"
GROUP_REPLIES_T = "`group_replies`" if USE_MYSQL else "group_replies"
GPR_T = "`group_post_reactions`" if USE_MYSQL else "group_post_reactions"
GRR_T = "`group_reply_reactions`" if USE_MYSQL else "group_reply_reactions"


def fanout_group_post_notifications(
    *,
    group_id: int,
    group_post_id: int,
    author_username: str,
    content: str,
    community_id: Optional[int],
    group_name: Optional[str] = None,
) -> None:
    """Notify all active group members (except author): bell + push. Respect community mute."""
    if not group_id or not group_post_id or not author_username:
        return

    preview = truncate_notification_preview(content or "")
    post_link = f"/post/{group_post_id}"
    ph = get_sql_placeholder()

    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT DISTINCT u.username
            FROM users u
            INNER JOIN {GROUP_MEMBERS_T} gm ON gm.username = u.username
            WHERE gm.group_id = {ph} AND gm.status = 'member' AND u.username <> {ph}
            """,
            (group_id, author_username),
        )
        recipients = [
            row["username"] if hasattr(row, "keys") else row[0]
            for row in (c.fetchall() or [])
            if (row["username"] if hasattr(row, "keys") else row[0])
        ]

        resolved_name = (group_name or "").strip()
        if not resolved_name:
            try:
                c.execute(
                    f"SELECT name FROM {GROUPS_T} WHERE id = {ph} LIMIT 1",
                    (group_id,),
                )
                gr = c.fetchone()
                if gr:
                    resolved_name = (gr["name"] if hasattr(gr, "keys") else gr[0]) or ""
            except Exception as e:
                logger.warning("group post notify name lookup failed gid=%s: %s", group_id, e)

        cid = int(community_id) if community_id is not None else None

        # Notification copy is resolved per-recipient so each member sees
        # the message in their own saved locale (Account Settings choice)
        # rather than the sender's session locale.
        push_event = "group_feed_post" if resolved_name else "group_feed_post_no_community"
        message_event = push_event
        push_preview = preview or truncate_notification_preview(content or "", 100)

        for member in recipients:
            if cid is not None:
                try:
                    c.execute(
                        f"SELECT 1 FROM user_muted_communities WHERE username={ph} AND community_id={ph}",
                        (member, cid),
                    )
                    if c.fetchone():
                        continue
                except Exception as mute_e:
                    logger.warning(
                        "muted community lookup failed %s comm=%s: %s",
                        member,
                        cid,
                        mute_e,
                    )

            member_locale = notification_copy.recipient_locale(member)
            line = notification_copy.in_app_text(
                message_event,
                member_locale,
                author=author_username,
                community=resolved_name or "",
            )
            push = notification_copy.push_payload(
                push_event,
                member_locale,
                author=author_username,
                preview=push_preview,
                community=resolved_name or "",
            )

            try:
                create_notification(
                    member,
                    author_username,
                    "group_feed_post",
                    post_id=group_post_id,
                    community_id=cid,
                    message=line,
                    link=post_link,
                    preview_text=preview or None,
                )
            except Exception as ne:
                logger.warning("group post notify db error to %s: %s", member, ne)

            try:
                send_push_to_user(
                    member,
                    {
                        "title": push["title"],
                        "body": push["body"],
                        "url": post_link,
                        "tag": f"group-feed-post-{group_id}-{group_post_id}",
                    },
                )
            except Exception as pe:
                logger.warning("group post push error to %s: %s", member, pe)


def _group_parent_snippet(c, group_post_id: int, parent_reply_id: Optional[int]) -> str:
    ph = get_sql_placeholder()
    try:
        if parent_reply_id:
            try:
                c.execute(
                    f"SELECT content, image_path, audio_path, video_path FROM {GROUP_REPLIES_T} WHERE id = {ph}",
                    (int(parent_reply_id),),
                )
            except Exception:
                c.execute(
                    f"SELECT content, image_path, audio_path FROM {GROUP_REPLIES_T} WHERE id = {ph}",
                    (int(parent_reply_id),),
                )
        else:
            try:
                c.execute(
                    f"SELECT content, image_path, audio_path, video_path FROM {GROUP_POSTS_T} WHERE id = {ph}",
                    (group_post_id,),
                )
            except Exception:
                c.execute(
                    f"SELECT content, image_path, audio_path FROM {GROUP_POSTS_T} WHERE id = {ph}",
                    (group_post_id,),
                )
        row = c.fetchone()
        if not row:
            return ""
        if hasattr(row, "keys"):
            text = (row.get("content") or "").strip()
            if text:
                return truncate_notification_preview(text)
            if row.get("video_path"):
                return "Video"
            if row.get("image_path"):
                return "Photo"
            if row.get("audio_path"):
                return "Voice message"
            return ""
        content = (row[0] or "").strip() if len(row) > 0 else ""
        if content:
            return truncate_notification_preview(content)
        if len(row) > 3 and row[3]:
            return "Video"
        if len(row) > 1 and row[1]:
            return "Photo"
        if len(row) > 2 and row[2]:
            return "Voice message"
        return ""
    except Exception:
        return ""


def notify_group_post_reply_recipients(
    *,
    group_post_id: int,
    group_id: int,
    from_user: str,
    community_id: Optional[int],
    parent_reply_id: Optional[int],
    reply_id: Optional[int],
    reply_content: Optional[str],
) -> None:
    """Bell + push for group reply: post author, parent author, prior repliers/reactors (excluding sender)."""
    if not group_post_id or not from_user:
        return

    cid = int(community_id) if community_id is not None else None
    ph = get_sql_placeholder()

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            engaged: set[str] = set()

            c.execute(
                f"SELECT username FROM {GROUP_POSTS_T} WHERE id = {ph}",
                (group_post_id,),
            )
            prow = c.fetchone()
            post_owner = (prow["username"] if hasattr(prow, "keys") else prow[0]) if prow else None
            if post_owner:
                engaged.add(post_owner)

            parent_author = None
            if parent_reply_id:
                c.execute(
                    f"SELECT username FROM {GROUP_REPLIES_T} WHERE id = {ph}",
                    (int(parent_reply_id),),
                )
                par = c.fetchone()
                parent_author = (par["username"] if hasattr(par, "keys") else par[0]) if par else None
                if parent_author:
                    engaged.add(parent_author)

            try:
                c.execute(
                    f"SELECT DISTINCT username FROM {GROUP_REPLIES_T} WHERE group_post_id = {ph}",
                    (group_post_id,),
                )
                for rr in c.fetchall() or []:
                    u = rr["username"] if hasattr(rr, "keys") else rr[0]
                    if u:
                        engaged.add(u)
            except Exception as e:
                logger.warning("group reply notify: prior repliers: %s", e)

            try:
                c.execute(
                    f"SELECT DISTINCT username FROM {GPR_T} WHERE group_post_id = {ph}",
                    (group_post_id,),
                )
                for rv in c.fetchall() or []:
                    u = rv["username"] if hasattr(rv, "keys") else rv[0]
                    if u:
                        engaged.add(u)
            except Exception as e:
                logger.warning("group reply notify: post reactors: %s", e)

            try:
                c.execute(
                    f"""
                    SELECT DISTINCT grr.username FROM {GRR_T} grr
                    INNER JOIN {GROUP_REPLIES_T} gr ON gr.id = grr.group_reply_id
                    WHERE gr.group_post_id = {ph}
                    """,
                    (group_post_id,),
                )
                for rr in c.fetchall() or []:
                    u = rr["username"] if hasattr(rr, "keys") else rr[0]
                    if u:
                        engaged.add(u)
            except Exception as e:
                logger.warning("group reply notify: reply reactors: %s", e)

            recipients = {u for u in engaged if u and u != from_user}

            parent_preview_snip = _group_parent_snippet(c, group_post_id, parent_reply_id)

            new_reply_snip = truncate_notification_preview(reply_content or "")
            if not new_reply_snip.strip():
                new_reply_snip = "(media)"
            safe_inner = new_reply_snip.replace('"', "'")
            notif_message = f'{from_user} replied "{safe_inner}"'

            post_link = f"/post/{group_post_id}"
            if reply_id:
                notif_link = f"/group_reply/{reply_id}"
            else:
                notif_link = post_link

            for target in recipients:
                if cid is not None:
                    try:
                        c.execute(
                            f"SELECT 1 FROM user_muted_communities WHERE username={ph} AND community_id={ph}",
                            (target, cid),
                        )
                        if c.fetchone():
                            continue
                    except Exception as mute_e:
                        logger.warning(
                            "group reply mute lookup failed %s: %s",
                            target,
                            mute_e,
                        )

                try:
                    if USE_MYSQL:
                        c.execute(
                            f"""
                            SELECT id FROM notifications
                            WHERE user_id={ph} AND from_user={ph} AND type='group_feed_reply' AND post_id={ph}
                              AND created_at > DATE_SUB(NOW(), INTERVAL 10 SECOND)
                            LIMIT 1
                            """,
                            (target, from_user, group_post_id),
                        )
                    else:
                        c.execute(
                            f"""
                            SELECT id FROM notifications
                            WHERE user_id={ph} AND from_user={ph} AND type='group_feed_reply' AND post_id={ph}
                              AND datetime(created_at) > datetime('now','-10 seconds')
                            LIMIT 1
                            """,
                            (target, from_user, group_post_id),
                        )
                    exists = c.fetchone()
                    if exists:
                        continue
                except Exception as dedupe_e:
                    logger.warning("group reply notify dedupe failed: %s", dedupe_e)

                try:
                    create_notification(
                        target,
                        from_user,
                        "group_feed_reply",
                        post_id=group_post_id,
                        community_id=cid,
                        message=notif_message,
                        link=notif_link,
                        preview_text=parent_preview_snip or None,
                    )
                except Exception as ne:
                    logger.warning("group reply notify db error to %s: %s", target, ne)

                try:
                    if new_reply_snip != "(media)":
                        push_body = new_reply_snip
                    else:
                        push_body = parent_preview_snip or "Tap to view the conversation"
                    send_push_to_user(
                        target,
                        {
                            "title": f"New reply from {from_user}",
                            "body": push_body,
                            "url": notif_link,
                            "tag": f"group-{group_id}-post-reply-{group_post_id}-{target}",
                        },
                    )
                except Exception as pe:
                    logger.warning("group reply push error to %s: %s", target, pe)

            logger.info(
                "[Group reply notify] post=%s notified=%s targets=%s",
                group_post_id,
                len(recipients),
                list(recipients),
            )
    except Exception as e:
        logger.error("notify_group_post_reply_recipients error: %s", e)
