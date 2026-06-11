"""Community handles — unique @addresses for root communities.

A handle is the community's findable address: globally unique, lowercase
``[a-z0-9-]``, 3-32 chars, root communities only. Display names stay
free-form and may collide; the handle never does. Findability is a
separate owner opt-in (``communities.discoverable``, default OFF) — a
handle existing reveals nothing until the owner lists the address.

This module owns the schema (idempotent ensure), the normalization /
validation rules, unique-handle generation, and the startup backfill for
pre-handle communities. The backfill is deterministic and idempotent:
oldest community (lowest id) keeps the clean slug, later collisions get
``-2``, ``-3``…, and only NULL handles are ever touched, so re-running it
is a no-op. Backfilled communities stay non-discoverable, so nothing is
user-visible until an owner opts in.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from typing import Any, Optional

from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

HANDLE_MIN_LEN = 3
HANDLE_MAX_LEN = 32
HANDLE_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$")

# Handles that can never be claimed: app routes, brand terms, and words
# whose presence in an address would confuse support or impersonate the
# platform. Checked after normalization (lowercase).
RESERVED_HANDLES = frozenset({
    "admin", "administrator", "api", "app", "about", "account", "billing",
    "c-point", "cpoint", "communities", "community", "compose", "contact",
    "dashboard", "directory", "feed", "help", "home", "invite", "invites",
    "join", "login", "logout", "me", "members", "networking", "new",
    "notifications", "official", "premium", "profile", "request",
    "requests", "settings", "signup", "steve", "support", "system", "test",
    "user", "users", "welcome",
})

_COLUMNS_ENSURED = False

# Owner-initiated handle changes are rate-limited so addresses stay stable
# once they start circulating (business cards, bios). Auto-assignment
# (creation/backfill) does not start the clock.
HANDLE_CHANGE_COOLDOWN_DAYS = 30


def ensure_handle_columns() -> None:
    """Idempotently add ``handle`` + ``discoverable`` to ``communities``."""
    global _COLUMNS_ENSURED
    if _COLUMNS_ENSURED:
        return
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            for ddl in (
                "ALTER TABLE communities ADD COLUMN handle VARCHAR(32) NULL",
                "ALTER TABLE communities ADD COLUMN discoverable TINYINT(1) DEFAULT 0",
                "ALTER TABLE communities ADD COLUMN handle_changed_at DATETIME NULL",
                "ALTER TABLE communities ADD UNIQUE INDEX uq_communities_handle (handle)",
            ):
                try:
                    c.execute(ddl)
                except Exception:
                    pass  # already applied
            try:
                conn.commit()
            except Exception:
                pass
        _COLUMNS_ENSURED = True
    except Exception as err:
        logger.warning("ensure_handle_columns failed: %s", err)


def slugify_handle(name: str) -> str:
    """Normalize a display name into handle charset (may be empty)."""
    if not name:
        return ""
    decomposed = unicodedata.normalize("NFKD", str(name))
    ascii_only = decomposed.encode("ascii", "ignore").decode("ascii").lower()
    hyphenated = re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-")
    collapsed = re.sub(r"-{2,}", "-", hyphenated)
    return collapsed[:HANDLE_MAX_LEN].strip("-")


def is_valid_handle(handle: str) -> bool:
    """Charset/length/reserved-word validation for a normalized handle."""
    if not handle or len(handle) < HANDLE_MIN_LEN or len(handle) > HANDLE_MAX_LEN:
        return False
    if handle in RESERVED_HANDLES:
        return False
    return bool(HANDLE_PATTERN.match(handle))


def _handle_taken(cursor: Any, ph: str, handle: str) -> bool:
    cursor.execute(f"SELECT 1 FROM communities WHERE handle = {ph}", (handle,))
    return cursor.fetchone() is not None


def generate_unique_handle(cursor: Any, ph: str, name: str, community_id: int) -> str:
    """Deterministic unique handle for ``name``: clean slug, else ``-2``…

    Falls back to ``community-<id>`` when the name yields nothing usable
    (emoji-only names, one-letter names). Always returns a valid, free
    handle for the cursor's current data.
    """
    base = slugify_handle(name)
    if len(base) < HANDLE_MIN_LEN or base in RESERVED_HANDLES:
        base = f"community-{int(community_id)}"
    base = base[:HANDLE_MAX_LEN].strip("-")

    if is_valid_handle(base) and not _handle_taken(cursor, ph, base):
        return base
    for suffix in range(2, 10_000):
        candidate = f"{base[: HANDLE_MAX_LEN - len(str(suffix)) - 1]}-{suffix}"
        if is_valid_handle(candidate) and not _handle_taken(cursor, ph, candidate):
            return candidate
    # Unreachable in practice; id-based handles are unique by construction.
    return f"community-{int(community_id)}"


def choose_handle_for_creation(
    cursor: Any, ph: str, requested: Optional[str], name: str, community_id: int
) -> str:
    """Creator-picked handle when valid and free; auto-generated otherwise.

    Creation never fails on a bad/taken handle pick — the form's live
    check makes conflicts rare, and the owner can adjust in Manage
    Community, so silent fallback beats blocking the create.
    """
    normalized = (requested or "").strip().lstrip("@").lower()
    if normalized and is_valid_handle(normalized) and not _handle_taken(cursor, ph, normalized):
        return normalized
    return generate_unique_handle(cursor, ph, name, community_id)


def assign_handle_for_new_community(community_id: int, name: str) -> Optional[str]:
    """Generate + persist a handle for a freshly created root community."""
    ensure_handle_columns()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            handle = generate_unique_handle(c, ph, name, community_id)
            c.execute(
                f"UPDATE communities SET handle = {ph} WHERE id = {ph} AND handle IS NULL",
                (handle, int(community_id)),
            )
            conn.commit()
            return handle
    except Exception as err:
        logger.warning("assign_handle_for_new_community failed for %s: %s", community_id, err)
        return None


# ── Owner settings (Manage Community) ───────────────────────────────────


def _has_manage_permission(username: str, community_id: int) -> bool:
    from bodybuilding_app import has_community_management_permission  # type: ignore

    return bool(has_community_management_permission(username, community_id))


def is_handle_available(handle: str) -> bool:
    """True when ``handle`` is valid and unclaimed. Reveals taken/free only
    (standard username-checker semantics) — never which community owns it."""
    normalized = (handle or "").strip().lstrip("@").lower()
    if not is_valid_handle(normalized):
        return False
    ensure_handle_columns()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            return not _handle_taken(c, get_sql_placeholder(), normalized)
    except Exception as err:
        logger.warning("is_handle_available failed: %s", err)
        return False


def get_handle_settings(username: str, community_id: int):
    """Return (payload, status) for the manage-community handle card."""
    if not _has_manage_permission(username, community_id):
        return {"success": False, "error": "Forbidden"}, 403
    ensure_handle_columns()
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"SELECT handle, discoverable, handle_changed_at, parent_community_id "
            f"FROM communities WHERE id = {ph}",
            (int(community_id),),
        )
        row = c.fetchone()
    if not row:
        return {"success": False, "error": "Community not found"}, 404
    get = (lambda k, i: row[k] if hasattr(row, "keys") else row[i])
    parent_id = get("parent_community_id", 3)
    if parent_id is not None:
        return {"success": False, "error": "Handles belong to root communities"}, 400
    changed_at = get("handle_changed_at", 2)
    can_change, days_left = _cooldown_state(changed_at)
    return {
        "success": True,
        "handle": get("handle", 0),
        "discoverable": bool(get("discoverable", 1) or 0),
        "can_change_handle": can_change,
        "cooldown_days_remaining": days_left,
    }, 200


def _cooldown_state(changed_at) -> tuple:
    if not changed_at:
        return True, 0
    from datetime import datetime, timedelta

    try:
        parsed = changed_at if hasattr(changed_at, "year") else datetime.strptime(str(changed_at), "%Y-%m-%d %H:%M:%S")
        unlock = parsed + timedelta(days=HANDLE_CHANGE_COOLDOWN_DAYS)
        remaining = (unlock - datetime.utcnow()).days
        if remaining > 0:
            return False, remaining
    except Exception:
        pass
    return True, 0


def update_handle_settings(username: str, community_id: int, *, handle=None, discoverable=None):
    """Owner/admin update of handle and/or findability. Returns (payload, status).

    Handle changes: validated, uniqueness re-checked atomically against the
    UNIQUE index, and rate-limited (one change per 30 days). The findability
    toggle requires a saved handle — an unlisted address can't be opened.
    """
    if not _has_manage_permission(username, community_id):
        return {"success": False, "error": "Forbidden"}, 403
    ensure_handle_columns()
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"SELECT handle, discoverable, handle_changed_at, parent_community_id "
            f"FROM communities WHERE id = {ph}",
            (int(community_id),),
        )
        row = c.fetchone()
        if not row:
            return {"success": False, "error": "Community not found"}, 404
        get = (lambda k, i: row[k] if hasattr(row, "keys") else row[i])
        if get("parent_community_id", 3) is not None:
            return {"success": False, "error": "Handles belong to root communities"}, 400

        current_handle = get("handle", 0)
        new_handle = None
        if handle is not None:
            new_handle = str(handle).strip().lstrip("@").lower()
            if new_handle == (current_handle or ""):
                new_handle = None  # no-op
            else:
                if not is_valid_handle(new_handle):
                    return {"success": False, "error": "invalid_handle", "reason": "invalid_handle"}, 400
                can_change, days_left = _cooldown_state(get("handle_changed_at", 2))
                if not can_change:
                    return {
                        "success": False,
                        "error": "handle_cooldown",
                        "reason": "handle_cooldown",
                        "cooldown_days_remaining": days_left,
                    }, 429
                if _handle_taken(c, ph, new_handle):
                    return {"success": False, "error": "handle_taken", "reason": "handle_taken"}, 409

        if new_handle is not None:
            from datetime import datetime

            now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
            try:
                c.execute(
                    f"UPDATE communities SET handle = {ph}, handle_changed_at = {ph} WHERE id = {ph}",
                    (new_handle, now_str, int(community_id)),
                )
            except Exception:
                # Lost the race to the UNIQUE index between check and write.
                return {"success": False, "error": "handle_taken", "reason": "handle_taken"}, 409

        if discoverable is not None:
            effective_handle = new_handle or current_handle
            if bool(discoverable) and not effective_handle:
                return {"success": False, "error": "handle_required", "reason": "handle_required"}, 400
            c.execute(
                f"UPDATE communities SET discoverable = {ph} WHERE id = {ph}",
                (1 if bool(discoverable) else 0, int(community_id)),
            )

        conn.commit()
        c.execute(
            f"SELECT handle, discoverable, handle_changed_at FROM communities WHERE id = {ph}",
            (int(community_id),),
        )
        fresh = c.fetchone()
    fget = (lambda k, i: fresh[k] if hasattr(fresh, "keys") else fresh[i])
    can_change, days_left = _cooldown_state(fget("handle_changed_at", 2))
    return {
        "success": True,
        "handle": fget("handle", 0),
        "discoverable": bool(fget("discoverable", 1) or 0),
        "can_change_handle": can_change,
        "cooldown_days_remaining": days_left,
    }, 200


def backfill_missing_handles() -> int:
    """Assign handles to root communities that predate the feature.

    Deterministic (ordered by id — oldest wins the clean slug) and
    idempotent (only NULL handles are filled; discoverable stays 0).
    Returns the number of rows updated.
    """
    ensure_handle_columns()
    updated = 0
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(
                "SELECT id, name FROM communities "
                "WHERE handle IS NULL AND parent_community_id IS NULL "
                "ORDER BY id ASC"
            )
            rows = c.fetchall()
            for row in rows:
                cid = row["id"] if hasattr(row, "keys") else row[0]
                name = row["name"] if hasattr(row, "keys") else row[1]
                handle = generate_unique_handle(c, ph, name or "", int(cid))
                c.execute(
                    f"UPDATE communities SET handle = {ph} WHERE id = {ph} AND handle IS NULL",
                    (handle, int(cid)),
                )
                updated += 1
            try:
                conn.commit()
            except Exception:
                pass
    except Exception as err:
        logger.warning("backfill_missing_handles failed: %s", err)
    if updated:
        logger.info("community handle backfill assigned %d handles", updated)
    return updated
