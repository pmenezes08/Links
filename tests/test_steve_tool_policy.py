"""Tests for Steve Grok hosted tool attachment intent policy."""

from dataclasses import replace

from backend.services.steve_community_config import SteveCommunityConfig
from backend.services.steve_tool_policy import (
    normalize_message_for_live_search_signals,
    steve_external_search_requested,
    steve_job_listing_or_employer_research_requested,
    steve_optional_live_web_intent,
    steve_tool_names_for_log,
    steve_tools_for_message,
    steve_web_search_confirmed,
    steve_x_search_requested,
)


def test_todays_news_variants_trigger():
    assert steve_external_search_requested("@Steve give me today's news")
    assert steve_external_search_requested("give me today's news")
    assert steve_external_search_requested("give me todays news")
    assert steve_external_search_requested("latest news please")
    assert steve_external_search_requested("Today's headlines?")
    assert steve_external_search_requested("news today")


def test_curly_apostrophe_normalized():
    assert steve_external_search_requested(f"today\u2019s news")


def test_normalize_collapses_smart_quotes():
    t = normalize_message_for_live_search_signals(f"today\u2019s")
    assert t == "today's"


def test_tool_log_summary():
    assert steve_tool_names_for_log(None) == "none"
    assert steve_tool_names_for_log([]) == "none"
    assert (
        steve_tool_names_for_log([{"type": "web_search"}, {"type": "x_search"}])
        == "web_search,x_search"
    )


def test_live_news_explicit_gets_web_only():
    cfg = SteveCommunityConfig()
    msg = "@admin @Steve what's the latest news"
    tools = steve_tools_for_message(msg, config=cfg)
    assert tools == [{"type": "web_search"}]


def test_live_news_with_x_phrase_gets_both_tools():
    cfg = SteveCommunityConfig()
    msg = "@Steve what's trending on twitter today"
    tools = steve_tools_for_message(msg, config=cfg)
    assert tools == [{"type": "web_search"}, {"type": "x_search"}]


def test_casual_chit_chat_attaches_web_by_default():
    """Default-attach: web_search rides along on every turn surviving hard exclusions."""
    cfg = SteveCommunityConfig()
    assert steve_tools_for_message("@Steve hello thanks", config=cfg) == [
        {"type": "web_search"},
    ]
    assert steve_tools_for_message("quick ping", config=cfg) == [
        {"type": "web_search"},
    ]


def test_casual_chit_chat_no_tools_under_legacy_gating(monkeypatch):
    """STEVE_LEGACY_TOOL_GATING=1 regression: chit-chat stays tool-free."""
    monkeypatch.setenv("STEVE_LEGACY_TOOL_GATING", "1")
    cfg = SteveCommunityConfig()
    assert steve_tools_for_message("@Steve hello thanks", config=cfg) == []
    assert steve_tools_for_message("quick ping", config=cfg) == []


def test_profile_about_user_suppresses_external_tools():
    cfg = SteveCommunityConfig()
    assert steve_tools_for_message("@Steve tell me about @alice career", config=cfg) == []
    assert steve_tools_for_message("who is john from our community?", config=cfg) == []


def test_profile_suppression_yields_when_news_also_requested():
    """Mixed wording: profile regex + sports/news heuristic still attaches."""
    cfg = SteveCommunityConfig()
    tools = steve_tools_for_message(
        "@Steve tell me about @bob AND what happened in Portugal news today?",
        config=cfg,
    )
    assert tools == [{"type": "web_search"}]


def test_platform_manual_path_strips_tools_even_if_news_words():
    cfg = SteveCommunityConfig()
    assert (
        steve_tools_for_message("today's news", platform_question=True, config=cfg) == []
    )


def test_professional_advice_strips_tools():
    cfg = SteveCommunityConfig()
    assert (
        steve_tools_for_message(
            "My knee hurts badly after squatting yesterday",
            professional_advice_question=True,
            config=cfg,
        )
        == []
    )


def test_kb_default_when_explicit_only_off_attaches_without_phrases():
    cfg = replace(
        SteveCommunityConfig(),
        external_search_explicit_only=False,
        web_search_default_enabled=True,
    )
    assert steve_tools_for_message("@Steve hey there", config=cfg) == [
        {"type": "web_search"},
    ]


def test_kb_explicit_only_attaches_by_default():
    """Default-attach ignores ``external_search_explicit_only``; web rides along."""
    cfg = replace(
        SteveCommunityConfig(),
        external_search_explicit_only=True,
        web_search_default_enabled=True,
    )
    assert steve_tools_for_message("@Steve hello", config=cfg) == [
        {"type": "web_search"},
    ]


def test_kb_explicit_only_requires_signal_under_legacy(monkeypatch):
    """STEVE_LEGACY_TOOL_GATING=1 regression: explicit_only ON + no signal → no tools."""
    monkeypatch.setenv("STEVE_LEGACY_TOOL_GATING", "1")
    cfg = replace(
        SteveCommunityConfig(),
        external_search_explicit_only=True,
        web_search_default_enabled=True,
    )
    assert steve_tools_for_message("@Steve hello", config=cfg) == []


def test_kb_can_disable_web_tool_only_when_eligible():
    cfg = replace(SteveCommunityConfig(), feed_attach_web_search_tool=False)
    tools = steve_tools_for_message("latest headlines please", config=cfg)
    assert tools == []


def test_kb_can_disable_x_tool_only_when_eligible():
    cfg = replace(SteveCommunityConfig(), feed_attach_x_search_tool=False)
    tools = steve_tools_for_message("breaking news roundup", config=cfg)
    assert tools == [{"type": "web_search"}]


def test_platform_intent_not_tripped_by_at_steve_for_casual_message():
    from backend.services.steve_platform_manual import is_platform_question

    assert not is_platform_question("@Steve hello thanks")


def test_careers_site_phrase_gets_tools_with_explicit_only():
    from backend.services.steve_platform_manual import is_platform_question

    cfg = SteveCommunityConfig()
    msg = "@Steve is there an OpenAI revenue ops role on their careers site?"
    assert not is_platform_question(msg)
    tools = steve_tools_for_message(
        msg,
        platform_question=is_platform_question(msg),
        config=cfg,
    )
    assert tools == [{"type": "web_search"}]


def test_job_listing_signal_overrides_profile_suppression_when_mixed():
    cfg = SteveCommunityConfig()
    tools = steve_tools_for_message(
        "@Steve tell me about @alice and any open roles at Meta",
        config=cfg,
    )
    assert tools == [{"type": "web_search"}]


def test_roles_at_company_triggers_tools_with_explicit_only():
    from backend.services.steve_platform_manual import is_platform_question

    cfg = SteveCommunityConfig()
    msg = "@Steve what roles at OpenAI should I look at?"
    assert not is_platform_question(msg)
    tools = steve_tools_for_message(
        msg,
        platform_question=is_platform_question(msg),
        config=cfg,
    )
    assert tools == [{"type": "web_search"}]


def test_web_search_confirmed_attaches_web_only():
    cfg = SteveCommunityConfig()
    assert steve_web_search_confirmed("Sim, consulta a internet")
    tools = steve_tools_for_message("yes please search the web for this", config=cfg)
    assert tools == [{"type": "web_search"}]


def test_podcast_episode_attaches_web_by_default():
    """Optional-web intent still resolves True, but default-attach also gives web_search."""
    cfg = SteveCommunityConfig()
    msg = "What's the latest episode of Huberman Lab?"
    assert steve_optional_live_web_intent(msg)
    assert steve_tools_for_message(msg, config=cfg) == [{"type": "web_search"}]


def test_podcast_episode_optional_web_not_auto_tools_under_legacy(monkeypatch):
    """STEVE_LEGACY_TOOL_GATING=1 regression: optional-web intent does not auto-attach."""
    monkeypatch.setenv("STEVE_LEGACY_TOOL_GATING", "1")
    cfg = SteveCommunityConfig()
    msg = "What's the latest episode of Huberman Lab?"
    assert steve_optional_live_web_intent(msg)
    assert steve_tools_for_message(msg, config=cfg) == []


def test_render_hosted_search_capability_instructions_reflects_tool_flag():
    from backend.services.steve_prompt_policy import render_hosted_search_capability_instructions

    assert "THIS TURN includes" in render_hosted_search_capability_instructions(
        has_hosted_search_tools=True
    )
    assert "don't have web lookup" in render_hosted_search_capability_instructions(
        has_hosted_search_tools=False
    )
    optional_caps = render_hosted_search_capability_instructions(
        has_hosted_search_tools=False,
        optional_web_offer=True,
    )
    assert "same language" in optional_caps.lower()
    assert "monthly steve" not in optional_caps.lower()
    assert "more of their" not in optional_caps.lower()
    assert "consulta a internet" not in optional_caps.lower()


def test_role_at_company_heuristic_not_career_at_a_crossroads():
    assert not steve_job_listing_or_employer_research_requested(
        "@Steve I feel my career at a crossroads"
    )
    assert steve_job_listing_or_employer_research_requested(
        "@Steve any roles at OpenAI for revenue ops?"
    )


# ── Phase 3: PT / ES intent detection (accent-fold) ──────────────────────────


def test_pt_news_intent_accent_folded_triggers():
    """European Portuguese news phrasing matches after diacritic folding."""
    assert steve_external_search_requested("Quais s\u00e3o as not\u00edcias de hoje?")
    assert steve_external_search_requested("d\u00e1-me as \u00faltimas not\u00edcias")
    assert steve_external_search_requested("not\u00edcias de \u00faltima hora por favor")
    assert steve_external_search_requested("o que se passa hoje?")


def test_es_news_intent_accent_folded_triggers():
    """Spanish news phrasing matches after diacritic folding."""
    assert steve_external_search_requested("dame las noticias de hoy")
    assert steve_external_search_requested("\u00bfcu\u00e1les son los titulares de hoy?")
    assert steve_external_search_requested("\u00bfqu\u00e9 est\u00e1 pasando hoy?")


def test_pt_job_research_accent_folded_triggers():
    """PT careers / job-posting phrasing matches after folding (p\u00e1gina \u2192 pagina)."""
    assert steve_job_listing_or_employer_research_requested(
        "tens a p\u00e1gina de carreiras da OpenAI?"
    )
    assert steve_job_listing_or_employer_research_requested(
        "h\u00e1 vagas de emprego na Stripe?"
    )


def test_es_job_research_accent_folded_triggers():
    """ES careers / job-posting phrasing matches after folding."""
    assert steve_job_listing_or_employer_research_requested(
        "mu\u00e9strame las ofertas de empleo"
    )
    assert steve_job_listing_or_employer_research_requested("\u00bfhay vacantes en Google?")


def test_pt_x_search_intent_triggers():
    assert steve_x_search_requested("procura no twitter sobre isto")
    assert steve_x_search_requested("o que dizem no twitter")


def test_es_x_search_intent_triggers():
    assert steve_x_search_requested("busca en twitter sobre esto")
    assert steve_x_search_requested("\u00bfqu\u00e9 dicen en twitter?")


def test_pt_web_confirm_triggers():
    assert steve_web_search_confirmed("sim, pesquisa na web")
    assert steve_web_search_confirmed("podes pesquisar na internet")


def test_es_web_confirm_accent_folded_triggers():
    """'s\u00ed' folds to 'si' and matches the ES confirmation phrases."""
    assert steve_web_search_confirmed("s\u00ed, busca en internet")
    assert steve_web_search_confirmed("busca en la web por favor")


def test_pt_x_intent_attaches_both_tools():
    cfg = SteveCommunityConfig()
    tools = steve_tools_for_message("o que dizem no twitter sobre isto?", config=cfg)
    assert tools == [{"type": "web_search"}, {"type": "x_search"}]


def test_pt_news_legacy_attaches_web_only(monkeypatch):
    """End-to-end: PT news intent survives legacy gating and attaches web only."""
    monkeypatch.setenv("STEVE_LEGACY_TOOL_GATING", "1")
    cfg = SteveCommunityConfig()
    tools = steve_tools_for_message("quais s\u00e3o as not\u00edcias de hoje?", config=cfg)
    assert tools == [{"type": "web_search"}]


# ── Phase 3: collision-negative cases (accent-fold must not over-match) ───────


def test_pt_career_crossroads_not_job_research():
    """Introspective 'carreira' (singular, no careers-page intent) must stay tool-neutral."""
    assert not steve_job_listing_or_employer_research_requested(
        "sinto a minha carreira num impasse"
    )


def test_bare_x_not_x_search_pt_es():
    """Bare 'x' (size / model) must not be read as X/Twitter intent in PT or ES."""
    assert not steve_x_search_requested("qual \u00e9 o tamanho x?")
    assert not steve_x_search_requested("el modelo x es mejor")


def test_es_si_substring_not_web_confirm():
    """'si' inside ordinary words must not count as the 's\u00ed, busca' confirmation."""
    assert not steve_web_search_confirmed("estoy considerando mi negocio")
    assert not steve_web_search_confirmed("si tienes tiempo dime")


def test_pt_es_greetings_not_news_intent():
    assert not steve_external_search_requested("bom dia, como est\u00e1s?")
    assert not steve_external_search_requested("obrigado pela ajuda")
    assert not steve_external_search_requested("hola, \u00bfqu\u00e9 tal?")
