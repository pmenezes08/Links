"""Unit coverage for case-insensitive profile-picture maps.

Content tables (replies/posts/messages) can store a different username
spelling than user_profiles (e.g. 'Mary' vs 'mary'); these maps must not drop
rows on case drift — that bug blanked comment avatars in feed/post-detail.
"""

from __future__ import annotations

from backend.services.profile_pictures import (
    CaseInsensitiveUserMap,
    fetch_profile_picture_map,
)


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows
        self.executed = None

    def execute(self, sql, params=None):
        self.executed = (sql, params)

    def fetchall(self):
        return self.rows


def test_map_get_is_case_insensitive():
    m = CaseInsensitiveUserMap()
    m.set("mary", "pic.jpg")
    assert m.get("Mary") == "pic.jpg"
    assert m.get("MARY") == "pic.jpg"
    assert m.get(" mary ") == "pic.jpg"
    assert m.get("someone-else") is None
    assert m.get(None) is None
    assert len(m) == 1
    assert bool(m) is True


def test_map_ignores_blank_keys():
    m = CaseInsensitiveUserMap()
    m.set(None, "x")
    m.set("", "x")
    m.set("   ", "x")
    assert len(m) == 0
    assert bool(m) is False


def test_fetch_builds_ci_map_from_dict_rows():
    cursor = FakeCursor([
        {"username": "mary", "profile_picture": "https://media.c-point.co/profile_pictures/a.jpeg"},
        {"username": "DaveH", "profile_picture": None},
    ])
    m = fetch_profile_picture_map(cursor, ["Mary", "daveh"])
    assert m.get("Mary") == "https://media.c-point.co/profile_pictures/a.jpeg"
    assert m.get("DAVEH") is None  # row present, picture NULL
    assert cursor.executed is not None


def test_fetch_builds_ci_map_from_tuple_rows():
    cursor = FakeCursor([("olivierAMS", "pic.png")])
    m = fetch_profile_picture_map(cursor, ["Olivierams"])
    assert m.get("olivierams") == "pic.png"


def test_fetch_skips_query_for_empty_input():
    cursor = FakeCursor([])
    m = fetch_profile_picture_map(cursor, ["", None, "   "])
    assert cursor.executed is None
    assert len(m) == 0


def test_fetch_survives_query_failure():
    class ExplodingCursor:
        def execute(self, sql, params=None):
            raise RuntimeError("db down")

        def fetchall(self):  # pragma: no cover - never reached
            return []

    m = fetch_profile_picture_map(ExplodingCursor(), ["mary"])
    assert m.get("mary") is None
    assert len(m) == 0
