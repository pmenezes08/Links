"""Human-peer DM typing reads (``typing_status`` table).

Steve's typing indicator is separate (``steve_dm_typing.py``, Redis flags).
The freshness TTL mirrors the monolith ``GET /api/typing`` handler
(``TYPING_TTL_SECONDS = 5`` in ``bodybuilding_app.py``) — writes land via
``POST /api/typing`` and go stale after this window.

Used to piggyback ``peer_is_typing`` onto the ``/get_messages`` poll response
so chat clients see typing state on every poll instead of a separate,
lower-cadence ``/api/typing`` request.
"""

from __future__ import annotations

import logging
from datetime import datetime

from backend.services.database import get_db_connection

logger = logging.getLogger(__name__)

TYPING_TTL_SECONDS = 5


def _typing_row_is_fresh(is_typing: object, updated_at: object) -> bool:
    if not is_typing:
        return False
    if isinstance(updated_at, datetime):
        last = updated_at
    else:
        raw = str(updated_at or "").strip()
        if not raw:
            return False
        try:
            if "T" in raw:
                last = datetime.fromisoformat(raw[:19])
            else:
                last = datetime.strptime(raw[:19], "%Y-%m-%d %H:%M:%S")
        except Exception:
            return False
    return (datetime.now() - last).total_seconds() <= TYPING_TTL_SECONDS


def peer_is_typing_for_viewer(viewer_username: str, other_user_id: object) -> bool:
    """True when the DM peer (by ``users.id``) is typing to ``viewer_username`` right now.

    Never raises — typing is auxiliary UX and must not break the message poll.
    """
    if not viewer_username or not other_user_id:
        return False
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT username FROM users WHERE id = ?", (other_user_id,))
            row = c.fetchone()
            if not row:
                return False
            peer_username = row["username"] if hasattr(row, "keys") else row[0]
            c.execute(
                "SELECT is_typing, updated_at FROM typing_status WHERE user = ? AND peer = ?",
                (peer_username, viewer_username),
            )
            trow = c.fetchone()
            if not trow:
                return False
            if hasattr(trow, "keys"):
                return _typing_row_is_fresh(trow["is_typing"], trow["updated_at"])
            return _typing_row_is_fresh(trow[0], trow[1])
    except Exception as e:
        logger.debug("peer_is_typing_for_viewer failed (non-fatal): %s", e)
        return False
