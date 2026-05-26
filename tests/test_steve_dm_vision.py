"""Steve DM Grok vision payload wiring (lightweight)."""

from __future__ import annotations

from contextlib import ExitStack
from unittest.mock import MagicMock, patch


def test_run_grok_dm_turn_attaches_input_image():
    captured = {}

    def fake_create(**kwargs):
        captured.update(kwargs)
        resp = MagicMock()
        resp.output_text = "I see a chart with revenue trends."
        return resp

    mock_client = MagicMock()
    mock_client.responses.create = fake_create

    cfg = MagicMock()
    cfg.model = "grok-test"
    cfg.max_output_tokens_dm = 800

    cursor = MagicMock()
    cursor.fetchall.return_value = [
        {
            "sender": "paulo",
            "message": "what is in this photo?",
            "image_path": "https://cdn.example/photo.jpg",
            "media_paths": None,
            "timestamp": "2026-05-25 12:00:00",
        }
    ]

    with ExitStack() as stack:
        stack.enter_context(patch("backend.services.steve_dm_reply.XAI_API_KEY", "test-key"))
        stack.enter_context(patch("openai.OpenAI", return_value=mock_client))
        stack.enter_context(patch("bodybuilding_app.get_steve_context_for_user", return_value=""))
        stack.enter_context(patch("backend.services.steve_prompt_policy.should_include_user_profile", return_value=False))
        stack.enter_context(patch("backend.services.steve_profiling_gates.user_can_access_steve_kb", return_value=False))
        mock_cfg = stack.enter_context(patch("backend.services.steve_model_config.get_steve_model_config"))
        mock_cfg.return_value = cfg
        stack.enter_context(patch("backend.services.steve_model_config.output_cap_for_surface", return_value=800))
        stack.enter_context(patch("backend.services.steve_model_config.context_limit", return_value=200))
        stack.enter_context(patch("backend.services.steve_model_config.response_usage_tokens", return_value=(10, 20)))
        stack.enter_context(patch("backend.services.steve_model_config.estimate_response_cost_usd", return_value=0.0))
        stack.enter_context(patch("backend.services.steve_tool_router.resolve_steve_hosted_tools", return_value=[]))
        stack.enter_context(patch("backend.services.steve_prompt_policy.render_hosted_search_capability_instructions", return_value="- no web"))
        stack.enter_context(patch("backend.services.steve_prompt_policy.append_response_policy", side_effect=lambda p, *_a, **_k: p))
        stack.enter_context(patch("backend.services.steve_platform_manual.render_platform_manual_prompt", return_value=""))
        stack.enter_context(patch("backend.services.steve_platform_manual.render_global_steve_safety_prompt", return_value=""))
        stack.enter_context(patch("backend.services.steve_platform_manual.select_platform_manual_cards", return_value=[]))
        stack.enter_context(patch("backend.services.steve_platform_manual.is_platform_question", return_value=False))
        stack.enter_context(patch("backend.services.steve_platform_manual.is_professional_advice_intent", return_value=False))
        stack.enter_context(patch("backend.services.steve_platform_manual.append_professional_disclaimer_if_needed", side_effect=lambda x, *_a, **_k: x))
        stack.enter_context(patch("backend.services.steve_community_config.get_paid_steve_package_config", return_value=MagicMock()))
        stack.enter_context(patch("backend.services.steve_dm_reply._persist_grok_steves_reply"))
        stack.enter_context(patch("backend.services.ai_usage.log_usage"))
        stack.enter_context(patch("bodybuilding_app.format_steve_response_links", side_effect=lambda x: x))
        mock_conn = stack.enter_context(patch("backend.services.steve_dm_reply.get_db_connection"))
        mock_conn.return_value.__enter__.return_value.cursor.return_value = cursor

        from backend.services import steve_dm_reply as sdr

        sdr._run_grok_dm_turn(
            sender_username="paulo",
            user_message="what is in this photo?",
            other_username=None,
            entitlements={"max_images_per_turn": 5},
        )

    user_msg = captured["input"][1]["content"]
    assert isinstance(user_msg, list)
    assert any(item.get("type") == "input_image" for item in user_msg)
