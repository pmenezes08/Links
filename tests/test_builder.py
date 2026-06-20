"""Tests for the Steve Builder surface.

Covers the AI-surface invariants for a new paid surface: the entitlements
gate (free quota vs paid uncap), creation persistence, and that publishing
creates a post linked to the creation. Runs against the MySQL testcontainer
(skips cleanly when Docker is unavailable).
"""

from __future__ import annotations

import pytest

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services import ai_usage, builder
from backend.services.entitlements_gate import gate_builder_or_reason

pytestmark = pytest.mark.usefixtures("mysql_dsn")

_FAKE_HTML = "<!doctype html><html><body><canvas></canvas></body></html>"


@pytest.fixture(autouse=True)
def _builder_tables():
    """Create the creations table + posts.creation_id for each test run."""
    builder.ensure_tables()


def _make_user(username: str, subscription: str = "free") -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO users (username, subscription) VALUES ({ph}, {ph})",
            (username, subscription),
        )
        conn.commit()


def _make_community(name: str = "Builders") -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO communities (name, creator_username) VALUES ({ph}, {ph})",
            (name, "owner"),
        )
        cid = c.lastrowid
        conn.commit()
    return cid


def test_create_stores_a_draft_creation(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()

    result = builder.create_creation(username="maker", community_id=cid, prompt="build a tetris game")
    assert result["id"]
    assert "<!doctype html>" in result["html"].lower()

    row = builder.get_creation(result["id"])
    assert row is not None
    assert row["created_by"] == "maker"
    assert row["status"] == "draft"
    assert int(row["community_id"]) == cid


def test_iterate_replaces_html(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()
    created = builder.create_creation(username="maker", community_id=cid, prompt="a quiz")

    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: "<!doctype html><html><body>v2</body></html>")
    updated = builder.iterate_creation(creation_id=created["id"], username="maker", message="make it neon")
    assert "v2" in updated["html"]
    assert builder.get_creation(created["id"])["html_content"] == updated["html"]


def test_publish_creates_post_linked_to_creation(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()
    created = builder.create_creation(username="maker", community_id=cid, prompt="a game")

    pub = builder.publish_creation(creation_id=created["id"], username="maker", caption="play this")
    assert pub["post_id"]
    assert pub["already_published"] is False

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT creation_id, username FROM posts WHERE id = {ph}", (pub["post_id"],))
        row = c.fetchone()
    assert row is not None
    creation_id = row["creation_id"] if hasattr(row, "keys") else row[0]
    assert int(creation_id) == int(created["id"])

    # Publishing again is idempotent — same post, no duplicate.
    again = builder.publish_creation(creation_id=created["id"], username="maker")
    assert again["post_id"] == pub["post_id"]
    assert again["already_published"] is True


def test_publish_rejects_non_owner(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    _make_user("intruder")
    cid = _make_community()
    created = builder.create_creation(username="maker", community_id=cid, prompt="a game")

    with pytest.raises(PermissionError):
        builder.publish_creation(creation_id=created["id"], username="intruder")


def test_gate_allows_free_quota_then_blocks_at_cap():
    _make_user("capped")  # free tier → free builder quota
    allowed, reason, ent = gate_builder_or_reason("capped", enforce_override=True)
    assert allowed is True
    assert reason is None
    cap = ent.get("builder_turns_per_month")
    assert isinstance(cap, int) and cap > 0

    for _ in range(cap):
        ai_usage.log_usage("capped", surface=ai_usage.SURFACE_BUILDER,
                           request_type="builder_create", community_id=1)

    blocked, reason2, _ent = gate_builder_or_reason("capped", enforce_override=True)
    assert blocked is False
    assert reason2 == "builder_monthly_cap"


def test_paid_tier_is_uncapped():
    _make_user("pro", subscription="premium")
    allowed, _reason, ent = gate_builder_or_reason("pro", enforce_override=True)
    assert allowed is True
    assert ent.get("builder_turns_per_month") is None


# --- Community interaction data ------------------------------------------------

def _make_creation(cid: int, owner: str = "maker", monkeypatch=None) -> int:
    if monkeypatch is not None:
        monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    return builder.create_creation(username=owner, community_id=cid, prompt="a game")["id"]


def test_submit_score_keeps_best_and_ranks(monkeypatch):
    _make_user("maker"); _make_user("p2")
    cid = _make_community()
    crid = _make_creation(cid, monkeypatch=monkeypatch)

    builder.submit_score(creation_id=crid, community_id=cid, username="maker", value=100)
    builder.submit_score(creation_id=crid, community_id=cid, username="maker", value=50)  # lower → ignored
    r = builder.submit_score(creation_id=crid, community_id=cid, username="p2", value=200)

    board = builder.get_leaderboard(crid, username="maker")
    assert [int(e["value"]) for e in board["entries"]] == [200, 100]
    assert board["entries"][0]["rank"] == 1
    assert board["mine"] is not None and int(board["mine"]["value"]) == 100 and board["mine"]["rank"] == 2
    assert r["rank"] == 1 and int(r["best"]) == 200


def test_rate_creation_aggregates(monkeypatch):
    _make_user("maker"); _make_user("p2")
    cid = _make_community()
    crid = _make_creation(cid, monkeypatch=monkeypatch)

    builder.rate_creation(creation_id=crid, community_id=cid, username="maker", value=4)
    builder.rate_creation(creation_id=crid, community_id=cid, username="maker", value=5)  # replaces (latest wins)
    res = builder.rate_creation(creation_id=crid, community_id=cid, username="p2", value=1)
    assert res["count"] == 2
    assert res["average"] == 3.0  # (5 + 1) / 2
    assert int(res["mine"]) == 1


def test_play_count_and_summary(monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation(cid, monkeypatch=monkeypatch)

    builder.record_play(crid)
    out = builder.record_play(crid)
    assert out["plays"] == 2

    builder.submit_score(creation_id=crid, community_id=cid, username="maker", value=500)
    builder.rate_creation(creation_id=crid, community_id=cid, username="maker", value=4)
    summary = builder.get_summary(crid)
    assert summary["plays"] == 2
    assert int(summary["top_score"]) == 500
    assert summary["rating_avg"] == 4.0 and summary["rating_count"] == 1


def test_converse_proposes_in_agent_mode(monkeypatch):
    monkeypatch.setattr(
        builder.llm, "generate_text",
        lambda *a, **k: '{"reply":"I\'ll make a neon snake with a leaderboard. Build it?","ready":true,"brief":"Neon snake with on-screen controls, sound, and a community leaderboard."}',
    )
    out = builder.converse([], "make a snake game", mode="simple", agent_mode=True)
    assert out["ready"] is True
    assert out["brief"]
    assert "snake" in out["reply"].lower()


def test_converse_ask_mode_never_builds(monkeypatch):
    # Even if the model says it's ready, Ask mode must never trigger a build.
    monkeypatch.setattr(
        builder.llm, "generate_text",
        lambda *a, **k: '{"reply":"Here is an idea you could try.","ready":true,"brief":"a thing"}',
    )
    out = builder.converse([], "make a snake game", agent_mode=False)
    assert out["ready"] is False
    assert out["brief"] == ""
    assert out["reply"]


def test_converse_tolerates_non_json(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: "Sure! Tell me more about the vibe you want.")
    out = builder.converse([], "hi", agent_mode=True)
    assert out["ready"] is False
    assert "vibe" in out["reply"].lower()


def test_invalid_score_is_rejected(monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation(cid, monkeypatch=monkeypatch)
    for bad in ("not-a-number", float("nan"), float("inf")):
        with pytest.raises(ValueError):
            builder.submit_score(creation_id=crid, community_id=cid, username="maker", value=bad)


# --- Async build jobs ---------------------------------------------------------
#
# The async builder is the durable, at-least-once-safe path: build/iterate
# enqueue a ``builder_jobs`` row and a worker runs generation later. These
# tests prove the reliability invariants that protect revenue + UX:
#   * exactly ONE ai_usage row per build turn (no double-charge on retries),
#   * an atomic claim so duplicate Cloud Tasks delivery cannot double-run,
#   * the completion notification fires exactly once,
#   * the entitlements gate / active-job / auth / ownership boundaries hold.

from flask import Flask  # noqa: E402

from backend.blueprints.builder import builder_bp  # noqa: E402
import backend.blueprints.builder as builder_bp_mod  # noqa: E402


def _count_usage_rows(username: str, *, surface: str = "builder", success=None) -> int:
    ph = get_sql_placeholder()
    where = [f"username = {ph}", f"surface = {ph}"]
    params = [username, surface]
    if success is not None:
        where.append(f"success = {ph}")
        params.append(1 if success else 0)
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT COUNT(*) AS n FROM ai_usage_log WHERE {' AND '.join(where)}", tuple(params))
        row = c.fetchone()
    if row is None:
        return 0
    return int(row["n"] if hasattr(row, "keys") else row[0])


def _set_job_raw(job_id: int, **cols) -> None:
    """Force builder_jobs columns directly so tests can fabricate states
    (e.g. an expired lease) that are tedious to reach through the worker."""
    ph = get_sql_placeholder()
    parts = ", ".join(f"{k} = {ph}" for k in cols)
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"UPDATE builder_jobs SET {parts} WHERE id = {ph}", (*cols.values(), job_id))
        conn.commit()


@pytest.fixture
def notify_recorder(monkeypatch):
    """Capture completion notifications without touching the notifications
    tables. Exercises the real ``_mark_notified`` gate (notify-once)."""
    calls = []
    monkeypatch.setattr(
        builder, "_notify_build_complete",
        lambda username, **kw: calls.append({"username": username, **kw}),
    )
    return calls


@pytest.fixture
def builder_client(monkeypatch):
    """Flask test client for the builder blueprint. Community access is
    stubbed (not under test here) and enqueue is a no-op recorder so the
    HTTP path never spawns a real generation thread."""
    monkeypatch.setattr(builder_bp_mod, "_can_access_community", lambda *_a, **_k: True)
    enqueued = []
    monkeypatch.setattr(builder, "enqueue_build_job", lambda jid: enqueued.append(jid) or False)
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(builder_bp)
    client = app.test_client()
    client._enqueued = enqueued  # type: ignore[attr-defined]
    return client


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


# ── P0: lifecycle, exactly-one usage, terminal failure, guards ──────────────

def test_create_job_persists_queued_row():
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")
    assert job["status"] == "queued"
    fetched = builder.get_build_job(int(job["id"]))
    assert fetched is not None
    assert fetched["username"] == "maker"
    assert int(fetched["community_id"]) == cid
    assert int(fetched["attempts"]) == 0
    assert fetched["kind"] == "create"


def test_run_build_job_create_success(monkeypatch, notify_recorder):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")

    out = builder.run_build_job(int(job["id"]))
    assert out["success"] is True

    fresh = builder.get_build_job(int(job["id"]))
    assert fresh["status"] == "succeeded"
    assert fresh["result_creation_id"]
    assert int(fresh["attempts"]) == 1
    assert fresh["started_at"] and fresh["finished_at"]
    # Lease released on terminal state.
    assert fresh["worker_token"] is None
    # Result points at a real creation owned by the maker.
    creation = builder.get_creation(int(fresh["result_creation_id"]))
    assert creation["created_by"] == "maker"


def test_run_build_job_iterate_success(monkeypatch, notify_recorder):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()
    created = builder.create_creation(username="maker", community_id=cid, prompt="a quiz")

    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: "<!doctype html><html><body>v2</body></html>")
    job = builder.create_build_job(username="maker", community_id=cid, creation_id=int(created["id"]),
                                   prompt="make it neon", tier="balanced", kind="iterate")
    out = builder.run_build_job(int(job["id"]))
    assert out["success"] is True

    fresh = builder.get_build_job(int(job["id"]))
    assert fresh["status"] == "succeeded"
    assert int(fresh["result_creation_id"]) == int(created["id"])
    assert "v2" in builder.get_creation(int(created["id"]))["html_content"]


def test_run_build_job_logs_exactly_one_usage_row_on_success(monkeypatch, notify_recorder):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")

    builder.run_build_job(int(job["id"]))
    assert _count_usage_rows("maker", success=True) == 1
    assert _count_usage_rows("maker", success=False) == 0
    # Completion notification fired exactly once.
    assert len(notify_recorder) == 1
    assert notify_recorder[0].get("failed") in (None, False)


def test_run_build_job_terminal_failure_logs_one_block_row(monkeypatch, notify_recorder):
    def _boom(*a, **k):
        raise RuntimeError("model produced an invalid artifact")
    monkeypatch.setattr(builder.llm, "generate_text", _boom)
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")

    out = builder.run_build_job(int(job["id"]))
    assert out["success"] is False
    assert out["transient"] is False  # terminal — Cloud Tasks should NOT retry

    fresh = builder.get_build_job(int(job["id"]))
    assert fresh["status"] == "failed"
    assert fresh["error"] == "build_failed"
    assert _count_usage_rows("maker", success=False) == 1
    assert _count_usage_rows("maker", success=True) == 0
    assert len(notify_recorder) == 1
    assert notify_recorder[0]["failed"] is True


def test_user_has_active_job_toggles(monkeypatch, notify_recorder):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")
    assert builder.user_has_active_job("maker") is True
    builder.run_build_job(int(job["id"]))
    assert builder.user_has_active_job("maker") is False


def test_blueprint_create_returns_409_when_active_job(builder_client):
    _make_user("maker")
    cid = _make_community()
    builder.create_build_job(username="maker", community_id=cid, prompt="first", tier="balanced")

    _login(builder_client, "maker")
    resp = builder_client.post("/api/builder/create", json={"community_id": cid, "prompt": "second"})
    assert resp.status_code == 409
    assert resp.get_json()["error"] == "builder_job_active"


def test_internal_run_route_requires_secret(monkeypatch, builder_client, notify_recorder):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    monkeypatch.setenv("BUILDER_JOB_SECRET", "s3cr3t")
    monkeypatch.delenv("CRON_SHARED_SECRET", raising=False)
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")
    url = f"/api/internal/builder/jobs/{int(job['id'])}/run"

    assert builder_client.post(url).status_code == 403
    assert builder_client.post(url, headers={"X-Builder-Job-Secret": "wrong"}).status_code == 403
    ok = builder_client.post(url, headers={"X-Builder-Job-Secret": "s3cr3t"})
    assert ok.status_code == 200
    assert ok.get_json()["success"] is True


def test_job_get_returns_404_for_non_owner(builder_client):
    _make_user("maker")
    _make_user("intruder")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")

    _login(builder_client, "intruder")
    resp = builder_client.get(f"/api/builder/jobs/{int(job['id'])}")
    assert resp.status_code == 404


# ── P1: idempotency, notify-once, cap block, Cloud Tasks enqueue ────────────

def test_duplicate_worker_delivery_is_noop(monkeypatch, notify_recorder):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")

    first = builder.run_build_job(int(job["id"]))
    second = builder.run_build_job(int(job["id"]))  # Cloud Tasks redelivery

    assert first["success"] is True
    assert second.get("already_done") is True
    # No duplicate creation, no duplicate usage row, no duplicate notification.
    assert _count_usage_rows("maker", success=True) == 1
    assert len(notify_recorder) == 1


def test_concurrent_claim_returns_already_running(monkeypatch, notify_recorder):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")
    # Another worker already holds the job with a valid (future) lease.
    assert builder.claim_build_job(int(job["id"]), "other-worker", lease_seconds=600) is True

    out = builder.run_build_job(int(job["id"]))
    assert out.get("already_running") is True
    # The loser produced no side effects.
    assert _count_usage_rows("maker", success=True) == 0
    assert len(notify_recorder) == 0


def test_blueprint_create_logs_block_and_returns_402_when_gate_denies(monkeypatch, builder_client):
    # Force a denied gate (e.g. monthly cap reached) regardless of the
    # ENTITLEMENTS_ENFORCEMENT_ENABLED flag.
    monkeypatch.setattr(builder_bp_mod, "gate_builder_or_reason",
                        lambda *a, **k: (False, "builder_monthly_cap", {}))
    _make_user("capped")
    cid = _make_community()

    _login(builder_client, "capped")
    resp = builder_client.post("/api/builder/create", json={"community_id": cid, "prompt": "x"})
    assert resp.status_code == 402
    # One block row written via ai_usage.log_block (success=0).
    assert _count_usage_rows("capped", success=False) == 1
    # No job enqueued.
    assert builder_client._enqueued == []


def test_enqueue_build_job_cloud_tasks_path(monkeypatch):
    import sys
    import types

    monkeypatch.setenv("BUILDER_TASKS_QUEUE", "test-queue")
    monkeypatch.setenv("BUILDER_TASKS_LOCATION", "us-central1")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://test.example.com")
    monkeypatch.setenv("BUILDER_JOB_SECRET", "s3cr3t")

    created = []

    class FakeClient:
        def queue_path(self, project, location, queue):
            return f"projects/{project}/locations/{location}/queues/{queue}"

        def create_task(self, *, request):
            created.append(request)

    fake_tasks = types.ModuleType("google.cloud.tasks_v2")
    fake_tasks.CloudTasksClient = FakeClient
    fake_tasks.HttpMethod = types.SimpleNamespace(POST="POST")
    monkeypatch.setitem(sys.modules, "google.cloud.tasks_v2", fake_tasks)

    ok = builder.enqueue_build_job(4242)
    assert ok is True
    assert len(created) == 1
    task = created[0]["task"]["http_request"]
    assert task["url"].endswith("/api/internal/builder/jobs/4242/run")
    assert task["headers"]["X-Builder-Job-Secret"] == "s3cr3t"


# ── P2: reaper, retries, placeholder-bug regression ─────────────────────────

def test_sweep_requeues_stale_running_job(monkeypatch, notify_recorder):
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")
    jid = int(job["id"])
    # Simulate a crashed worker: running with an expired lease, attempts left.
    _set_job_raw(jid, status="running", attempts=1, max_attempts=3,
                 lease_expires_at="2000-01-01 00:00:00", worker_token="dead")
    requeued = []
    monkeypatch.setattr(builder, "enqueue_build_job", lambda j: requeued.append(j) or False)

    result = builder.sweep_build_jobs()
    assert result["requeued"] == 1 and result["failed"] == 0
    assert builder.get_build_job(jid)["status"] == "queued"
    assert requeued == [jid]


def test_sweep_fails_job_past_max_attempts(monkeypatch, notify_recorder):
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")
    jid = int(job["id"])
    _set_job_raw(jid, status="running", attempts=3, max_attempts=3,
                 lease_expires_at="2000-01-01 00:00:00", worker_token="dead")

    result = builder.sweep_build_jobs()
    assert result["failed"] == 1 and result["requeued"] == 0
    fresh = builder.get_build_job(jid)
    assert fresh["status"] == "failed"
    assert fresh["error"] == "build_timed_out"
    # One block row + one failure notification.
    assert _count_usage_rows("maker", success=False) == 1
    assert len(notify_recorder) == 1 and notify_recorder[0]["failed"] is True


def test_failed_job_can_be_retried(monkeypatch, notify_recorder):
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")
    jid = int(job["id"])

    def _boom(*a, **k):
        raise RuntimeError("transient-free terminal error")
    monkeypatch.setattr(builder.llm, "generate_text", _boom)
    builder.run_build_job(jid)
    assert builder.get_build_job(jid)["status"] == "failed"

    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    builder.run_build_job(jid)  # failed jobs are re-claimable
    fresh = builder.get_build_job(jid)
    assert fresh["status"] == "succeeded"
    assert int(fresh["attempts"]) == 2
    # One failure row + one success row.
    assert _count_usage_rows("maker", success=False) == 1
    assert _count_usage_rows("maker", success=True) == 1


def test_set_job_status_handles_question_mark_in_value():
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")
    jid = int(job["id"])
    # Regression: the old replace('?', ph) corrupted any value with a '?'.
    builder._set_job_status(jid, "failed", error="why? because the model said so?", finished=True)
    fresh = builder.get_build_job(jid)
    assert fresh["status"] == "failed"
    assert fresh["error"] == "why? because the model said so?"
