"""Community functional type (General/Gym/…) is platform-admin only."""

from __future__ import annotations

import pytest

from backend.services.community import (
    coerce_community_type_for_create,
    effective_community_type_for_update,
    normalize_community_type_value,
)
from tests.fixtures import make_user

pytestmark = pytest.mark.usefixtures("mysql_dsn")


def test_normalize_community_type_value_defaults_to_general():
    assert normalize_community_type_value("") == "general"
    assert normalize_community_type_value("Gym") == "gym"


def test_non_admin_create_always_general():
    make_user("type_regular", subscription="premium")
    assert coerce_community_type_for_create("type_regular", "Gym") == "general"
    assert coerce_community_type_for_create("type_regular", "Business") == "general"


def test_admin_create_preserves_requested_type():
    make_user("type_admin_user", is_admin=True)
    assert coerce_community_type_for_create("type_admin_user", "Gym") == "gym"
    assert coerce_community_type_for_create("type_admin_user", "Business") == "business"


def test_non_admin_update_cannot_change_type():
    make_user("type_updater")
    assert (
        effective_community_type_for_update("type_updater", "University", "Gym")
        == "gym"
    )
    assert (
        effective_community_type_for_update("type_updater", "", "Business")
        == "business"
    )


def test_admin_update_can_change_type():
    make_user("type_admin_updater", is_admin=True)
    assert (
        effective_community_type_for_update("type_admin_updater", "University", "general")
        == "university"
    )
    assert (
        effective_community_type_for_update("type_admin_updater", "", "gym")
        == "gym"
    )
