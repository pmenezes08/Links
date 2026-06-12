"""Networking member directory: single-JOIN roster, gate-before-cache, filters.

Covers the service behind ``GET /api/networking/community_members/<id>``
(``backend.services.networking_directory``): the membership gate must run on
every request before the community-keyed cache is read, the viewer is
excluded at serve time (the cache stores the full roster), and the dropdown
filter semantics match the legacy endpoint.
"""

from __future__ import annotations

from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user

MEMBERSHIP_ERROR = "Not a member of this community"


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _ensure_directory_schema() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        for column, definition in {
            "city": "TEXT NULL",
            "country": "TEXT NULL",
            "role": "TEXT NULL",
            "company": "TEXT NULL",
            "industry": "TEXT NULL",
            "professional_about": "TEXT NULL",
            "professional_interests": "TEXT NULL",
        }.items():
            try:
                c.execute(f"ALTER TABLE users ADD COLUMN {column} {definition}")
            except Exception:
                pass
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS user_profiles (
                id INT PRIMARY KEY AUTO_INCREMENT,
                username VARCHAR(191) UNIQUE NOT NULL,
                display_name TEXT,
                bio TEXT,
                location TEXT,
                profile_picture TEXT,
                is_public TINYINT(1) DEFAULT 1
            )
            """
        )
        try:
            conn.commit()
        except Exception:
            pass


def _add_member(username: str, community_id: int) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        user_id = row["id"] if hasattr(row, "keys") else row[0]
        c.execute(
            f"INSERT INTO user_communities (user_id, community_id, role, joined_at)"
            f" VALUES ({ph}, {ph}, {ph}, NOW())",
            (int(user_id), community_id, "member"),
        )
        try:
            conn.commit()
        except Exception:
            pass


def _set_profile(
    username: str,
    *,
    display_name: str = "",
    city: str = "",
    country: str = "",
    industry: str = "",
    interests: str = "",
) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        if display_name:
            # make_user already inserts a user_profiles row (profile picture
            # for the basic-profile gate) — upsert the display name onto it.
            c.execute(
                f"INSERT INTO user_profiles (username, display_name) VALUES ({ph}, {ph})"
                f" ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)",
                (username, display_name),
            )
        c.execute(
            f"UPDATE users SET city = {ph}, country = {ph}, industry = {ph},"
            f" professional_interests = {ph} WHERE username = {ph}",
            (city, country, industry, interests, username),
        )
        try:
            conn.commit()
        except Exception:
            pass


def _get(client, community_id, query: str = ""):
    return client.get(f"/api/networking/community_members/{community_id}{query}")


def _setup_community(suffix: str):
    """Owner + two profiled members in one community; returns (cid, names)."""
    _ensure_directory_schema()
    make_user(f"dir_owner_{suffix}")
    make_user(f"dir_alice_{suffix}")
    make_user(f"dir_bob_{suffix}")
    cid = make_community(f"dir-comm-{suffix}", creator_username=f"dir_owner_{suffix}")
    for uname in (f"dir_owner_{suffix}", f"dir_alice_{suffix}", f"dir_bob_{suffix}"):
        _add_member(uname, cid)
    _set_profile(
        f"dir_alice_{suffix}",
        display_name="Alice Quartz",
        city="Lisbon",
        country="Portugal",
        industry="Fintech",
        interests='["Investing", "Padel"]',
    )
    _set_profile(
        f"dir_bob_{suffix}",
        display_name="Bob Marble",
        city="Porto",
        country="Portugal",
        industry="Healthcare",
        interests='["Running"]',
    )
    return cid


def test_non_member_403_and_unknown_404(mysql_dsn):
    import bodybuilding_app

    cid = _setup_community("gate")
    make_user("dir_outsider_gate")
    client = bodybuilding_app.app.test_client()
    _login(client, "dir_outsider_gate")

    resp = _get(client, cid)
    assert resp.status_code == 403
    assert resp.get_json()["error"] == MEMBERSHIP_ERROR

    resp = _get(client, 99999999)
    assert resp.status_code == 404


def test_roster_excludes_viewer_and_returns_profile_fields(mysql_dsn):
    import bodybuilding_app

    cid = _setup_community("roster")
    client = bodybuilding_app.app.test_client()
    _login(client, "dir_owner_roster")

    resp = _get(client, cid)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    usernames = [m["username"] for m in body["members"]]
    assert "dir_owner_roster" not in usernames  # viewer excluded
    assert set(usernames) == {"dir_alice_roster", "dir_bob_roster"}

    alice = next(m for m in body["members"] if m["username"] == "dir_alice_roster")
    assert alice["display_name"] == "Alice Quartz"
    assert alice["location"] == "Lisbon, Portugal"
    assert alice["industry"] == "Fintech"
    assert alice["professional_interests"] == ["Investing", "Padel"]

    # Filter option sets are computed over the full visible roster.
    assert set(body["filters"]["industries"]) == {"Fintech", "Healthcare"}
    assert "Lisbon, Portugal" in body["filters"]["locations"]
    assert "Running" in body["filters"]["interests"]


def test_filters_match_legacy_semantics(mysql_dsn):
    import bodybuilding_app

    cid = _setup_community("filters")
    client = bodybuilding_app.app.test_client()
    _login(client, "dir_owner_filters")

    # Industry: case-insensitive substring.
    body = _get(client, cid, "?industry=fin").get_json()
    assert [m["username"] for m in body["members"]] == ["dir_alice_filters"]

    # Location: substring of the space-joined parts matches.
    body = _get(client, cid, "?location=Porto").get_json()
    assert [m["username"] for m in body["members"]] == ["dir_bob_filters"]

    # Interests: substring against any interest.
    body = _get(client, cid, "?interests=padel").get_json()
    assert [m["username"] for m in body["members"]] == ["dir_alice_filters"]

    # Filter options stay computed pre-filter.
    assert set(body["filters"]["industries"]) == {"Fintech", "Healthcare"}


def test_cache_is_shared_but_gate_and_viewer_exclusion_stay_per_request(mysql_dsn):
    import bodybuilding_app

    cid = _setup_community("cache")
    make_user("dir_outsider_cache")
    client = bodybuilding_app.app.test_client()

    # Warm the cache as one member...
    _login(client, "dir_alice_cache")
    body = _get(client, cid).get_json()
    assert "dir_alice_cache" not in [m["username"] for m in body["members"]]
    assert "dir_bob_cache" in [m["username"] for m in body["members"]]

    # ...a different member served from the same cached roster still gets
    # themselves excluded (the cache stores the full roster).
    _login(client, "dir_bob_cache")
    body = _get(client, cid).get_json()
    usernames = [m["username"] for m in body["members"]]
    assert "dir_bob_cache" not in usernames
    assert "dir_alice_cache" in usernames

    # ...and a non-member is still denied after the cache is warm.
    _login(client, "dir_outsider_cache")
    resp = _get(client, cid)
    assert resp.status_code == 403
    assert resp.get_json()["error"] == MEMBERSHIP_ERROR
