"""Shared prompt policy for interactive Steve surfaces."""

from __future__ import annotations

import re
from typing import Optional

MODE_QUICK_ANSWER = "quick_answer"
MODE_SUBSTANTIVE_ANALYSIS = "substantive_analysis"
MODE_RECOMMENDATION = "recommendation"
MODE_REVIEW_CRITIQUE = "review_critique"
MODE_MENTORSHIP = "mentorship"

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
    r"(@[A-Za-z0-9_]+|\bwho is\b|\btell me about\b|\bconnect me\b|\bintro(?:duce)?\b|\bmentor\b|\bcareer\b|\bbackground\b|\bexperience\b)",
    re.IGNORECASE,
)


def classify_response_mode(user_message: str, *, mentorship_enabled: bool = False) -> str:
    text = (user_message or "").strip()
    if mentorship_enabled:
        return MODE_MENTORSHIP
    if not text or _CASUAL_RE.search(text):
        return MODE_QUICK_ANSWER
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


def render_response_policy_prompt(user_message: str, *, surface: str, mentorship_enabled: bool = False) -> str:
    mode = classify_response_mode(user_message, mentorship_enabled=mentorship_enabled)
    return f"""STEVE RESPONSE POLICY:
- First classify the user's request internally. Current likely mode: {mode}.
- Think step-by-step internally for complex requests, but do not reveal hidden chain-of-thought.
- Give the user the conclusion, the key reasoning, and the actionable next move.

RESPONSE MODES:
- quick_answer: Use for casual chat, acknowledgements, and simple questions. Reply naturally in 2-5 sentences. Do not add headings unless they help.
- substantive_analysis: Use for strategy, business, product, technical, career, health, finance, community decisions, or why/how questions. Use Markdown headings and bullet points.
- recommendation: State the recommendation clearly, explain why, include tradeoffs, and finish with practical next steps.
- review_critique: Evaluate what works, risks, blind spots, and improvements.
- mentorship: Be practical, direct, supportive, and specific. Ask at most one useful follow-up question only if needed.

FORMAT RULES:
- Avoid long walls of text.
- For substantive answers, prefer this structure: ## Short Answer, ## Analysis, ## Recommendation, ## Pitfalls, ## Next Steps.
- Use bullet points by default in substantive sections, usually 3-6 bullets per section.
- Use numbered steps only for sequences or action plans.
- Bold the key recommendation when helpful.
- For casual replies, stay conversational and do not over-format.

CONTEXT USE:
- Use recent thread history only when it changes the answer.
- Use user profile knowledge only when it makes advice more relevant or the user asks about a person.
- Use community documents, events, links, and polls only for community-resource questions or when directly referenced.
- Use the C-Point Platform Manual for C-Point product, privacy, pricing, onboarding, discovery, bugs, feedback, founder, mission, or policy questions.
- Do not mention injected context unless it matters to the answer.

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
