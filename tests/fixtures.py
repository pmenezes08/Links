"""Factories for the MySQL-backed tests.

These are plain functions (not pytest fixtures) so any test can import
them directly. They intentionally bypass the production entry points
(Flask blueprints, webhook handlers) because we're testing service-level
invariants, not HTTP contracts. For HTTP-level smoke tests see
``scripts/staging_smoke.ps1``.

Design conventions:

  * Every helper is **idempotent / forgiving** — re-running with the
    same args should not explode.
  * All timestamps default to UTC and accept ``datetime`` or ``None``.
  * Returns a dict describing the row that was inserted so tests can
    chain without re-fetching.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from backend.services.database import get_db_connection, get_sql_placeholder


def _now_str() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def _fmt(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.strftime("%Y-%m-%d %H:%M:%S")


# ── Users ───────────────────────────────────────────────────────────────


def make_user(
    username: str,
    *,
    subscription: str = "free",
    is_special: bool = False,
    created_at: Optional[datetime] = None,
    email: Optional[str] = None,
    is_admin: bool = False,
) -> Dict[str, Any]:
    """Insert a minimal user row.

    ``subscription`` mirrors the production enum: ``'free'``,
    ``'premium'``, ``'pro'``, ``'paid'``.
    """
    ph = get_sql_placeholder()
    created_str = _fmt(created_at) or _now_str()
    email = email or f"{username}@test.local"
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO users (username, email, subscription, is_special, is_admin, created_at)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """,
            (username, email, subscription, 1 if is_special else 0,
             1 if is_admin else 0, created_str),
        )
        try:
            conn.commit()
        except Exception:
            pass
    return {
        "username": username,
        "email": email,
        "subscription": subscription,
        "is_special": bool(is_special),
        "created_at": created_str,
    }


# ── ai_usage_log ────────────────────────────────────────────────────────


def log_row(
    username: str,
    *,
    surface: str,
    success: bool = True,
    duration_seconds: Optional[float] = None,
    tokens_in: Optional[int] = None,
    tokens_out: Optional[int] = None,
    cost_usd: Optional[float] = None,
    reason_blocked: Optional[str] = None,
    community_id: Optional[int] = None,
    created_at: Optional[datetime] = None,
    request_type: Optional[str] = None,
) -> None:
    """Insert one raw ``ai_usage_log`` row with a custom ``created_at``.

    Unlike ``ai_usage.log_usage`` this accepts a fabricated timestamp so
    tests can verify month-boundary semantics (e.g. a row from the
    previous calendar month must NOT count toward the current-month
    counter).
    """
    ph = get_sql_placeholder()
    rtype = (request_type or surface)[:50]
    created_str = _fmt(created_at) or _now_str()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO ai_usage_log
                (username, request_type, surface, tokens_in, tokens_out,
                 cost_usd, duration_seconds, success, reason_blocked,
                 community_id, created_at)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph},
                    {ph}, {ph})
            """,
            (username, rtype, surface, tokens_in, tokens_out, cost_usd,
             duration_seconds, 1 if success else 0, reason_blocked,
             community_id, created_str),
        )
        try:
            conn.commit()
        except Exception:
            pass


def log_rows(username: str, surface: str, n: int, **kwargs) -> None:
    """Bulk insert ``n`` identical successful rows for a user."""
    for _ in range(n):
        log_row(username, surface=surface, **kwargs)


# ── Knowledge Base ──────────────────────────────────────────────────────


def seed_kb(pages: Optional[Iterable[Dict[str, Any]]] = None) -> Dict[str, int]:
    """Seed the KB with either a custom set of pages or the full default set.

    Tests that only need *one* KB page (e.g. to override
    ``steve_uses_per_month_user_facing``) should pass a minimal list to
    keep the test fast. Tests that want realistic defaults can call
    ``seed_kb()`` with no args to run the production seed.
    """
    from backend.services import knowledge_base as kb
    if pages is None:
        return kb.seed_default_pages(force=True)

    ph = get_sql_placeholder()
    now = _now_str()
    inserted = 0
    # Upsert semantics — tests frequently chain ``kb_override_field`` +
    # ``seed_kb`` on the same slug (e.g. override a scalar cap, then
    # replace the page with a richer one). MySQL gives us
    # ``INSERT ... ON DUPLICATE KEY UPDATE``; SQLite uses
    # ``INSERT OR REPLACE``. Both preserve the PK on conflict.
    with get_db_connection() as conn:
        c = conn.cursor()
        for seed in pages:
            params = (
                seed["slug"], seed.get("title") or seed["slug"],
                seed.get("category") or "reference", seed.get("icon"),
                seed.get("description"), seed.get("sort_order", 0),
                json.dumps(seed.get("fields") or []),
                json.dumps(seed.get("field_groups") or []),
                seed.get("body") or "",
                "test-fixture", now, now,
            )
            if ph == "%s":  # MySQL
                c.execute(
                    f"""
                    INSERT INTO kb_pages
                        (slug, title, category, icon, description, sort_order,
                         fields_json, field_groups_json, body_markdown,
                         version, updated_by, created_at, updated_at)
                    VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph},
                            1, {ph}, {ph}, {ph})
                    ON DUPLICATE KEY UPDATE
                        title=VALUES(title),
                        category=VALUES(category),
                        icon=VALUES(icon),
                        description=VALUES(description),
                        sort_order=VALUES(sort_order),
                        fields_json=VALUES(fields_json),
                        field_groups_json=VALUES(field_groups_json),
                        body_markdown=VALUES(body_markdown),
                        version=version+1,
                        updated_by=VALUES(updated_by),
                        updated_at=VALUES(updated_at)
                    """,
                    params,
                )
            else:  # SQLite
                c.execute(
                    f"""
                    INSERT OR REPLACE INTO kb_pages
                        (slug, title, category, icon, description, sort_order,
                         fields_json, field_groups_json, body_markdown,
                         version, updated_by, created_at, updated_at)
                    VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph},
                            1, {ph}, {ph}, {ph})
                    """,
                    params,
                )
            inserted += 1
        try:
            conn.commit()
        except Exception:
            pass
    return {"inserted": inserted}


def kb_override_field(
    slug: str, field_name: str, value: Any,
    *, field_type: str = "integer", label: Optional[str] = None,
) -> None:
    """Upsert a single-field KB page used to override an entitlements default.

    Tests use this to drive ``_load_kb_defaults`` without needing a full
    seed. Example::

        kb_override_field("credits-entitlements",
                          "steve_uses_per_month_user_facing", 50)
    """
    seed_kb([
        {
            "slug": slug,
            "title": slug.replace("-", " ").title(),
            "category": "pricing",
            "fields": [
                {
                    "name": field_name,
                    "label": label or field_name,
                    "type": field_type,
                    "value": value,
                }
            ],
        }
    ])


# ── Communities + Enterprise seats ──────────────────────────────────────


def make_community(
    name: str,
    *,
    tier: str = "free",
    creator_username: Optional[str] = None,
    parent_community_id: Optional[int] = None,
) -> int:
    """Insert a community row and return its id.

    ``creator_username`` / ``parent_community_id`` are plumbed so tests of
    tier-cap enforcement can build both the owner and sub-community
    shapes without manually poking the table.
    """
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO communities
                (name, tier, creator_username, parent_community_id, created_at)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph})
            """,
            (name, tier, creator_username, parent_community_id, _now_str()),
        )
        cid = c.lastrowid
        try:
            conn.commit()
        except Exception:
            pass
    return int(cid)


def fill_community_members(community_id: int, count: int, *, prefix: str = "member") -> List[str]:
    """Create ``count`` users and attach them to the community.

    Returns the list of usernames inserted so the caller can reference a
    specific row (e.g. remove one to dip back under the cap). Each
    insert is wrapped in a try/except so tests can call this multiple
    times with overlapping prefixes without fighting unique constraints.
    """
    ph = get_sql_placeholder()
    names: List[str] = []
    joined = _now_str()
    with get_db_connection() as conn:
        c = conn.cursor()
        for i in range(count):
            uname = f"{prefix}_{community_id}_{i}"
            try:
                c.execute(
                    f"""
                    INSERT INTO users (username, email, subscription, created_at)
                    VALUES ({ph}, {ph}, {ph}, {ph})
                    """,
                    (uname, f"{uname}@test.local", "free", joined),
                )
                user_id = c.lastrowid
            except Exception:
                # User already exists (test calling this twice with the
                # same prefix). Look up the id and continue.
                c.execute(
                    f"SELECT id FROM users WHERE username = {ph}",
                    (uname,),
                )
                row = c.fetchone()
                if not row:
                    continue
                user_id = row["id"] if hasattr(row, "keys") else row[0]
            try:
                c.execute(
                    f"""
                    INSERT INTO user_communities (user_id, community_id, role, joined_at)
                    VALUES ({ph}, {ph}, {ph}, {ph})
                    """,
                    (int(user_id), community_id, "member", joined),
                )
            except Exception:
                pass
            names.append(uname)
        try:
            conn.commit()
        except Exception:
            pass
    return names


def make_enterprise_seat(
    username: str,
    community_id: int,
    *,
    started_at: Optional[datetime] = None,
    ended_at: Optional[datetime] = None,
    end_reason: Optional[str] = None,
    grace_until: Optional[datetime] = None,
    had_personal_premium_at_join: bool = False,
    return_intent: bool = False,
) -> Dict[str, Any]:
    """Insert an ``user_enterprise_seats`` row directly.

    Lets tests construct seats in states (e.g. "ended but still in
    grace window") that would be tedious to drive via
    ``start_seat`` / ``end_seat``.
    """
    ph = get_sql_placeholder()
    started = _fmt(started_at) or _now_str()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO user_enterprise_seats
                (username, community_id, community_slug, started_at,
                 ended_at, end_reason, grace_until,
                 had_personal_premium_at_join, return_intent, created_at)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """,
            (username, community_id, f"c{community_id}", started,
             _fmt(ended_at), end_reason, _fmt(grace_until),
             1 if had_personal_premium_at_join else 0,
             1 if return_intent else 0, _now_str()),
        )
        seat_id = c.lastrowid
        try:
            conn.commit()
        except Exception:
            pass
    return {
        "id": int(seat_id),
        "username": username,
        "community_id": community_id,
        "started_at": started,
        "ended_at": _fmt(ended_at),
        "end_reason": end_reason,
        "grace_until": _fmt(grace_until),
    }


# ── Convenience time helpers for tests ──────────────────────────────────


def days_ago(n: int) -> datetime:
    return datetime.utcnow() - timedelta(days=n)


def hours_ago(n: int) -> datetime:
    return datetime.utcnow() - timedelta(hours=n)


def first_of_this_month() -> datetime:
    now = datetime.utcnow()
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def last_month_midpoint() -> datetime:
    first = first_of_this_month()
    return first - timedelta(days=15)
