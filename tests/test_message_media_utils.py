"""Unit tests for message_media_utils (path normalization + lookup)."""

from backend.services.message_media_utils import (
    find_media_index,
    normalize_media_path_for_compare,
    parse_media_paths,
)


def test_parse_media_paths_json_string():
    raw = '["uploads/message_photos/a.jpg", "https://cdn.example.com/message_videos/b.mp4"]'
    assert parse_media_paths(raw) == [
        "uploads/message_photos/a.jpg",
        "https://cdn.example.com/message_videos/b.mp4",
    ]


def test_find_media_index_matches_uploads_vs_cdn():
    paths = [
        "uploads/message_photos/photo.jpg",
    ]
    assert (
        find_media_index(paths, "https://my.cdn.example/message_photos/photo.jpg")
        == 0
    )


def test_normalize_media_path_strips_query():
    assert normalize_media_path_for_compare(
        "https://x/y/z.jpg?v=1"
    ) == normalize_media_path_for_compare("https://x/y/z.jpg")
