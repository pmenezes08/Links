"""Regression coverage for profile and username lookup privacy gates."""

from __future__ import annotations

from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _ensure_profile_schema() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        user_columns = {
            "gender": "TEXT NULL",
            "country": "TEXT NULL",
            "city": "TEXT NULL",
            "date_of_birth": "DATE NULL",
            "age": "INT NULL",
            "role": "TEXT NULL",
            "company": "TEXT NULL",
            "industry": "TEXT NULL",
            "degree": "TEXT NULL",
            "school": "TEXT NULL",
            "skills": "TEXT NULL",
            "linkedin": "TEXT NULL",
            "experience": "TEXT NULL",
            "professional_about": "TEXT NULL",
            "professional_interests": "TEXT NULL",
            "professional_share_community_id": "INT NULL",
            "professional_company_intel": "TEXT NULL",
            "current_role_start_ym": "VARCHAR(7) NULL",
            "professional_work_history": "TEXT NULL",
            "professional_education": "TEXT NULL",
            "personal_highlight_answers": "TEXT NULL",
        }
        for column, definition in user_columns.items():
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
                website TEXT,
                instagram TEXT,
                twitter TEXT,
                profile_picture TEXT,
                cover_photo TEXT,
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
        assert row
        user_id = row["id"] if hasattr(row, "keys") else row[0]
        c.execute(
            f"""
            INSERT INTO user_communities (user_id, community_id, role)
            VALUES ({ph}, {ph}, 'member')
            """,
            (user_id, community_id),
        )
        try:
            conn.commit()
        except Exception:
            pass


def _upsert_profile(username: str, *, display_name: str | None = None) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        if ph == "%s":
            c.execute(
                f"""
                INSERT INTO user_profiles (username, display_name, bio, is_public)
                VALUES ({ph}, {ph}, {ph}, 1)
                ON DUPLICATE KEY UPDATE
                    display_name = VALUES(display_name),
                    bio = VALUES(bio),
                    is_public = 1
                """,
                (username, display_name or username, f"{username} bio"),
            )
        else:
            c.execute(
                f"""
                INSERT OR REPLACE INTO user_profiles (username, display_name, bio, is_public)
                VALUES ({ph}, {ph}, {ph}, 1)
                """,
                (username, display_name or username, f"{username} bio"),
            )
        try:
            conn.commit()
        except Exception:
            pass


def _seed_users_and_profiles():
    _ensure_profile_schema()
    make_user("privacy_viewer", subscription="premium")
    make_user("privacy_target", subscription="free")
    make_user("privacy_outsider", subscription="free")
    make_user("privacy_admin", subscription="free", is_admin=True)
    _upsert_profile("privacy_viewer", display_name="Viewer")
    _upsert_profile("privacy_target", display_name="Target")
    _upsert_profile("privacy_outsider", display_name="Outsider")
    community_id = make_community("profile-privacy-shared", creator_username="privacy_viewer")
    _add_member("privacy_viewer", community_id)
    _add_member("privacy_target", community_id)
    return community_id


def test_profile_lookup_requires_shared_community(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _seed_users_and_profiles()
    client = bodybuilding_app.app.test_client()

    _login(client, "privacy_viewer")
    profile_resp = client.get("/api/profile/privacy_target")
    assert profile_resp.status_code == 200
    assert profile_resp.get_json()["profile"]["username"] == "privacy_target"

    brief_resp = client.get("/api/get_user_profile_brief?username=privacy_target")
    assert brief_resp.status_code == 200
    assert brief_resp.get_json()["display_name"] == "Target"

    id_resp = client.post("/api/get_user_id_by_username", data={"username": "privacy_target"})
    assert id_resp.status_code == 200
    assert id_resp.get_json()["success"] is True

    _login(client, "privacy_outsider")
    assert client.get("/api/profile/privacy_target").status_code == 404
    assert client.get("/api/get_user_profile_brief?username=privacy_target").status_code == 404
    assert client.post("/api/get_user_id_by_username", data={"username": "privacy_target"}).status_code == 404


def test_profile_privacy_allows_self_and_admin_without_shared_community(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _seed_users_and_profiles()
    client = bodybuilding_app.app.test_client()

    _login(client, "privacy_outsider")
    self_resp = client.get("/api/profile/privacy_outsider")
    assert self_resp.status_code == 200
    assert self_resp.get_json()["profile"]["is_self"] is True

    _login(client, "privacy_admin")
    admin_resp = client.get("/api/profile/privacy_target")
    assert admin_resp.status_code == 200
    assert admin_resp.get_json()["profile"]["username"] == "privacy_target"


def test_anonymous_profile_request_does_not_expose_existing_user(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _seed_users_and_profiles()
    client = bodybuilding_app.app.test_client()

    resp = client.get("/api/profile/privacy_target")
    assert resp.status_code == 404
    assert resp.get_json()["error"] == "not found"


def test_profile_cache_is_viewer_scoped_after_authorized_read(mysql_dsn):
    import bodybuilding_app
    from redis_cache import cache

    cache.flush_all()
    _seed_users_and_profiles()
    client = bodybuilding_app.app.test_client()

    _login(client, "privacy_viewer")
    assert client.get("/api/profile/privacy_target").status_code == 200

    _login(client, "privacy_outsider")
    assert client.get("/api/profile/privacy_target").status_code == 404

    second_community_id = make_community("profile-privacy-second", creator_username="privacy_outsider")
    _add_member("privacy_outsider", second_community_id)
    _add_member("privacy_target", second_community_id)
    assert client.get("/api/profile/privacy_target").status_code == 200
