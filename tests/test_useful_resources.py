from __future__ import annotations

from unittest.mock import MagicMock, patch

from backend.services.community_access import (
    check_useful_resource_mutation_access,
    user_is_member_of_community,
)
from backend.services.useful_docs_write import delete_useful_doc


def test_non_member_cannot_mutate_community_resources():
    cursor = MagicMock()
    cursor.fetchone.side_effect = [None, None]

    ok, err = check_useful_resource_mutation_access(
        cursor,
        "%s",
        "outsider",
        community_id_raw="42",
        group_id_int=None,
    )

    assert ok is False
    assert err == "Forbidden"


def test_member_can_mutate_community_resources():
    cursor = MagicMock()
    cursor.fetchone.return_value = {"1": 1}

    ok, err = check_useful_resource_mutation_access(
        cursor,
        "%s",
        "member",
        community_id_raw="42",
        group_id_int=None,
    )

    assert ok is True
    assert err is None


@patch("backend.services.steve_document_memory.purge_useful_doc")
@patch("backend.services.useful_docs_write._delete_doc_file_best_effort")
def test_delete_useful_doc_purges_firestore(mock_delete_file, mock_purge):
    conn = MagicMock()
    cursor = MagicMock()
    cursor.fetchone.return_value = {
        "username": "alice",
        "file_path": "docs/foo.pdf",
        "community_id": 7,
        "group_id": None,
    }

    ok, payload = delete_useful_doc(
        conn,
        cursor,
        "%s",
        username="alice",
        doc_id_raw="99",
    )

    assert ok is True
    assert payload["success"] is True
    mock_purge.assert_called_once_with(99, community_id=7, group_id=None)
    mock_delete_file.assert_called_once_with("docs/foo.pdf")


def test_user_is_member_checks_parent_community():
    cursor = MagicMock()
    cursor.fetchone.side_effect = [None, {"parent_community_id": 10}, None]

    assert user_is_member_of_community(cursor, "%s", "child_member", 99) is False

    cursor = MagicMock()
    cursor.fetchone.side_effect = [None, {"parent_community_id": 10}, {"1": 1}]
    assert user_is_member_of_community(cursor, "%s", "child_member", 99) is True
