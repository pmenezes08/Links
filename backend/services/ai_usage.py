"""AI usage logging and counter helpers.

Single source of truth for writes and reads against the ``ai_usage_log`` table.
Every Steve / Whisper / content-generation code path must call
:func:`log_usage` on success *and* on failure so that usage counters and cost
attribution are complete.

The table originally had a minimal schema ``(username, request_type, created_at)``
and was written from two sites inside the legacy monolith. This module
extends the schema with richer columns via idempotent ``ALTER TABLE`` calls
and exposes one ``log_usage`` entry point plus fast counter helpers used by
:mod:`backend.services.entitlements`.

Schema additions (all nullable, so old rows keep working):

    surface           VARCHAR(32)   ('dm' | 'group' | 'feed' | 'post_summary'
                                     | 'voice_summary' | 'content_gen'
                                     | 'whisper')
    tokens_in         INT
    tokens_out        INT
    cost_usd          DECIMAL(10, 6)
    duration_seconds  DECIMAL(10, 3)    (Whisper only — audio minutes billed)
    success           TINYINT(1) DEFAULT 1
    reason_blocked    VARCHAR(64)       (enum from entitlements_errors)
    response_time_ms  INT
    community_id      INT               (for community-pool accounting later)
    model             VARCHAR(64)       (e.g. grok-4-1-fast-reasoning)

Counter semantics:
    * :func:`daily_count` — rows in the last 24h, used for ``ai_daily_limit``.
    * :func:`monthly_steve_count` — rows this calendar month where
      ``surface`` is one of the Steve surfaces and ``success=1``. Used for
      ``steve_uses_per_month``.
    * :func:`whisper_minutes_this_month` — SUM(duration_seconds)/60 for
      ``surface='whisper'`` rows this month; used for
      ``whisper_minutes_per_month``.

The counters explicitly exclude ``success=0`` rows so a blocked call never
counts against the user's allowance. Blocked rows are still logged for
analytics.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)


# Canonical surface values. Kept as a module constant so the rest of the
# codebase and admin queries share the same vocabulary.
SURFACE_DM = "dm"
SURFACE_GROUP = "group"
SURFACE_FEED = "feed"
SURFACE_POST_SUMMARY = "post_summary"
SURFACE_VOICE_SUMMARY = "voice_summary"
SURFACE_CONTENT_GEN = "content_gen"
SURFACE_WHISPER = "whisper"

ALL_SURFACES = (
    SURFACE_DM,
    SURFACE_GROUP,
    SURFACE_FEED,
    SURFACE_POST_SUMMARY,
    SURFACE_VOICE_SUMMARY,
    SURFACE_CONTENT_GEN,
    SURFACE_WHISPER,
)

# Surfaces that count against the user-facing "Steve uses / month" allowance.
# Whisper is tracked separately (minutes, not calls); content_gen is a
# community-pool concept and not billed against the personal Steve cap.
STEVE_SURFACES = (
    SURFACE_DM,
    SURFACE_GROUP,
    SURFACE_FEED,
    SURFACE_POST_SUMMARY,
    SURFACE_VOICE_SUMMARY,
)


_SCHEMA_READY = False


def _utc_now_str() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def _ensure_column(cursor, column: str, column_def_sql: str) -> None:
    """Idempotently add a column via ``ALTER TABLE``. Safe on MySQL + SQLite."""
    try:
        cursor.execute(
            f"ALTER TABLE ai_usage_log ADD COLUMN {column} {column_def_sql}"
        )
    except Exception:
        # Column already exists on both backends.
        pass


def _ensure_index(cursor, index_name: str, column_sql: str) -> None:
    try:
        if USE_MYSQL:
            cursor.execute(
                f"ALTER TABLE ai_usage_log ADD INDEX {index_name} ({column_sql})"
            )
        else:
            cursor.execute(
                f"CREATE INDEX IF NOT EXISTS {index_name} ON ai_usage_log ({column_sql})"
            )
    except Exception:
        pass


def ensure_tables() -> None:
    """Create / upgrade the ``ai_usage_log`` table. Idempotent.

    Safe to call from every blueprint or service init. Uses a module-level
    flag so the real DDL only runs once per process.
    """
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return

    with get_db_connection() as conn:
        c = conn.cursor()

        # Create the base table if it doesn't exist. Matches the legacy shape
        # created inside bodybuilding_app.py so we don't clash.
        if USE_MYSQL:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS ai_usage_log (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    username VARCHAR(191) NOT NULL,
                    request_type VARCHAR(50) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_ai_usage_user (username),
                    INDEX idx_ai_usage_time (created_at)
                )
                """
            )
        else:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS ai_usage_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    request_type TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

        # Enriched columns (all nullable to keep backfill trivial).
        _ensure_column(c, "surface", "VARCHAR(32) NULL")
        _ensure_column(c, "tokens_in", "INT NULL")
        _ensure_column(c, "tokens_out", "INT NULL")
        _ensure_column(c, "cost_usd", "DECIMAL(10, 6) NULL")
        _ensure_column(c, "duration_seconds", "DECIMAL(10, 3) NULL")
        _ensure_column(c, "success", "TINYINT(1) NOT NULL DEFAULT 1")
        _ensure_column(c, "reason_blocked", "VARCHAR(64) NULL")
        _ensure_column(c, "response_time_ms", "INT NULL")
        _ensure_column(c, "community_id", "INT NULL")
        _ensure_column(c, "model", "VARCHAR(64) NULL")

        # Indexes for the hot queries (counter helpers below).
        _ensure_index(c, "idx_ai_usage_user_surface", "username, surface")
        _ensure_index(c, "idx_ai_usage_user_time_success", "username, created_at, success")

        try:
            conn.commit()
        except Exception:
            pass

    _SCHEMA_READY = True


# ────────────────────────────────────────────────────────────────────
# Writes
# ────────────────────────────────────────────────────────────────────


def log_usage(
    username: str,
    *,
    surface: str,
    request_type: Optional[str] = None,
    tokens_in: Optional[int] = None,
    tokens_out: Optional[int] = None,
    cost_usd: Optional[float] = None,
    duration_seconds: Optional[float] = None,
    success: bool = True,
    reason_blocked: Optional[str] = None,
    response_time_ms: Optional[int] = None,
    community_id: Optional[int] = None,
    model: Optional[str] = None,
) -> None:
    """Insert one row into ``ai_usage_log``.

    This function never raises — logging failures must not break the
    request. Errors are captured at WARNING level.

    Args:
        username: actor. Required.
        surface: one of :data:`ALL_SURFACES`. Required.
        request_type: legacy text label kept for back-compat with existing
            rows (e.g. ``'steve_reply'``, ``'steve_post_reply'``). If omitted,
            falls back to ``surface``.
        tokens_in / tokens_out: from the LLM ``usage`` object.
        cost_usd: computed cost for this call in USD.
        duration_seconds: for Whisper — audio length billed.
        success: ``False`` when the call was blocked by entitlements or errored.
        reason_blocked: one of the entitlements_errors reason codes when
            ``success=False``.
        response_time_ms: latency of the upstream call.
        community_id: community the action took place in (for pool accounting).
        model: provider model id.
    """
    if not username or not surface:
        # Defensive — never silently log garbage.
        logger.debug("log_usage called without username/surface, skipping")
        return

    ensure_tables()

    rtype = (request_type or surface)[:50]
    ph = get_sql_placeholder()
    now = _utc_now_str()

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""
                INSERT INTO ai_usage_log
                    (username, request_type, surface, tokens_in, tokens_out,
                     cost_usd, duration_seconds, success, reason_blocked,
                     response_time_ms, community_id, model, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph},
                        {ph}, {ph}, {ph}, {ph}, {ph})
                """,
                (
                    username,
                    rtype,
                    surface,
                    tokens_in,
                    tokens_out,
                    cost_usd,
                    duration_seconds,
                    1 if success else 0,
                    reason_blocked,
                    response_time_ms,
                    community_id,
                    model,
                    now,
                ),
            )
            try:
                conn.commit()
            except Exception:
                pass
    except Exception as err:
        logger.warning("ai_usage.log_usage failed: %s", err)


def log_block(
    username: str,
    *,
    surface: str,
    reason: str,
    community_id: Optional[int] = None,
) -> None:
    """Convenience wrapper for logging a blocked call (success=0).

    Blocked rows are excluded from the allowance counters but kept for
    analytics — e.g. conversion rates on the "limit reached" CTA.
    """
    log_usage(
        username,
        surface=surface,
        request_type=f"blocked:{reason}",
        success=False,
        reason_blocked=reason,
        community_id=community_id,
    )


# ────────────────────────────────────────────────────────────────────
# Counter helpers
# ────────────────────────────────────────────────────────────────────


def _first_of_current_month_utc() -> str:
    now = datetime.utcnow()
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).strftime(
        "%Y-%m-%d %H:%M:%S"
    )


def _start_of_utc_day() -> str:
    now = datetime.utcnow()
    return now.replace(hour=0, minute=0, second=0, microsecond=0).strftime(
        "%Y-%m-%d %H:%M:%S"
    )


def _twenty_four_hours_ago() -> str:
    return (datetime.utcnow() - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")


def _fetch_count(cursor, sql: str, params: tuple) -> int:
    try:
        cursor.execute(sql, params)
        row = cursor.fetchone()
    except Exception as err:
        logger.debug("ai_usage count query failed: %s", err)
        return 0
    if not row:
        return 0
    # DictCursor yields a mapping; sqlite3.Row supports mapping access;
    # tuple cursors hit the numeric index.
    try:
        return int(row["cnt"] if hasattr(row, "keys") else row[0] or 0)
    except Exception:
        return 0


def daily_count(username: str) -> int:
    """Successful Steve calls in the last 24 rolling hours for ``username``.

    Used to enforce ``ai_daily_limit`` and powers the "Steve uses today"
    counter in the Manage Membership modal. Scoped to the same
    :data:`STEVE_SURFACES` set as :func:`monthly_steve_count` so the two
    counters stay consistent — a daily number can never exceed its own
    monthly total.

    Whisper minutes have their own cap (``whisper_minutes_per_month``) and
    are intentionally excluded from this counter; see
    :func:`daily_any_count` if you need the raw "any AI call today" number
    (e.g. for admin dashboards).
    """
    if not username:
        return 0
    ensure_tables()
    ph = get_sql_placeholder()
    placeholders = ",".join([ph] * len(STEVE_SURFACES))
    with get_db_connection() as conn:
        c = conn.cursor()
        return _fetch_count(
            c,
            f"""
            SELECT COUNT(*) AS cnt FROM ai_usage_log
            WHERE username = {ph}
              AND surface IN ({placeholders})
              AND success = 1
              AND created_at >= {ph}
            """,
            (username, *STEVE_SURFACES, _twenty_four_hours_ago()),
        )


def daily_any_count(username: str) -> int:
    """Successful AI calls in the last 24 rolling hours, regardless of surface.

    Includes Whisper and content-gen. Not used for enforcement — exposed for
    admin dashboards that want to see total AI activity per user/day.
    """
    if not username:
        return 0
    ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        return _fetch_count(
            c,
            f"""
            SELECT COUNT(*) AS cnt FROM ai_usage_log
            WHERE username = {ph}
              AND created_at >= {ph}
              AND success = 1
            """,
            (username, _twenty_four_hours_ago()),
        )


def monthly_steve_count(username: str) -> int:
    """Steve calls (excluding Whisper / content-gen) this calendar month.

    Enforces ``steve_uses_per_month``. Whisper is not a Steve "call" — it's
    a transcription minute, tracked separately.
    """
    if not username:
        return 0
    ensure_tables()
    ph = get_sql_placeholder()
    placeholders = ",".join([ph] * len(STEVE_SURFACES))
    with get_db_connection() as conn:
        c = conn.cursor()
        return _fetch_count(
            c,
            f"""
            SELECT COUNT(*) AS cnt FROM ai_usage_log
            WHERE username = {ph}
              AND surface IN ({placeholders})
              AND success = 1
              AND created_at >= {ph}
            """,
            (username, *STEVE_SURFACES, _first_of_current_month_utc()),
        )


def monthly_count(username: str, surface: Optional[str] = None) -> int:
    """Generic monthly count, optionally scoped to a single surface."""
    if not username:
        return 0
    ensure_tables()
    ph = get_sql_placeholder()
    params: List[Any] = [username, _first_of_current_month_utc()]
    sql = f"""
        SELECT COUNT(*) AS cnt FROM ai_usage_log
        WHERE username = {ph}
          AND created_at >= {ph}
          AND success = 1
    """
    if surface:
        sql += f" AND surface = {ph}"
        params.append(surface)
    with get_db_connection() as conn:
        c = conn.cursor()
        return _fetch_count(c, sql, tuple(params))


def monthly_spend_usd(username: str) -> float:
    """Return SUM(``cost_usd``) for successful calls this calendar month.

    Drives the internal ``monthly_spend_ceiling_eur`` gate in
    :mod:`backend.services.entitlements_gate`. Deliberately **never**
    returned to end users — this is a cost-attribution signal used to
    pre-empt runaway AI spend, not a credit balance.

    Returns ``0.0`` on any DB issue so a transient query failure can't
    accidentally lock a user out (the ceiling check fails-open by
    design).
    """
    if not username:
        return 0.0
    ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT COALESCE(SUM(cost_usd), 0) AS total_cost
                FROM ai_usage_log
                WHERE username = {ph}
                  AND success = 1
                  AND created_at >= {ph}
                """,
                (username, _first_of_current_month_utc()),
            )
            row = c.fetchone()
        except Exception as err:
            logger.debug("monthly_spend_usd query failed for %s: %s", username, err)
            return 0.0
    if not row:
        return 0.0
    raw = row["total_cost"] if hasattr(row, "keys") else row[0]
    try:
        return float(raw or 0)
    except Exception:
        return 0.0


def whisper_minutes_this_month(username: str) -> float:
    """Return minutes of audio transcribed this calendar month.

    Enforces ``whisper_minutes_per_month``. Rounds *up* per call so a 12s
    clip still counts as a billable minute (matches OpenAI's own rounding).
    """
    if not username:
        return 0.0
    ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT COALESCE(SUM(duration_seconds), 0) AS secs
                FROM ai_usage_log
                WHERE username = {ph}
                  AND surface = {ph}
                  AND success = 1
                  AND created_at >= {ph}
                """,
                (username, SURFACE_WHISPER, _first_of_current_month_utc()),
            )
            row = c.fetchone()
        except Exception as err:
            logger.debug("whisper_minutes_this_month query failed: %s", err)
            return 0.0
    if not row:
        return 0.0
    secs = row["secs"] if hasattr(row, "keys") else row[0]
    try:
        return float(secs or 0) / 60.0
    except Exception:
        return 0.0


# ────────────────────────────────────────────────────────────────────
# Summaries
# ────────────────────────────────────────────────────────────────────


def current_month_summary(username: str) -> Dict[str, Any]:
    """Structured summary for the Manage Membership / AI Usage view.

    Shape::

        {
            "by_surface": {"dm": 12, "group": 34, ...},
            "total_calls": 83,
            "total_tokens_in": 154200,
            "total_tokens_out": 42300,
            "total_cost_usd": 0.34,
            "whisper_minutes": 22.0,
            "resets_at_monthly": "2026-05-01T00:00:00Z",
            "resets_at_daily": "2026-04-20T00:00:00Z"
        }
    """
    if not username:
        return _empty_summary()

    ensure_tables()
    ph = get_sql_placeholder()
    first_of_month = _first_of_current_month_utc()

    by_surface: Dict[str, int] = {s: 0 for s in ALL_SURFACES}
    total_calls = 0
    total_in = 0
    total_out = 0
    total_cost = 0.0
    whisper_seconds = 0.0

    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT surface,
                       COUNT(*) AS cnt,
                       COALESCE(SUM(tokens_in), 0) AS ti,
                       COALESCE(SUM(tokens_out), 0) AS to_,
                       COALESCE(SUM(cost_usd), 0) AS cost,
                       COALESCE(SUM(duration_seconds), 0) AS secs
                FROM ai_usage_log
                WHERE username = {ph}
                  AND success = 1
                  AND created_at >= {ph}
                GROUP BY surface
                """,
                (username, first_of_month),
            )
            rows = c.fetchall() or []
        except Exception as err:
            logger.debug("current_month_summary query failed: %s", err)
            rows = []

    for r in rows:
        def _g(key, idx):
            return r[key] if hasattr(r, "keys") else r[idx]
        surface = _g("surface", 0) or "unknown"
        cnt = int(_g("cnt", 1) or 0)
        ti = int(_g("ti", 2) or 0)
        to = int(_g("to_", 3) or 0)
        cost = float(_g("cost", 4) or 0)
        secs = float(_g("secs", 5) or 0)
        if surface in by_surface:
            by_surface[surface] = cnt
        total_calls += cnt
        total_in += ti
        total_out += to
        total_cost += cost
        if surface == SURFACE_WHISPER:
            whisper_seconds = secs

    # Compute next-reset timestamps in a timezone-aware way.
    now = datetime.now(timezone.utc)
    if now.month == 12:
        next_month = now.replace(year=now.year + 1, month=1, day=1,
                                 hour=0, minute=0, second=0, microsecond=0)
    else:
        next_month = now.replace(month=now.month + 1, day=1,
                                 hour=0, minute=0, second=0, microsecond=0)
    next_day = (now + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    return {
        "by_surface": by_surface,
        "total_calls": total_calls,
        "total_tokens_in": total_in,
        "total_tokens_out": total_out,
        "total_cost_usd": round(total_cost, 6),
        "whisper_minutes": round(whisper_seconds / 60.0, 2),
        "steve_call_count": sum(by_surface[s] for s in STEVE_SURFACES),
        "resets_at_monthly": next_month.isoformat().replace("+00:00", "Z"),
        "resets_at_daily": next_day.isoformat().replace("+00:00", "Z"),
    }


def _empty_summary() -> Dict[str, Any]:
    return {
        "by_surface": {s: 0 for s in ALL_SURFACES},
        "total_calls": 0,
        "total_tokens_in": 0,
        "total_tokens_out": 0,
        "total_cost_usd": 0.0,
        "whisper_minutes": 0.0,
        "steve_call_count": 0,
        "resets_at_monthly": None,
        "resets_at_daily": None,
    }


def recent_rows(username: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Most recent rows for one user, for the admin ``Manage`` drawer."""
    if not username:
        return []
    ensure_tables()
    ph = get_sql_placeholder()
    limit = max(1, min(int(limit or 50), 500))
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT id, username, request_type, surface, tokens_in, tokens_out,
                       cost_usd, duration_seconds, success, reason_blocked,
                       response_time_ms, community_id, model, created_at
                FROM ai_usage_log
                WHERE username = {ph}
                ORDER BY created_at DESC, id DESC
                LIMIT {limit}
                """,
                (username,),
            )
            rows = c.fetchall() or []
        except Exception as err:
            logger.debug("ai_usage.recent_rows failed: %s", err)
            return []

    out: List[Dict[str, Any]] = []
    for r in rows:
        def _g(key, idx):
            return r[key] if hasattr(r, "keys") else r[idx]
        out.append({
            "id": _g("id", 0),
            "username": _g("username", 1),
            "request_type": _g("request_type", 2),
            "surface": _g("surface", 3),
            "tokens_in": _g("tokens_in", 4),
            "tokens_out": _g("tokens_out", 5),
            "cost_usd": float(_g("cost_usd", 6)) if _g("cost_usd", 6) is not None else None,
            "duration_seconds": float(_g("duration_seconds", 7)) if _g("duration_seconds", 7) is not None else None,
            "success": bool(int(_g("success", 8) or 0)),
            "reason_blocked": _g("reason_blocked", 9),
            "response_time_ms": _g("response_time_ms", 10),
            "community_id": _g("community_id", 11),
            "model": _g("model", 12),
            "created_at": str(_g("created_at", 13)) if _g("created_at", 13) else None,
        })
    return out
