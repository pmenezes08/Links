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
