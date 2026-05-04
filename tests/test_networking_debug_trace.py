"""Tests for sanitized Steve networking debug traces."""

from backend.services.networking_debug_trace import build_networking_debug_trace


def test_debug_trace_is_compact_json_safe_and_redacts_sensitive_keys():
    trace = build_networking_debug_trace(
        query_plan={
            "intent_summary": "Find direct cooking capability",
            "target": "cooking",
            "relationship_to_target": "direct personal capability",
            "dimension_analysis": {
                "LifeInterests": {"priority": "primary", "reason": "Personal capability evidence belongs here."},
                "system_prompt": "do not expose",
            },
            "direct_evidence_query": "personally cooks recipes weekly cooking",
        },
        dimension_plan={"primary_dimensions": {"LifeInterests"}, "api_key": "xai-secret"},
        retrieval_query="cook " * 300,
        structured_ids=["chef", "food_investor"],
        structured_details={
            "chef": {
                "score": 14.123456789,
                "matched_dimensions": {"LifeInterests"},
                "direct_evidence_hits": 3,
                "adjacent_evidence_hits": 1,
            },
            "food_investor": {"score": 2, "deprioritized_evidence_hits": 2},
        },
        semantic_ids=["chef"],
        semantic_details={"chef": {"semantic_score": 0.88, "best_chunk_type": "LifeInterests"}},
        candidate_pool=["chef", "food_investor"],
        metadata_scores={"chef": {"score": 4, "session_token": "hidden"}},
        ordered_usernames=["chef", "food_investor"],
        tiered_matches={"chef": "direct", "food_investor": "broader"},
        forced_usernames=[],
        retrieval_policy={"prompt_member_cap": 2, "full_context_cap": 10, "secret": "hidden"},
        all_member_usernames=["chef", "food_investor", "pilot"],
        model_used="grok-4.20-reasoning",
        recommended=["chef"],
        ai_response="@" + "chef " * 300,
        planner_model="grok-4-1-fast-reasoning",
        planner_diagnostics={
            "attempted": True,
            "succeeded": False,
            "failure_reason": "normalization_empty",
            "raw_preview": "{" + ("x" * 1200),
            "api_key": "hidden",
        },
    )

    assert trace["planner"]["diagnostics"]["attempted"] is True
    assert trace["planner"]["diagnostics"]["failure_reason"] == "normalization_empty"
    assert trace["planner"]["diagnostics"]["api_key"] == "[redacted]"
    assert len(trace["planner"]["diagnostics"]["raw_preview"]) <= 1000
    assert trace["planner"]["dimension_analysis"]["LifeInterests"]["priority"] == "primary"
    assert trace["planner"]["dimension_analysis"]["system_prompt"] == "[redacted]"
    assert trace["retrieval"]["dimension_plan"]["primary_dimensions"] == ["LifeInterests"]
    assert trace["retrieval"]["dimension_plan"]["api_key"] == "[redacted]"
    assert trace["fusion"]["metadata_scores"]["chef"]["session_token"] == "[redacted]"
    assert trace["context"]["retrieval_policy"]["secret"] == "[redacted]"
    assert trace["context"]["member_count"] == 3
    assert len(trace["retrieval"]["retrieval_query"]) < 905
    assert trace["retrieval"]["structured_candidates"][0]["direct_evidence_hits"] == 3
    assert trace["final_answer"]["recommended_usernames"] == ["chef"]
    assert len(trace["final_answer"]["response_preview"]) < 705
