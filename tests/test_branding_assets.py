from __future__ import annotations

from io import BytesIO

from flask import Flask

from backend.blueprints import branding_assets as branding_assets_bp_module
from backend.blueprints.branding_assets import branding_assets_bp
from backend.services import branding_assets


def _app() -> Flask:
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(branding_assets_bp)
    return app


def test_public_onboarding_video_returns_null_when_unset(monkeypatch):
    monkeypatch.setattr(branding_assets, "get_onboarding_welcome_video_url", lambda: None)

    with _app().test_client() as client:
        resp = client.get("/api/public/onboarding_welcome_video")

    assert resp.status_code == 200
    assert resp.get_json() == {"success": True, "video_url": None}
    assert "no-store" in resp.headers.get("Cache-Control", "")


def test_admin_onboarding_video_requires_admin(monkeypatch):
    monkeypatch.setattr(
        branding_assets_bp_module.session_identity,
        "valid_session_username",
        lambda _session: "member",
    )
    monkeypatch.setattr(branding_assets_bp_module, "is_app_admin", lambda _username: False)

    with _app().test_client() as client:
        resp = client.get("/admin/get_onboarding_welcome_video")

    assert resp.status_code == 403
    assert resp.get_json()["success"] is False


def test_admin_upload_rejects_invalid_video_extension(monkeypatch):
    monkeypatch.setattr(
        branding_assets_bp_module.session_identity,
        "valid_session_username",
        lambda _session: "admin",
    )
    monkeypatch.setattr(branding_assets_bp_module, "is_app_admin", lambda _username: True)

    with _app().test_client() as client:
        resp = client.post(
            "/admin/upload_onboarding_welcome_video",
            data={"video": (BytesIO(b"not a video"), "intro.gif")},
            content_type="multipart/form-data",
        )

    assert resp.status_code == 400
    assert "MP4 or WebM" in resp.get_json()["error"]


def test_admin_remove_onboarding_video_clears_setting(monkeypatch):
    deleted_keys: list[str] = []
    monkeypatch.setattr(
        branding_assets_bp_module.session_identity,
        "valid_session_username",
        lambda _session: "admin",
    )
    monkeypatch.setattr(branding_assets_bp_module, "is_app_admin", lambda _username: True)
    monkeypatch.setattr(branding_assets, "delete_setting", deleted_keys.append)

    with _app().test_client() as client:
        resp = client.post("/admin/remove_onboarding_welcome_video")

    assert resp.status_code == 200
    assert resp.get_json()["success"] is True
    assert deleted_keys == [branding_assets.ONBOARDING_WELCOME_VIDEO_KEY]
