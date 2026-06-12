"""Section-aware profile prompts — cadence, rotation, budgets, locale copy."""

from datetime import datetime, timedelta, timezone

from flask import Flask

from backend.blueprints import onboarding as onboarding_bp_module
from backend.blueprints.onboarding import onboarding_bp
from backend.services import onboarding_reminders
from backend.services.onboarding_reminders import pick_section, section_status


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


def _quiet_sends(monkeypatch, notifications, pushes):
    monkeypatch.setattr(
        onboarding_reminders, "create_notification",
        lambda *args, **kwargs: notifications.append((args, kwargs)),
    )
    monkeypatch.setattr(
        onboarding_reminders, "send_push_to_user",
        lambda *args, **kwargs: pushes.append((args, kwargs)),
    )
    # No SQL in these unit tests — durable status comes from the doc only.
    monkeypatch.setattr(onboarding_reminders, "_fetch_sql_row", lambda username: None)
    monkeypatch.setattr(
        onboarding_reminders.notification_copy, "recipient_locale", lambda username: "en"
    )


def _tier1_doc(now, *, hours_ago=72, extra=None):
    payload = {
        "stage": "intro_profile_later",
        "profile_deferred_at": (now - timedelta(hours=hours_ago)).isoformat(),
    }
    if extra:
        payload.update(extra)
    return _FakeDoc("alice", payload)


NOW = datetime(2026, 6, 10, 13, 0, tzinfo=timezone.utc)


def test_professional_is_asked_first_with_locale_copy_and_markers(monkeypatch):
    notifications, pushes = [], []
    _quiet_sends(monkeypatch, notifications, pushes)
    doc = _tier1_doc(NOW)

    result = onboarding_reminders.dispatch_onboarding_reminders(db=_FakeDb([doc]), now_utc=NOW)

    assert result["sent"] == 1
    args, kwargs = notifications[0]
    assert args[0] == "alice"
    assert args[2] == "profile_section_professional"
    assert kwargs["link"] == "/steve/profile-builder/professional"
    assert "introduce someone" in args[5]  # resolved copy, not a key
    assert pushes[0][0][0] == "alice"
    markers = doc.reference.writes[0][0]
    assert markers["section_prompt_last_section"] == "professional"
    assert markers["section_prompt_count"] == 1
    assert markers["last_profile_ask_at"] == NOW.isoformat()


def test_quiet_for_48h_after_tier1(monkeypatch):
    notifications, pushes = [], []
    _quiet_sends(monkeypatch, notifications, pushes)
    doc = _tier1_doc(NOW, hours_ago=24)

    result = onboarding_reminders.dispatch_onboarding_reminders(db=_FakeDb([doc]), now_utc=NOW)

    assert result["sent"] == 0
    assert notifications == []


def test_ignored_section_rotates_once_then_budget_caps(monkeypatch):
    notifications, pushes = [], []
    _quiet_sends(monkeypatch, notifications, pushes)
    doc = _tier1_doc(
        NOW,
        hours_ago=24 * 10,
        extra={
            "section_prompt_last_sent_at": (NOW - timedelta(hours=96)).isoformat(),
            "section_prompt_last_section": "professional",
            "section_prompt_count": 1,
            "last_profile_ask_at": (NOW - timedelta(hours=96)).isoformat(),
        },
    )

    result = onboarding_reminders.dispatch_onboarding_reminders(db=_FakeDb([doc]), now_utc=NOW)

    assert result["sent"] == 1
    assert notifications[0][0][2] == "profile_section_personal"  # rotated

    # Lifetime cap: two prompts, then permanent silence.
    capped = _tier1_doc(
        NOW,
        hours_ago=24 * 30,
        extra={
            "section_prompt_last_sent_at": (NOW - timedelta(hours=200)).isoformat(),
            "section_prompt_last_section": "personal",
            "section_prompt_count": 2,
        },
    )
    notifications.clear()
    result = onboarding_reminders.dispatch_onboarding_reminders(db=_FakeDb([capped]), now_utc=NOW)
    assert result["sent"] == 0


def test_daily_budget_and_spacing_block_sends(monkeypatch):
    notifications, pushes = [], []
    _quiet_sends(monkeypatch, notifications, pushes)
    recent_ask = _tier1_doc(
        NOW, extra={"last_profile_ask_at": (NOW - timedelta(hours=3)).isoformat()}
    )
    recent_prompt = _tier1_doc(
        NOW,
        extra={
            "section_prompt_last_sent_at": (NOW - timedelta(hours=30)).isoformat(),
            "section_prompt_count": 1,
        },
    )

    for doc in (recent_ask, recent_prompt):
        result = onboarding_reminders.dispatch_onboarding_reminders(db=_FakeDb([doc]), now_utc=NOW)
        assert result["sent"] == 0


def test_complete_sections_end_the_prompts(monkeypatch):
    notifications, pushes = [], []
    _quiet_sends(monkeypatch, notifications, pushes)
    doc = _tier1_doc(
        NOW,
        extra={
            "collected": {
                "bio": "I grow olives.",
                "role": "CTO",
                "company": "Acme",
            }
        },
    )

    result = onboarding_reminders.dispatch_onboarding_reminders(db=_FakeDb([doc]), now_utc=NOW)
    assert result["sent"] == 0


def test_pick_section_rules():
    assert pick_section(False, False, None) == "professional"
    assert pick_section(False, False, "professional") == "personal"
    assert pick_section(False, False, "personal") == "professional"
    assert pick_section(True, False, None) == "professional"
    assert pick_section(False, True, "professional") == "personal"
    assert pick_section(True, True, None) is None


def test_section_status_reads_collected():
    personal, professional = section_status(
        {"collected": {"talkAllDay": "olives", "role": "CTO", "company": "Acme"}}, None
    )
    assert personal is True
    assert professional is True


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
    body = response.get_json()
    # Migrated to the shared api_errors shape -- switch on the stable
    # identifier rather than the (now localized) English text.
    assert body["success"] is False
    assert body["error_code"] == "auth.authentication_required"
    assert body["message_key"] == "auth.authentication_required"
