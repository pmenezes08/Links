"""Intent-based attachment of Grok hosted web_search / x_search tools for Steve."""

from __future__ import annotations

import re
from typing import Any, Iterable, Optional


def normalize_message_for_live_search_signals(message: str) -> str:
    """Lowercase plus normalize Unicode apostrophes for substring matching."""
    if not message:
        return ""
    t = message.lower().strip()
    for ch in ("\u2019", "\u2018"):
        t = t.replace(ch, "'")
    return t


def steve_external_search_requested(message: str) -> bool:
    """True when the user is clearly asking for live web/social/current information."""
    text = normalize_message_for_live_search_signals(message)
    if not text:
        return False

    phrases: tuple[str, ...] = (
        # Explicit browse
        "search the web",
        "web search",
        "online search",
        "search online",
        "look up online",
        "look it up online",
        "look up",
        "google",
        "bing",
        # News / current-events phrasing (including common variants)
        "latest news",
        "current news",
        "recent news",
        "today's news",
        "todays news",
        "news today",
        "news for today",
        "tell me today's news",
        "tell me the news",
        "give me today's news",
        "give me the news",
        "what's the news",
        "what is the news",
        "today's headlines",
        "todays headlines",
        "headlines today",
        "latest headlines",
        "the headlines",
        "top headlines",
        "headlines",
        "give me headlines",
        "breaking news",
        "morning news",
        "evening news",
        "daily news",
        "news update",
        "news roundup",
        "daily briefing",
        "news briefing",
        "current events",
        "recent events",
        "recent headlines",
        # Recency intent
        "what happened today",
        "what's new today",
        "what is new today",
        "what's trending",
        "what is trending",
        "happening today",
        "going on today",
        "happening now",
        "happening right now",
        "what's happening now",
        "what is happening now",
        # X/Twitter triggers
        "check x",
        "check twitter",
        "search twitter",
        "on x",
        "on twitter",
        "tweet about",
        "what are people saying on x",
        "what are people saying on twitter",
    )

    return any(phrase in text for phrase in phrases)


_AT_STOPWORDS_FOR_ROLE_AT = frozenset(
    {
        "stake",
        "home",
        "least",
        "first",
        "once",
        "hand",
        "large",
        "best",
        "worst",
        "any",
        "all",
        "the",
        "this",
        "that",
        "a",
        "an",
        "your",
        "my",
        "our",
    }
)


def _role_job_careers_at_external_target(text: str) -> bool:
    """True for \"roles at Acme\", \"job at Google\", \"career at OpenAI\"; false for \"career at a crossroads\"."""
    m = re.search(r"\b(jobs?|roles?|positions?|career|careers)\s+at\s+(\S+)", text, re.IGNORECASE)
    if not m:
        return False
    w = m.group(2).lower().strip(".,?!'\"")
    if w in _AT_STOPWORDS_FOR_ROLE_AT:
        return False
    return True


def steve_job_listing_or_employer_research_requested(message: str) -> bool:
    """True when the user is asking about real job postings, careers pages, or verifying a role.

    Phrases are chosen to avoid matching bare profile/introduction asks (e.g. \"tell me about
    @user career\") that should stay tool-off when profile_signal suppresses.
    """
    text = normalize_message_for_live_search_signals(message)
    if not text:
        return False
    if _role_job_careers_at_external_target(text):
        return True
    phrases: tuple[str, ...] = (
        "careers page",
        "careers site",
        "official careers",
        "company careers",
        "their careers",
        "job posting",
        "job postings",
        "job listing",
        "job listings",
        "job opening",
        "job openings",
        "open role",
        "open roles",
        "open position",
        "open positions",
        "jobs at",
        "opening at",
        "openings at",
        "hiring at",
        "now hiring",
        "job description",
        "requisition",
        "req id",
        "verify this job",
        "verify this role",
        "is this job real",
        "is this role real",
        "does this job exist",
        "does this role exist",
        "any openings at",
        "openings on the",
        "listed on lever",
        "listed on greenhouse",
        "workday job",
        "ashby job",
    )
    return any(phrase in text for phrase in phrases)


def steve_tool_names_for_log(tools: Optional[Iterable[Any]]) -> str:
    """Compact tool list for structured logs."""
    if not tools:
        return "none"
    names: list[str] = []
    for item in tools:
        if isinstance(item, dict) and item.get("type"):
            names.append(str(item["type"]))
    return ",".join(names) if names else "none"


def steve_tools_for_message(
    message: str,
    *,
    platform_question: bool = False,
    professional_advice_question: bool = False,
    config: Any = None,
) -> list[dict[str, str]]:
    """Return hosted web_search/x_search tools only when intent + KB flags allow.

    Order of checks:

    1. No external tools for platform-manual-only or professional-advice-only paths.
    2. Prefer on-platform KB: profile-style wording (mentions / introductions / \"about me\")
       suppresses external tools unless the same message also requests live-news, explicit browse, or
       employer/public-job style lookup (see ``steve_job_listing_or_employer_research_requested``).
    3. Eligible live intent: ``steve_external_search_requested``, ``news_current_events_requested``,
       ``steve_job_listing_or_employer_research_requested``, or (when KB ``external_search_explicit_only``
       is OFF) the web/X default-enabled flags.

    KB channel kill-switches: ``feed_attach_web_search_tool`` / ``feed_attach_x_search_tool``
    apply only after eligibility resolves (operators can disable web or X without redeploy).

    When ``config`` is None, behaviour matches explicit-only ON and defaults OFF (only explicit
    phrase + news heuristics attach tools; kill-switches default to allowing each channel).
    """
    if platform_question or professional_advice_question:
        return []

    from backend.services.steve_prompt_policy import (
        news_current_events_requested,
        should_include_user_profile,
    )

    text = message or ""
    explicit = steve_external_search_requested(text)
    news_live = news_current_events_requested(text)
    job_research = steve_job_listing_or_employer_research_requested(text)
    _text_wo_steve_mention = re.sub(r"@steve\b", "", text, flags=re.IGNORECASE).strip()
    profile_signal = bool(
        should_include_user_profile(text)
        and should_include_user_profile(_text_wo_steve_mention)
    )

    if profile_signal and not news_live and not explicit and not job_research:
        return []

    explicit_only = True
    web_default = False
    x_default = False
    if config is not None:
        explicit_only = bool(getattr(config, "external_search_explicit_only", True))
        web_default = bool(getattr(config, "web_search_default_enabled", False))
        x_default = bool(getattr(config, "x_search_default_enabled", False))

    eligible = False
    if explicit or news_live or job_research:
        eligible = True
    elif not explicit_only:
        eligible = bool(web_default or x_default)

    if not eligible:
        return []

    tools: list[dict[str, str]] = []
    attach_w = config is None or bool(getattr(config, "feed_attach_web_search_tool", True))
    attach_x = config is None or bool(getattr(config, "feed_attach_x_search_tool", True))
    if attach_w:
        tools.append({"type": "web_search"})
    if attach_x:
        tools.append({"type": "x_search"})
    return tools
