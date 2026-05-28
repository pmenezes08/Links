"""Tests for backend.services.session_revocation — multi-device session invalidation."""

from __future__ import annotations

from flask import Flask, session

from backend.services import session_revocation
from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_user


def _app() -> Flask:
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.config.update(SESSION_COOKIE_NAME="cpoint_session")
    return app


class TestGetSessionVersion:
    def test_returns_default_for_new_user(self):
        make_user("sv_user_1")
        version = session_revocation.get_session_version("sv_user_1")
        assert version == 1

    def test_returns_default_for_nonexistent_user(self):
        version = session_revocation.get_session_version("nonexistent_user_xyz")
        assert version == 1

    def test_returns_default_for_empty_username(self):
        version = session_revocation.get_session_version("")
        assert version == 1


class TestBumpSessionVersion:
    def test_increments_version(self):
        make_user("sv_bump_1")
        assert session_revocation.get_session_version("sv_bump_1") == 1

        new_ver = session_revocation.bump_session_version("sv_bump_1")
        assert new_ver == 2
        assert session_revocation.get_session_version("sv_bump_1") == 2

    def test_sets_session_invalidated_at(self):
        make_user("sv_bump_2")
        session_revocation.bump_session_version("sv_bump_2")

        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"SELECT session_invalidated_at FROM users WHERE username={ph}",
                ("sv_bump_2",),
            )
            row = c.fetchone()
        ts = row["session_invalidated_at"] if isinstance(row, dict) else row[0]
        assert ts is not None

    def test_multiple_bumps(self):
        make_user("sv_bump_3")
        session_revocation.bump_session_version("sv_bump_3")
        session_revocation.bump_session_version("sv_bump_3")
        v = session_revocation.bump_session_version("sv_bump_3")
        assert v == 4

    def test_noop_for_empty_username(self):
        result = session_revocation.bump_session_version("")
        assert result == 0

    def test_noop_for_none_username(self):
        result = session_revocation.bump_session_version(None)
        assert result == 0


class TestStampSession:
    def test_stamps_sv_and_created_at(self):
        make_user("sv_stamp_1")
        app = _app()
        with app.test_request_context():
            session["username"] = "sv_stamp_1"
            session_revocation.stamp_session(session, "sv_stamp_1")

            assert session["_sv"] == 1
            assert "_created_at" in session

    def test_stamp_uses_current_version(self):
        make_user("sv_stamp_2")
        session_revocation.bump_session_version("sv_stamp_2")  # version -> 2

        app = _app()
        with app.test_request_context():
            session["username"] = "sv_stamp_2"
            session_revocation.stamp_session(session, "sv_stamp_2")
            assert session["_sv"] == 2


class TestIsSessionRevoked:
    def test_not_revoked_when_versions_match(self):
        make_user("sv_revoke_1")
        app = _app()
        with app.test_request_context():
            session["username"] = "sv_revoke_1"
            session["_sv"] = 1
            assert session_revocation.is_session_revoked(session) is False

    def test_revoked_when_versions_mismatch(self):
        make_user("sv_revoke_2")
        app = _app()
        with app.test_request_context():
            session["username"] = "sv_revoke_2"
            session["_sv"] = 1

            session_revocation.bump_session_version("sv_revoke_2")
            assert session_revocation.is_session_revoked(session) is True

    def test_legacy_session_without_sv_is_not_revoked(self):
        """Legacy sessions without _sv are lazily enrolled, not rejected."""
        make_user("sv_revoke_3")
        app = _app()
        with app.test_request_context():
            session["username"] = "sv_revoke_3"
            # No _sv key — simulates pre-upgrade cookie
            assert session_revocation.is_session_revoked(session) is False
            # After the check, it should have been stamped
            assert "_sv" in session

    def test_revoked_after_password_reset_scenario(self):
        """Simulates: user logged in on device B, resets password → device B session revoked."""
        make_user("sv_revoke_4")
        app = _app()
        with app.test_request_context():
            session["username"] = "sv_revoke_4"
            session["_sv"] = 1

            # Password reset bumps version
            session_revocation.bump_session_version("sv_revoke_4")

            # Device B's session (still at sv=1) should now be revoked
            assert session_revocation.is_session_revoked(session) is True


class TestMultiDeviceLogoutScenario:
    """End-to-end scenario: user on 3 devices, logs out from one."""

    def test_logout_invalidates_other_devices(self):
        make_user("sv_multi_1")
        app = _app()

        # Simulate 3 devices all logged in with sv=1
        device_sessions = []
        for _ in range(3):
            with app.test_request_context():
                session["username"] = "sv_multi_1"
                session_revocation.stamp_session(session, "sv_multi_1")
                device_sessions.append(dict(session))

        # All should have sv=1
        for ds in device_sessions:
            assert ds["_sv"] == 1

        # Device 1 logs out — triggers bump
        session_revocation.bump_session_version("sv_multi_1")

        # Devices 2 and 3 should now be revoked
        with app.test_request_context():
            for ds in device_sessions[1:]:
                session.clear()
                session.update(ds)
                assert session_revocation.is_session_revoked(session) is True

        # A fresh login (device 1 re-logs in) gets the new version
        with app.test_request_context():
            session["username"] = "sv_multi_1"
            session_revocation.stamp_session(session, "sv_multi_1")
            assert session["_sv"] == 2
            assert session_revocation.is_session_revoked(session) is False
