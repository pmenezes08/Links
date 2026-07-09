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

    # Enforce the real send_push_to_user(target_username, payload: dict)
    # signature (backend/services/notifications.py). A permissive
    # lambda *args here once hid a production TypeError that silently
    # dropped every reminder push.
    def fake_push(target_username, payload):
        assert isinstance(payload, dict) and "title" in payload and "body" in payload
        pushes.append(((target_username, payload), {}))

    monkeypatch.setattr(onboarding_reminders, "send_push_to_user", fake_push)
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


def _silent_doc(now, *, updated_hours_ago, extra=None):
    """A silent abandon: mid-flow stage saves but never a 'finish later' tap,
    so no profile_deferred_at — only updated_at."""
    payload = {
        "stage": "section_picker",
        "updated_at": (now - timedelta(hours=updated_hours_ago)).isoformat(),
    }
    if extra:
        payload.update(extra)
    return _FakeDoc("bob", payload)


def test_silent_abandon_gets_prompt_after_fallback_window(monkeypatch):
    notifications, pushes = [], []
    _quiet_sends(monkeypatch, notifications, pushes)
    doc = _silent_doc(NOW, updated_hours_ago=50)

    result = onboarding_reminders.dispatch_onboarding_reminders(db=_FakeDb([doc]), now_utc=NOW)

    assert result["sent"] == 1
    assert notifications[0][0][2] == "profile_section_professional"
    markers = doc.reference.writes[0][0]
    assert markers["section_prompt_count"] == 1


def test_recently_active_silent_doc_stays_quiet(monkeypatch):
    notifications, pushes = [], []
    _quiet_sends(monkeypatch, notifications, pushes)
    doc = _silent_doc(NOW, updated_hours_ago=24)

    result = onboarding_reminders.dispatch_onboarding_reminders(db=_FakeDb([doc]), now_utc=NOW)
    assert result["sent"] == 0


def test_doc_with_neither_anchor_stays_quiet(monkeypatch):
    notifications, pushes = [], []
    _quiet_sends(monkeypatch, notifications, pushes)
    doc = _FakeDoc("carol", {"stage": "name"})

    result = onboarding_reminders.dispatch_onboarding_reminders(db=_FakeDb([doc]), now_utc=NOW)
    assert result["sent"] == 0


def test_lifetime_cap_holds_under_fallback_anchor(monkeypatch):
    notifications, pushes = [], []
    _quiet_sends(monkeypatch, notifications, pushes)
    doc = _silent_doc(
        NOW,
        updated_hours_ago=24 * 30,
        extra={
            "section_prompt_last_sent_at": (NOW - timedelta(hours=200)).isoformat(),
            "section_prompt_count": 2,
        },
    )

    result = onboarding_reminders.dispatch_onboarding_reminders(db=_FakeDb([doc]), now_utc=NOW)
    assert result["sent"] == 0


def test_spacing_holds_under_fallback_anchor(monkeypatch):
    notifications, pushes = [], []
    _quiet_sends(monkeypatch, notifications, pushes)
    doc = _silent_doc(
        NOW,
        updated_hours_ago=100,
        extra={
            "section_prompt_last_sent_at": (NOW - timedelta(hours=30)).isoformat(),
            "section_prompt_count": 1,
        },
    )

    result = onboarding_reminders.dispatch_onboarding_reminders(db=_FakeDb([doc]), now_utc=NOW)
    assert result["sent"] == 0


def test_explicit_defer_anchor_takes_precedence_over_updated_at(monkeypatch):
    notifications, pushes = [], []
    _quiet_sends(monkeypatch, notifications, pushes)
    # Deferred only 24h ago (inside the quiet floor) but updated_at is
    # ancient — the explicit Tier-1 anchor must win, keeping the doc quiet.
    doc = _FakeDoc(
        "dora",
        {
            "stage": "intro_profile_later",
            "profile_deferred_at": (NOW - timedelta(hours=24)).isoformat(),
            "updated_at": (NOW - timedelta(hours=100)).isoformat(),
        },
    )

    result = onboarding_reminders.dispatch_onboarding_reminders(db=_FakeDb([doc]), now_utc=NOW)
    assert result["sent"] == 0


def test_push_payload_shape_matches_notifications_service(monkeypatch):
    notifications, pushes = [], []
    _quiet_sends(monkeypatch, notifications, pushes)
    doc = _tier1_doc(NOW)

    onboarding_reminders.dispatch_onboarding_reminders(db=_FakeDb([doc]), now_utc=NOW)

    (target, payload), _ = pushes[0]
    assert target == "alice"
    assert payload["url"] == "/steve/profile-builder/professional"
    assert payload["tag"].startswith("profile_section_professional_")


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
