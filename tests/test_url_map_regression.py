"""Phase F1 + G3: URL map sanity — critical routes exist; purged debug routes absent."""

from __future__ import annotations


def _rules(app):
    return {str(r.rule) for r in app.url_map.iter_rules()}


def test_logout_and_login_back_single_rule():
    from bodybuilding_app import app

    rules = _rules(app)
    logout = [r for r in app.url_map.iter_rules() if str(r.rule) == "/logout"]
    assert len(logout) == 1
    back = [r for r in app.url_map.iter_rules() if str(r.rule) == "/login_back"]
    assert len(back) == 1
    assert "/manifest.webmanifest" in rules
    assert "/favicon.svg" in rules


def test_icons_path_registered():
    from bodybuilding_app import app

    assert any(str(r.rule).startswith("/icons/") for r in app.url_map.iter_rules())


def test_phase_f1_debug_routes_removed():
    """F1 removed dangerous / unused routes; they must not appear on url_map."""
    from bodybuilding_app import app

    rules = _rules(app)
    deleted_exact = {
        "/api/debug/kb_log",
        "/api/debug/login_test",
        "/api/test",
        "/clear_sessions",
        "/test_color_detection",
        "/debug_table_structure",
        "/migrate_database",
        "/migrate_user_communities_role",
        "/migrate_passwords",
        "/test_password_hash",
        "/test_specific_password",
        "/check_password_status",
    }
    for path in deleted_exact:
        assert path not in rules, f"expected {path} removed"


def test_no_debug_password_route_family():
    from bodybuilding_app import app

    for r in app.url_map.iter_rules():
        rule = str(r.rule)
        assert "debug_password" not in rule
        assert "reset_password_debug" not in rule
        assert "fix_duplicate_user" not in rule


def test_auth_and_webhook_routes_still_exist():
    from bodybuilding_app import app

    rules = _rules(app)
    assert "/delete_account" in rules
    delete_account = [r for r in app.url_map.iter_rules() if str(r.rule) == "/delete_account"]
    assert len(delete_account) == 1
    assert "/api/admin/delete_user" in rules
    du = [r for r in app.url_map.iter_rules() if str(r.rule) == "/api/admin/delete_user"]
    assert len(du) == 1
    assert "/api/auth/google" in rules
    assert "/api/webhooks/stripe" in rules
    assert "/api/check_pending_login" in rules
    assert "/api/clear_stale_session" in rules
    assert "/api/me/platform-activity-digest" in rules
    assert "/api/dashboard_unread_feed" in rules
    assert "/api/community_group_feed/<int:parent_id>" in rules
    assert "/api/about/tutorial_videos" in rules


def test_legacy_encryption_routes_removed():
    from bodybuilding_app import app

    for rule in app.url_map.iter_rules():
        path = str(rule.rule)
        assert not path.startswith("/api/encryption/"), f"legacy encryption route still registered: {path}"
        assert not path.startswith("/api/signal/"), f"legacy signal route still registered: {path}"
