from datetime import datetime, timedelta, timezone

from flask import Flask

from backend.blueprints import onboarding as onboarding_bp_module
from backend.blueprints.onboarding import onboarding_bp
from backend.services import onboarding_reminders


class _FakeRef:
    def __init__(self):
        self.writes = []

    def set(self, payload, merge=False):
        self.writes.append((payload, merge))


class _FakeDoc:
    def __init__(self, doc_id, payload):
        self.id = doc_id
        self._payload = payload
        self.reference = _FakeRef()

    def to_dict(self):
        return dict(self._payload)


class _FakeCollection:
    def __init__(self, docs):
        self._docs = docs

    def stream(self):
        return iter(self._docs)


class _FakeDb:
    def __init__(self, docs):
        self.docs = docs

    def collection(self, name):
        assert name == "steve_onboarding"
        return _FakeCollection(self.docs)


def test_dispatch_onboarding_reminders_sends_and_dedupes(monkeypatch):
    now = datetime(2026, 4, 2, 13, 0, tzinfo=timezone.utc)
    doc = _FakeDoc(
        "alice",
        {
            "stage": "section_picker",
            "profile_deferred_at": (now - timedelta(hours=25)).isoformat(),
            "profile_defer_until": (now + timedelta(hours=47)).isoformat(),
        },
    )
    calls = []
    monkeypatch.setattr(onboarding_reminders, "create_notification", lambda *args, **kwargs: calls.append((args, kwargs)))

    result = onboarding_reminders.dispatch_onboarding_reminders(db=_FakeDb([doc]), now_utc=now)

    assert result["success"] is True
    assert result["sent"] == 1
    assert calls[0][0][0] == "alice"
    assert calls[0][0][2] == "onboarding_reminder_24h"
    assert doc.reference.writes[0][0]["onboarding_reminder_24h_sent_at"] == now.isoformat()

    doc._payload["onboarding_reminder_24h_sent_at"] = now.isoformat()
    calls.clear()
    result = onboarding_reminders.dispatch_onboarding_reminders(db=_FakeDb([doc]), now_utc=now)
    assert result["sent"] == 0
    assert calls == []


def test_onboarding_reminder_cron_rejects_missing_secret(monkeypatch):
    monkeypatch.setenv("CRON_SHARED_SECRET", "secret")
    monkeypatch.setattr(onboarding_bp_module, "dispatch_onboarding_reminders", None, raising=False)
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(onboarding_bp)
    response = app.test_client().post("/api/cron/onboarding/reminders")
    assert response.status_code == 403


def test_onboarding_api_auth_failure_returns_json():
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(onboarding_bp)
    response = app.test_client().post("/api/onboarding/defer_profile", json={})
    assert response.status_code == 401
    assert response.get_json() == {"success": False, "error": "Unauthorized"}
