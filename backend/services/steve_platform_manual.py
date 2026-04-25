"""Platform Manual cards for Steve's C-Point product knowledge."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Iterable, List

logger = logging.getLogger(__name__)

PLATFORM_MANUAL_SLUG = "steve-platform-manual"
SURFACE_DM = "steve_dm"
SURFACE_GROUP = "steve_group"


@dataclass(frozen=True)
class PlatformManualCard:
    id: str
    title: str
    priority: str
    intents: tuple[str, ...]
    surfaces: tuple[str, ...]
    answer: str
    rules: tuple[str, ...] = ()


DEFAULT_CARDS: tuple[PlatformManualCard, ...] = (
    PlatformManualCard(
        id="platform.identity",
        title="Platform Identity",
        priority="always",
        intents=("c-point", "this platform", "the app", "here"),
        surfaces=(SURFACE_DM, SURFACE_GROUP),
        answer=(
            "Steve is inside C-Point. C-Point, \"this platform\", \"the platform\", "
            "\"this app\", \"the app\", and \"here\" always mean C-Point unless the "
            "user explicitly names another platform. Steve is a member of C-Point "
            "with extra reach. He is not a support widget and does not answer as if "
            "he is on X/Twitter, Grok, or any external network."
        ),
        rules=(
            "Never answer as if this platform means X/Twitter unless the user explicitly says X, Twitter, or x.com.",
            "Do not call Steve an assistant, bot, chatbot, or AI service.",
            "Do not use web_search or x_search for C-Point product questions.",
        ),
    ),
    PlatformManualCard(
        id="platform.what_is_cpoint",
        title="What C-Point Is",
        priority="retrieved",
        intents=("what is c-point", "what is this platform", "tell me about this platform", "this app"),
        surfaces=(SURFACE_DM, SURFACE_GROUP),
        answer=(
            "C-Point is a global platform built from private micro-networks: trusted "
            "spaces where people can connect, talk, build, share ideas, and stay close "
            "to the communities that matter. Those micro-networks can be entrepreneurship "
            "networks, founder circles, university cohorts, alumni groups, sports and "
            "athletic clubs, wellness and lifestyle communities, dating or social discovery "
            "networks, or small friend groups planning trips, discussing new ventures, "
            "testing ideas about the future, or just keeping the banter alive. C-Point is "
            "not one giant public feed. It is a network of smaller, trusted worlds where "
            "context, privacy, and meaningful connection come first."
        ),
        rules=("Keep the answer exciting but plain.", "Emphasise privacy, exclusivity, meaningful connection, and micro-networks."),
    ),
    PlatformManualCard(
        id="steve.what_can_i_do",
        title="What Steve Can Do",
        priority="retrieved",
        intents=("what can you do", "what can steve do", "help me", "capabilities"),
        surfaces=(SURFACE_DM, SURFACE_GROUP),
        answer=(
            "Steve can explain how C-Point works, answer platform questions, help users "
            "understand communities and DMs, brainstorm, summarise when the app exposes a "
            "summary action, give an opinion when tagged, collect product feedback, receive "
            "bug reports, help with member discovery flows, and handle general banter. Users "
            "can DM Steve directly. In posts, comments, and group contexts, users can tag "
            "@Steve when they want him to join the conversation."
        ),
        rules=("Do not overpromise actions that are not implemented yet.", "Mention member discovery only as a guided, privacy-gated flow."),
    ),
    PlatformManualCard(
        id="privacy.core_rules",
        title="Privacy Core Rules",
        priority="retrieved",
        intents=("privacy", "visibility", "recognise", "recognize", "who can see", "share information"),
        surfaces=(SURFACE_DM, SURFACE_GROUP),
        answer=(
            "C-Point is built around controlled visibility. The platform is designed for "
            "private groups and networks where context matters. Steve only shares member "
            "knowledge when the server-side privacy gate allows it. If Steve says he does "
            "not recognise a user, it means he does not have shareable context in that "
            "conversation. He should not imply that hidden information exists."
        ),
        rules=("Never say \"I know but can't tell you.\"", "Use \"I don't recognise that user\" for blocked user-knowledge cases."),
    ),
    PlatformManualCard(
        id="communities.basics",
        title="Communities Basics",
        priority="retrieved",
        intents=("community", "communities", "feed", "post", "comments", "links", "docs", "media", "starred"),
        surfaces=(SURFACE_DM, SURFACE_GROUP),
        answer=(
            "Communities are the core spaces inside C-Point. A community can stand alone "
            "or sit under a parent/root network. Sub-communities can focus a large network "
            "into smaller spaces while still belonging to the same broader world. Inside "
            "community feeds, members can publish posts, comment, reply, react, share links "
            "and docs, upload media, and use key/starred posts to keep important content "
            "visible. When a user wants Steve's view, they can tag @Steve."
        ),
        rules=("Do not mention features that are not true in production.", "Group chats are separate from the community feed."),
    ),
    PlatformManualCard(
        id="feedback.bugs_features",
        title="Feedback, Bugs, and Features",
        priority="retrieved",
        intents=("bug", "broken", "not working", "feature request", "product idea", "complaint", "confusing", "feedback"),
        surfaces=(SURFACE_DM, SURFACE_GROUP),
        answer=(
            "Users can report bugs, confusing flows, complaints, and product ideas to Steve. "
            "Steve should collect enough detail to make the report useful, classify it, and "
            "send it to the admin feedback queue. If the report is ambiguous, Steve asks one "
            "short follow-up question. Steve only says a report has been sent through after "
            "the backend has created a feedback item."
        ),
        rules=("Keep follow-up questions light: one question at a time.", "Do not interrogate the user."),
    ),
    PlatformManualCard(
        id="founder.paulo.short",
        title="Founder: Paulo",
        priority="retrieved",
        intents=("paulo", "founder", "who built", "why c-point exists", "vision", "mission"),
        surfaces=(SURFACE_DM, SURFACE_GROUP),
        answer=(
            "Paulo is the founder of C-Point. He built it around a pretty clear idea: "
            "public social networks are great for reach, but not great for trust. C-Point "
            "is his answer to that: private micro-networks where people have context, "
            "privacy, and a reason to be together."
        ),
        rules=(
            "Only use this when asked about Paulo, the founder, why C-Point exists, vision, or mission.",
            "Do not invent extra biographical details about Paulo.",
        ),
    ),
)

_CARD_BY_ID = {card.id: card for card in DEFAULT_CARDS}

PLATFORM_TERMS = (
    "c-point", "cpoint", "this platform", "the platform", "this app", "the app",
    "here", "steve", "community", "communities", "privacy", "dm", "direct message",
    "post", "feed", "onboarding", "discovery", "bug", "broken", "not working",
    "feature request", "product idea", "complaint", "feedback", "paulo", "founder",
    "vision", "mission", "pricing", "membership",
)

EXPLICIT_X_TERMS = ("x/twitter", "twitter", "x.com", "on x", "tweet", "tweets")


def _norm(text: str | None) -> str:
    return (text or "").strip().lower()


def _surface_ok(card: PlatformManualCard, surface: str) -> bool:
    return surface in card.surfaces


def explicitly_asks_about_x(message: str | None) -> bool:
    msg = _norm(message)
    return any(term in msg for term in EXPLICIT_X_TERMS)


def detect_platform_manual_intent(message: str | None) -> bool:
    msg = _norm(message)
    if not msg:
        return False
    if explicitly_asks_about_x(msg) and not any(term in msg for term in ("c-point", "cpoint", "steve")):
        return False
    return any(term in msg for term in PLATFORM_TERMS)


def is_platform_question(message: str | None) -> bool:
    return detect_platform_manual_intent(message)


def is_feedback_intent(message: str | None) -> bool:
    msg = _norm(message)
    if not msg:
        return False
    terms = _CARD_BY_ID["feedback.bugs_features"].intents + (
        "doesn't work", "does not work", "crash", "error", "issue", "problem",
        "i wish", "should add", "can you add", "improvement", "suggestion",
    )
    return any(term in msg for term in terms)


def _parse_cards_from_markdown(body: str | None) -> list[PlatformManualCard]:
    """Best-effort parser for admin-edited markdown cards.

    The defaults remain the schema of record. If admins edit the body, this lets
    answer text flow into Steve without requiring a redeploy.
    """
    if not body:
        return []
    sections = re.split(r"\n###\s+`([^`]+)`\s*\n", body)
    if len(sections) < 3:
        return []

    parsed: list[PlatformManualCard] = []
    for idx in range(1, len(sections), 2):
        card_id = sections[idx].strip()
        content = sections[idx + 1].strip()
        default = _CARD_BY_ID.get(card_id)
        if not default:
            continue
        answer = content
        answer_match = re.search(r"\*\*Answer / context:\*\*\s*(.*?)(?:\n\*\*Rules:\*\*|\Z)", content, re.S)
        if answer_match:
            answer = answer_match.group(1).strip()
        rules: tuple[str, ...] = default.rules
        rules_match = re.search(r"\*\*Rules:\*\*\s*(.*)", content, re.S)
        if rules_match:
            rules = tuple(
                line.strip().lstrip("- ").strip()
                for line in rules_match.group(1).splitlines()
                if line.strip().startswith("-")
            ) or default.rules
        parsed.append(
            PlatformManualCard(
                id=default.id,
                title=default.title,
                priority=default.priority,
                intents=default.intents,
                surfaces=default.surfaces,
                answer=answer,
                rules=rules,
            )
        )
    return parsed


def load_platform_manual_cards() -> list[PlatformManualCard]:
    try:
        from backend.services.knowledge_base import ensure_tables, get_page

        ensure_tables()
        page = get_page(PLATFORM_MANUAL_SLUG)
        parsed = _parse_cards_from_markdown((page or {}).get("body_markdown") or (page or {}).get("body") or "")
        if parsed:
            by_id = {card.id: card for card in DEFAULT_CARDS}
            by_id.update({card.id: card for card in parsed})
            return [by_id[card.id] for card in DEFAULT_CARDS if card.id in by_id]
    except Exception as exc:
        logger.warning("Could not load Steve Platform Manual from KB: %s", exc)
    return list(DEFAULT_CARDS)


def select_platform_manual_cards(message: str | None, surface: str = SURFACE_DM, max_cards: int = 4) -> list[PlatformManualCard]:
    cards = [card for card in load_platform_manual_cards() if _surface_ok(card, surface)]
    selected: list[PlatformManualCard] = [card for card in cards if card.priority == "always"]
    msg = _norm(message)

    scored: list[tuple[int, PlatformManualCard]] = []
    for card in cards:
        if card in selected:
            continue
        score = sum(1 for term in card.intents if term and term in msg)
        if score:
            scored.append((score, card))

    scored.sort(key=lambda item: item[0], reverse=True)
    selected.extend(card for _, card in scored)

    if detect_platform_manual_intent(message) and len(selected) == 1:
        selected.append(_CARD_BY_ID["platform.what_is_cpoint"])

    deduped: list[PlatformManualCard] = []
    seen = set()
    for card in selected:
        if card.id in seen:
            continue
        seen.add(card.id)
        deduped.append(card)
        if len(deduped) >= max_cards:
            break
    return deduped


def render_platform_manual_prompt(cards: Iterable[PlatformManualCard]) -> str:
    card_list = list(cards)
    if not card_list:
        return ""
    chunks = [
        "C-POINT PLATFORM MANUAL (canonical; overrides web/X for platform questions):",
        "- If the user says C-Point, this platform, the platform, the app, or here, they mean C-Point.",
        "- Do not use web_search or x_search to answer C-Point product/manual questions.",
        "- Only discuss X/Twitter when the user explicitly asks about X, Twitter, or x.com.",
    ]
    for card in card_list:
        chunks.append(f"\n[{card.id}] {card.title}\n{card.answer}")
        if card.rules:
            chunks.append("Rules:\n" + "\n".join(f"- {rule}" for rule in card.rules))
    return "\n".join(chunks).strip()
