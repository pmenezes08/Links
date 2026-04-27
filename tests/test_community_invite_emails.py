"""Unit coverage for community invite email rendering."""

from __future__ import annotations

from backend.services import community_invite_emails


def test_new_user_invite_email_contains_invite_link_and_nested_names():
    html, text = community_invite_emails.render_new_user_invite_email(
        inviter_username="owner",
        community_name="Founders",
        invite_url="https://app.test/invite/token",
        nested_names=["Subgroup A"],
        logo_url="https://cdn.test/logo.svg",
    )

    assert "https://app.test/invite/token" in html
    assert "Subgroup A" in html
    assert "Welcome to C-Point" in text
    assert "owner" in text


def test_existing_user_added_email_contains_go_to_cpoint_cta():
    html, text = community_invite_emails.render_existing_user_added_email(
        inviter_username="owner",
        community_name="Founders",
        nested_names=[],
        logo_url="https://cdn.test/logo.svg",
    )

    assert "You've Been Added!" in html
    assert "Go to C-Point" in html
    assert "Founders" in text
