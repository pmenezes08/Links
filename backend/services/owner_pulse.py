"""Weekly Steve pulse for community owners — the dashboard's return loop.

Once a week, each owner of a root community with real activity gets one
templated, payoff-first push (+ in-app row) in their own locale: how many
members were active this week, deep-linking into the Owner Dashboard. No AI
call anywhere — Steve's voice here is i18n templates over numbers computed
at send time.

Rules:
* One pulse per owner per ISO week, enforced by an ``owner_pulse_sends``
  dedup table (INSERT-first, UNIQUE(username, week_key)) so Cloud Scheduler
  retries stay idempotent. At-most-once: a push failure after the insert is
  logged and dropped, never double-sent.
* An owner with several root communities gets ONE pulse, for the network
  with the most members.
* Quiet weeks are skipped entirely — "0 members were active" is a shame-gram,
  not a pulse (payoff-first, never deficit-framed).
* Kill-switch: real sends require ``OWNER_PULSE_ENABLED`` to be truthy;
  ``dry_run`` works regardless and writes/sends nothing.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

_DEDUP_DDL = """
CREATE TABLE IF NOT EXISTS owner_pulse_sends (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(191) NOT NULL,
    community_id INT NOT NULL,
    week_key CHAR(10) NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_owner_week (username, week_key)
)
"""


def _enabled() -> bool:
    return (os.environ.get("OWNER_PULSE_ENABLED") or "").strip().lower() in {"1", "true", "yes", "on"}


def week_key(now: Optional[datetime] = None) -> str:
    """ISO year-week, e.g. '2026-W28' — the dedup granularity."""
    now = now or datetime.now(timezone.utc)
    return now.strftime("%G-W%V")


def _ensure_dedup_table(cursor) -> None:
    try:
        cursor.execute(_DEDUP_DDL)
    except Exception:  # pragma: no cover - table exists / limited env
        pass


def _candidates(cursor, ph: str) -> List[Dict[str, Any]]:
    """One row per owner: their largest root community (by member count,
    platform 'admin' excluded) that has at least one member besides them."""
    cursor.execute(
        f"""
        SELECT co.id, co.name, co.creator_username, COUNT(uc.id) AS member_count
        FROM communities co
        JOIN user_communities uc ON uc.community_id = co.id
            AND uc.user_id NOT IN (SELECT id FROM users WHERE LOWER(username) = 'admin')
        JOIN users u ON uc.user_id = u.id AND LOWER(u.username) <> LOWER(co.creator_username)
        WHERE co.parent_community_id IS NULL
          AND co.creator_username IS NOT NULL
          AND LOWER(co.creator_username) <> 'admin'
        GROUP BY co.id, co.name, co.creator_username
        HAVING COUNT(uc.id) >= 1
        """,
    )
    best_per_owner: Dict[str, Dict[str, Any]] = {}
    for r in cursor.fetchall() or []:
        row = {
            "community_id": int(r["id"] if hasattr(r, "keys") else r[0]),
            "name": r["name"] if hasattr(r, "keys") else r[1],
            "owner": (r["creator_username"] if hasattr(r, "keys") else r[2]) or "",
            "members": int((r["member_count"] if hasattr(r, "keys") else r[3]) or 0),
        }
        key = row["owner"].strip().lower()
        if not key:
            continue
        current = best_per_owner.get(key)
        if current is None or row["members"] > current["members"]:
            best_per_owner[key] = row
    return list(best_per_owner.values())


def _week_numbers(cursor, ph: str, community_id: int) -> Dict[str, int]:
    """This week's active members + prior week's, across the whole subtree
    (the owner owns the apex, so network numbers are theirs to see)."""
    from backend.services.community import get_descendant_community_ids
    from backend.services.community_analytics import _active_users

    try:
        ids = [int(cid) for cid in get_descendant_community_ids(cursor, community_id)] or [community_id]
    except Exception:
        ids = [community_id]
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
    two_weeks_ago = (now - timedelta(days=14)).strftime("%Y-%m-%d %H:%M:%S")
    wau = _active_users(cursor, ph, ids, week_ago)
    wau_prev = _active_users(cursor, ph, ids, two_weeks_ago, until=week_ago)
    return {"wau": wau, "wau_prev": wau_prev}


def _try_reserve(cursor, owner: str, community_id: int, wk: str) -> bool:
    """INSERT-first dedup: False when this owner already got this week's pulse."""
    ph = get_sql_placeholder()
    try:
        cursor.execute(
            f"INSERT INTO owner_pulse_sends (username, community_id, week_key) VALUES ({ph}, {ph}, {ph})",
            (owner, community_id, wk),
        )
        return True
    except Exception:
        return False


def run_weekly_pulse(*, dry_run: bool = False) -> Dict[str, Any]:
    """Send this week's owner pulses. Returns send/skip counters."""
    from backend.services import notification_copy
    from backend.services.notifications import create_notification, send_push_to_user

    result = {
        "success": True,
        "dry_run": dry_run,
        "enabled": _enabled(),
        "candidates": 0,
        "sent": 0,
        "skipped_dedup": 0,
        "skipped_quiet": 0,
        "errors": 0,
    }
    wk = week_key()

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        _ensure_dedup_table(c)
        candidates = _candidates(c, ph)
        result["candidates"] = len(candidates)

        if dry_run:
            result["preview"] = [
                {"owner": cand["owner"], "community_id": cand["community_id"],
                 "members": cand["members"], **_week_numbers(c, ph, cand["community_id"])}
                for cand in candidates[:100]
            ]
            return result

        if not _enabled():
            result["success"] = False
            result["error"] = "OWNER_PULSE_ENABLED is off"
            return result

        for cand in candidates:
            try:
                numbers = _week_numbers(c, ph, cand["community_id"])
                if numbers["wau"] <= 0:
                    result["skipped_quiet"] += 1
                    continue
                if not _try_reserve(c, cand["owner"], cand["community_id"], wk):
                    result["skipped_dedup"] += 1
                    continue
                try:
                    conn.commit()
                except Exception:
                    pass

                owner = cand["owner"]
                locale = notification_copy.recipient_locale(owner)
                delta = numbers["wau"] - numbers["wau_prev"]
                event = "owner_pulse_up" if delta > 0 else "owner_pulse"
                params = {"community": cand["name"], "wau": numbers["wau"], "delta": delta}
                url = f"/community/{cand['community_id']}/owner"

                payload = notification_copy.push_payload(event, locale, **params)
                send_push_to_user(owner, {
                    "title": payload["title"],
                    "body": payload["body"],
                    "url": url,
                    "tag": f"owner-pulse-{cand['community_id']}-{wk}",
                })
                create_notification(
                    user_id=owner,
                    from_user="steve",
                    notification_type="owner_pulse",
                    community_id=cand["community_id"],
                    message=notification_copy.in_app_text(event, locale, **params),
                    link=url,
                )
                result["sent"] += 1
            except Exception as exc:
                # At-most-once by design: the reservation stands, the miss is
                # logged. A skipped weekly digest beats a double push.
                logger.error("owner pulse failed for %s: %s", cand.get("owner"), exc, exc_info=True)
                result["errors"] += 1

    return result
