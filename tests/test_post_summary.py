"""Post-summary surface — authorization, gating, and usage accounting.

Locks down the three invariants the legacy monolith route violated:

  1. **Authorization**: only members of the post's community (or app
     admins) can summarize it; outsiders get the same non-enumerating
     404 as a missing post, and no Grok call is made.
  2. **Gating**: the call runs through ``check_steve_access`` with the
     ``post_summary`` surface — a free user with enforcement on is
     blocked with the canonical entitlements error shape, and the block
     is logged.
  3. **Accounting**: exactly one ``ai_usage_log`` row per upstream call,
     ``surface='post_summary'``, with tokens and community attribution.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import pytest

from backend.services import ai_usage
from backend.services.ai_usage import SURFACE_POST_SUMMARY
from backend.services.database import get_db_connection, get_sql_placeholder

from tests.fixtures import days_ago, make_community, make_user


# ── Helpers ─────────────────────────────────────────────────────────────


def _join_community(username: str, community_id: int) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        user_id = row["id"] if hasattr(row, "keys") else row[0]
        c.execute(
            f"INSERT INTO user_communities (user_id, community_id, role) VALUES ({ph}, {ph}, 'member')",
            (int(user_id), int(community_id)),
        )
        conn.commit()


def _make_post(community_id: Optional[int], author: str, content: str, replies: List[str] = ()) -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO posts (community_id, username, content) VALUES ({ph}, {ph}, {ph})",
            (community_id, author, content),
        )
        post_id = int(c.lastrowid)
        for reply in replies:
            c.execute(
                f"INSERT INTO replies (post_id, community_id, username, content) VALUES ({ph}, {ph}, {ph}, {ph})",
                (post_id, community_id, author, reply),
            )
        conn.commit()
    return post_id


def _usage_rows(surface: str = SURFACE_POST_SUMMARY) -> List[Dict[str, Any]]:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""SELECT username, surface, request_type, success, reason_blocked,
                       tokens_in, tokens_out, community_id, model
                FROM ai_usage_log WHERE surface = {ph}""",
            (surface,),
        )
        rows = c.fetchall()
    out = []
    for r in rows:
        if hasattr(r, "keys"):
            out.append(dict(r))
        else:
            out.append({
                "username": r[0], "surface": r[1], "request_type": r[2],
                "success": r[3], "reason_blocked": r[4], "tokens_in": r[5],
                "tokens_out": r[6], "community_id": r[7], "model": r[8],
            })
    return out


class _FakeUsage:
    prompt_tokens = 321
    completion_tokens = 87


class _FakeMessage:
    content = "A concise summary of the discussion."


class _FakeChoice:
    message = _FakeMessage()


class _FakeResponse:
    choices = [_FakeChoice()]
    usage = _FakeUsage()


class _FakeCompletions:
    def __init__(self, calls: list):
        self._calls = calls

    def create(self, **kwargs):
        self._calls.append(kwargs)
        return _FakeResponse()


class _FakeChat:
    def __init__(self, calls: list):
        self.completions = _FakeCompletions(calls)


class _FakeOpenAI:
    calls: list = []

    def __init__(self, *args, **kwargs):
        self.chat = _FakeChat(self.__class__.calls)


@pytest.fixture(autouse=True)
def _clear_summary_cache():
    """The shared cache is process-global and post ids reset with TRUNCATE —
    flush it so a cached summary from one test can't leak into the next."""
    from redis_cache import cache as shared_cache

    for store in ("cache", "expiry"):
        try:
            getattr(shared_cache, store).clear()
        except Exception:
            pass
    yield


@pytest.fixture()
def fake_grok(monkeypatch):
    """Patch the xAI client and API key; yields the recorded call list."""
    import openai

    from backend.services import post_summary as ps

    _FakeOpenAI.calls = []
    monkeypatch.setattr(openai, "OpenAI", _FakeOpenAI)
    monkeypatch.setattr(ps, "XAI_API_KEY", "test-key")
    yield _FakeOpenAI.calls


# ── 1. Authorization ────────────────────────────────────────────────────


class TestPostSummaryAuthorization:
    def test_non_member_gets_non_enumerating_404_and_no_ai_call(self, mysql_dsn, fake_grok):
        from backend.services.post_summary import generate_post_summary

        make_user("author", subscription="premium", created_at=days_ago(60))
        make_user("outsider", subscription="premium", created_at=days_ago(60))
        cid = make_community("Private Founders", creator_username="author")
        _join_community("author", cid)
        post_id = _make_post(cid, "author", "Secret roadmap discussion", ["reply one"])

        body, status = generate_post_summary("outsider", post_id)

        assert status == 404
        assert body == {"success": False, "error": "Post not found"}
        assert fake_grok == []  # never reached the model
        assert _usage_rows() == []  # and never logged usage

    def test_missing_post_is_indistinguishable_from_denied(self, mysql_dsn, fake_grok):
        from backend.services.post_summary import generate_post_summary

        make_user("outsider", subscription="premium", created_at=days_ago(60))
        missing_body, missing_status = generate_post_summary("outsider", 999_999)

        make_user("author", subscription="premium", created_at=days_ago(60))
        cid = make_community("Private Founders 2", creator_username="author")
        _join_community("author", cid)
        post_id = _make_post(cid, "author", "Secret thread")
        denied_body, denied_status = generate_post_summary("outsider", post_id)

        assert (missing_body, missing_status) == (denied_body, denied_status)

    def test_member_is_authorized(self, mysql_dsn, fake_grok):
        from backend.services.post_summary import generate_post_summary

        make_user("alice", subscription="premium", created_at=days_ago(60))
        cid = make_community("Open Builders", creator_username="alice")
        _join_community("alice", cid)
        post_id = _make_post(cid, "alice", "What stack are you all using?", ["Flask", "React"])

        body, status = generate_post_summary("alice", post_id)

        assert status == 200
        assert body["success"] is True
        assert body["summary"] == "A concise summary of the discussion."
        assert body["reply_count"] == 2


# ── 2. Entitlements gate ────────────────────────────────────────────────


class TestPostSummaryGate:
    def test_surface_is_a_steve_surface(self):
        assert SURFACE_POST_SUMMARY in ai_usage.STEVE_SURFACES

    def test_free_user_blocked_with_canonical_shape_and_block_row(
        self, mysql_dsn, fake_grok, monkeypatch
    ):
        from backend.services import post_summary as ps

        monkeypatch.setattr(ps, "entitlements_enforcement_enabled", lambda: True)
        make_user("free_rider", subscription="free", created_at=days_ago(60))
        cid = make_community("Free Town", creator_username="free_rider")
        _join_community("free_rider", cid)
        post_id = _make_post(cid, "free_rider", "Summarize me", ["a reply"])

        body, status = ps.generate_post_summary("free_rider", post_id)

        assert status == 402
        assert body.get("reason") == "premium_required"
        assert fake_grok == []  # blocked before the model
        rows = _usage_rows()
        assert len(rows) == 1  # the gate's log_block row, nothing else
        assert int(rows[0]["success"]) == 0
        assert rows[0]["reason_blocked"] == "premium_required"


# ── 3. Usage accounting ─────────────────────────────────────────────────


class TestPostSummaryAccounting:
    def test_exactly_one_usage_row_with_tokens_and_community(self, mysql_dsn, fake_grok):
        from backend.services.post_summary import generate_post_summary

        make_user("alice", subscription="premium", created_at=days_ago(60))
        cid = make_community("Accounting Club", creator_username="alice")
        _join_community("alice", cid)
        post_id = _make_post(cid, "alice", "Long discussion", ["r1", "r2", "r3"])

        body, status = generate_post_summary("alice", post_id)
        assert status == 200

        rows = _usage_rows()
        assert len(rows) == 1
        row = rows[0]
        assert row["username"] == "alice"
        assert row["request_type"] == "post_summary"
        assert int(row["success"]) == 1
        assert int(row["tokens_in"]) == 321
        assert int(row["tokens_out"]) == 87
        assert int(row["community_id"]) == cid

    def test_output_tokens_capped_from_entitlements(self, mysql_dsn, fake_grok):
        """The model call must use the entitlements feed cap, not a literal."""
        from backend.services.entitlements import resolve_entitlements
        from backend.services.post_summary import generate_post_summary

        make_user("alice", subscription="premium", created_at=days_ago(60))
        cid = make_community("Token Cappers", creator_username="alice")
        _join_community("alice", cid)
        post_id = _make_post(cid, "alice", "Cap check")

        body, status = generate_post_summary("alice", post_id)
        assert status == 200

        ent = resolve_entitlements("alice")
        expected = int(ent.get("max_output_tokens_feed") or 500)
        assert len(fake_grok) == 1
        assert fake_grok[0]["max_tokens"] == expected

    def test_cache_hit_logs_nothing_and_skips_the_model(self, mysql_dsn, fake_grok):
        from backend.services.post_summary import generate_post_summary

        make_user("alice", subscription="premium", created_at=days_ago(60))
        cid = make_community("Cache Club", creator_username="alice")
        _join_community("alice", cid)
        post_id = _make_post(cid, "alice", "Hot thread", ["r1", "r2"])

        first, _ = generate_post_summary("alice", post_id)
        assert first["cached"] is False

        # Second viewer: same summary, no second model call, no second row.
        make_user("bob", subscription="premium", created_at=days_ago(60))
        _join_community("bob", cid)
        second, status = generate_post_summary("bob", post_id)

        assert status == 200
        assert second["cached"] is True
        assert second["summary"] == first["summary"]
        assert len(fake_grok) == 1
        assert len(_usage_rows()) == 1  # only the generation logged

    def test_new_reply_invalidates_the_cache(self, mysql_dsn, fake_grok):
        from backend.services.post_summary import generate_post_summary

        make_user("alice", subscription="premium", created_at=days_ago(60))
        cid = make_community("Fresh Club", creator_username="alice")
        _join_community("alice", cid)
        post_id = _make_post(cid, "alice", "Evolving thread", ["r1"])

        generate_post_summary("alice", post_id)
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"INSERT INTO replies (post_id, community_id, username, content) VALUES ({ph}, {ph}, {ph}, {ph})",
                (post_id, cid, "alice", "late reply"),
            )
            conn.commit()

        body, _ = generate_post_summary("alice", post_id)
        assert body["cached"] is False  # reply count changed the key
        assert len(fake_grok) == 2

    def test_kill_switch_disables_the_surface(self, mysql_dsn, fake_grok):
        from backend.services.post_summary import generate_post_summary
        from tests.fixtures import kb_override_field

        kb_override_field("post-summary", "post_summary_enabled", False, field_type="boolean")
        make_user("alice", subscription="premium", created_at=days_ago(60))
        cid = make_community("Dark Club", creator_username="alice")
        _join_community("alice", cid)
        post_id = _make_post(cid, "alice", "Should not summarize")

        body, status = generate_post_summary("alice", post_id)

        assert status == 503
        assert fake_grok == []
        assert _usage_rows() == []

    def test_daily_backstop_blocks_after_cap(self, mysql_dsn, fake_grok):
        from backend.services.post_summary import generate_post_summary
        from tests.fixtures import kb_override_field

        kb_override_field("post-summary", "calls_per_user_per_24h", 1)
        make_user("alice", subscription="premium", created_at=days_ago(60))
        cid = make_community("Backstop Club", creator_username="alice")
        _join_community("alice", cid)
        first_post = _make_post(cid, "alice", "First thread")
        second_post = _make_post(cid, "alice", "Second thread")

        ok_body, ok_status = generate_post_summary("alice", first_post)
        assert ok_status == 200

        blocked_body, blocked_status = generate_post_summary("alice", second_post)

        assert blocked_status != 200
        assert blocked_body.get("reason") == "daily_cap"
        assert len(fake_grok) == 1  # second call never reached the model
        rows = _usage_rows()
        blocked_rows = [r for r in rows if not int(r["success"])]
        assert len(blocked_rows) == 1
        assert blocked_rows[0]["reason_blocked"] == "daily_cap"

    def test_upstream_error_logs_failed_row(self, mysql_dsn, fake_grok, monkeypatch):
        import openai

        from backend.services.post_summary import generate_post_summary

        class _BoomCompletions:
            def create(self, **kwargs):
                raise RuntimeError("xAI down")

        class _BoomChat:
            completions = _BoomCompletions()

        class _BoomOpenAI:
            def __init__(self, *args, **kwargs):
                self.chat = _BoomChat()

        monkeypatch.setattr(openai, "OpenAI", _BoomOpenAI)

        make_user("alice", subscription="premium", created_at=days_ago(60))
        cid = make_community("Outage Club", creator_username="alice")
        _join_community("alice", cid)
        post_id = _make_post(cid, "alice", "Doomed request")

        body, status = generate_post_summary("alice", post_id)

        assert status == 500
        assert body["success"] is False
        rows = _usage_rows()
        assert len(rows) == 1
        assert int(rows[0]["success"]) == 0
        assert rows[0]["reason_blocked"] == "upstream_error"
