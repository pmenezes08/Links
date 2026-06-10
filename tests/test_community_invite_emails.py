"""Unit coverage for community invite email rendering."""

from __future__ import annotations

from backend.services import community_invite_emails, i18n


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


def test_new_user_invite_email_contains_expiry_when_provided():
    html, text = community_invite_emails.render_new_user_invite_email(
        inviter_username="owner",
        community_name="Founders",
        invite_url="https://app.test/invite/token",
        nested_names=[],
        logo_url="https://cdn.test/logo.svg",
        expires_at="2026-06-10 12:00:00",
    )

    assert "valid until 2026-06-10 12:00:00" in html
    assert "valid until 2026-06-10 12:00:00" in text


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


# ── pt-PT locale variants ───────────────────────────────────────────────


def test_new_user_invite_email_pt_pt():
    i18n.reload_catalogs()
    html, text = community_invite_emails.render_new_user_invite_email(
        inviter_username="owner",
        community_name="Founders",
        invite_url="https://app.test/invite/token",
        nested_names=[],
        logo_url="https://cdn.test/logo.svg",
        locale="pt-PT",
    )
    assert "https://app.test/invite/token" in html
    assert "Welcome to C-Point" not in text   # English heading must be gone
    # CTA is interpolated with the community name in both locales.
    assert "Founders" in html


def test_existing_user_added_email_pt_pt():
    i18n.reload_catalogs()
    html, text = community_invite_emails.render_existing_user_added_email(
        inviter_username="owner",
        community_name="Founders",
        nested_names=["Subgroup A"],
        logo_url="https://cdn.test/logo.svg",
        locale="pt-PT",
    )
    assert "You've Been Added!" not in html
    assert "Subgroup A" in html
    assert "Founders" in text


def test_invite_subject_locale():
    en = community_invite_emails.invite_subject(
        kind="existing", inviter_username="owner", community_name="Founders", locale="en"
    )
    pt = community_invite_emails.invite_subject(
        kind="existing", inviter_username="owner", community_name="Founders", locale="pt-PT"
    )
    assert "owner" in en and "Founders" in en
    assert "owner" in pt and "Founders" in pt
    assert en != pt
