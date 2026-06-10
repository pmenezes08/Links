from __future__ import annotations

from backend.services.steve_community_welcome import (
    render_cold_start_poll,
    render_introduce_yourself_thread,
    render_rolling_welcome_post,
    render_welcome_post,
)
from backend.services import i18n


def test_cold_start_poll_uses_professional_copy():
    question, options = render_cold_start_poll(
        community_type="business",
        community_name="Founders Circle",
    )

    assert question == "Quick one: what should this space be useful for first?"
    assert options == [
        "Finding the right people",
        "Sharing useful work",
        "Asking sharp questions",
        "Spotting new opportunities",
    ]


def test_cold_start_poll_professional_copy_pt_pt():
    question, options = render_cold_start_poll(
        community_type="business",
        community_name="Founders Circle",
        locale="pt-PT",
    )

    assert question == i18n.t("steve_welcome.poll.professional.question", "pt-PT")
    assert options == [
        i18n.t("steve_welcome.poll.professional.option_1", "pt-PT"),
        i18n.t("steve_welcome.poll.professional.option_2", "pt-PT"),
        i18n.t("steve_welcome.poll.professional.option_3", "pt-PT"),
        i18n.t("steve_welcome.poll.professional.option_4", "pt-PT"),
    ]


def test_introduce_thread_copy_is_steve_peer_voice():
    text = render_introduce_yourself_thread(community_name="Lisbon Builders")

    assert "**👋 Introduce Yourself!**" in text
    assert "*Posted by Steve.*" in text
    assert "What brought you to **Lisbon Builders**" in text
    assert "assistant" not in text.lower()


def test_introduce_thread_copy_pt_pt():
    text = render_introduce_yourself_thread(
        community_name="Lisbon Builders",
        locale="pt-PT",
    )

    assert i18n.t("steve_welcome.introduce.title", "pt-PT") in text
    assert "Lisbon Builders" in text
    assert "assistant" not in text.lower()


def test_rolling_welcome_caps_visible_names():
    text = render_rolling_welcome_post(
        community_name="Alumni Club",
        member_names=["Ana", "Miguel", "Joana", "Ravi", "Sofia", "Leo"],
    )

    assert "**New faces in Alumni Club**" in text
    assert "Ana, Miguel, Joana, Ravi, Sofia, and 1 more" in text
    assert "Good spaces get built in small replies." in text


def test_welcome_post_root_en():
    text = render_welcome_post(
        card_key="welcome.root",
        community_name="Test Club",
    )

    assert "**Welcome to Test Club 👋**" in text
    assert "A quick tour of what's inside:" in text


def test_welcome_post_root_pt_pt():
    text = render_welcome_post(
        card_key="welcome.root",
        community_name="Clube Teste",
        locale="pt-PT",
    )

    assert i18n.t("steve_welcome.welcome.header", "pt-PT", name="Clube Teste") in text
    assert i18n.t("steve_welcome.welcome.tour_intro", "pt-PT") in text
