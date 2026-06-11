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
