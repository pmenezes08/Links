"""Steve's spotlight question on the dashboard.

One quiet card, one question at a time, finite lifecycle: Steve may
surface one unanswered spotlight question on the dashboard; answering
writes that single answer into the profile (verbatim — no AI rewriting)
and the card leaves; skipping retires the question, with one re-offer 30
days later, then permanent silence. New questions start at most weekly
and respect the shared one-profile-ask-per-day budget
(``last_profile_ask_at`` — the same marker the section-prompt cron uses).

The answers live in ``users.personal_highlight_answers`` — this service
does a read-merge-write of the single key, because the legacy
``/update_personal_info`` endpoint rebuilds the whole blob and would wipe
the other answers. Ask/skip state lives in the ``steve_onboarding``
Firestore doc (the established markers pattern).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.onboarding_session import _parse_iso_utc
from backend.services.profile_structured_fields import (
    MAX_PERSONAL_HIGHLIGHT_LEN,
    PERSONAL_HIGHLIGHT_ORDER,
    _clip,
)

logger = logging.getLogger(__name__)

# A skipped question is offered once more after this long, then retired.
SKIP_REOFFER_DAYS = 30
# A new question starts at most this often.
SPOTLIGHT_CADENCE_DAYS = 7
# Shared budget with every other profile ask (sections cron etc.).
PROFILE_ASK_BUDGET_HOURS = 24

MARKER_SPOTLIGHT = "spotlight"
MARKER_LAST_RESOLVED = "last_spotlight_resolved_at"
MARKER_LAST_PROFILE_ASK = "last_profile_ask_at"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _doc_ref(username: str):
    from backend.services.firestore_reads import _get_client

    return _get_client().collection("steve_onboarding").document(username)


def read_markers(username: str) -> Dict[str, Any]:
    try:
        snap = _doc_ref(username).get()
        return (snap.to_dict() or {}) if getattr(snap, "exists", True) else {}
    except Exception as exc:
        logger.warning("spotlight markers read failed for %s: %s", username, exc)
        return {}


def write_markers(username: str, payload: Dict[str, Any]) -> None:
    try:
        _doc_ref(username).set(payload, merge=True)
    except Exception as exc:
        logger.warning("spotlight markers write failed for %s: %s", username, exc)


def _read_answers(username: str) -> Dict[str, str]:
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(
                f"SELECT personal_highlight_answers FROM users WHERE username = {ph}",
                (username,),
            )
            row = c.fetchone()
        raw = (row["personal_highlight_answers"] if hasattr(row, "keys") else row[0]) if row else None
        if not raw:
            return {}
        data = json.loads(raw) if isinstance(raw, str) else raw
        return data if isinstance(data, dict) else {}
    except Exception as exc:
        logger.warning("spotlight answers read failed for %s: %s", username, exc)
        return {}


def question_eligible(qid: str, answers: Dict[str, str], spotlight_state: Dict[str, Any], now: datetime) -> bool:
    """Unanswered, and either never skipped or due its single re-offer."""
    if str(answers.get(qid) or "").strip():
        return False
    state = spotlight_state.get(qid) if isinstance(spotlight_state.get(qid), dict) else {}
    skip_count = int(state.get("skip_count") or 0)
    if skip_count == 0:
        return True
    if skip_count >= 2:
        return False
    skipped_at = _parse_iso_utc(state.get("skipped_at"))
    return bool(skipped_at and now - skipped_at >= timedelta(days=SKIP_REOFFER_DAYS))


def pick_spotlight_ask(
    answers: Dict[str, str], doc: Dict[str, Any], now: datetime
) -> Optional[str]:
    """The question id to show right now, or None (cadence/budget/none left)."""
    last_ask = _parse_iso_utc(doc.get(MARKER_LAST_PROFILE_ASK))
    if last_ask and now - last_ask < timedelta(hours=PROFILE_ASK_BUDGET_HOURS):
        return None
    last_resolved = _parse_iso_utc(doc.get(MARKER_LAST_RESOLVED))
    if last_resolved and now - last_resolved < timedelta(days=SPOTLIGHT_CADENCE_DAYS):
        return None
    spotlight_state = doc.get(MARKER_SPOTLIGHT) if isinstance(doc.get(MARKER_SPOTLIGHT), dict) else {}
    for qid in PERSONAL_HIGHLIGHT_ORDER:
        if question_eligible(qid, answers, spotlight_state, now):
            return qid
    return None


def get_spotlight_ask(username: str) -> Tuple[Dict[str, Any], int]:
    now = _now()
    answers = _read_answers(username)
    doc = read_markers(username)
    qid = pick_spotlight_ask(answers, doc, now)
    return {"success": True, "ask": ({"id": qid} if qid else None)}, 200


def merge_answer(username: str, qid: str, text: str) -> bool:
    """Read-merge-write of one answer key; siblings are never touched."""
    clipped = _clip(text, MAX_PERSONAL_HIGHLIGHT_LEN)
    if not clipped:
        return False
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(
                f"SELECT personal_highlight_answers FROM users WHERE username = {ph}",
                (username,),
            )
            row = c.fetchone()
            raw = (row["personal_highlight_answers"] if hasattr(row, "keys") else row[0]) if row else None
            data: Dict[str, str] = {}
            if raw:
                try:
                    parsed = json.loads(raw) if isinstance(raw, str) else raw
                    if isinstance(parsed, dict):
                        data = parsed
                except Exception:
                    data = {}
            data[qid] = clipped
            c.execute(
                f"UPDATE users SET personal_highlight_answers = {ph} WHERE username = {ph}",
                (json.dumps(data, ensure_ascii=False), username),
            )
            conn.commit()
        return True
    except Exception as exc:
        logger.warning("spotlight answer merge failed for %s/%s: %s", username, qid, exc)
        return False


def resolve_spotlight_ask(
    username: str, qid: str, action: str, text: Optional[str] = None
) -> Tuple[Dict[str, Any], int]:
    """Answer or skip the question; both end the card and start the clocks."""
    if qid not in PERSONAL_HIGHLIGHT_ORDER:
        return {"success": False, "error": "Unknown question"}, 400
    if action not in ("answer", "skip"):
        return {"success": False, "error": "Invalid action"}, 400

    now = _now()
    now_iso = now.isoformat()

    if action == "answer":
        if not (text or "").strip():
            return {"success": False, "error": "Answer required"}, 400
        if not merge_answer(username, qid, str(text)):
            return {"success": False, "error": "Could not save"}, 500
        try:
            from redis_cache import invalidate_user_cache

            invalidate_user_cache(username)
        except Exception:
            pass
        try:
            # The answer should reach Steve: re-analyze and queue KB synthesis,
            # same hooks the profile editor fires.
            from bodybuilding_app import _trigger_background_profile_analysis

            _trigger_background_profile_analysis(username)
        except Exception:
            pass
        write_markers(username, {MARKER_LAST_RESOLVED: now_iso, MARKER_LAST_PROFILE_ASK: now_iso})
        return {"success": True, "saved": True}, 200

    # Skip: bump the per-question lifecycle and start the cadence clocks.
    doc = read_markers(username)
    spotlight_state = doc.get(MARKER_SPOTLIGHT) if isinstance(doc.get(MARKER_SPOTLIGHT), dict) else {}
    state = spotlight_state.get(qid) if isinstance(spotlight_state.get(qid), dict) else {}
    write_markers(
        username,
        {
            MARKER_SPOTLIGHT: {
                **spotlight_state,
                qid: {"skip_count": int(state.get("skip_count") or 0) + 1, "skipped_at": now_iso},
            },
            MARKER_LAST_RESOLVED: now_iso,
            MARKER_LAST_PROFILE_ASK: now_iso,
        },
    )
    return {"success": True, "saved": False}, 200
