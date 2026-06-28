from backend.services import creation_match as cm


def test_cell_reads_dict_cursor_rows_by_select_order():
    """Regression: production MySQL uses DictCursor, not positional tuples."""
    assert cm._cell({"username": "alice", "display_name": "Alice"}, 0) == "alice"
    assert cm._cell({"username": "alice", "display_name": "Alice"}, 1) == "Alice"

