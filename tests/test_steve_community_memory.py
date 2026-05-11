from __future__ import annotations

from backend.services.steve_community_memory import _render_direct_memory


def test_render_direct_memory_keeps_prompt_compact():
    text = _render_direct_memory(
        {
            "currentSummary": "A travel community planning Portugal trips.",
            "topics": ["Lisbon", "Algarve"],
            "activeDecisions": ["Villa shortlist"],
        }
    )

    assert "Community memory summary: A travel community planning Portugal trips." in text
    assert "Recurring topics: Lisbon; Algarve" in text
    assert "Active decisions: Villa shortlist" in text
