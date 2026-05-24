"""Shared prompt policy for interactive Steve surfaces."""

from __future__ import annotations

import re
from typing import Iterable, Optional

from backend.services.steve_tool_policy import (
    normalize_message_for_live_search_signals,
    steve_external_search_requested,
)

MODE_QUICK_ANSWER = "quick_answer"
MODE_SUBSTANTIVE_ANALYSIS = "substantive_analysis"
MODE_RECOMMENDATION = "recommendation"
MODE_REVIEW_CRITIQUE = "review_critique"
MODE_MENTORSHIP = "mentorship"
MODE_NEWS_CURRENT_EVENTS = "news_current_events"

_NEWS_TOPIC_HINT = re.compile(
    r"\b(news|headlines|briefing|weather|forecast|markets?|stocks?|nasdaq|election|politics|"
    r"sports?|football|scores?|breaking)\b",
    re.IGNORECASE,
)

_RECOMMENDATION_RE = re.compile(
    r"\b(should i|should we|what should|recommend|recommendation|what would you do|next step|best option|which option)\b",
    re.IGNORECASE,
)
_REVIEW_RE = re.compile(
    r"\b(review|critique|evaluate|analyse|analyze|assess|proposal|plan|idea|trade[- ]?off|risk|blind spot)\b",
    re.IGNORECASE,
)
_SUBSTANTIVE_RE = re.compile(
    r"\b(strategy|business|product|technical|architecture|career|finance|legal|health|pricing|community|growth|roadmap|why|how|decision|problem|solve|design|implementation)\b",
    re.IGNORECASE,
)
_CASUAL_RE = re.compile(
    r"^\s*(thanks|thank you|ok|okay|cool|nice|great|lol|haha|yes|no|sure|perfect|bom|obrigado|obrigada)[.!?\s]*$",
    re.IGNORECASE,
)
_COMMUNITY_RESOURCE_RE = re.compile(
    r"\b(document|docs|file|pdf|event|calendar|link|poll|community resource|uploaded|attachment)\b",
    re.IGNORECASE,
)
_RESOURCE_FOLLOWUP_RE = re.compile(
    r"\b(summary|summarize|summarise|feedback|review|critique|evaluate|analyse|analyze|assess|"
    r"structure|recommendation|recommend|takeaways|key points|what does it say|what is it about|"
    r"read it|explain it|the new one|latest|that one|this one)\b",
    re.IGNORECASE,
)
_PROFILE_RE = re.compile(
    r"(@[A-Za-z0-9_]+|\bwho is\b|\btell me about\b|\bconnect me\b|\bintro(?:duce)?\b|\bmentor\b|\bcareer\b|\bbackground\b|\bexperience\b"
    r"|\bwhat\s+do\s+you\s+know\s+about\s+me\b|\babout\s+myself\b"
    r"|\bmy\s+communities\b|\bcommunities\s+(that\s+i'm|that\s+i am|i'?m\s+in|am\s+i\s+in)\b"
    r"|\blist\s+(my\s+|the\s+)?communities\b|\bwhich\s+communities\s+am\s+i\b|\bmembership(s)?\b)",
    re.IGNORECASE,
)


def news_current_events_requested(message: str | None) -> bool:
    """True when the user is asking for news, weather, markets, sports, or similar live briefing."""
    if steve_external_search_requested(message or ""):
        return True
    text = normalize_message_for_live_search_signals(message or "")
    if not text:
        return False
    return bool(_NEWS_TOPIC_HINT.search(text))


def classify_response_mode(user_message: str, *, mentorship_enabled: bool = False) -> str:
    text = (user_message or "").strip()
    if mentorship_enabled:
        return MODE_MENTORSHIP
    if not text or _CASUAL_RE.search(text):
        return MODE_QUICK_ANSWER
    if news_current_events_requested(text):
        return MODE_NEWS_CURRENT_EVENTS
    if _RECOMMENDATION_RE.search(text):
        return MODE_RECOMMENDATION
    if _REVIEW_RE.search(text):
        return MODE_REVIEW_CRITIQUE
    if _SUBSTANTIVE_RE.search(text) or len(text) > 220 or "?" in text and len(text) > 80:
        return MODE_SUBSTANTIVE_ANALYSIS
    return MODE_QUICK_ANSWER


def should_include_user_profile(user_message: str) -> bool:
    return bool(_PROFILE_RE.search(user_message or ""))


def should_include_community_resources(user_message: str) -> bool:
    return bool(_COMMUNITY_RESOURCE_RE.search(user_message or ""))


def should_include_community_resources_from_thread(
    user_message: str,
    *,
    original_post: str = "",
    parent_reply: str = "",
    recent_replies: Optional[Iterable[str]] = None,
    has_recent_docs: bool = False,
) -> bool:
    """Language-neutral resource activation using thread/resource state.

    The model is multilingual, but this decision happens before Steve sees
    context. We therefore use broad structural signals instead of trying to
    enumerate every language.
    """
    current = user_message or ""
    thread_text = "\n".join(
        part
        for part in [current, original_post or "", parent_reply or "", "\n".join(list(recent_replies or [])[-8:])]
        if part
    )
    if _COMMUNITY_RESOURCE_RE.search(thread_text):
        return True
    if has_recent_docs and _RESOURCE_FOLLOWUP_RE.search(thread_text):
        return True
    if has_recent_docs and len((current or "").strip()) >= 12:
        return bool(re.search(r"\b(it|this|that|latest|new|one|summary|feedback|review|explain|structure)\b", current, re.IGNORECASE))
    return False


def render_hosted_search_capability_instructions(
    *,
    has_hosted_search_tools: bool,
    optional_web_offer: bool = False,
    has_x_search: bool = False,
) -> str:
    """Align the system prompt with the actual ``tools=`` list for this Grok turn.

    When tools are omitted, Steve should state plainly that web lookup is not available **for this
    turn** (not a vague \"I have no real-time access\" forever), or offer confirm-then-search phrasing.
    """
    if has_hosted_search_tools:
        x_line = (
            "- THIS TURN also includes hosted **x_search** — use it only when the user clearly wants "
            "X/Twitter posts or social chatter on X.\n"
            if has_x_search
            else ""
        )
        return (
            "- THIS TURN includes hosted **web_search**. Use it for **current or verifiable public web** "
            "information — e.g. news, markets, sports, employer **public** careers pages, podcasts, "
            "product or company facts, government pages, event schedules.\n"
            f"{x_line}"
            "- Prefer **primary sources** (official careers/press/docs) when claiming a specific job posting, "
            "product fact, or policy exists.\n"
            "- Do **not** claim you searched or saw live results for facts that did not come from tool output "
            "on this turn.\n"
            "- **C-Point members:** do not use web search to look up platform users who are not in the "
            "injected profile excerpts; privacy rules override."
        )
    if optional_web_offer:
        return (
            "- THIS TURN does **not** include hosted web_search yet — the answer may be incomplete for "
            "live public-web facts (e.g. latest podcast episode, release date, listing).\n"
            "- Briefly offer to **search the web** for this if they want. Ask for a short, clear confirmation "
            "in **the same language the user is using in this conversation** — phrase it naturally for them; "
            "do **not** prescribe canned example phrases in another language or list multiple languages.\n"
            "- Do **not** mention credits, allowances, or billing.\n"
            "- Do **not** invent episode numbers, URLs, or headlines as if you had browsed the web."
        )
    return (
        "- THIS TURN does **not** include hosted web_search or x_search — **no live web lookup on this reply**. "
        "If the user needs current public-web facts (careers pages, listings, news, etc.), say so plainly "
        '(e.g. \"I don\'t have web lookup on this turn\") and answer from the conversation and injected '
        "C-Point context only.\n"
        "- Do **not** speculate or invent employer postings, URLs, or live news as if you had browsed the web."
    )


def render_third_party_job_grounding_rules() -> str:
    """Shared bullets for feed, DM, and group-chat system prompts (append where tool rules live)."""
    return (
        "THIRD-PARTY JOBS / EMPLOYERS:\n"
        "- Do not invent specific job titles, requirements, locations, application URLs, or "
        "requisition IDs for external companies.\n"
        "- When web_search / x_search were supplied for this turn, ground claims in retrieved "
        "snippets and prefer linking the employer's official careers or job-posting page.\n"
        "- If you cannot verify a listing exists, say so and tell the user how to confirm "
        "(e.g. search that employer's careers site) instead of fabricating JD text."
    )


def render_response_policy_prompt(user_message: str, *, surface: str, mentorship_enabled: bool = False) -> str:
    mode = classify_response_mode(user_message, mentorship_enabled=mentorship_enabled)
    return f"""STEVE RESPONSE POLICY:
- First classify the user's request internally. Current likely mode: {mode}.
- Think step-by-step internally for complex requests, but do not reveal hidden chain-of-thought.
- Give the user the conclusion, the key reasoning, and the actionable next move.

RESPONSE MODES:
- quick_answer: Use for casual chat, acknowledgements, and simple questions. Reply naturally in 2-5 sentences. Do not add headings unless they help.
- news_current_events: Use for news headlines, weather, sports results, politics, markets, breaking stories, and “what happened today” briefings. Use web_search / x_search when needed. Be substantive — not a one-liner.
- substantive_analysis: Use for strategy, business, product, technical, career, health, finance, community decisions, or why/how questions. Use Markdown headings and bullet points.
- recommendation: State the recommendation clearly, explain why, include tradeoffs, and finish with practical next steps.
- review_critique: Evaluate what works, risks, blind spots, and improvements.
- mentorship: Be practical, direct, supportive, and specific. Ask at most one useful follow-up question only if needed.

NEWS / CURRENT EVENTS (news_current_events mode) — REQUIRED SHAPE:
- Open with a short paragraph (2-4 sentences) framing the story or day’s theme.
- ## Key developments — 3-6 bullets with concrete facts: who, what, when, where; include dates and figures when the sources provide them.
- ## Why it matters — 2-4 bullets on implications or context (avoid fluff).
- ## Sources — 2-4 lines; each line MUST be a Markdown link using the article headline as link text: [Exact headline from the source](https://full-url). Do NOT use bare URLs. Do NOT use [[1]](url) citation-style links in the final reply.
- SOURCE HYGIENE: Prefer reputable outlets — major wires and nationals (e.g. Reuters, AP, BBC, FT, NPR, Guardian where appropriate). For Portugal or when the user writes European Portuguese / asks about Portugal, prioritise RTP Notícias, Público, Expresso, Observador, ECO (economy/business), and official Portuguese government sites (.gov.pt) for policy; cross-check thin aggregators against a tier-one outlet before relying on them.

FORMAT RULES:
- Avoid long walls of unbroken prose outside the opening paragraph.
- For substantive_analysis (non-news), prefer: ## Short Answer, ## Analysis, ## Recommendation, ## Pitfalls, ## Next Steps.
- Use bullet points by default in substantive and news sections, usually 3-6 bullets per section where applicable.
- Use numbered steps only for sequences or action plans.
- Bold the key recommendation when helpful (substantive/recommendation modes).
- For casual replies, stay conversational and do not over-format.

CONTEXT USE:
- Use recent thread history only when it changes the answer.
- Use user profile knowledge only when it makes advice more relevant or the user asks about a person.
- Use community documents, events, links, and polls only for community-resource questions or when directly referenced.
- Use the C-Point Platform Manual for C-Point product, privacy, pricing, onboarding, discovery, bugs, feedback, founder, mission, or policy questions.
- Do not mention injected context unless it matters to the answer.

{render_third_party_job_grounding_rules()}

SURFACE: {surface}"""


def append_response_policy(
    system_prompt: str,
    user_message: str,
    *,
    surface: str,
    mentorship_enabled: bool = False,
) -> str:
    return f"{system_prompt.rstrip()}\n\n{render_response_policy_prompt(user_message, surface=surface, mentorship_enabled=mentorship_enabled)}"


def append_context_guidance(system_prompt: str, guidance: Optional[str]) -> str:
    text = (guidance or "").strip()
    if not text:
        return system_prompt
    return f"{system_prompt.rstrip()}\n\n{text}"
