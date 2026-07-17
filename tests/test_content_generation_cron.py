"""Content-generation cron: failure must advance the schedule; LLM calls meter.

Regression tests for the July 2026 xAI credit exhaustion:
  * A failing due job previously kept its next_run_at, staying "due" forever —
    the every-10-minutes cron re-executed a WEEKLY web-search job ~4.6k times.
    Now a failed run advances to its next scheduled slot like a successful one.
  * Those calls were invisible: content generation logged nothing to
    ai_usage_log. llm helpers now log one row per upstream call — but ONLY
    when a usage_context is active (the builder logs its own rows; no
    double-counting).
"""

from __future__ import annotations

from types import SimpleNamespace

from backend.services.content_generation import llm


# ── Metering: context-gated, correct token extraction ────────────────────


class _FakeUsageResponse:
    def __init__(self, tokens_in=1234, tokens_out=56):
        self.usage = SimpleNamespace(input_tokens=tokens_in, output_tokens=tokens_out)
        self.output_text = '{"ok": true}'


def test_log_llm_usage_requires_context(monkeypatch):
    logged = []
    monkeypatch.setattr(
        "backend.services.ai_usage.log_usage",
        lambda username, **kw: logged.append((username, kw)),
    )

    # No context (builder-style call) → no row: builder keeps its own logging.
    llm._log_llm_usage(_FakeUsageResponse(), model="grok-4.3")
    assert logged == []

    # Inside a context (content-gen job) → exactly one row with real tokens.
    with llm.usage_context(username="jobowner", request_type="content_public_news_roundup", community_id=210):
        llm._log_llm_usage(_FakeUsageResponse(), model="grok-4.3", tools_web_search=True)
    assert len(logged) == 1
    username, kw = logged[0]
    assert username == "jobowner"
    assert kw["surface"] == "content_gen"
    assert kw["request_type"] == "content_public_news_roundup"
    assert kw["tokens_in"] == 1234 and kw["tokens_out"] == 56
    assert kw["community_id"] == 210
    assert kw["tools_web_search"] is True

    # Context resets after the block.
    llm._log_llm_usage(_FakeUsageResponse(), model="grok-4.3")
    assert len(logged) == 1


def test_usage_tokens_handles_both_provider_shapes():
    responses_shape = SimpleNamespace(input_tokens=10, output_tokens=2)
    chat_shape = SimpleNamespace(prompt_tokens=30, completion_tokens=4)
    assert llm._usage_tokens(responses_shape) == (10, 2)
    assert llm._usage_tokens(chat_shape) == (30, 4)
    assert llm._usage_tokens(None) == (None, None)
    assert llm._usage_tokens({"input_tokens": 7, "output_tokens": 1}) == (7, 1)


def test_logging_failure_never_raises(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("ai_usage down")

    monkeypatch.setattr("backend.services.ai_usage.log_usage", boom)
    with llm.usage_context(username="x", request_type="content_test"):
        llm._log_llm_usage(_FakeUsageResponse(), model="grok-4.3")  # must not raise


# ── Cron: failed job still advances its schedule ─────────────────────────


def test_failed_due_job_advances_next_run(monkeypatch):
    import bodybuilding_app
    from backend.blueprints import content_generation as cg

    due = [{
        "id": 27,
        "idea_id": "public_news_roundup",
        "community_id": 210,
        "actor_username": "Paulo",
        "schedule": {"cadence": "weekly"},
    }]
    advanced = []

    monkeypatch.setattr(cg, "get_due_jobs", lambda limit=5: due)
    monkeypatch.setattr(
        cg, "execute_job",
        lambda job, triggered_by_username: (_ for _ in ()).throw(RuntimeError("upstream 403")),
    )
    monkeypatch.setattr(
        cg, "update_job_next_run",
        lambda job_id, cadence: advanced.append((job_id, cadence)),
    )
    monkeypatch.setenv("CRON_SHARED_SECRET", "test-cron-secret")

    client = bodybuilding_app.app.test_client()
    resp = client.post(
        "/api/content-generation/cron/process-due-jobs",
        headers={"X-Cron-Secret": "test-cron-secret"},
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["processed"] == 0          # the job failed…
    assert advanced == [(27, "weekly")]    # …but its schedule STILL advanced


def test_successful_due_job_advances_next_run_once(monkeypatch):
    import bodybuilding_app
    from backend.blueprints import content_generation as cg

    due = [{
        "id": 28,
        "idea_id": "public_opinion_roundup",
        "community_id": 210,
        "actor_username": "Paulo",
        "schedule": {"cadence": "weekly"},
    }]
    advanced = []

    monkeypatch.setattr(cg, "get_due_jobs", lambda limit=5: due)
    monkeypatch.setattr(
        cg, "execute_job",
        lambda job, triggered_by_username: {"run_id": 1, "output_post_id": 99},
    )
    monkeypatch.setattr(
        cg, "update_job_next_run",
        lambda job_id, cadence: advanced.append((job_id, cadence)),
    )
    monkeypatch.setenv("CRON_SHARED_SECRET", "test-cron-secret")

    client = bodybuilding_app.app.test_client()
    resp = client.post(
        "/api/content-generation/cron/process-due-jobs",
        headers={"X-Cron-Secret": "test-cron-secret"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["processed"] == 1
    assert advanced == [(28, "weekly")]    # exactly once, not twice


def test_cron_rejects_unauthenticated(monkeypatch):
    import bodybuilding_app
    from backend.blueprints import content_generation as cg

    called = []
    monkeypatch.setattr(cg, "get_due_jobs", lambda limit=5: called.append("ran") or [])
    monkeypatch.setenv("CRON_SHARED_SECRET", "test-cron-secret")
    monkeypatch.delenv("CONTENT_GENERATION_CRON_API_KEY", raising=False)

    client = bodybuilding_app.app.test_client()
    resp = client.post("/api/content-generation/cron/process-due-jobs")
    assert resp.status_code == 401
    assert called == []  # handler body never ran
