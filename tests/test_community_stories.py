"""HTTP smoke coverage for community story APIs."""

from __future__ import annotations

from io import BytesIO

from werkzeug.datastructures import FileStorage

from tests.fixtures import make_community, make_user


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def test_story_reaction_normalization():
    from backend.services import community_stories

    assert community_stories.normalize_story_reaction(" 👍 ") == "👍"
    assert community_stories.normalize_story_reaction("bad") is None
    assert community_stories.normalize_story_reaction("") is None


def test_story_public_url_normalizes_local_paths(monkeypatch):
    from backend.services import community_stories

    monkeypatch.setattr(community_stories, "get_public_upload_url", lambda path: f"https://cdn.test/{path}")

    assert community_stories._public_url("https://example.test/story.jpg") == "https://example.test/story.jpg"
    assert community_stories._public_url("community_stories/story.jpg") == "https://cdn.test/uploads/community_stories/story.jpg"
    assert community_stories._public_url(None) is None


def test_story_json_field_parser_accepts_expected_type():
    from backend.services import community_stories

    assert community_stories._parse_json_field('[{"caption":"first"}]', list) == [{"caption": "first"}]
    assert community_stories._parse_json_field('{"name":"old location"}', dict) == {"name": "old location"}
    assert community_stories._parse_json_field('{"wrong":"type"}', list) == []
    assert community_stories._parse_json_field("not json", dict) is None


def test_uploaded_video_duration_probe_uses_local_temp_and_rewinds(monkeypatch):
    from backend.services import community_stories

    seen = {}

    def fake_probe(path: str):
        seen["path"] = path
        with open(path, "rb") as fh:
            seen["bytes"] = fh.read()
        return 11.2

    monkeypatch.setattr(community_stories, "_probe_video_duration_seconds", fake_probe)
    storage = FileStorage(stream=BytesIO(b"fake-video"), filename="story.mp4", content_type="video/mp4")

    assert community_stories._probe_uploaded_video_duration_seconds(storage) == 11.2
    assert seen["bytes"] == b"fake-video"
    assert storage.stream.read() == b"fake-video"


def test_story_upload_list_interactions_and_delete(mysql_dsn, monkeypatch):
    import bodybuilding_app
    from backend.services import community_stories

    monkeypatch.setattr(
        community_stories,
        "save_uploaded_file",
        lambda file, subfolder=None, allowed_extensions=None: f"{subfolder}/story-test.jpg",
    )
    monkeypatch.setattr(community_stories, "send_push_to_user", lambda username, payload: None)
    monkeypatch.setattr(community_stories, "create_notification", lambda *args, **kwargs: None)

    make_user("story_owner", subscription="premium")
    community_id = make_community(
        "story-api-community",
        tier="free",
        creator_username="story_owner",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "story_owner")

    create_resp = client.post(
        "/api/community_stories",
        data={
            "community_id": str(community_id),
            "description": "shared set",
            "per_file_metadata": '[{"caption":"first slide"}]',
            "media": (BytesIO(b"fake-image"), "story.jpg"),
        },
        content_type="multipart/form-data",
    )
    assert create_resp.status_code == 200
    created = create_resp.get_json()
    assert created["success"] is True
    assert created["count"] == 1
    story_id = created["story"]["id"]

    list_resp = client.get(f"/api/community_stories/{community_id}")
    assert list_resp.status_code == 200
    listed = list_resp.get_json()
    assert listed["success"] is True
    assert listed["groups"][0]["username"] == "story_owner"
    assert listed["stories"][0]["caption"] == "first slide"

    view_resp = client.post("/api/community_stories/view", json={"story_id": story_id})
    assert view_resp.status_code == 200
    assert view_resp.get_json()["view_count"] == 1

    viewers_resp = client.get(f"/api/community_stories/{story_id}/viewers")
    assert viewers_resp.status_code == 200
    assert viewers_resp.get_json()["viewers"][0]["username"] == "story_owner"

    invalid_reaction = client.post("/api/community_stories/react", json={"story_id": story_id, "reaction": "bad"})
    assert invalid_reaction.status_code == 400

    reaction_resp = client.post("/api/community_stories/react", json={"story_id": story_id, "reaction": "👍"})
    assert reaction_resp.status_code == 200
    assert reaction_resp.get_json()["user_reaction"] == "👍"

    comment_resp = client.post(
        f"/api/community_stories/{story_id}/comments",
        json={"content": "Nice story"},
    )
    assert comment_resp.status_code == 200
    comment_id = comment_resp.get_json()["comment"]["id"]

    comments_resp = client.get(f"/api/community_stories/{story_id}/comments")
    assert comments_resp.status_code == 200
    assert comments_resp.get_json()["comments"][0]["content"] == "Nice story"

    delete_comment_resp = client.delete(f"/api/community_stories/comments/{comment_id}")
    assert delete_comment_resp.status_code == 200
    assert delete_comment_resp.get_json()["success"] is True

    delete_story_resp = client.delete(f"/api/community_stories/{story_id}")
    assert delete_story_resp.status_code == 200
    assert delete_story_resp.get_json()["success"] is True
