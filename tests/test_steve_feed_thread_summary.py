"""Long-thread rolling summary: thresholds, caching, one-metered-call contract."""

from __future__ import annotations

from types import SimpleNamespace

from backend.services import steve_feed_thread_summary as sfts
from backend.services.steve_feed_thread_summary import maybe_get_feed_thread_summary


class _Cursor:
    def __init__(self, count: int, older_rows=None):
        self._count = count
        self._older_rows = older_rows or []
        self.executed = []

    def execute(self, sql, params=None):
        self.executed.append(sql.strip().split("\n")[0])
        self._last_sql = sql

    def fetchone(self):
        return {"n": self._count}

    def fetchall(self):
        return self._older_rows


class _FakeDoc:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data or {})


class _FakeFs:
    def __init__(self, data=None):
        self._data = data
        self.saved = None

    def collection(self, name):
        return self

    def document(self, doc_id):
        self.doc_id = doc_id
        return self

    def get(self):
        return _FakeDoc(self._data)

    def set(self, payload, merge=False):
        self.saved = (payload, merge)


def _config(**overrides):
    base = dict(
        feed_thread_summary_enabled=True,
        feed_thread_summary_trigger_older=10,
        feed_thread_summary_refresh_every=20,
        feed_thread_summary_max_chars=1500,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _wire_fs(monkeypatch, fs):
    from backend.services import firestore_writes

    monkeypatch.setattr(firestore_writes, "USE_FIRESTORE_WRITES", True)
    monkeypatch.setattr(firestore_writes, "_get_client", lambda: fs)


def test_below_trigger_returns_none_without_llm(monkeypatch):
    calls = []
    from backend.services.content_generation import llm

    monkeypatch.setattr(llm, "generate_text", lambda *a, **k: calls.append(1) or "x")
    # 24 visible of 30 total → 6 older < trigger 10
    out = maybe_get_feed_thread_summary(
        _Cursor(count=30), "%s", post_id=1, visible_count=24,
        sender_username="paulo", steve_config=_config(),
    )
    assert out is None
    assert calls == []


def test_fresh_cache_reused_without_llm(monkeypatch):
    calls = []
    from backend.services.content_generation import llm

    monkeypatch.setattr(llm, "generate_text", lambda *a, **k: calls.append(1) or "x")
    # 60 total, 24 visible → 36 older; cached at 30 → 6 new < refresh 20
    fs = _FakeFs({"steve_feed_thread_summary": "cached summary", "steve_feed_thread_summary_older_count": 30})
    _wire_fs(monkeypatch, fs)
    out = maybe_get_feed_thread_summary(
        _Cursor(count=60), "%s", post_id=1, visible_count=24,
        sender_username="paulo", steve_config=_config(),
    )
    assert out == "cached summary"
    assert calls == []


def test_refresh_summarizes_once_and_caches(monkeypatch):
    calls = []
    from backend.services.content_generation import llm

    def fake_generate(system, user, **kwargs):
        calls.append((system, user))
        return "• decisions: tournament on May 10"

    monkeypatch.setattr(llm, "generate_text", fake_generate)
    older_rows = [
        {"username": "mary", "content": "let's do May 10", "timestamp": "2026-07-01 10:00:00"},
    ]
    fs = _FakeFs({"steve_feed_thread_summary": "old", "steve_feed_thread_summary_older_count": 5})
    _wire_fs(monkeypatch, fs)
    # 60 total, 24 visible → 36 older; cached at 5 → 31 new ≥ refresh 20
    out = maybe_get_feed_thread_summary(
        _Cursor(count=60, older_rows=older_rows), "%s", post_id=7, visible_count=24,
        sender_username="paulo", steve_config=_config(), original_post="Padel plans",
    )
    assert out == "• decisions: tournament on May 10"
    assert len(calls) == 1
    assert "EXISTING SUMMARY:\nold" in calls[0][1]
    assert "mary: let's do May 10" in calls[0][1]
    assert "Padel plans" in calls[0][1]
    payload, merge = fs.saved
    assert merge is True
    assert payload["steve_feed_thread_summary_older_count"] == 36
    assert fs.doc_id == "7"


def test_group_post_uses_gp_doc_id(monkeypatch):
    from backend.services.content_generation import llm

    monkeypatch.setattr(llm, "generate_text", lambda *a, **k: "summary")
    fs = _FakeFs(None)
    _wire_fs(monkeypatch, fs)
    older_rows = [{"username": "m", "content": "hi", "created_at": "2026-07-01"}]
    cursor = _Cursor(count=60, older_rows=older_rows)
    out = maybe_get_feed_thread_summary(
        cursor, "%s", post_id=9, visible_count=24,
        sender_username="paulo", steve_config=_config(),
        is_group_post=True, replies_table="group_replies",
        replies_id_column="group_post_id", replies_ts_column="created_at",
    )
    assert out == "summary"
    assert fs.doc_id == "gp_9"


def test_disabled_flag_short_circuits(monkeypatch):
    out = maybe_get_feed_thread_summary(
        _Cursor(count=500), "%s", post_id=1, visible_count=24,
        sender_username="paulo", steve_config=_config(feed_thread_summary_enabled=False),
    )
    assert out is None


def test_llm_failure_falls_back_to_cache(monkeypatch):
    from backend.services.content_generation import llm

    def boom(*a, **k):
        raise RuntimeError("upstream down")

    monkeypatch.setattr(llm, "generate_text", boom)
    fs = _FakeFs({"steve_feed_thread_summary": "old cache", "steve_feed_thread_summary_older_count": 5})
    _wire_fs(monkeypatch, fs)
    older_rows = [{"username": "m", "content": "hi", "timestamp": "2026-07-01"}]
    out = maybe_get_feed_thread_summary(
        _Cursor(count=60, older_rows=older_rows), "%s", post_id=1, visible_count=24,
        sender_username="paulo", steve_config=_config(),
    )
    assert out == "old cache"  # graceful degrade, no retry
