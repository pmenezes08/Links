"""Exclusive group-feed Steve agent — schema helpers, schedule, package gate."""

from __future__ import annotations

import logging
import random
import re
from datetime import datetime, timedelta
from typing import Optional, Tuple

from backend.services.database import USE_MYSQL, get_sql_placeholder

logger = logging.getLogger(__name__)

PRESET_CAREER_EXPERT = "career_expert"
CAREER_EXPERT_OUTPUT_CAP = 2000
MIN_ASK_STEVE_CHARS = 80

_STEVE_MENTION_RE = re.compile(r"@steve\b", re.IGNORECASE)


def mentions_steve(text: str | None) -> bool:
    return bool(text and _STEVE_MENTION_RE.search(text))


def sample_first_reply_delay_seconds() -> int:
    """Random delay between 15m and 2h, skewed toward ~30m (triangular)."""
    return int(random.triangular(900, 7200, 1800))


def ensure_group_steve_agent_schema(cursor) -> None:
    """Idempotent columns + schedule table for group Steve agent."""
    g_t = "`groups`" if USE_MYSQL else "groups"
    gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
    for alter in (
        f"ALTER TABLE {g_t} ADD COLUMN steve_agent_enabled TINYINT(1) NOT NULL DEFAULT 0",
        f"ALTER TABLE {g_t} ADD COLUMN steve_agent_preset VARCHAR(32) NULL",
        f"ALTER TABLE {g_t} ADD COLUMN steve_proactive_enabled TINYINT(1) NOT NULL DEFAULT 0",
    ):
        try:
            cursor.execute(alter)
        except Exception:
            pass
    for alter in (
        f"ALTER TABLE {gp_t} ADD COLUMN ask_steve TINYINT(1) NOT NULL DEFAULT 0",
        f"ALTER TABLE {gp_t} ADD COLUMN auto_steve_used_count INT NOT NULL DEFAULT 0",
        f"ALTER TABLE {gp_t} ADD COLUMN agent_cap_notice_shown TINYINT(1) NOT NULL DEFAULT 0",
    ):
        try:
            cursor.execute(alter)
        except Exception:
            pass
    sch = "`group_steve_agent_schedule`" if USE_MYSQL else "group_steve_agent_schedule"
    try:
        if USE_MYSQL:
            cursor.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {sch} (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    group_post_id INTEGER NOT NULL,
                    run_after DATETIME NOT NULL,
                    author_username VARCHAR(191) NOT NULL,
                    cancelled TINYINT(1) NOT NULL DEFAULT 0,
                    UNIQUE KEY uq_gsa_post (group_post_id),
                    CONSTRAINT fk_gsa_gp FOREIGN KEY (group_post_id)
                        REFERENCES `group_posts`(id) ON DELETE CASCADE
                )
                """
            )
        else:
            cursor.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {sch} (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    group_post_id INTEGER NOT NULL UNIQUE,
                    run_after TEXT NOT NULL,
                    author_username TEXT NOT NULL,
                    cancelled INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (group_post_id) REFERENCES group_posts(id) ON DELETE CASCADE
                )
                """
            )
    except Exception as e:
        logger.warning("group_steve_agent_schedule create: %s", e)


def root_may_enable_agent(community_id: int) -> bool:
    from backend.services import community as community_svc
    from backend.services import community_billing

    root_id, _ = community_svc.resolve_root_community_id(int(community_id))
    return bool(community_billing.has_active_steve_package(int(root_id)))


def cancel_pending_agent_first_reply(cursor, group_post_id: int) -> None:
    sch = "`group_steve_agent_schedule`" if USE_MYSQL else "group_steve_agent_schedule"
    ph = get_sql_placeholder()
    try:
        cursor.execute(
            f"UPDATE {sch} SET cancelled = 1 WHERE group_post_id = {ph} AND cancelled = 0",
            (int(group_post_id),),
        )
    except Exception as e:
        logger.debug("cancel_pending_agent_first_reply: %s", e)


def schedule_agent_first_reply(cursor, group_post_id: int, author_username: str) -> None:
    sch = "`group_steve_agent_schedule`" if USE_MYSQL else "group_steve_agent_schedule"
    ph = get_sql_placeholder()
    delay = sample_first_reply_delay_seconds()
    run_after = datetime.utcnow() + timedelta(seconds=delay)
    rs = run_after.strftime("%Y-%m-%d %H:%M:%S")
    try:
        if USE_MYSQL:
            cursor.execute(
                f"""
                INSERT INTO {sch} (group_post_id, run_after, author_username, cancelled)
                VALUES ({ph}, {ph}, {ph}, 0)
                ON DUPLICATE KEY UPDATE run_after = VALUES(run_after),
                    author_username = VALUES(author_username), cancelled = 0
                """,
                (int(group_post_id), rs, author_username),
            )
        else:
            cursor.execute(f"DELETE FROM {sch} WHERE group_post_id = {ph}", (int(group_post_id),))
            cursor.execute(
                f"""
                INSERT INTO {sch} (group_post_id, run_after, author_username, cancelled)
                VALUES ({ph}, {ph}, {ph}, 0)
                """,
                (int(group_post_id), rs, author_username),
            )
    except Exception as e:
        logger.warning("schedule_agent_first_reply: %s", e)


def load_group_agent_flags(cursor, group_id: int) -> Tuple[bool, Optional[str], bool]:
    g_t = "`groups`" if USE_MYSQL else "groups"
    ph = get_sql_placeholder()
    try:
        cursor.execute(
            f"""
            SELECT steve_agent_enabled, steve_agent_preset, steve_proactive_enabled
            FROM {g_t} WHERE id = {ph} LIMIT 1
            """,
            (int(group_id),),
        )
        row = cursor.fetchone()
    except Exception:
        return False, None, False
    if not row:
        return False, None, False
    en = row["steve_agent_enabled"] if hasattr(row, "keys") else row[0]
    preset = row["steve_agent_preset"] if hasattr(row, "keys") else row[1]
    pro = row["steve_proactive_enabled"] if hasattr(row, "keys") else row[2]
    ps = str(preset).strip().lower() if preset else None
    return bool(en), ps, bool(pro)


def post_qualifies_for_ask_steve_schedule(content: str, has_media: bool) -> bool:
    if has_media:
        return True
    return len((content or "").strip()) >= MIN_ASK_STEVE_CHARS


def fetch_due_agent_schedules(cursor, limit: int = 25):
    sch = "`group_steve_agent_schedule`" if USE_MYSQL else "group_steve_agent_schedule"
    ph = get_sql_placeholder()
    now_s = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    try:
        if USE_MYSQL:
            cursor.execute(
                f"""
                SELECT id, group_post_id, author_username FROM {sch}
                WHERE cancelled = 0 AND run_after <= {ph}
                ORDER BY run_after ASC
                LIMIT {int(limit)}
                """,
                (now_s,),
            )
        else:
            cursor.execute(
                f"""
                SELECT id, group_post_id, author_username FROM {sch}
                WHERE cancelled = 0 AND run_after <= {ph}
                ORDER BY run_after ASC
                LIMIT {int(limit)}
                """,
                (now_s,),
            )
        return cursor.fetchall() or []
    except Exception as e:
        logger.warning("fetch_due_agent_schedules: %s", e)
        return []


def mark_schedule_cancelled(cursor, schedule_id: int) -> None:
    sch = "`group_steve_agent_schedule`" if USE_MYSQL else "group_steve_agent_schedule"
    ph = get_sql_placeholder()
    try:
        cursor.execute(f"UPDATE {sch} SET cancelled = 1 WHERE id = {ph}", (int(schedule_id),))
    except Exception:
        pass


def pop_group_steve_agent_schedule(cursor, schedule_id: int) -> bool:
    """Delete a due schedule row; returns True if a row was removed (claim)."""
    sch = "`group_steve_agent_schedule`" if USE_MYSQL else "group_steve_agent_schedule"
    ph = get_sql_placeholder()
    try:
        cursor.execute(f"DELETE FROM {sch} WHERE id = {ph}", (int(schedule_id),))
        rc = getattr(cursor, "rowcount", None)
        return bool(rc)
    except Exception as e:
        logger.debug("pop_group_steve_agent_schedule: %s", e)
        return False


def load_post_group_agent_state(
    cursor, group_post_id: int
) -> tuple[Optional[int], Optional[int], bool, Optional[str]]:
    """Return (community_id, group_id, steve_agent_enabled, preset) for a group post."""
    gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
    g_t = "`groups`" if USE_MYSQL else "groups"
    ph = get_sql_placeholder()
    try:
        cursor.execute(
            f"""
            SELECT g.community_id, g.id AS group_id, g.steve_agent_enabled, g.steve_agent_preset
            FROM {gp_t} gp
            JOIN {g_t} g ON g.id = gp.group_id
            WHERE gp.id = {ph}
            LIMIT 1
            """,
            (int(group_post_id),),
        )
        row = cursor.fetchone()
    except Exception:
        return None, None, False, None
    if not row:
        return None, None, False, None
    cid = row["community_id"] if hasattr(row, "keys") else row[0]
    gid = row["group_id"] if hasattr(row, "keys") else row[1]
    en = row["steve_agent_enabled"] if hasattr(row, "keys") else row[2]
    preset = row["steve_agent_preset"] if hasattr(row, "keys") else row[3]
    ps = str(preset).strip().lower() if preset else None
    return (
        int(cid) if cid is not None else None,
        int(gid) if gid is not None else None,
        bool(en),
        ps,
    )


def steve_reply_count_for_post(cursor, group_post_id: int) -> int:
    gr_t = "`group_replies`" if USE_MYSQL else "group_replies"
    ph = get_sql_placeholder()
    try:
        cursor.execute(
            f"""
            SELECT COUNT(*) AS c FROM {gr_t}
            WHERE group_post_id = {ph} AND LOWER(username) = 'steve'
            """,
            (int(group_post_id),),
        )
        row = cursor.fetchone()
        if not row:
            return 0
        return int(row["c"] if hasattr(row, "keys") else row[0] or 0)
    except Exception:
        return 0
