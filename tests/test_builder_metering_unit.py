"""Unit tests (no DB) for the builder cost-metering primitives.

Covers the two pieces the builder cost-control work added to the shared LLM
metering path:
  * ``usage_context(surface=...)`` — the builder's chat / plan / pipeline /
    judge contexts must label their rows with their own surface instead of
    ``content_gen`` (and nested contexts must override then restore).
  * ``steve_model_config.estimate_model_cost_usd`` — KB-backed per-model
    pricing so ai_usage rows carry a real ``cost_usd`` for the spend
    ceilings; hard fallbacks mirror provider list prices when the KB is
    unavailable.
"""

from __future__ import annotations

from types import SimpleNamespace

from backend.services import steve_model_config as smc
from backend.services.content_generation import llm


def _resp(tokens_in=100, tokens_out=10):
    return SimpleNamespace(usage=SimpleNamespace(input_tokens=tokens_in, output_tokens=tokens_out))


# ── usage_context surface labelling ──────────────────────────────────────


def test_usage_context_surface_override_labels_builder_rows(monkeypatch):
    logged = []
    monkeypatch.setattr("backend.services.ai_usage.log_usage",
                        lambda username, **kw: logged.append((username, kw)))
    monkeypatch.setattr(smc, "_field_map", lambda _slug: {})  # KB-less → fallback rates

    with llm.usage_context(username="u", request_type="builder_chat", surface="builder_chat"):
        llm._log_llm_usage(_resp(1000, 200), model="claude-fable-5")

    assert len(logged) == 1
    username, kw = logged[0]
    assert username == "u"
    assert kw["surface"] == "builder_chat"
    assert kw["request_type"] == "builder_chat"
    assert kw["model"] == "claude-fable-5"
    assert kw["tokens_in"] == 1000 and kw["tokens_out"] == 200
    # Fable list price fallback: 1000/1M * $10 + 200/1M * $50 = 0.02
    assert abs(kw["cost_usd"] - 0.02) < 1e-9


def test_usage_context_default_surface_stays_content_gen(monkeypatch):
    logged = []
    monkeypatch.setattr("backend.services.ai_usage.log_usage",
                        lambda username, **kw: logged.append(kw))
    monkeypatch.setattr(smc, "_field_map", lambda _slug: {})

    with llm.usage_context(username="u", request_type="content_test"):
        llm._log_llm_usage(_resp(), model="grok-4.3")

    assert logged[0]["surface"] == "content_gen"


def test_nested_usage_context_overrides_then_restores(monkeypatch):
    """The vision judge nests its own context inside the build worker's —
    the inner surface wins for its calls, the outer one is restored after."""
    logged = []
    monkeypatch.setattr("backend.services.ai_usage.log_usage",
                        lambda username, **kw: logged.append(kw))
    monkeypatch.setattr(smc, "_field_map", lambda _slug: {})

    with llm.usage_context(username="u", request_type="builder_create", surface="builder_llm"):
        llm._log_llm_usage(_resp(), model="grok-4.3")
        with llm.usage_context(username="u", request_type="builder_judge", surface="builder_judge"):
            llm._log_llm_usage(_resp(), model="claude-opus-4-8")
        llm._log_llm_usage(_resp(), model="grok-4.3")

    assert [row["surface"] for row in logged] == ["builder_llm", "builder_judge", "builder_llm"]


def test_no_context_means_no_row(monkeypatch):
    logged = []
    monkeypatch.setattr("backend.services.ai_usage.log_usage",
                        lambda username, **kw: logged.append(kw))
    llm._log_llm_usage(_resp(), model="grok-4.3")
    assert logged == []


# ── estimate_model_cost_usd ──────────────────────────────────────────────


def test_estimate_model_cost_fallback_rates(monkeypatch):
    monkeypatch.setattr(smc, "_field_map", lambda _slug: {})
    assert smc.estimate_model_cost_usd("claude-fable-5", 1_000_000, 0) == 10.0
    assert smc.estimate_model_cost_usd("claude-fable-5", 0, 1_000_000) == 50.0
    assert smc.estimate_model_cost_usd("claude-mythos-5", 1_000_000, 0) == 10.0
    assert smc.estimate_model_cost_usd("claude-opus-4-8", 1_000_000, 1_000_000) == 30.0
    assert smc.estimate_model_cost_usd("gpt-4o", 1_000_000, 0) == 2.5


def test_estimate_model_cost_reads_kb_overrides(monkeypatch):
    monkeypatch.setattr(smc, "_field_map", lambda _slug: {
        "model_fable_input_per_m_usd": 12.0,
        "model_fable_output_per_m_usd": 60.0,
    })
    assert smc.estimate_model_cost_usd("claude-fable-5", 500_000, 100_000) == 12.0


def test_grok_models_fall_through_to_primary_config(monkeypatch):
    monkeypatch.setattr(smc, "_field_map", lambda _slug: {})
    # Primary-model defaults: $1.25 in / $2.50 out per 1M.
    assert smc.estimate_model_cost_usd("grok-4.3", 1_000_000, 1_000_000) == 3.75


def test_estimate_model_cost_tolerates_none_tokens(monkeypatch):
    monkeypatch.setattr(smc, "_field_map", lambda _slug: {})
    assert smc.estimate_model_cost_usd("claude-fable-5", None, None) == 0.0
    assert smc.estimate_model_cost_usd(None, 1000, 1000) >= 0.0
