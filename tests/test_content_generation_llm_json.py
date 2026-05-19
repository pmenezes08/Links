"""Unit tests for content-generation JSON extraction (no API calls)."""

from __future__ import annotations

import pytest

from backend.services.content_generation.llm import _extract_json


def test_extract_json_bare_object():
    assert _extract_json('{"hook": "hi", "sections": []}') == {"hook": "hi", "sections": []}


def test_extract_json_markdown_fence():
    raw = "```json\n{\"a\": 1, \"b\": \"x\"}\n```"
    assert _extract_json(raw) == {"a": 1, "b": "x"}


def test_extract_json_fence_no_lang():
    raw = "```\n{\"ok\": true}\n```"
    assert _extract_json(raw) == {"ok": True}


def test_extract_json_prose_before_braces():
    raw = 'Here is the payload:\n{"sections": [], "hook": "test"}'
    assert _extract_json(raw) == {"sections": [], "hook": "test"}


def test_extract_json_empty_raises():
    with pytest.raises(ValueError, match="Empty"):
        _extract_json("")
    with pytest.raises(ValueError, match="Empty"):
        _extract_json("   ")


def test_extract_json_no_object_raises():
    with pytest.raises(ValueError, match="No JSON object"):
        _extract_json("no braces here")
