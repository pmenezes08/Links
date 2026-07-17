"""Weekly member digest — the member-side return loop.

Once a week, each member of a community that actually had activity gets one
templated, recipient-locale push (+ in-app row): how many new posts landed in
their most active community, deep-linking into that feed. No AI call — this
is i18n templates over counts computed at send time (same doctrine as the
owner pulse in ``owner_pulse.py``).

Rules:
* **Disabled by default** — real sends require ``MEMBER_DIGEST_ENABLED`` to
  be truthy. Staging keeps it off (staging shares the prod Cloud SQL
  instance, so a staging cron run must never push to real members);
  ``dry_run=1`` works regardless and writes/sends nothing.
* One digest per member per ISO week (``member_digest_sends``,
  INSERT-first UNIQUE(username, week_key)) so Scheduler retries stay
  idempotent. At-most-once: push failure after the reservation is logged
  and dropped, never re-sent.
* A member of several communities gets ONE digest, for the community with
  the most new posts this week.
* Quiet communities are skipped (fewer than ``MIN_NEW_POSTS`` new posts by
  OTHER people this week) — a digest about nothing trains people to ignore
  the channel. Community owners are skipped too: they get the owner pulse.
* Every send writes a ``digest_sent`` retention_events row so tap-through
  (``digest_opened``, fired by the client from the ``?source=`` param) is
  measurable against sends.
* ``max_sends`` caps one run (default 500) so the first enabled run on a
  large instance can be throttled and observed.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.owner_pulse import week_key

logger = logging.getLogger(__name__)

MIN_NEW_POSTS = 3
DEFAULT_MAX_SENDS = 500

_DEDUP_DDL = """
CREATE TABLE IF NOT EXISTS member_digest_sends (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(191) NOT NULL,
    community_id INT NOT NULL,
    week_key CHAR(10) NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_member_week (username, week_key)
)
"""


def _enabled() -> bool:
    return (os.environ.get("MEMBER_DIGEST_ENABLED") or "").strip().lower() in {"1", "true", "yes", "on"}


def _ensure_dedup_table(cursor) -> None:
    try:
        cursor.execute(_DEDUP_DDL)
    except Exception:  # pragma: no cover - table exists / limited env
        pass


def _candidates(cursor, ph: str) -> List[Dict[str, Any]]:
    """One row per member: their community with the most posts by OTHER
    members this week (>= MIN_NEW_POSTS). Owners and the platform 'admin'
    are excluded — owners have the pulse."""
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute(
        f"""
        SELECT u.username, co.id AS community_id, co.name, COUNT(p.id) AS new_posts
        FROM user_communities uc
        JOIN users u ON u.id = uc.user_id
        JOIN communities co ON co.id = uc.community_id
        JOIN posts p ON p.community_id = co.id
            AND p.timestamp >= {ph}
            AND LOWER(COALESCE(p.username, '')) <> LOWER(u.username)
        WHERE LOWER(u.username) <> 'admin'
          AND LOWER(COALESCE(co.creator_username, '')) <> LOWER(u.username)
        GROUP BY u.username, co.id, co.name
        HAVING COUNT(p.id) >= {MIN_NEW_POSTS}
        """,
        (week_ago,),
    )
    best_per_member: Dict[str, Dict[str, Any]] = {}
    for r in cursor.fetchall() or []:
        row = {
            "username": (r["username"] if hasattr(r, "keys") else r[0]) or "",
            "community_id": int(r["community_id"] if hasattr(r, "keys") else r[1]),
            "name": r["name"] if hasattr(r, "keys") else r[2],
            "new_posts": int((r["new_posts"] if hasattr(r, "keys") else r[3]) or 0),
        }
        key = row["username"].strip().lower()
        if not key:
            continue
        current = best_per_member.get(key)
        if current is None or row["new_posts"] > current["new_posts"]:
            best_per_member[key] = row
    return list(best_per_member.values())


def _try_reserve(cursor, username: str, community_id: int, wk: str) -> bool:
    """INSERT-first dedup: False when this member already got this week's digest."""
    ph = get_sql_placeholder()
    try:
        cursor.execute(
            f"INSERT INTO member_digest_sends (username, community_id, week_key) VALUES ({ph}, {ph}, {ph})",
            (username, community_id, wk),
        )
        return True
    except Exception:
        return False


def run_weekly_digest(*, dry_run: bool = False, max_sends: int = DEFAULT_MAX_SENDS) -> Dict[str, Any]:
    """Send this week's member digests. Returns send/skip counters."""
    from backend.services import notification_copy, retention_events
    from backend.services.notifications import create_notification, send_push_to_user

    result = {
        "success": True,
        "dry_run": dry_run,
        "enabled": _enabled(),
        "candidates": 0,
        "sent": 0,
        "skipped_dedup": 0,
        "skipped_cap": 0,
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
                {"username": cand["username"], "community_id": cand["community_id"],
                 "new_posts": cand["new_posts"]}
                for cand in candidates[:100]
            ]
            return result

        if not _enabled():
            result["success"] = False
            result["error"] = "MEMBER_DIGEST_ENABLED is off"
            return result

        for cand in candidates:
            if result["sent"] >= max(0, int(max_sends)):
                result["skipped_cap"] += 1
                continue
            try:
                if not _try_reserve(c, cand["username"], cand["community_id"], wk):
                    result["skipped_dedup"] += 1
                    continue
                try:
                    conn.commit()
                except Exception:
                    pass

                member = cand["username"]
                locale = notification_copy.recipient_locale(member)
                params = {"community": cand["name"], "posts": cand["new_posts"]}
                url = (
                    f"/community_feed_react/{cand['community_id']}"
                    f"?source=weekly_digest_push"
                )

                payload = notification_copy.push_payload("member_digest", locale, **params)
                send_push_to_user(member, {
                    "title": payload["title"],
                    "body": payload["body"],
                    "url": url,
                    "tag": f"member-digest-{cand['community_id']}-{wk}",
                })
                create_notification(
                    user_id=member,
                    from_user="steve",
                    notification_type="member_digest",
                    community_id=cand["community_id"],
                    message=notification_copy.in_app_text("member_digest", locale, **params),
                    link=url,
                )
                retention_events.record_event(
                    member,
                    event_type="digest_sent",
                    source="weekly_digest_cron",
                    community_id=cand["community_id"],
                )
                result["sent"] += 1
            except Exception as exc:
                # At-most-once by design: the reservation stands, the miss is
                # logged. A skipped weekly digest beats a double push.
                logger.error("member digest failed for %s: %s", cand.get("username"), exc, exc_info=True)
                result["errors"] += 1

    return result
