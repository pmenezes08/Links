"""Polls attached to group_posts (parallel to polls/post_id for community posts)."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from backend.services.database import USE_MYSQL, get_sql_placeholder

logger = logging.getLogger(__name__)


def _mysql_table_exists(cursor, table_name: str) -> bool:
    cursor.execute(f"SHOW TABLES LIKE '{table_name}'")
    return bool(cursor.fetchone())


def _commit_cursor(cursor) -> None:
    conn = getattr(cursor, "connection", None)
    if conn is not None:
        conn.commit()


def ensure_group_poll_tables(cursor) -> None:
    if USE_MYSQL:
        if not _mysql_table_exists(cursor, "group_polls"):
            try:
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS `group_polls` (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        group_id INT NOT NULL,
                        group_post_id INT NOT NULL,
                        question VARCHAR(512) NOT NULL,
                        created_by VARCHAR(191) NOT NULL,
                        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        expires_at DATETIME NULL,
                        is_active TINYINT(1) NOT NULL DEFAULT 1,
                        single_vote TINYINT(1) NOT NULL DEFAULT 1,
                        UNIQUE KEY uniq_gp_post (group_post_id),
                        KEY idx_gp_group (group_id),
                        CONSTRAINT fk_gp_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
                        CONSTRAINT fk_gp_post FOREIGN KEY (group_post_id) REFERENCES `group_posts`(id) ON DELETE CASCADE
                    )
                    """
                )
                _commit_cursor(cursor)
            except Exception:
                logger.exception("group_polls CREATE TABLE with FK failed; retrying without FK")
                try:
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS `group_polls` (
                            id INT AUTO_INCREMENT PRIMARY KEY,
                            group_id INT NOT NULL,
                            group_post_id INT NOT NULL,
                            question VARCHAR(512) NOT NULL,
                            created_by VARCHAR(191) NOT NULL,
                            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            expires_at DATETIME NULL,
                            is_active TINYINT(1) NOT NULL DEFAULT 1,
                            single_vote TINYINT(1) NOT NULL DEFAULT 1,
                            UNIQUE KEY uniq_gp_post (group_post_id),
                            KEY idx_gp_group (group_id),
                            KEY idx_gp_post (group_post_id)
                        )
                        """
                    )
                    _commit_cursor(cursor)
                except Exception:
                    logger.exception("group_polls CREATE TABLE failed")

        if _mysql_table_exists(cursor, "group_polls"):
            if not _mysql_table_exists(cursor, "group_poll_options"):
                try:
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS `group_poll_options` (
                            id INT AUTO_INCREMENT PRIMARY KEY,
                            group_poll_id INT NOT NULL,
                            option_text VARCHAR(512) NOT NULL,
                            votes INT NOT NULL DEFAULT 0,
                            KEY idx_gpo_poll (group_poll_id),
                            CONSTRAINT fk_gpo_poll FOREIGN KEY (group_poll_id) REFERENCES `group_polls`(id) ON DELETE CASCADE
                        )
                        """
                    )
                    _commit_cursor(cursor)
                except Exception:
                    logger.exception("group_poll_options CREATE TABLE failed")
            if _mysql_table_exists(cursor, "group_poll_options"):
                if not _mysql_table_exists(cursor, "group_poll_votes"):
                    try:
                        cursor.execute(
                            """
                            CREATE TABLE IF NOT EXISTS `group_poll_votes` (
                                id INT AUTO_INCREMENT PRIMARY KEY,
                                group_poll_id INT NOT NULL,
                                option_id INT NOT NULL,
                                username VARCHAR(191) NOT NULL,
                                voted_at DATETIME NOT NULL,
                                UNIQUE KEY uniq_gpv (group_poll_id, username, option_id),
                                KEY idx_gpv_poll (group_poll_id),
                                CONSTRAINT fk_gpv_poll FOREIGN KEY (group_poll_id) REFERENCES `group_polls`(id) ON DELETE CASCADE,
                                CONSTRAINT fk_gpv_opt FOREIGN KEY (option_id) REFERENCES `group_poll_options`(id) ON DELETE CASCADE
                            )
                            """
                        )
                        _commit_cursor(cursor)
                    except Exception:
                        logger.exception("group_poll_votes CREATE TABLE failed")
    else:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS group_polls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                group_post_id INTEGER NOT NULL,
                question TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                expires_at TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                single_vote INTEGER NOT NULL DEFAULT 1,
                UNIQUE(group_post_id),
                FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
                FOREIGN KEY (group_post_id) REFERENCES group_posts(id) ON DELETE CASCADE
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS group_poll_options (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_poll_id INTEGER NOT NULL,
                option_text TEXT NOT NULL,
                votes INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (group_poll_id) REFERENCES group_polls(id) ON DELETE CASCADE
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS group_poll_votes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_poll_id INTEGER NOT NULL,
                option_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                voted_at TEXT NOT NULL,
                UNIQUE(group_poll_id, username, option_id),
                FOREIGN KEY (group_poll_id) REFERENCES group_polls(id) ON DELETE CASCADE,
                FOREIGN KEY (option_id) REFERENCES group_poll_options(id) ON DELETE CASCADE
            )
            """
        )


def poll_expired(expires_at: Any) -> bool:
    if not expires_at:
        return False
    try:
        s = str(expires_at).replace("T", " ")[:19]
        exp = datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
        return datetime.now() >= exp
    except Exception:
        try:
            exp = datetime.strptime(str(expires_at)[:10], "%Y-%m-%d")
            return datetime.now().date() > exp.date()
        except Exception:
            return False


def load_polls_for_group_posts(
    cursor,
    ph: str,
    username: str | None,
    post_ids: list[int],
) -> dict[int, dict[str, Any]]:
    """Map group_post_id -> poll dict shaped like community feed ``poll``."""
    if not post_ids:
        return {}
    gp = "`group_polls`" if USE_MYSQL else "group_polls"
    gpo = "`group_poll_options`" if USE_MYSQL else "group_poll_options"
    in_ph = ",".join([ph] * len(post_ids))
    cursor.execute(
        f"""
        SELECT * FROM {gp}
        WHERE group_post_id IN ({in_ph}) AND is_active = 1
        """,
        tuple(post_ids),
    )
    polls_raw = cursor.fetchall() or []
    poll_by_post: dict[int, Any] = {}
    poll_ids = []
    for pr in polls_raw:
        row = dict(pr) if hasattr(pr, "keys") else {}
        if not row:
            continue
        poll_id = row.get("id")
        gpid = row.get("group_post_id")
        if poll_id and gpid:
            poll_ids.append(int(poll_id))
            poll_by_post[int(gpid)] = row

    if not poll_ids:
        return {}

    poll_ph = ",".join([ph] * len(poll_ids))
    cursor.execute(
        f"""
        SELECT * FROM {gpo}
        WHERE group_poll_id IN ({poll_ph})
        ORDER BY group_poll_id, id
        """,
        tuple(poll_ids),
    )
    opt_rows = cursor.fetchall() or []
    option_ids: list[int] = []
    by_poll: dict[int, list[dict[str, Any]]] = {pid: [] for pid in poll_ids}
    for opt in opt_rows:
        od = dict(opt) if hasattr(opt, "keys") else {}
        if not od:
            continue
        pid = int(od.get("group_poll_id") or 0)
        oid = int(od.get("id") or 0)
        if pid and oid:
            option_ids.append(oid)
            by_poll.setdefault(pid, []).append(
                {
                    "id": oid,
                    "poll_id": pid,
                    "option_text": od.get("option_text", ""),
                    "text": od.get("option_text", ""),
                    "votes": int(od.get("votes") or 0),
                    "user_voted": False,
                }
            )

    user_voted_opts: dict[int, set[int]] = {pid: set() for pid in poll_ids}
    if username and option_ids:
        opt_in = ",".join([ph] * len(option_ids))
        gpv = "`group_poll_votes`" if USE_MYSQL else "group_poll_votes"
        cursor.execute(
            f"""
            SELECT group_poll_id, option_id FROM {gpv}
            WHERE option_id IN ({opt_in}) AND username = {ph}
            """,
            tuple(option_ids) + (username,),
        )
        for vr in cursor.fetchall() or []:
            if hasattr(vr, "keys"):
                p = int(vr.get("group_poll_id") or 0)
                o = int(vr.get("option_id") or 0)
            else:
                p, o = int(vr[0]), int(vr[1])
            if p and o:
                user_voted_opts.setdefault(p, set()).add(o)

    out: dict[int, dict[str, Any]] = {}
    for g_post_id, prow in poll_by_post.items():
        pid = int(prow.get("id") or 0)
        if not pid:
            continue
        if poll_expired(prow.get("expires_at")):
            continue
        options = by_poll.get(pid, [])
        voted_set = user_voted_opts.get(pid, set())
        total = 0
        user_vote: int | None = None
        single_vote_flag = bool(int(prow.get("single_vote") if prow.get("single_vote") is not None else 1))
        for o in options:
            cnt = int(o.get("votes") or 0)
            total += cnt
            uv = o["id"] in voted_set
            o["user_voted"] = uv
            if uv and single_vote_flag:
                user_vote = o["id"]
        if not single_vote_flag:
            user_vote = None
        out[g_post_id] = {
            "id": pid,
            "question": prow.get("question") or "",
            "is_active": int(prow.get("is_active") or 1),
            "single_vote": bool(int(prow.get("single_vote") if prow.get("single_vote") is not None else 1)),
            "expires_at": prow.get("expires_at"),
            "options": options,
            "user_vote": user_vote,
            "total_votes": total,
        }
    return out


def vote_group_poll(
    cursor,
    ph: str,
    username: str,
    group_poll_id: int,
    option_id: int,
) -> tuple[bool, str, list[dict[str, Any]] | None]:
    """Record vote; return (ok, message, poll_results rows like vote_poll)."""
    gp = "`group_polls`" if USE_MYSQL else "group_polls"
    gpo = "`group_poll_options`" if USE_MYSQL else "group_poll_options"
    gpv = "`group_poll_votes`" if USE_MYSQL else "group_poll_votes"
    cursor.execute(f"SELECT * FROM {gp} WHERE id = {ph}", (group_poll_id,))
    prow = cursor.fetchone()
    if not prow:
        return False, "Poll not found", None
    poll_data = dict(prow) if hasattr(prow, "keys") else {}
    if not int(poll_data.get("is_active", 1)):
        return False, "Poll not active", None
    if poll_expired(poll_data.get("expires_at")):
        return False, "Poll has expired", None

    cursor.execute(
        f"SELECT 1 FROM {gpo} WHERE id = {ph} AND group_poll_id = {ph}",
        (option_id, group_poll_id),
    )
    if not cursor.fetchone():
        return False, "Invalid option", None

    single_vote = bool(int(poll_data.get("single_vote") if poll_data.get("single_vote") is not None else 1))
    now_s = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute(
        f"SELECT id FROM {gpv} WHERE group_poll_id = {ph} AND username = {ph} AND option_id = {ph}",
        (group_poll_id, username, option_id),
    )
    existing_on_opt = cursor.fetchone()

    cursor.execute(
        f"SELECT id, option_id FROM {gpv} WHERE group_poll_id = {ph} AND username = {ph}",
        (group_poll_id, username),
    )
    existing_vote = cursor.fetchone()

    if existing_on_opt:
        cursor.execute(
            f"DELETE FROM {gpv} WHERE group_poll_id = {ph} AND username = {ph} AND option_id = {ph}",
            (group_poll_id, username, option_id),
        )
        message = "Vote removed!"
    elif existing_vote and single_vote:
        cursor.execute(
            f"UPDATE {gpv} SET option_id = {ph}, voted_at = {ph} WHERE group_poll_id = {ph} AND username = {ph}",
            (option_id, now_s, group_poll_id, username),
        )
        message = "Vote updated!"
    else:
        cursor.execute(
            f"""
            INSERT INTO {gpv} (group_poll_id, option_id, username, voted_at)
            VALUES ({ph}, {ph}, {ph}, {ph})
            """,
            (group_poll_id, option_id, username, now_s),
        )
        message = "Vote recorded successfully!"

    cursor.execute(
        f"UPDATE {gpo} SET votes = (SELECT COUNT(*) FROM {gpv} WHERE option_id = {ph}) WHERE id = {ph}",
        (option_id, option_id),
    )
    if existing_vote and single_vote and not existing_on_opt:
        old_oid = existing_vote["option_id"] if hasattr(existing_vote, "keys") else existing_vote[1]
        if old_oid != option_id:
            cursor.execute(
                f"UPDATE {gpo} SET votes = (SELECT COUNT(*) FROM {gpv} WHERE option_id = {ph}) WHERE id = {ph}",
                (old_oid, old_oid),
            )

    cursor.execute(
        f"""
        SELECT po.id, po.option_text, po.votes,
               (SELECT COUNT(*) FROM {gpv} WHERE group_poll_id = {ph}) as total_votes,
               (SELECT option_id FROM {gpv} WHERE group_poll_id = {ph} AND username = {ph} LIMIT 1) as user_vote,
               (SELECT COUNT(*) FROM {gpv} WHERE group_poll_id = {ph} AND username = {ph} AND option_id = po.id) as user_voted
        FROM {gpo} po
        WHERE po.group_poll_id = {ph}
        ORDER BY po.id
        """,
        (group_poll_id, group_poll_id, username, group_poll_id, username, group_poll_id, group_poll_id),
    )
    rows = [dict(x) for x in (cursor.fetchall() or [])]
    for r in rows:
        r["text"] = r.get("option_text", "")
    return True, message, rows


def create_group_poll(
    cursor,
    ph: str,
    username: str,
    group_id: int,
    group_post_id: int,
    question: str,
    options: list[str],
    single_vote: bool,
    expires_at_sql: str | None,
) -> tuple[int | None, str | None]:
    """Insert poll + options. Returns (poll_id, error_message)."""
    gp = "`group_polls`" if USE_MYSQL else "group_polls"
    gpo = "`group_poll_options`" if USE_MYSQL else "group_poll_options"
    gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
    cursor.execute(
        f"SELECT id, username, group_id FROM {gp_t} WHERE id = {ph}",
        (group_post_id,),
    )
    row = cursor.fetchone()
    if not row:
        return None, "Post not found"
    post_gid = row["group_id"] if hasattr(row, "keys") else row[2]
    if int(post_gid) != int(group_id):
        return None, "Post does not belong to this group"
    cursor.execute(f"SELECT id FROM {gp} WHERE group_post_id = {ph}", (group_post_id,))
    if cursor.fetchone():
        return None, "This post already has a poll"

    now_s = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    sv = 1 if single_vote else 0
    cursor.execute(
        f"""
        INSERT INTO {gp} (group_id, group_post_id, question, created_by, created_at, expires_at, is_active, single_vote)
        VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, 1, {ph})
        """,
        (group_id, group_post_id, question, username, now_s, expires_at_sql, sv),
    )
    poll_id = int(cursor.lastrowid)
    for opt in options:
        ot = (opt or "").strip()
        if not ot:
            continue
        cursor.execute(
            f"INSERT INTO {gpo} (group_poll_id, option_text, votes) VALUES ({ph}, {ph}, 0)",
            (poll_id, ot),
        )
    return poll_id, None
