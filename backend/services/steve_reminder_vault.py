"""
Steve Reminder Vault — user-scheduled reminders in private DM with Steve only.

Opener regex is an optimization for cheap matches; authoritative scheduling uses
Grok JSON slots plus :func:`try_parse_fire_datetime` before persistence.

Isolated from profiling KB / steve_user_profiles synthesis.
"""

from __future__ import annotations

import logging
import random
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

from backend.services.steve_reminder_parse import (
    RE_REMINDER_CANCEL as _RE_CANCEL,
    RE_REMINDER_LIST as _RE_LIST,
    draft_followup_composite_texts,
    extract_subject,
    looks_like_time_only_followup,
    match_create_opener,
    normalize_time_phrases_for_parse,
    reminder_intent_llm_plausible,
    try_parse_fire_datetime,
    try_parse_fire_datetime_first_candidate,
)
from backend.services.steve_reminder_slots import (
    ReminderSlots,
    extract_reminder_slots_llm,
    merged_text_for_datetime_parse,
)

logger = logging.getLogger(__name__)

MAX_ACTIVE_SCHEDULED = 40
BODY_MAX_LEN = 500
DRAFT_TTL_HOURS = 36


def ensure_reminder_tables() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS steve_reminder_vault (
                    id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    username VARCHAR(255) NOT NULL,
                    reminder_text VARCHAR(520) NOT NULL,
                    fire_at_utc DATETIME NOT NULL,
                    tz_label VARCHAR(64) NOT NULL DEFAULT 'UTC',
                    status VARCHAR(24) NOT NULL DEFAULT 'scheduled',
                    fired_at DATETIME NULL,
                    cancel_reason VARCHAR(255) NULL,
                    INDEX idx_srv_username_status (username, status),
                    INDEX idx_srv_fire (fire_at_utc, status)
                )
                """
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS steve_reminder_draft (
                    username VARCHAR(255) NOT NULL PRIMARY KEY,
                    subject_snippet VARCHAR(520) NOT NULL,
                    updated_at DATETIME NOT NULL
                )
                """
            )
        else:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS steve_reminder_vault (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    username TEXT NOT NULL,
                    reminder_text TEXT NOT NULL,
                    fire_at_utc TEXT NOT NULL,
                    tz_label TEXT NOT NULL DEFAULT 'UTC',
                    status TEXT NOT NULL DEFAULT 'scheduled',
                    fired_at TEXT,
                    cancel_reason TEXT
                )
                """
            )
            c.execute(
                "CREATE INDEX IF NOT EXISTS idx_srv_username_status ON steve_reminder_vault(username, status)"
            )
            c.execute(
                "CREATE INDEX IF NOT EXISTS idx_srv_fire ON steve_reminder_vault(fire_at_utc, status)"
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS steve_reminder_draft (
                    username TEXT NOT NULL PRIMARY KEY,
                    subject_snippet TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
        try:
            conn.commit()
        except Exception:
            pass


def _now_utc_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _sql_now() -> str:
    return _now_utc_naive().strftime("%Y-%m-%d %H:%M:%S")


def _fetch_user_timezone(username: str) -> str:
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(f"SELECT timezone FROM users WHERE username = {ph}", (username,))
            row = c.fetchone()
            if not row:
                return "UTC"
            tz = row["timezone"] if hasattr(row, "keys") else row[0]
            tz = (tz or "").strip()
            return tz if tz else "UTC"
    except Exception:
        return "UTC"


def _count_scheduled(username: str) -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT COUNT(*) AS n FROM steve_reminder_vault WHERE username = {ph} AND status = 'scheduled'",
            (username,),
        )
        row = c.fetchone()
        if hasattr(row, "keys"):
            return int(row["n"] or 0)
        return int(row[0] or 0)


def _sanitize_body(text: str) -> str:
    t = " ".join((text or "").split())
    if len(t) > BODY_MAX_LEN:
        return t[:BODY_MAX_LEN].rstrip() + "…"
    return t


def _fetch_draft(username: str) -> Optional[str]:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
            c.execute(
                f"SELECT subject_snippet, updated_at FROM steve_reminder_draft WHERE username = {ph}",
                (username,),
            )
        else:
            c.execute(
                f"SELECT subject_snippet, updated_at FROM steve_reminder_draft WHERE username = {ph}",
                (username,),
            )
        row = c.fetchone()
        if not row:
            return None
        snippet = row["subject_snippet"] if hasattr(row, "keys") else row[0]
        upd_raw = row["updated_at"] if hasattr(row, "keys") else row[1]
        try:
            if isinstance(upd_raw, datetime):
                upd = upd_raw.replace(tzinfo=None)
            elif isinstance(upd_raw, str):
                upd = datetime.strptime(upd_raw[:19], "%Y-%m-%d %H:%M:%S")
            else:
                return None
        except Exception:
            return None
        if upd < _now_utc_naive() - timedelta(hours=DRAFT_TTL_HOURS):
            _clear_draft(username)
            return None
        return snippet or None


def _save_draft(username: str, subject: str) -> None:
    ph = get_sql_placeholder()
    ts = _sql_now()
    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
            c.execute(
                f"""
                INSERT INTO steve_reminder_draft (username, subject_snippet, updated_at)
                VALUES ({ph}, {ph}, NOW())
                ON DUPLICATE KEY UPDATE subject_snippet=VALUES(subject_snippet),
                  updated_at=VALUES(updated_at)
                """,
                (username, subject[:520]),
            )
        else:
            c.execute(
                f"""
                INSERT INTO steve_reminder_draft (username, subject_snippet, updated_at)
                VALUES ({ph}, {ph}, {ph})
                ON CONFLICT(username) DO UPDATE SET subject_snippet=excluded.subject_snippet,
                  updated_at=excluded.updated_at
                """,
                (username, subject[:520], ts),
            )
        conn.commit()


def _clear_draft(username: str) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"DELETE FROM steve_reminder_draft WHERE username = {ph}", (username,))
        conn.commit()


def _current_utc_hint() -> str:
    return datetime.now(timezone.utc).strftime("%A, %B %d, %Y %H:%M UTC")


def _insert_if_parsed(
    username: str,
    subject: str,
    dt_utc: datetime,
    when_face: str,
    tz_label: str,
) -> str:
    grace = timedelta(minutes=1)
    if dt_utc < _now_utc_naive() + grace:
        return "That time reads as already passed — pick something a little ahead."

    subj = _sanitize_body(subject)
    if len(subj.strip()) < 4:
        return "Say briefly what you’d like me to remind you about."

    if _count_scheduled(username) >= MAX_ACTIVE_SCHEDULED:
        return (
            "You’ve hit the limit of active reminders right now. "
            "Cancel one with **cancel reminder #_id_** (see **list my reminders**)."
        )

    return _insert_reminder_and_reply(username, subj, dt_utc, when_face or "", tz_label)


def _apply_slots_schedule(
    username: str,
    tz_label: str,
    slots: ReminderSlots,
    rest_for_fallback_subject: str,
    *,
    draft_fallback_subject: Optional[str] = None,
) -> Optional[str]:
    """Insert or ask for time from LLM slots. Returns None if no Steve reply can be produced."""
    merged = merged_text_for_datetime_parse(slots.subject, slots.time_phrase)
    if not merged:
        merged = normalize_time_phrases_for_parse(rest_for_fallback_subject)

    text_for_parse = (merged if merged else rest_for_fallback_subject).strip()
    dt_utc, when_face = try_parse_fire_datetime(text_for_parse, tz_label)

    base_subj = (
        slots.subject
        or ((draft_fallback_subject or "").strip() or None)
        or extract_subject(rest_for_fallback_subject)
    )
    subject = _sanitize_body(base_subj)

    if not dt_utc:
        if len(subject.strip()) >= 4:
            if draft_fallback_subject is None:
                _save_draft(username, subject)
                return f"Sure — what time should I nudge you about: {subject}?"
            return (
                "I couldn’t read that as a time — try **11:25am**, **3pm**, **in 30 minutes**, "
                "or **tomorrow 9:00**."
            )
        return None

    return _insert_if_parsed(username, subject, dt_utc, when_face or "", tz_label)


def try_handle_direct_steve_dm_reminder(*, sender_username: str, user_message: str) -> Optional[str]:
    """
    Handle reminder intents when the user is in a private DM with Steve (no third party).
    Returns Steve reply body if handled, else None (caller may run Grok).
    """
    ensure_reminder_tables()
    msg = (user_message or "").strip()
    if not msg:
        return None

    username = sender_username.strip()
    tz_label = _fetch_user_timezone(username)
    stripped = re.sub(r"^\s*@\s*steve\s*[,:]?\s*", "", msg, flags=re.I).strip()

    if _RE_LIST.match(stripped):
        return _format_list(username)

    m_can = _RE_CANCEL.match(stripped)
    if m_can:
        return _cancel_by_id(username, int(m_can.group(2)))

    draft = _fetch_draft(username)
    if draft:
        grace_floor = _now_utc_naive() - timedelta(minutes=1)

        dt_utc, when_face = try_parse_fire_datetime(stripped, tz_label)
        if dt_utc and dt_utc >= grace_floor:
            subject = _sanitize_body(draft)
            _clear_draft(username)
            return _insert_reminder_and_reply(username, subject, dt_utc, when_face or "", tz_label)

        composite_texts = draft_followup_composite_texts(draft, stripped)
        dt_cmp, wf_cmp = try_parse_fire_datetime_first_candidate(composite_texts, tz_label)
        if dt_cmp and dt_cmp >= grace_floor:
            _clear_draft(username)
            return _insert_if_parsed(
                username,
                _sanitize_body(draft),
                dt_cmp,
                wf_cmp or "",
                tz_label,
            )

        if match_create_opener(stripped):
            _clear_draft(username)
            # Fall through: new explicit create supersedes pending time-only draft.
        else:
            slots = extract_reminder_slots_llm(
                username=username,
                user_message=msg,
                tz_label=tz_label,
                current_utc_hint=_current_utc_hint(),
                draft_subject=draft,
            )
            if slots is None:
                return (
                    "I still need a clear time for that reminder — or say **list my reminders** to see what’s queued."
                )

            effective = slots
            if effective.intent != "schedule" and looks_like_time_only_followup(stripped):
                effective = ReminderSlots(intent="schedule", subject=draft, time_phrase=stripped.strip())

            if effective.intent != "schedule":
                return (
                    "I still need a clear time for that reminder — or say **list my reminders** to see what’s queued."
                )

            slots_reply = _apply_slots_schedule(
                username,
                tz_label,
                effective,
                stripped,
                draft_fallback_subject=draft,
            )
            if slots_reply:
                _clear_draft(username)
                return slots_reply
            return (
                "I still need a clear time — try something like **3pm** or **tomorrow 9:00**. "
                "Or say **list my reminders** to see what’s queued."
            )

    if _count_scheduled(username) >= MAX_ACTIVE_SCHEDULED:
        m_trig = match_create_opener(stripped)
        if m_trig or reminder_intent_llm_plausible(stripped, msg):
            return (
                "You’ve hit the limit of active reminders right now. "
                "Cancel one with **cancel reminder #_id_** (see **list my reminders**)."
            )

    m_trig = match_create_opener(stripped)
    if m_trig:
        rest = (m_trig.group("tail") or "").strip()
        if not rest:
            return "Tell me what to remind you about — and when — or say **list my reminders**."

        dt_utc, when_face = try_parse_fire_datetime(rest, tz_label)
        if dt_utc:
            return _insert_if_parsed(
                username,
                _sanitize_body(extract_subject(rest)),
                dt_utc,
                when_face or "",
                tz_label,
            )

        slots = extract_reminder_slots_llm(
            username=username,
            user_message=msg,
            tz_label=tz_label,
            current_utc_hint=_current_utc_hint(),
        )
        if slots and slots.intent == "schedule":
            llm_reply = _apply_slots_schedule(username, tz_label, slots, rest)
            if llm_reply:
                return llm_reply

        subj = _sanitize_body(extract_subject(rest))
        if len(subj) < 4:
            return "Say briefly what you’d like me to remind you about."
        _save_draft(username, subj)
        return f"Sure — what time should I nudge you about: {subj}?"

    if not reminder_intent_llm_plausible(stripped, msg):
        return None

    slots_no_regex = extract_reminder_slots_llm(
        username=username,
        user_message=msg,
        tz_label=tz_label,
        current_utc_hint=_current_utc_hint(),
    )
    if slots_no_regex is None or slots_no_regex.intent != "schedule":
        return None
    no_regex_reply = _apply_slots_schedule(username, tz_label, slots_no_regex, stripped)
    return no_regex_reply


def _insert_reminder_and_reply(
    username: str, subject: str, dt_utc: datetime, when_face: str, tz_label: str
) -> str:
    ph = get_sql_placeholder()
    dt_str = dt_utc.strftime("%Y-%m-%d %H:%M:%S")
    rid: Optional[int] = None
    is_first = False
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT COUNT(*) AS n FROM steve_reminder_vault WHERE username = {ph}", (username,))
        cr = c.fetchone()
        is_first = int((cr["n"] if hasattr(cr, "keys") else cr[0]) or 0) == 0

    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
            c.execute(
                f"""
                INSERT INTO steve_reminder_vault (
                    created_at, updated_at, username, reminder_text, fire_at_utc, tz_label, status
                ) VALUES (NOW(), NOW(), {ph}, {ph}, {ph}, {ph}, 'scheduled')
                """,
                (username, subject, dt_str, tz_label[:64]),
            )
            rid = c.lastrowid
        else:
            now_str = _sql_now()
            c.execute(
                f"""
                INSERT INTO steve_reminder_vault (
                    created_at, updated_at, username, reminder_text, fire_at_utc, tz_label, status
                ) VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, 'scheduled')
                """,
                (now_str, now_str, username, subject, dt_str, tz_label[:64]),
            )
            rid = c.lastrowid
        conn.commit()

    rid_txt = str(rid) if rid else "?"
    when_txt = when_face or dt_str
    tail = _vault_onboarding_tail(username, is_first_saved_reminder=is_first)
    return (
        f"Got it — I’ll nudge you around **{when_txt}**:\n\n{subject}\n\n"
        f"(Vault #{rid_txt}. Reply **list my reminders** anytime.){tail}"
    )


def _vault_onboarding_tail(username: str, *, is_first_saved_reminder: bool) -> str:
    show = is_first_saved_reminder or random.random() < 0.22
    if not show:
        return ""
    return (
        "\n\nTip: open this chat, tap **⋯** (top right) → **Reminder Vault** to see or edit what I’m holding for you."
    )


def _format_list(username: str) -> str:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT id, reminder_text, fire_at_utc, status FROM steve_reminder_vault
            WHERE username = {ph} AND status = 'scheduled'
            ORDER BY fire_at_utc ASC
            LIMIT 30
            """,
            (username,),
        )
        rows = list(c.fetchall() or [])

    if not rows:
        return "No upcoming reminders. Try: **Steve, remind me to call Alex on Tuesday at 3pm**."

    lines: list[str] = ["**Your reminders**"]
    for row in rows:
        if hasattr(row, "keys"):
            rid = row["id"]
            txt = row["reminder_text"]
            fa = row["fire_at_utc"]
        else:
            rid, txt, fa, *_ = tuple(row[:3])
        fa_s = fa.strftime("%Y-%m-%d %H:%M") if hasattr(fa, "strftime") else str(fa)
        lines.append(f"- **#{rid}** — {fa_s} UTC — {txt}")
    lines.append("\nCancel with **cancel reminder #123**.")
    return "\n".join(lines)


def _cancel_by_id(username: str, rid: int) -> str:
    ph = get_sql_placeholder()
    affected = 0
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            if USE_MYSQL:
                c.execute(
                    f"""
                    UPDATE steve_reminder_vault SET status = 'cancelled', cancel_reason = 'user_dm',
                        updated_at = NOW()
                    WHERE id = {ph} AND username = {ph} AND status = 'scheduled'
                    """,
                    (rid, username),
                )
            else:
                c.execute(
                    f"""
                    UPDATE steve_reminder_vault SET status = 'cancelled', cancel_reason = 'user_dm',
                        updated_at = {ph}
                    WHERE id = {ph} AND username = {ph} AND status = 'scheduled'
                    """,
                    (_sql_now(), rid, username),
                )
            affected = c.rowcount or 0
            conn.commit()
    except Exception as exc:
        logger.warning("Cancel reminder failed: %s", exc)
        return "Couldn’t cancel that reminder right now. Try again in a minute."

    if affected:
        return f"Cleared reminder **#{rid}**."
    return f"No active reminder **#{rid}**. Use **list my reminders**."


def list_reminders_for_user(username: str) -> Dict[str, Any]:
    ensure_reminder_tables()
    ph = get_sql_placeholder()
    out: list[Dict[str, Any]] = []
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT id, reminder_text, fire_at_utc, tz_label, status, created_at
            FROM steve_reminder_vault
            WHERE username = {ph} AND status = 'scheduled'
            ORDER BY fire_at_utc ASC
            LIMIT 50
            """,
            (username,),
        )
        for row in c.fetchall() or []:
            if hasattr(row, "keys"):
                out.append(
                    {
                        "id": row["id"],
                        "reminder_text": row["reminder_text"],
                        "fire_at_utc": str(row["fire_at_utc"]),
                        "tz_label": row["tz_label"],
                        "status": row["status"],
                        "created_at": (
                            str(row["created_at"]) if row["created_at"] is not None else None
                        ),
                    }
                )
            else:
                out.append(
                    {
                        "id": row[0],
                        "reminder_text": row[1],
                        "fire_at_utc": str(row[2]),
                        "tz_label": row[3],
                        "status": row[4],
                        "created_at": str(row[5]) if len(row) > 5 else None,
                    }
                )
    return {"reminders": out}


def update_reminder_for_user(
    *, username: str, reminder_id: int, reminder_text: Optional[str], fire_at_utc_iso: Optional[str]
) -> Tuple[bool, str]:
    ensure_reminder_tables()
    if not reminder_text and not fire_at_utc_iso:
        return False, "Nothing to update."
    ph = get_sql_placeholder()
    parts = []
    params: list[Any] = []
    if reminder_text is not None:
        t = _sanitize_body(reminder_text)
        if len(t.strip()) < 2:
            return False, "Description too short."
        parts.append(f"reminder_text = {ph}")
        params.append(t)
    if fire_at_utc_iso:
        try:
            s = fire_at_utc_iso.strip().replace("Z", "+00:00")
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is not None:
                dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
            if dt < _now_utc_naive() + timedelta(minutes=1):
                return False, "Pick a time in the future."
            parts.append(f"fire_at_utc = {ph}")
            params.append(dt.strftime("%Y-%m-%d %H:%M:%S"))
        except Exception:
            return False, "Invalid date/time."
    if USE_MYSQL:
        parts.append("updated_at = NOW()")
    else:
        parts.append(f"updated_at = {ph}")
        params.append(_sql_now())

    params.extend([reminder_id, username])
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""
                UPDATE steve_reminder_vault SET {", ".join(parts)}
                WHERE id = {ph} AND username = {ph} AND status = 'scheduled'
                """,
                tuple(params),
            )
            affected = c.rowcount or 0
            conn.commit()
    except Exception as exc:
        logger.warning("update reminder failed: %s", exc)
        return False, "Update failed."
    if affected:
        return True, "Updated."
    return False, "Reminder not found or already fired."


def dispatch_due_reminders(*, lookahead_minutes: int = 12, stale_catch_hours: int = 48) -> Dict[str, Any]:
    """Cron: fire pending reminders."""
    ensure_reminder_tables()
    from backend.services.content_generation.delivery import send_steve_dm

    now = _now_utc_naive()
    horizon = now + timedelta(minutes=max(1, lookahead_minutes))
    stale_floor = now - timedelta(hours=max(1, stale_catch_hours))

    sent = 0
    errors = 0
    ph = get_sql_placeholder()
    horizon_s = horizon.strftime("%Y-%m-%d %H:%M:%S")
    stale_s = stale_floor.strftime("%Y-%m-%d %H:%M:%S")

    cand_rows: list[Any] = []
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            if USE_MYSQL:
                c.execute(
                    f"""
                    SELECT id, username, reminder_text, fire_at_utc FROM steve_reminder_vault
                    WHERE status = 'scheduled'
                      AND fire_at_utc BETWEEN {ph} AND {ph}
                    ORDER BY fire_at_utc ASC
                    LIMIT 250
                    """,
                    (stale_s, horizon_s),
                )
            else:
                c.execute(
                    f"""
                    SELECT id, username, reminder_text, fire_at_utc FROM steve_reminder_vault
                    WHERE status = 'scheduled'
                      AND datetime(fire_at_utc) >= datetime({ph})
                      AND datetime(fire_at_utc) <= datetime({ph})
                    ORDER BY fire_at_utc ASC
                    LIMIT 250
                    """,
                    (stale_s, horizon_s),
                )
            cand_rows = list(c.fetchall() or [])
    except Exception as exc:
        logger.exception("Reminder dispatch query failed: %s", exc)
        return {"sent": 0, "errors": 1, "candidates": 0}

    for row in cand_rows:
        row_id = row["id"] if hasattr(row, "keys") else row[0]
        uname = row["username"] if hasattr(row, "keys") else row[1]
        body_txt = row["reminder_text"] if hasattr(row, "keys") else row[2]

        locked = False
        try:
            with get_db_connection() as conn2:
                c2 = conn2.cursor()
                if USE_MYSQL:
                    c2.execute(
                        f"""
                        UPDATE steve_reminder_vault SET status = 'fired', fired_at = NOW(),
                            updated_at = NOW()
                        WHERE id = {ph} AND username = {ph} AND status = 'scheduled'
                        """,
                        (row_id, uname),
                    )
                    locked = (c2.rowcount or 0) >= 1
                else:
                    ts = _sql_now()
                    c2.execute(
                        f"""
                        UPDATE steve_reminder_vault SET status = 'fired', fired_at = {ph},
                            updated_at = {ph}
                        WHERE id = {ph} AND username = {ph} AND status = 'scheduled'
                        """,
                        (ts, ts, row_id, uname),
                    )
                    locked = (c2.rowcount or 0) >= 1
                conn2.commit()
        except Exception as exc:
            logger.warning("Reminder lock row #%s failed: %s", row_id, exc)
            errors += 1
            continue

        if not locked:
            continue

        msg = (
            f"Hey — quick nudge: {body_txt}\n\n"
            f"(Reminder #{row_id}. Say **list my reminders** if you want to tweak what’s queued.)"
        )
        try:
            send_steve_dm(receiver_username=uname, content=msg)
            sent += 1
        except Exception as exc:
            logger.error("send_steve_dm failed reminder %s: %s", row_id, exc)
            errors += 1

    return {"sent": sent, "errors": errors, "candidates": len(cand_rows)}
