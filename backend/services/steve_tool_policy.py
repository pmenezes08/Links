"""Community-feed Steve: when Grok receives web_search / x_search tools (KB policy)."""

from __future__ import annotations

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
    """KB policy: when may Grok see hosted web_search / x_search on community feed.

    * ``explicit`` — message qualifies for external lookup: live-search phrases and/or
      (when ``external_search_explicit_only`` is false) web/X default-on flags.
    * Per-tool attachment follows KB defaults (phrase + explicit-only widens both channels;
      default-on flags widen only their channel). ``feed_attach_*`` toggles disable a
      channel without redeploying code.
    """
    if platform_question or professional_advice_question:
        return []
    phrase_explicit = steve_external_search_requested(message)
    explicit = phrase_explicit
    if config and not getattr(config, "external_search_explicit_only", True):
        explicit = explicit or bool(
            getattr(config, "web_search_default_enabled", False)
            or getattr(config, "x_search_default_enabled", False)
        )
    if not explicit:
        return []

    explicit_only = getattr(config, "external_search_explicit_only", True) if config else True
    web_default = getattr(config, "web_search_default_enabled", False) if config else False
    x_default = getattr(config, "x_search_default_enabled", False) if config else False

    attach_web = (
        not config
        or web_default
        or explicit_only
        or phrase_explicit
    )
    attach_x = (
        not config
        or x_default
        or explicit_only
        or phrase_explicit
    )

    tools: list[dict[str, str]] = []
    if attach_web and (not config or getattr(config, "feed_attach_web_search_tool", True)):
        tools.append({"type": "web_search"})
    if attach_x and (not config or getattr(config, "feed_attach_x_search_tool", True)):
        tools.append({"type": "x_search"})
    return tools
