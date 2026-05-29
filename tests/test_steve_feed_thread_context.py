from __future__ import annotations

from unittest.mock import MagicMock

from backend.services.steve_feed_thread_context import (
    STEVE_PRIOR_REPLY_LABEL,
    ThreadComment,
    fetch_recent_post_comments,
    format_thread_for_steve,
)


def _desc_rows(start: int, end: int):
    """Simulate SQL ORDER BY timestamp DESC (newest first)."""
    rows = []
    for i in range(end, start - 1, -1):
        rows.append(
            {
                "username": f"user{i}",
                "content": f"comment {i}",
                "id": i,
                "parent_reply_id": None,
                "timestamp": f"2026-05-25 12:{i:02d}:00",
            }
        )
    return rows


def test_format_comment_includes_timestamp():
    """Comment lines now include a timestamp prefix from sort_key."""
    from backend.services.steve_feed_thread_context import _format_comment_line
    comment = ThreadComment(
        id=1, username="paulo", content="Great post!",
        parent_reply_id=None, sort_key="2026-05-25 14:30:00",
    )
    line = _format_comment_line(comment, number=1, id_to_number={1: 1})
    assert "[May 25, 14:30]" in line
    assert "#1" in line
    assert "paulo: Great post!" in line


def test_fetch_recent_post_comments_returns_tail_not_head():
    cursor = MagicMock()
    cursor.fetchall.return_value = _desc_rows(5, 12)

    comments = fetch_recent_post_comments(cursor, "%s", post_id=1, limit=8)

    assert [c.content for c in comments] == [f"comment {i}" for i in range(5, 13)]
    assert "comment 4" not in [c.content for c in comments]
    assert comments[-1].content == "comment 12"


def test_format_thread_labels_steve_prior_replies():
    comments = [
        ThreadComment(id=1, username="paulo", content="What about NASA?", parent_reply_id=None),
        ThreadComment(id=2, username="steve", content="NASA digital transformation example.", parent_reply_id=1),
    ]
    block, plain = format_thread_for_steve(
        comments,
        post_description="Original post by mary: Research question",
        current_username="paulo",
        current_message="@steve give sources",
        max_chars=12000,
    )

    assert STEVE_PRIOR_REPLY_LABEL in block
    assert "NASA digital transformation example." in block
    assert plain == ["What about NASA?", "NASA digital transformation example."]
    assert "#1" in block and "#2" in block


def test_format_thread_shows_parent_reply_hint():
    comments = [
        ThreadComment(id=1, username="mary", content="See the Work Project doc", parent_reply_id=None),
        ThreadComment(id=2, username="paulo", content="What did Steve say?", parent_reply_id=1),
    ]
    block, _ = format_thread_for_steve(
        comments,
        post_description="Original post by mary: Topic",
        current_username="paulo",
        current_message="@steve sources please",
        max_chars=12000,
    )

    assert "↳ reply to #1" in block


def test_format_thread_trims_oldest_comments_when_over_char_budget():
    comments = [
        ThreadComment(id=i, username="user", content=f"{'x' * 400} #{i}", parent_reply_id=None)
        for i in range(1, 9)
    ]
    block, plain = format_thread_for_steve(
        comments,
        post_description="Original post by author: Short post",
        current_username="paulo",
        current_message="follow up",
        max_chars=2500,
    )

    assert "#8" in block or " #8" in block
    assert "#1 x" not in block
    assert len(plain) < len(comments)


def test_render_thread_grounding_appendix_mentions_multilingual_and_prior_replies():
    from backend.services.steve_prompt_policy import render_thread_grounding_appendix

    text = render_thread_grounding_appendix()
    assert "multilingual" in text.lower()
    assert STEVE_PRIOR_REPLY_LABEL in text
