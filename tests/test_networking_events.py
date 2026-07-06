"""Networking attribution sink + rolling-welcome cue (concierge Increment 0).

Covers:
  * ``backend.services.networking_events`` — validation (closed event-type
    set, unknown-source collapse to 'direct') and persistence.
  * ``POST /api/networking/event`` — auth required; malformed events accepted
    but not recorded (attribution is fire-and-forget on the client).
  * Rolling-welcome networking cue — renderer only appends the link when the
    dispatcher passes a community id; the gate honours the KB toggle, the
    member threshold, and the package gate.
"""

from __future__ import annotations

from backend.services import networking_events
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.networking_ai_config import get_networking_ai_config
from backend.services.steve_community_welcome import (
    _networking_cue_allowed,
    render_rolling_welcome_post,
)


# ── Service: validation ──────────────────────────────────────────────────


def test_normalize_event_rejects_unknown_event_type():
    assert networking_events.normalize_event(event_type="bogus", source="welcome_cue") is None
    assert networking_events.normalize_event(event_type="", source="welcome_cue") is None


def test_normalize_event_collapses_unknown_source_to_direct():
    out = networking_events.normalize_event(event_type="page_view", source="mystery_campaign")
    assert out is not None and out["source"] == "direct"
    out = networking_events.normalize_event(event_type="page_view", source=None)
    assert out is not None and out["source"] == "direct"
    out = networking_events.normalize_event(event_type="page_view", source="welcome_cue")
    assert out is not None and out["source"] == "welcome_cue"


def test_normalize_event_coerces_community_id():
    out = networking_events.normalize_event(event_type="page_view", source="direct", community_id="42")
    assert out is not None and out["community_id"] == 42
    out = networking_events.normalize_event(event_type="page_view", source="direct", community_id="nope")
    assert out is not None and out["community_id"] is None


# ── Service: persistence ─────────────────────────────────────────────────


def _fetch_events(username: str):
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT username, event_type, source, community_id, target_username"
            f" FROM networking_events WHERE username = {ph} ORDER BY id",
            (username,),
        )
        rows = c.fetchall() or []
    out = []
    for r in rows:
        if hasattr(r, "keys"):
            out.append((r["username"], r["event_type"], r["source"], r["community_id"], r["target_username"]))
        else:
            out.append(tuple(r))
    return out


def test_record_event_persists_row():
    assert networking_events.record_event(
        "evt_alice",
        event_type="message_tap",
        source="steve_match",
        community_id=7,
        target_username="evt_bob",
    ) is True
    rows = _fetch_events("evt_alice")
    assert rows == [("evt_alice", "message_tap", "steve_match", 7, "evt_bob")]


def test_record_event_drops_bad_input_without_raising():
    assert networking_events.record_event("", event_type="page_view", source="direct") is False
    assert networking_events.record_event("evt_carol", event_type="bogus", source="direct") is False
    assert _fetch_events("evt_carol") == []


# ── Route ────────────────────────────────────────────────────────────────


def _client():
    import bodybuilding_app

    return bodybuilding_app.app.test_client()


def test_event_route_requires_login():
    client = _client()
    resp = client.post("/api/networking/event", json={"event_type": "page_view"})
    assert resp.status_code == 401


def test_event_route_records_for_logged_in_user():
    client = _client()
    with client.session_transaction() as sess:
        sess["username"] = "evt_route_user"
    resp = client.post(
        "/api/networking/event",
        json={"event_type": "page_view", "source": "welcome_cue", "community_id": 3},
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True and body["recorded"] is True
    assert _fetch_events("evt_route_user") == [("evt_route_user", "page_view", "welcome_cue", 3, None)]

    # Malformed event: still 200 (fire-and-forget client) but not recorded.
    resp = client.post("/api/networking/event", json={"event_type": "nonsense"})
    assert resp.status_code == 200
    assert resp.get_json()["recorded"] is False


# ── Rolling-welcome cue ──────────────────────────────────────────────────


def test_rolling_welcome_renderer_appends_cue_only_when_asked():
    base = render_rolling_welcome_post(
        community_name="Test Community",
        member_names=["Ana", "Bruno"],
        locale="en",
    )
    assert "/networking?community=" not in base

    with_cue = render_rolling_welcome_post(
        community_name="Test Community",
        member_names=["Ana", "Bruno"],
        locale="en",
        networking_cue_community_id=42,
    )
    assert "/networking?community=42&source=welcome_cue" in with_cue
    assert with_cue.startswith(base)  # cue is strictly appended


class _FakeCursor:
    def __init__(self, member_count: int):
        self._member_count = member_count

    def execute(self, sql, params=None):
        pass

    def fetchone(self):
        return (self._member_count,)


def test_networking_cue_gate_respects_toggle_threshold_and_package(monkeypatch):
    from backend.services import steve_community_welcome as scw

    class _Cfg:
        welcome_cue_enabled = True
        welcome_cue_min_members = 15

    decisions = {"mode": "cap"}
    monkeypatch.setattr(
        "backend.services.networking_ai_config.get_networking_ai_config", lambda: _Cfg()
    )
    monkeypatch.setattr(
        "backend.services.networking_billing.networking_gate_decision",
        lambda username, community_id, config: decisions,
    )

    # Above threshold + package OK → cue allowed.
    assert scw._networking_cue_allowed(_FakeCursor(20), 1, "%s") is True

    # Below threshold → no cue.
    assert scw._networking_cue_allowed(_FakeCursor(10), 1, "%s") is False

    # No package → never tease a paywall.
    decisions["mode"] = "no_package"
    assert scw._networking_cue_allowed(_FakeCursor(20), 1, "%s") is False
    decisions["mode"] = "cap"

    # KB toggle off → no cue anywhere, regardless of size/package.
    _Cfg.welcome_cue_enabled = False
    assert scw._networking_cue_allowed(_FakeCursor(50), 1, "%s") is False


def test_networking_ai_config_reads_welcome_cue_fields():
    config = get_networking_ai_config(
        {
            "slug": "networking-ai",
            "fields": [
                {"name": "networking_welcome_cue_enabled", "value": False},
                {"name": "networking_welcome_cue_min_members", "value": 30},
            ],
        }
    )
    assert config.welcome_cue_enabled is False
    assert config.welcome_cue_min_members == 30

    defaults = get_networking_ai_config({})
    assert defaults.welcome_cue_enabled is True
    assert defaults.welcome_cue_min_members == 15
