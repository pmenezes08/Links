import pytest

from backend.services import creation_runtime as rt


def test_runtime_normalizes_external_names_and_keys():
    assert rt.normalize_key(" Main Board!! ") == "main_board"
    assert rt.normalize_name("RSVP List 2026") == "rsvp_list_2026"
    assert rt.normalize_key("!!!") == "main"
    assert rt.normalize_name("") == "items"


def test_runtime_rejects_non_json_and_oversized_values():
    with pytest.raises(ValueError) as invalid:
        rt._json_dumps({"bad": object()}, 1000)
    assert str(invalid.value) == "invalid_json"

    with pytest.raises(ValueError) as large:
        rt._json_dumps({"text": "x" * 200}, 20)
    assert str(large.value) == "value_too_large"
