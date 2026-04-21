"""Smoke tests for :mod:`backend.services.community_lifecycle`.

Covers the branches that ship behavior changes for end users:

  * Feature flag OFF in KB → no sends, no dedup writes
  * First pre-archive warning at day >= warn_day and < warn_last_day
  * Last pre-archive warning at day >= warn_last_day (prefers last
    over first when both would apply)
  * Purge reminder on archived communities past purge_reminder_day
  * Dedup: second run in the same window is a no-op
  * Dry-run: counts but doesn't send or write dedup rows

Delivery side effects (in-app create_notification, email via Resend) are
monkey-patched so we can assert call counts + args without a live SMTP
or a populated users.email.

The tests use the shared MySQL testcontainer via the ``mysql_dsn``
fixture — they're skipped cleanly when Docker isn't available.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List

import pytest

pytestmark = pytest.mark.usefixtures("mysql_dsn")


from backend.services import community_lifecycle
from backend.services.community_lifecycle import (
    WARN_PRE_ARCHIVE,
    WARN_PRE_ARCHIVE_LAST,
    WARN_PURGE_REMINDER,
    dispatch_due_notifications,
)
from backend.services.database import get_db_connection, get_sql_placeholder

from tests.fixtures import (
    kb_override_field,
    make_community,
    make_user,
)


# ── Helpers ─────────────────────────────────────────────────────────────


def _set_last_post(community_id: int, when: datetime) -> None:
    """Insert a post with a fabricated timestamp for inactivity signaling."""
    ph = get_sql_placeholder()
    ts = when.strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO posts (community_id, username, content, timestamp)
            VALUES ({ph}, {ph}, {ph}, {ph})
            """,
            (community_id, "seed", "activity ping", ts),
        )
        try:
            conn.commit()
        except Exception:
            pass


def _set_archived_at(community_id: int, when: datetime) -> None:
    ph = get_sql_placeholder()
    ts = when.strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"UPDATE communities SET archived_at = {ph} WHERE id = {ph}",
            (ts, community_id),
        )
        try:
            conn.commit()
        except Exception:
            pass


def _dedup_rows() -> List[Dict[str, Any]]:
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                "SELECT community_id, warning_type, owner_username "
                "FROM community_lifecycle_notifications"
            )
            rows = c.fetchall() or []
        except Exception:
            return []
    out: List[Dict[str, Any]] = []
    for r in rows:
        if hasattr(r, "keys"):
            out.append(dict(r))
        else:
            out.append(
                {
                    "community_id": r[0],
                    "warning_type": r[1],
                    "owner_username": r[2],
                }
            )
    return out


@pytest.fixture(autouse=True)
def _patch_delivery(monkeypatch):
    """Intercept in-app + email delivery so tests stay hermetic.

    We stash the calls on the fixture so individual tests can assert
    against them. The lifecycle module imports these lazily inside
    ``_send_in_app`` / ``_send_email``, so we patch the module
    attributes rather than the underlying ``backend.services.notifications``
    helper (which would need a fresh import dance per test).
    """
    calls = {"in_app": [], "email": []}

    def fake_in_app(*, owner_username, community_id, message):
        calls["in_app"].append(
            {
                "owner_username": owner_username,
                "community_id": community_id,
                "message": message,
            }
        )

    def fake_email(*, to_email, subject, body_text):
        calls["email"].append(
            {"to_email": to_email, "subject": subject, "body": body_text}
        )
        return True

    monkeypatch.setattr(community_lifecycle, "_send_in_app", fake_in_app)
    monkeypatch.setattr(community_lifecycle, "_send_email", fake_email)
    return calls


# ── Kill-switch / dry-run ──────────────────────────────────────────────


class TestFeatureFlag:
    def test_disabled_in_kb_treats_run_as_dry_run(self, _patch_delivery):
        kb_override_field(
            "community-tiers",
            "community_lifecycle_notifications_enabled",
            False,
            field_type="boolean",
        )
        make_user("owner1", subscription="free")
        cid = make_community("flagged-off", tier="free", creator_username="owner1")
        _set_last_post(cid, datetime.utcnow() - timedelta(days=80))

        result = dispatch_due_notifications()

        assert result["enabled"] is False
        assert result["dry_run"] is True
        # A warning is *selected* (counted in sent) but no delivery
        # happens and no dedup row is persisted.
        assert result["sent"][WARN_PRE_ARCHIVE] == 1
        assert _patch_delivery["in_app"] == []
        assert _patch_delivery["email"] == []
        assert _dedup_rows() == []

    def test_explicit_dry_run_skips_delivery(self, _patch_delivery):
        kb_override_field(
            "community-tiers",
            "community_lifecycle_notifications_enabled",
            True,
            field_type="boolean",
        )
        make_user("owner2", subscription="free")
        cid = make_community("dry-1", tier="free", creator_username="owner2")
        _set_last_post(cid, datetime.utcnow() - timedelta(days=80))

        result = dispatch_due_notifications(dry_run=True)

        assert result["dry_run"] is True
        assert result["sent"][WARN_PRE_ARCHIVE] == 1
        assert _patch_delivery["in_app"] == []
        assert _patch_delivery["email"] == []
        assert _dedup_rows() == []


# ── Warning selection ──────────────────────────────────────────────────


class TestWarningSelection:
    def setup_method(self) -> None:
        # Enable the flag and publish default thresholds (75 / 88 / 300).
        kb_override_field(
            "community-tiers",
            "community_lifecycle_notifications_enabled",
            True,
            field_type="boolean",
        )
        make_user("selector_owner", subscription="free")

    def test_day_80_fires_first_warning(self, _patch_delivery):
        # warn_day defaults to 75, warn_last_day to 88 — 80 is in the
        # pre_archive window.
        cid = make_community(
            "active-80", tier="free", creator_username="selector_owner"
        )
        _set_last_post(cid, datetime.utcnow() - timedelta(days=80))

        result = dispatch_due_notifications()

        assert result["sent"][WARN_PRE_ARCHIVE] == 1
        assert result["sent"][WARN_PRE_ARCHIVE_LAST] == 0
        rows = _dedup_rows()
        assert len(rows) == 1
        assert rows[0]["warning_type"] == WARN_PRE_ARCHIVE
        assert len(_patch_delivery["in_app"]) == 1

    def test_day_89_fires_last_warning(self, _patch_delivery):
        cid = make_community(
            "active-89", tier="free", creator_username="selector_owner"
        )
        _set_last_post(cid, datetime.utcnow() - timedelta(days=89))

        result = dispatch_due_notifications()

        assert result["sent"][WARN_PRE_ARCHIVE_LAST] == 1
        assert result["sent"][WARN_PRE_ARCHIVE] == 0
        rows = _dedup_rows()
        assert len(rows) == 1
        assert rows[0]["warning_type"] == WARN_PRE_ARCHIVE_LAST

    def test_day_30_fires_nothing(self, _patch_delivery):
        cid = make_community(
            "active-30", tier="free", creator_username="selector_owner"
        )
        _set_last_post(cid, datetime.utcnow() - timedelta(days=30))

        result = dispatch_due_notifications()

        assert sum(result["sent"].values()) == 0
        assert _dedup_rows() == []

    def test_archived_day_310_fires_purge_reminder(self, _patch_delivery):
        cid = make_community(
            "archived-310", tier="free", creator_username="selector_owner"
        )
        _set_archived_at(cid, datetime.utcnow() - timedelta(days=310))

        result = dispatch_due_notifications()

        assert result["sent"][WARN_PURGE_REMINDER] == 1
        rows = _dedup_rows()
        assert len(rows) == 1
        assert rows[0]["warning_type"] == WARN_PURGE_REMINDER

    def test_archived_day_200_fires_nothing(self, _patch_delivery):
        cid = make_community(
            "archived-200", tier="free", creator_username="selector_owner"
        )
        _set_archived_at(cid, datetime.utcnow() - timedelta(days=200))

        result = dispatch_due_notifications()

        assert sum(result["sent"].values()) == 0


# ── Dedup ──────────────────────────────────────────────────────────────


class TestDedup:
    def test_second_run_is_noop(self, _patch_delivery):
        kb_override_field(
            "community-tiers",
            "community_lifecycle_notifications_enabled",
            True,
            field_type="boolean",
        )
        make_user("dedupe_owner", subscription="free")
        cid = make_community(
            "dedupe", tier="free", creator_username="dedupe_owner"
        )
        _set_last_post(cid, datetime.utcnow() - timedelta(days=80))

        first = dispatch_due_notifications()
        second = dispatch_due_notifications()

        assert first["sent"][WARN_PRE_ARCHIVE] == 1
        assert second["sent"][WARN_PRE_ARCHIVE] == 0
        assert second["already_notified"] == 1
        # Delivery should only have happened once across both runs.
        assert len(_patch_delivery["in_app"]) == 1
        assert len(_dedup_rows()) == 1


# ── Ownerless / misconfigured ──────────────────────────────────────────


class TestMisconfigured:
    def test_community_without_owner_is_skipped(self, _patch_delivery):
        kb_override_field(
            "community-tiers",
            "community_lifecycle_notifications_enabled",
            True,
            field_type="boolean",
        )
        cid = make_community("no-owner", tier="free", creator_username=None)
        _set_last_post(cid, datetime.utcnow() - timedelta(days=80))

        result = dispatch_due_notifications()

        # The community matches the inactivity window but has no owner
        # to notify — count it, don't explode.
        assert result["skipped_no_owner"] == 1
        assert sum(result["sent"].values()) == 0
        assert _dedup_rows() == []

    def test_community_with_no_activity_is_skipped(self, _patch_delivery):
        kb_override_field(
            "community-tiers",
            "community_lifecycle_notifications_enabled",
            True,
            field_type="boolean",
        )
        make_user("dead_owner", subscription="free")
        make_community("never-active", tier="free", creator_username="dead_owner")
        # No posts, no member joins → last_activity is None.

        result = dispatch_due_notifications()

        assert sum(result["sent"].values()) == 0
        assert _dedup_rows() == []
