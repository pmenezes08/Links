"""Tests for /translate_summary entitlements gate and surface accounting."""

from __future__ import annotations

import pytest

from backend.services import ai_usage
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.entitlements_gate import check_steve_access

from tests.fixtures import days_ago, make_user


class TestTranslateSummaryGate:
    def test_translation_surface_counts_as_steve(self):
        assert ai_usage.SURFACE_TRANSLATION in ai_usage.STEVE_SURFACES

    def test_free_user_blocked_for_voice_summary_surface(self, mysql_dsn, monkeypatch):
        monkeypatch.setenv("ENTITLEMENTS_ENFORCEMENT_ENABLED", "true")
        from backend.services import feature_flags

        monkeypatch.setattr(feature_flags, "entitlements_enforcement_enabled", lambda: True)
        make_user("free_translator", subscription="free", created_at=days_ago(60))

        allowed, payload, status, _ent = check_steve_access(
            "free_translator",
            ai_usage.SURFACE_VOICE_SUMMARY,
        )
        assert allowed is False
        assert status == 402
        assert payload is not None
        assert payload.get("reason") == "premium_required"

    def test_free_user_blocked_for_profile_translation_surface(self, mysql_dsn, monkeypatch):
        monkeypatch.setenv("ENTITLEMENTS_ENFORCEMENT_ENABLED", "true")
        from backend.services import feature_flags

        monkeypatch.setattr(feature_flags, "entitlements_enforcement_enabled", lambda: True)
        make_user("free_profile_reader", subscription="free", created_at=days_ago(60))

        allowed, payload, status, _ent = check_steve_access(
            "free_profile_reader",
            ai_usage.SURFACE_TRANSLATION,
        )
        assert allowed is False
        assert payload is not None
        assert payload.get("reason") == "premium_required"

    def test_premium_user_allowed_for_translation_surface(self, mysql_dsn, monkeypatch):
        monkeypatch.setenv("ENTITLEMENTS_ENFORCEMENT_ENABLED", "true")
        from backend.services import feature_flags

        monkeypatch.setattr(feature_flags, "entitlements_enforcement_enabled", lambda: True)
        make_user("prem_translator", subscription="premium", created_at=days_ago(60))

        allowed, payload, status, _ent = check_steve_access(
            "prem_translator",
            ai_usage.SURFACE_TRANSLATION,
        )
        assert allowed is True
        assert payload is None


class TestNotificationPreviewPreference:
    def test_notification_preview_toggle_persists(self, mysql_dsn):
        make_user("preview_user", subscription="free", created_at=days_ago(10))
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            try:
                c.execute(
                    "ALTER TABLE users DROP COLUMN notification_show_previews"
                )
                conn.commit()
            except Exception:
                pass

        from backend.services import notifications as notifications_mod
        from backend.services.notifications import ensure_users_notification_show_previews_column

        notifications_mod._SHOW_PREVIEWS_COLUMN_ENSURED = False
        ensure_users_notification_show_previews_column()

        import bodybuilding_app

        client = bodybuilding_app.app.test_client()
        with client.session_transaction() as sess:
            sess["username"] = "preview_user"

        off = client.post(
            "/api/account/notification_preferences",
            json={"show_content_previews": False},
        )
        assert off.status_code == 200
        body = off.get_json()
        assert body["success"] is True
        assert body["show_content_previews"] is False

        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"SELECT notification_show_previews FROM users WHERE username = {ph}",
                ("preview_user",),
            )
            row = c.fetchone()
            val = row["notification_show_previews"] if hasattr(row, "keys") else row[0]
            assert int(val) == 0

        on = client.post(
            "/api/account/notification_preferences",
            json={"show_content_previews": True},
        )
        assert on.status_code == 200
        assert on.get_json()["show_content_previews"] is True
