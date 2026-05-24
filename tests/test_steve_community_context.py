"""Regression coverage for exact-scope Steve community corpus assembly."""

from __future__ import annotations

from datetime import datetime, timedelta

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.steve_community_context import build_steve_feed_corpus
from tests.fixtures import make_community, make_user


def _add_member(username: str, community_id: int) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        assert row
        user_id = row["id"] if hasattr(row, "keys") else row[0]
        c.execute(
            f"""
            INSERT INTO user_communities (user_id, community_id, role, joined_at)
            VALUES ({ph}, {ph}, 'member', {ph})
            """,
            (user_id, community_id, datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")),
        )
        conn.commit()


def _insert_post(username: str, community_id: int, content: str, image_path: str | None = None) -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO posts (username, content, image_path, timestamp, community_id)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph})
            """,
            (username, content, image_path, datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"), community_id),
        )
        post_id = int(c.lastrowid)
        conn.commit()
        return post_id


def _insert_scope_resources(username: str, community_id: int, label: str) -> None:
    ph = get_sql_placeholder()
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    future = (datetime.utcnow() + timedelta(days=7)).strftime("%Y-%m-%d")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO useful_links (community_id, group_id, username, url, description, created_at)
            VALUES ({ph}, NULL, {ph}, {ph}, {ph}, {ph})
            """,
            (community_id, username, f"https://example.test/{label}", f"{label} link", now),
        )
        c.execute(
            f"""
            INSERT INTO useful_docs (community_id, group_id, username, file_path, description, created_at)
            VALUES ({ph}, NULL, {ph}, {ph}, {ph}, {ph})
            """,
            (community_id, username, f"/{label}.pdf", f"{label} doc", now),
        )
        c.execute(
            f"""
            INSERT INTO calendar_events (username, title, date, description, created_at, community_id)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """,
            (username, f"{label} event", future, f"{label} event description", now, community_id),
        )
        c.execute(
            f"""
            INSERT INTO tasks (community_id, group_id, title, description, due_date, assigned_to_username, created_by_username, created_at, completed, status)
            VALUES ({ph}, NULL, {ph}, {ph}, {ph}, NULL, {ph}, {ph}, 0, 'ongoing')
            """,
            (community_id, f"{label} task", f"{label} task description", future, username, now),
        )
        conn.commit()


def test_steve_feed_corpus_uses_exact_subcommunity_scope(mysql_dsn):
    import bodybuilding_app

    bodybuilding_app.add_missing_tables()
    make_user("scope_owner", subscription="premium")
    make_user("scope_c_member", subscription="free")
    root_a = make_community("scope-root-a", creator_username="scope_owner")
    child_b = make_community("scope-child-b", creator_username="scope_owner", parent_community_id=root_a)
    child_c = make_community("scope-child-c", creator_username="scope_owner", parent_community_id=root_a)
    _add_member("scope_c_member", child_c)

    _insert_scope_resources("scope_owner", root_a, "rootA-secret")
    _insert_scope_resources("scope_owner", child_b, "childB-secret")
    _insert_scope_resources("scope_owner", child_c, "childC-visible")

    _insert_post("scope_owner", root_a, "rootA post secret", image_path="rootA-secret.png")
    _insert_post("scope_owner", child_b, "childB post secret", image_path="childB-secret.png")
    c_post = _insert_post("scope_c_member", child_c, "childC post visible", image_path="childC-visible.png")

    with get_db_connection() as conn:
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        corpus = build_steve_feed_corpus(
            cursor,
            ph,
            viewer_username="scope_c_member",
            post_id=c_post,
            user_message="What is in this community?",
            include_resources=True,
            max_doc_chars_total=1000,
            recent_comments_limit=10,
        )

    assert "childC post visible" in corpus.text
    assert "childC-visible link" in corpus.text
    assert "childC-visible doc" in corpus.text
    assert "childC-visible event" in corpus.text
    assert "childC-visible task" in corpus.text
    assert "childC-visible.png" in "\n".join(corpus.image_urls)

    assert "rootA" not in corpus.text
    assert "childB" not in corpus.text
    assert "rootA-secret.png" not in "\n".join(corpus.image_urls)
    assert "childB-secret.png" not in "\n".join(corpus.image_urls)


def test_steve_feed_corpus_ignores_client_supplied_scope_by_deriving_from_post(mysql_dsn):
    import bodybuilding_app

    bodybuilding_app.add_missing_tables()
    make_user("derive_owner", subscription="premium")
    make_user("derive_member", subscription="free")
    root_a = make_community("derive-root-a", creator_username="derive_owner")
    child_c = make_community("derive-child-c", creator_username="derive_owner", parent_community_id=root_a)
    _add_member("derive_member", child_c)
    _insert_scope_resources("derive_owner", root_a, "derive-root-hidden")
    _insert_scope_resources("derive_owner", child_c, "derive-child-visible")
    post_id = _insert_post("derive_member", child_c, "derive child post")

    with get_db_connection() as conn:
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        corpus = build_steve_feed_corpus(
            cursor,
            ph,
            viewer_username="derive_member",
            post_id=post_id,
            user_message="show docs",
            include_resources=True,
        )

    assert corpus.community_id == child_c
    assert "derive-child-visible" in corpus.text
    assert "derive-root-hidden" not in corpus.text


def test_profile_kb_gate_does_not_widen_community_corpus(mysql_dsn, monkeypatch):
    import bodybuilding_app
    from backend.services import steve_profiling_gates

    bodybuilding_app.add_missing_tables()
    monkeypatch.setattr(steve_profiling_gates, "user_can_access_steve_kb", lambda *args, **kwargs: True)

    make_user("profile_gate_owner", subscription="premium")
    make_user("profile_gate_member", subscription="free")
    root_a = make_community("profile-gate-root", creator_username="profile_gate_owner")
    child_c = make_community("profile-gate-child", creator_username="profile_gate_owner", parent_community_id=root_a)
    _add_member("profile_gate_member", child_c)
    _insert_scope_resources("profile_gate_owner", root_a, "profile-root-hidden")
    _insert_scope_resources("profile_gate_owner", child_c, "profile-child-visible")
    post_id = _insert_post("profile_gate_member", child_c, "profile child post")

    with get_db_connection() as conn:
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        corpus = build_steve_feed_corpus(
            cursor,
            ph,
            viewer_username="profile_gate_member",
            post_id=post_id,
            user_message="What do we have here?",
            include_resources=True,
        )

    assert "profile-child-visible" in corpus.text
    assert "profile-root-hidden" not in corpus.text
