from __future__ import annotations

from unittest.mock import MagicMock

from backend.services.steve_resource_context import (
    _docs_section_from_memory_or_legacy,
    _memory_context_is_usable,
    scope_has_useful_docs,
)


def test_memory_context_is_usable_requires_chunks():
    assert _memory_context_is_usable("", {"manifest_count": 1}) is False
    assert _memory_context_is_usable("Community manifest only", {"manifest_count": 1, "chunk_count": 0}) is False
    assert _memory_context_is_usable(
        "Relevant document excerpts from this exact scope:\n\nDocument: Plan",
        {"manifest_count": 1, "chunk_count": 2},
    ) is True
    assert _memory_context_is_usable(
        "Relevant document excerpts from this exact scope:\n\nDocument: Plan",
        {"manifest_count": 1, "chunk_count": 0},
    ) is True


def test_scope_has_useful_docs_community_excludes_group_rows():
    c = MagicMock()
    c.fetchone.side_effect = [None, {"1": 1}]

    assert scope_has_useful_docs(c, "%s", community_id=5) is False
    c.execute.assert_called()
    sql = c.execute.call_args_list[0][0][0]
    assert "group_id IS NULL" in sql

    assert scope_has_useful_docs(c, "%s", community_id=5) is True


def test_docs_section_falls_back_when_manifest_only(monkeypatch):
    c = MagicMock()
    doc_row = {"file_path": "docs/foo.pdf", "description": "Quarterly plan"}
    c.fetchall.return_value = [doc_row]

    monkeypatch.setattr(
        "backend.services.steve_document_memory.build_doc_memory_context",
        lambda *args, **kwargs: ("Indexed manifest without chunks", {"manifest_count": 1, "chunk_count": 0}),
    )
    monkeypatch.setattr(
        "backend.services.steve_resource_context.extract_pdf_text_for_steve",
        lambda fp, max_chars=4000: "Legacy PDF excerpt text",
    )

    section = _docs_section_from_memory_or_legacy(
        c,
        "%s",
        scope_sql="community_id = %s",
        scope_params=(1,),
        docs_limit=3,
        max_doc_chars_total=2000,
        community_id=1,
        group_id=None,
        query="read the documents",
        original_post="",
        recent_comments=None,
        section_label="Community documents",
    )

    assert section is not None
    assert "Legacy PDF excerpt text" in section
    assert "Indexed manifest without chunks" not in section
