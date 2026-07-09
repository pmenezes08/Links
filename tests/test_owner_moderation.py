"""Owner Dashboard — community-scoped report moderation.

Covers: non-enumerating access (outsider → 404), listing pending reports for
*this* community only, dismiss moving a report out of the pending queue, remove
deleting the post and resolving its reports, and the cross-community guard (an
owner of B cannot list A's reports nor act on a report whose post lives in A).
"""

from __future__ import annotations

import pytest

from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


_REPORTS_DDL = """
CREATE TABLE IF NOT EXISTS post_reports (
    id INT PRIMARY KEY AUTO_INCREMENT,
    post_id INT NOT NULL,
    reporter_username VARCHAR(191) NOT NULL,
    reason TEXT NOT NULL,
    details TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    reviewed_by VARCHAR(191),
    reviewed_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_post_reporter (post_id, reporter_username)
)
"""


@pytest.fixture(autouse=True)
def _reports_table():
    """Ensure + clear post_reports each test (conftest doesn't truncate it, and
    TRUNCATE resets post ids — stale reports would otherwise cross-contaminate)."""
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            try:
                c.execute(_REPORTS_DDL)
            except Exception:
                pass
            try:
                c.execute("DELETE FROM post_reports")
            except Exception:
                pass
            try:
                conn.commit()
            except Exception:
                pass
    except Exception:
        pass
    yield


def _make_post(community_id: int, author: str, content: str = "hello") -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO posts (community_id, username, content) VALUES ({ph}, {ph}, {ph})",
            (community_id, author, content),
        )
        pid = c.lastrowid
        try:
            conn.commit()
        except Exception:
            pass
    return int(pid)


def _make_report(post_id: int, reporter: str, reason: str = "Spam") -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO post_reports (post_id, reporter_username, reason, status) "
            f"VALUES ({ph}, {ph}, {ph}, 'pending')",
            (post_id, reporter, reason),
        )
        rid = c.lastrowid
        try:
            conn.commit()
        except Exception:
            pass
    return int(rid)


def _reports(client, cid: int, status: str = "pending"):
    return client.get(f"/api/community/{cid}/reports?status={status}")


def test_outsider_cannot_see_reports(mysql_dsn):
    import bodybuilding_app

    make_user("ownerA")
    make_user("stranger")
    client = bodybuilding_app.app.test_client()
    a = make_community("Mod A", creator_username="ownerA")

    _login(client, "stranger")
    assert _reports(client, a).status_code == 404


def test_owner_sees_pending_report(mysql_dsn):
    import bodybuilding_app

    make_user("ownerA")
    make_user("m1")
    make_user("r1")
    client = bodybuilding_app.app.test_client()
    a = make_community("Mod A", creator_username="ownerA")
    pid = _make_post(a, "m1", "buy my crypto course")
    _make_report(pid, "r1", "Spam")

    _login(client, "ownerA")
    resp = _reports(client, a, "pending")
    assert resp.status_code == 200
    reports = resp.get_json()["reports"]
    assert len(reports) == 1
    r = reports[0]
    assert r["post_id"] == pid
    assert r["reason"] == "Spam"
    assert r["report_count"] == 1
    assert r["type"] == "post"


def test_dismiss_moves_report_out_of_pending(mysql_dsn):
    import bodybuilding_app

    make_user("ownerA")
    make_user("m1")
    make_user("r1")
    client = bodybuilding_app.app.test_client()
    a = make_community("Mod A", creator_username="ownerA")
    pid = _make_post(a, "m1")
    rid = _make_report(pid, "r1")

    _login(client, "ownerA")
    rev = client.post(f"/api/community/{a}/reports/review", json={"report_id": rid, "action": "dismiss"})
    assert rev.status_code == 200
    assert rev.get_json()["status"] == "dismissed"

    assert _reports(client, a, "pending").get_json()["reports"] == []
    assert len(_reports(client, a, "dismissed").get_json()["reports"]) == 1


def test_remove_deletes_post_and_resolves_reports(mysql_dsn):
    import bodybuilding_app

    make_user("ownerA")
    make_user("m1")
    make_user("r1")
    client = bodybuilding_app.app.test_client()
    a = make_community("Mod A", creator_username="ownerA")
    pid = _make_post(a, "m1", "bad content")
    _make_report(pid, "r1")

    _login(client, "ownerA")
    rm = client.post(f"/api/community/{a}/reports/remove", json={"post_id": pid})
    assert rm.status_code == 200

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT COUNT(*) AS n FROM posts WHERE id = {ph}", (pid,))
        row = c.fetchone()
        n = row["n"] if hasattr(row, "keys") else row[0]
    assert int(n) == 0


def test_owner_review_does_not_overwrite_prior_resolution(mysql_dsn):
    """Queue precedence: when the app-admin queue resolved a report first,
    the owner's action reports already_resolved instead of clobbering it."""
    import bodybuilding_app

    make_user("ownerA")
    make_user("m1")
    make_user("r1")
    client = bodybuilding_app.app.test_client()
    a = make_community("Mod A", creator_username="ownerA")
    pid = _make_post(a, "m1")
    rid = _make_report(pid, "r1")

    # Simulate the admin surface resolving the row first.
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"UPDATE post_reports SET status = 'reviewed', reviewed_by = 'admin' WHERE id = {ph}",
            (rid,),
        )
        conn.commit()

    _login(client, "ownerA")
    rev = client.post(f"/api/community/{a}/reports/review", json={"report_id": rid, "action": "dismiss"})
    assert rev.status_code == 200
    body = rev.get_json()
    assert body["success"] is True
    assert body["already_resolved"] is True
    assert body["status"] == "reviewed"
    assert body["reviewed_by"] == "admin"

    # The admin's resolution stands — the row did not become 'dismissed'.
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT status FROM post_reports WHERE id = {ph}", (rid,))
        row = c.fetchone()
        status = row["status"] if hasattr(row, "keys") else row[0]
    assert status == "reviewed"


def _add_member(username: str, community_id: int, role: str = "member") -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        uid = row["id"] if hasattr(row, "keys") else row[0]
        c.execute(
            f"INSERT INTO user_communities (user_id, community_id, role) VALUES ({ph}, {ph}, {ph})",
            (int(uid), community_id, role),
        )
        conn.commit()


def test_report_notifies_owner_and_delegated_admin_only(mysql_dsn, monkeypatch):
    """Owner-first signal: a new report notifies the community's moderators
    (owner + delegated admins) in-app + push — never the reporter, never the
    reported author, never the platform 'admin' account."""
    from backend.services import notifications as notif_mod
    from backend.services.community_moderation import notify_moderators_of_report

    make_user("ownerA")
    make_user("deleg1")
    make_user("m1")
    make_user("r1")
    a = make_community("Mod A", creator_username="ownerA")
    _add_member("deleg1", a, role="admin")
    _add_member("m1", a)
    _add_member("r1", a)
    pid = _make_post(a, "m1")

    pushed, rows = [], []
    monkeypatch.setattr(notif_mod, "send_push_to_user", lambda u, p: pushed.append((u, p)))
    monkeypatch.setattr(notif_mod, "create_notification", lambda **kw: rows.append(kw))

    sent = notify_moderators_of_report(a, pid, "r1", "m1")
    assert sent == 2
    recipients = sorted(u for u, _ in pushed)
    assert recipients == ["deleg1", "ownerA"]
    assert sorted(r["user_id"] for r in rows) == ["deleg1", "ownerA"]
    for _, payload in pushed:
        assert payload["url"] == f"/community/{a}/owner?tab=reports"

    # When the owner is the one reporting, they are not notified about it.
    pushed.clear(); rows.clear()
    sent = notify_moderators_of_report(a, pid, "ownerA", "m1")
    assert sent == 1
    assert [u for u, _ in pushed] == ["deleg1"]


def test_no_cross_community_moderation(mysql_dsn):
    import bodybuilding_app

    make_user("ownerA")
    make_user("ownerB")
    make_user("m1")
    make_user("r1")
    client = bodybuilding_app.app.test_client()
    a = make_community("Mod A", creator_username="ownerA")
    b = make_community("Mod B", creator_username="ownerB")
    pid = _make_post(a, "m1")
    rid = _make_report(pid, "r1")

    _login(client, "ownerB")
    # Can't list A's reports at all.
    assert _reports(client, a).status_code == 404
    # Can't reach into A's report via B's own route — the post isn't in B.
    rev = client.post(f"/api/community/{b}/reports/review", json={"report_id": rid, "action": "dismiss"})
    assert rev.status_code == 404
    # Nor remove A's post via B's remove route.
    rm = client.post(f"/api/community/{b}/reports/remove", json={"post_id": pid})
    assert rm.status_code == 404
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT COUNT(*) AS n FROM posts WHERE id = {ph}", (pid,))
        row = c.fetchone()
        n = row["n"] if hasattr(row, "keys") else row[0]
    assert int(n) == 1


# ---------------------------------------------------------------------------
# Unified deletion cascade (post_deletion.delete_post_cascade)
# ---------------------------------------------------------------------------

_IMAGINE_JOBS_DDL = """
CREATE TABLE IF NOT EXISTS imagine_jobs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    target_type VARCHAR(16) NOT NULL,
    target_id BIGINT NOT NULL,
    community_id BIGINT NULL,
    status VARCHAR(32) NOT NULL,
    style VARCHAR(16) NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
)
"""


def _exec(sql: str, params=()):
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(sql, params)
        try:
            conn.commit()
        except Exception:
            pass


def _scalar(sql: str, params=()):
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(sql, params)
        row = c.fetchone()
        if row is None:
            return None
        return row[list(row.keys())[0]] if hasattr(row, "keys") else row[0]


def test_remove_cascade_cleans_up_everything(mysql_dsn):
    """Moderation remove must clean up the same referents as a normal delete:
    replies, post_views, in-flight imagine jobs, and every report on the post."""
    import bodybuilding_app

    make_user("ownerA")
    make_user("m1")
    make_user("r1")
    make_user("r2")
    client = bodybuilding_app.app.test_client()
    a = make_community("Mod A", creator_username="ownerA")
    pid = _make_post(a, "m1", "bad content")
    ph = get_sql_placeholder()

    _exec(_IMAGINE_JOBS_DDL)
    _exec(f"DELETE FROM imagine_jobs WHERE target_type = 'post' AND target_id = {ph}", (pid,))
    _exec(
        f"INSERT INTO replies (post_id, community_id, username, content) VALUES ({ph}, {ph}, {ph}, {ph})",
        (pid, a, "r1", "a reply"),
    )
    _exec(f"INSERT INTO post_views (post_id, username) VALUES ({ph}, {ph})", (pid, "r1"))
    _exec(
        f"INSERT INTO imagine_jobs (target_type, target_id, community_id, status, style, created_by, created_at, updated_at) "
        f"VALUES ('post', {ph}, {ph}, 'pending', 'photo', 'm1', NOW(), NOW())",
        (pid, a),
    )
    _make_report(pid, "r1")
    _make_report(pid, "r2")

    _login(client, "ownerA")
    rm = client.post(f"/api/community/{a}/reports/remove", json={"post_id": pid})
    assert rm.status_code == 200

    assert int(_scalar(f"SELECT COUNT(*) FROM posts WHERE id = {ph}", (pid,))) == 0
    assert int(_scalar(f"SELECT COUNT(*) FROM replies WHERE post_id = {ph}", (pid,))) == 0
    assert int(_scalar(f"SELECT COUNT(*) FROM post_views WHERE post_id = {ph}", (pid,))) == 0
    assert _scalar(
        f"SELECT status FROM imagine_jobs WHERE target_type = 'post' AND target_id = {ph}", (pid,)
    ) == "error"
    assert int(_scalar(f"SELECT COUNT(*) FROM post_reports WHERE post_id = {ph} AND status != 'reviewed'", (pid,))) == 0
    reviewed_by = _scalar(f"SELECT reviewed_by FROM post_reports WHERE post_id = {ph} LIMIT 1", (pid,))
    assert reviewed_by == "ownerA"


def test_welcome_lock_blocks_moderation_remove(mysql_dsn):
    """Steve's welcome post inside its 7-day lock survives a moderation remove."""
    import bodybuilding_app

    make_user("ownerA")
    make_user("r1")
    client = bodybuilding_app.app.test_client()
    a = make_community("Mod A", creator_username="ownerA")
    ph = get_sql_placeholder()

    # The thin test schema doesn't carry is_system_post — add it lazily, the
    # same way the app's own migrations do.
    try:
        _exec("ALTER TABLE posts ADD COLUMN is_system_post TINYINT DEFAULT 0")
    except Exception:
        pass
    _exec(
        f"INSERT INTO posts (community_id, username, content, is_system_post, timestamp) "
        f"VALUES ({ph}, 'steve', 'welcome manual', 1, NOW())",
        (a,),
    )
    pid = int(_scalar("SELECT MAX(id) FROM posts"))
    _make_report(pid, "r1")

    _login(client, "ownerA")
    rm = client.post(f"/api/community/{a}/reports/remove", json={"post_id": pid})
    assert rm.status_code == 403
    assert int(_scalar(f"SELECT COUNT(*) FROM posts WHERE id = {ph}", (pid,))) == 1


def test_r2_key_derivation():
    """Unit: R2 key is derived only for recognizable R2 CDN URLs, and only
    when R2 is enabled — everything else falls through to filesystem/no-op."""
    from backend.services import r2_storage
    from backend.services.post_deletion import _r2_key_for

    orig_enabled = r2_storage.R2_ENABLED
    orig_url = r2_storage.R2_PUBLIC_URL
    try:
        r2_storage.R2_ENABLED = True
        r2_storage.R2_PUBLIC_URL = "https://cdn.example.com"
        assert _r2_key_for("https://cdn.example.com/uploads/img/a.jpg") == "uploads/img/a.jpg"
        assert _r2_key_for("https://elsewhere.example.com/uploads/img/a.jpg") is None
        assert _r2_key_for("uploads/img/local.jpg") is None
        assert _r2_key_for("") is None
        r2_storage.R2_ENABLED = False
        assert _r2_key_for("https://cdn.example.com/uploads/img/a.jpg") is None
    finally:
        r2_storage.R2_ENABLED = orig_enabled
        r2_storage.R2_PUBLIC_URL = orig_url
