from __future__ import annotations

from datetime import datetime, timedelta


class FakeCursor:
    def __init__(self, event_row):
        self.event_row = event_row
        self.result = []
        self.logged = []

    def execute(self, sql, params=()):
        lowered = " ".join(sql.lower().split())
        if "from calendar_events ce" in lowered and "where ce.id" in lowered:
            self.result = [self.event_row]
        elif "from calendar_events" in lowered and "order by date" in lowered:
            self.result = [{"id": self.event_row["id"]}]
        elif "select distinct invited_username" in lowered:
            self.result = [{"invited_username": "invitee"}]
        elif "select id from event_notification_log" in lowered:
            self.result = []
        elif "insert" in lowered and "event_notification_log" in lowered:
            self.logged.append(params)
            self.result = []
        else:
            self.result = []

    def fetchone(self):
        return self.result[0] if self.result else None

    def fetchall(self):
        return self.result


class FakeConnection:
    def __init__(self, event_row):
        self.cursor_obj = FakeCursor(event_row)

    def cursor(self):
        return self.cursor_obj

    def commit(self):
        pass

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def _event_row(notification_preferences: str, *, hours_until: float = 23.5):
    now = datetime.utcnow()
    return {
        "id": 10,
        "title": "Community lift",
        "date": now.strftime("%Y-%m-%d"),
        "start_time": now + timedelta(hours=hours_until),
        "end_time": None,
        "created_at": now - timedelta(days=1),
        "community_id": None,
        "notification_preferences": notification_preferences,
        "created_by": "creator",
    }


def test_event_notification_none_suppresses_all(monkeypatch):
    from backend.services import notifications

    created = []
    pushed = []
    monkeypatch.setattr(notifications, "create_notification", lambda *args, **kwargs: created.append((args, kwargs)))
    monkeypatch.setattr(notifications, "send_push_to_user", lambda *args, **kwargs: pushed.append((args, kwargs)))

    conn = FakeConnection(_event_row("none"))

    assert notifications.check_single_event_notifications(10, conn) == 0
    assert created == []
    assert pushed == []
    assert conn.cursor_obj.logged == []


def test_event_notification_threshold_sends_with_event_link(monkeypatch):
    from backend.services import notifications

    created = []
    pushed = []
    monkeypatch.setattr(notifications, "create_notification", lambda *args, **kwargs: created.append((args, kwargs)))
    monkeypatch.setattr(notifications, "send_push_to_user", lambda *args, **kwargs: pushed.append((args, kwargs)))

    conn = FakeConnection(_event_row("all", hours_until=23.5))

    assert notifications.check_single_event_notifications(10, conn) == 2
    assert len(created) == 2
    assert len(pushed) == 2
    assert {args[0] for args, _ in created} == {"invitee", "creator"}
    assert all(kwargs["link"] == "/event/10" for _, kwargs in created)
    assert all(args[1]["url"] == "/event/10" for args, _ in pushed)
    assert {entry[2] for entry in conn.cursor_obj.logged} == {"1_day"}


def test_event_notification_cron_requires_secret_and_supports_dry_run(monkeypatch):
    from flask import Flask

    from backend.blueprints import notifications as notifications_bp_module

    monkeypatch.setenv("CRON_SHARED_SECRET", "secret")
    conn = FakeConnection(_event_row("all"))
    monkeypatch.setattr(notifications_bp_module, "get_db_connection", lambda: conn)

    app = Flask(__name__)
    app.register_blueprint(notifications_bp_module.notifications_bp)
    client = app.test_client()

    forbidden = client.post("/api/event_notification_check?dry_run=1")
    assert forbidden.status_code == 403

    allowed = client.post("/api/event_notification_check?dry_run=1", headers={"X-Cron-Secret": "secret"})
    assert allowed.status_code == 200
    payload = allowed.get_json()
    assert payload["success"] is True
    assert payload["dry_run"] is True
    assert payload["candidate_events"] == 1
