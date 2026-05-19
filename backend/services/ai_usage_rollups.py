"""Daily aggregates of ``ai_usage_log`` for admin metrics (avoids full-table scans)."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)


def ensure_tables() -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS ai_usage_daily_rollups (
                rollup_date DATE NOT NULL,
                username VARCHAR(64) NOT NULL,
                surface VARCHAR(64) NOT NULL,
                success_rows INT NOT NULL DEFAULT 0,
                credits_debited DECIMAL(12, 3) NOT NULL DEFAULT 0,
                cost_usd DECIMAL(12, 6) NOT NULL DEFAULT 0,
                PRIMARY KEY (rollup_date, username, surface)
            )
            """
        )
        try:
            c.execute(
                "CREATE INDEX idx_ai_usage_rollups_date ON ai_usage_daily_rollups (rollup_date)"
            )
        except Exception:
            pass
        conn.commit()


def rollup_day(target: Optional[date] = None) -> Dict[str, Any]:
    """Aggregate one UTC calendar day into ``ai_usage_daily_rollups``."""
    ensure_tables()
    day = target or (datetime.now(timezone.utc).date() - timedelta(days=1))
    start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO ai_usage_daily_rollups
                (rollup_date, username, surface, success_rows, credits_debited, cost_usd)
            SELECT
                {ph} AS rollup_date,
                username,
                surface,
                SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_rows,
                COALESCE(SUM(CASE WHEN success = 1 THEN credits_debited ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN success = 1 THEN cost_usd ELSE 0 END), 0)
            FROM ai_usage_log
            WHERE created_at >= {ph} AND created_at < {ph}
            GROUP BY username, surface
            ON DUPLICATE KEY UPDATE
                success_rows = VALUES(success_rows),
                credits_debited = VALUES(credits_debited),
                cost_usd = VALUES(cost_usd)
            """,
            (day, start, end),
        )
        affected = c.rowcount
        conn.commit()
    logger.info("ai_usage rollup for %s: %s rows touched", day, affected)
    return {"rollup_date": str(day), "rows_affected": affected}


def recent_totals(*, days: int = 30) -> List[Dict[str, Any]]:
    """Return per-day credit totals for the last N days (admin dashboards)."""
    ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT rollup_date,
                   SUM(success_rows) AS calls,
                   SUM(credits_debited) AS credits,
                   SUM(cost_usd) AS cost_usd
            FROM ai_usage_daily_rollups
            WHERE rollup_date >= DATE_SUB(CURDATE(), INTERVAL {ph} DAY)
            GROUP BY rollup_date
            ORDER BY rollup_date DESC
            """,
            (int(days),),
        )
        rows = c.fetchall() or []
    out: List[Dict[str, Any]] = []
    for row in rows:
        if hasattr(row, "keys"):
            out.append(dict(row))
        else:
            out.append(
                {
                    "rollup_date": row[0],
                    "calls": row[1],
                    "credits": row[2],
                    "cost_usd": row[3],
                }
            )
    return out
