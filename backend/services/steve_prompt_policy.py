"""Shared prompt policy for interactive Steve surfaces."""

from __future__ import annotations

import re
from typing import Optional

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
