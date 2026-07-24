"""The create-community duplicate guard is a 60-second window, not forever.

Found in prod 2026-07-24: the inline dedup query in ``create_community``
matched on ``(creator_username, name)`` with no time bound, so an owner who
had EVER created a community with some name could never use that name again
anywhere in their networks — and the response said ``success: true`` with
``duplicate: true``, so the client closed the modal and nothing appeared.
(The TAP Air Portugal owner lost five attempts to create a "PNT"
sub-community this way.)

``backend.services.community.find_recent_duplicate_community`` now owns the
check: same creator + same name **+ same parent** only counts as a duplicate
inside the ``window_seconds`` double-tap window, and unparseable timestamps
fail open. Community names are deliberately not unique — identity is the id
and the connection to the root — so the same name under different parents
(at any nesting depth) must always be allowed.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

import pytest

pytestmark = pytest.mark.usefixtures("mysql_dsn")


from backend.services.community import find_recent_duplicate_community
from backend.services.database import get_db_connection, get_sql_placeholder


def _make_named_community(
    name: str,
    creator: str,
    *,
    created_at: datetime,
    parent_community_id: Optional[int] = None,
) -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO communities (name, tier, creator_username, parent_community_id, created_at)
            VALUES ({ph}, 'free', {ph}, {ph}, {ph})
            """,
            (name, creator, parent_community_id, created_at.strftime("%Y-%m-%d %H:%M:%S")),
        )
        cid = int(c.lastrowid)
        try:
            conn.commit()
        except Exception:
            pass
    return cid


def _run(creator: str, name: str, **kwargs):
    with get_db_connection() as conn:
        c = conn.cursor()
        return find_recent_duplicate_community(
            c, creator_username=creator, name=name, **kwargs
        )


class TestDuplicateWindow:
    def test_seconds_old_row_is_a_duplicate(self):
        cid = _make_named_community("Crew Lounge", "dup_owner", created_at=datetime.now())
        assert _run("dup_owner", "Crew Lounge") == cid

    def test_old_same_name_community_does_not_block(self):
        """The prod failure: an hours-old community must not swallow a new one."""
        _make_named_community(
            "PNT", "tap_owner", created_at=datetime.now() - timedelta(hours=2)
        )
        assert _run("tap_owner", "PNT") is None

    def test_just_outside_the_window_does_not_block(self):
        _make_named_community(
            "Edge Case", "edge_owner", created_at=datetime.now() - timedelta(seconds=90)
        )
        assert _run("edge_owner", "Edge Case") is None

    def test_other_creators_never_match(self):
        _make_named_community("Shared Name", "creator_a", created_at=datetime.now())
        assert _run("creator_b", "Shared Name") is None

    def test_name_is_stripped_before_matching(self):
        cid = _make_named_community("Trim Me", "trim_owner", created_at=datetime.now())
        assert _run("trim_owner", "  Trim Me  ") == cid

    def test_blank_inputs_return_none(self):
        assert _run("", "Anything") is None
        assert _run("someone", "   ") is None


class TestParentScoping:
    """Names are not unique — the (creator, name, parent) triple is the
    double-tap key, so identical names under different parents never collide."""

    def test_same_name_under_a_different_parent_is_not_a_duplicate(self):
        """Even seconds apart: 'Marketing' under root A and root B is legit."""
        root_a = _make_named_community("Root A", "multi_owner", created_at=datetime.now())
        root_b = _make_named_community("Root B", "multi_owner", created_at=datetime.now())
        _make_named_community(
            "Marketing", "multi_owner",
            created_at=datetime.now(), parent_community_id=root_a,
        )
        assert _run("multi_owner", "Marketing", parent_community_id=root_b) is None

    def test_same_name_under_the_same_parent_is_a_duplicate(self):
        root = _make_named_community("Root C", "same_owner", created_at=datetime.now())
        cid = _make_named_community(
            "Ops", "same_owner", created_at=datetime.now(), parent_community_id=root,
        )
        assert _run("same_owner", "Ops", parent_community_id=root) == cid

    def test_root_name_does_not_block_a_sub_of_the_same_name(self):
        """The TAP case: root 'PNT' must not block a sub-community 'PNT'."""
        _make_named_community("PNT", "tap_owner2", created_at=datetime.now())
        root = _make_named_community("TAP Air Portugal", "tap_owner2", created_at=datetime.now())
        assert _run("tap_owner2", "PNT", parent_community_id=root) is None

    def test_sub_name_does_not_block_a_new_root_of_the_same_name(self):
        root = _make_named_community("Root D", "root_owner", created_at=datetime.now())
        _make_named_community(
            "Atlas", "root_owner", created_at=datetime.now(), parent_community_id=root,
        )
        assert _run("root_owner", "Atlas", parent_community_id=None) is None

    def test_nested_levels_are_scoped_independently(self):
        """Same name at different nesting depths of the same tree is allowed."""
        root = _make_named_community("Root E", "nest_owner", created_at=datetime.now())
        sub = _make_named_community(
            "Crew", "nest_owner", created_at=datetime.now(), parent_community_id=root,
        )
        # "Crew" again, one level deeper (under the sub) — different parent, OK.
        assert _run("nest_owner", "Crew", parent_community_id=sub) is None
