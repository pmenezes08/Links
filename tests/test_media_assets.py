"""Unit coverage for community media asset accounting helpers."""

from __future__ import annotations


def test_object_key_from_upload_paths():
    from backend.services import media_assets

    assert media_assets.object_key_from_path("uploads/community_stories/story.jpg") == "community_stories/story.jpg"
    assert media_assets.object_key_from_path("/uploads/post_images/photo.jpg") == "post_images/photo.jpg"
    assert media_assets.object_key_from_path("community_backgrounds/bg.jpg") == "community_backgrounds/bg.jpg"
    assert media_assets.object_key_from_path(None) is None


def test_object_key_from_cdn_url(monkeypatch):
    from backend.services import media_assets

    monkeypatch.setattr(media_assets, "R2_PUBLIC_URL", "https://cdn.example.test")

    assert (
        media_assets.object_key_from_path("https://cdn.example.test/community_stories/story.mp4")
        == "community_stories/story.mp4"
    )
    assert (
        media_assets.object_key_from_path("https://other.example.test/uploads/community_stories/story.mp4")
        == "uploads/community_stories/story.mp4"
    )

