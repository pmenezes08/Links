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
SURFACE_FEED = "steve_feed"
SURFACE_NETWORKING = "steve_networking"
SURFACE_CONTENT = "steve_content"
ALL_STEVE_SURFACES = (SURFACE_DM, SURFACE_GROUP, SURFACE_FEED, SURFACE_NETWORKING, SURFACE_CONTENT)


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
        surfaces=ALL_STEVE_SURFACES,
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
        intents=(
            "what is c-point",
            "what is this platform",
            "tell me about this platform",
            "this app",
            "manifesto",
            "c-point manifesto",
            "philosophy",
            "mission",
            "vision",
            "values",
            "explain c-point",
        ),
        surfaces=ALL_STEVE_SURFACES,
        answer=(
            "C-Point Manifesto\n\n"
            "C-Point was built on a simple principle: The world is meant to be lived. Come here to reconnect with your people, stay present in your world, and actually get back to living.\n\n"
            "C-Point is a global platform of private, independent communities.\n"
            "No public feeds. No self-promotion. No algorithm-driven noise. No fast-consuming content.\n\n"
            "A community can be anything — a close group of friends planning trips, a circle debating the future, a place for banter with people who truly get you, or the private network that keeps you connected to the organisations that matter: your alumni group, your school, an investor network, your sports club, or your company.\n\n"
            "Inside every community lives Steve — our intelligent presence who deeply understands each member's journey, values and expertise, and quietly works to create meaningful connections and keep the space alive.\n\n"
            "Access is by invitation only. Privacy and exclusivity are built in from day one. Everything shared inside stays inside. No strangers. No algorithms deciding what deserves your attention.\n\n"
            "This is your world. Come connect with it."
        ),
        rules=(
            "For questions about C-Point's mission, manifesto, values, or why the platform exists, ground answers in this manifesto; quote short phrases when helpful and do not invent positioning beyond it.",
            "Keep answers inspiring but plain when paraphrasing.",
            "Mention only 1-2 community examples by default when expanding beyond the manifesto text.",
            "Offer more examples instead of listing many upfront.",
            "Avoid naming other platforms unless the user explicitly asks for a comparison.",
            "Emphasise privacy, exclusivity, invitation-only access, and genuine connection.",
        ),
    ),
    PlatformManualCard(
        id="platform.comparisons",
        title="Platform Comparisons",
        priority="retrieved",
        intents=(
            "difference between", "compare", "comparison", "versus", " vs ", "like linkedin",
            "like discord", "like reddit", "like whatsapp", "like x", "like twitter",
            "how is c-point different", "what makes c-point different", "different between",
            "linkedin", "discord", "reddit", "whatsapp",
        ),
        surfaces=ALL_STEVE_SURFACES,
        answer=(
            "C-Point is complementary to public platforms. Public platforms are built for "
            "reach, discovery, and consumption. C-Point is built for private, independent "
            "communities — invitation-only spaces with no public feeds, no algorithms, and no "
            "noise from strangers. DMs and group chats handle immediate conversation; the "
            "feed gives the network memory, so ideas, links, docs, media, and decisions stay "
            "threaded and findable.\n\n"
            "That mirrors the manifesto: the world is meant to be lived — connect with your "
            "people and your communities without strangers or algorithms deciding what deserves "
            "your attention."
        ),
        rules=(
            "Do not name competitors proactively.",
            "If the user names another platform, compare respectfully and plainly.",
            "Do not frame C-Point as replacing group chats, because C-Point includes DMs and group chats.",
        ),
    ),
    PlatformManualCard(
        id="feed.private_social_layer",
        title="Feed as Private Social Layer",
        priority="retrieved",
        intents=("feed", "private social layer", "network memory", "threaded", "posts", "why does the feed exist"),
        surfaces=ALL_STEVE_SURFACES,
        answer=(
            "Every meaningful micro-network deserves its own private social layer. The feed "
            "exists because each micro-network needs more than a message stream. It needs a "
            "private social layer: posts, replies, links, docs, media, ideas, and decisions "
            "attached to context, so important things stay visible and findable."
        ),
        rules=(
            "Do not mention competitor chat apps by name unless the user asks.",
            "Explain that C-Point has DMs/group chats for fast coordination and feed threads for durable network memory.",
        ),
    ),
    PlatformManualCard(
        id="dm_and_group_chats.basics",
        title="DMs and Group Chats",
        priority="retrieved",
        intents=("dm", "direct message", "group chat", "group chats", "fast coordination", "chat"),
        surfaces=ALL_STEVE_SURFACES,
        answer=(
            "C-Point has DMs and group chats for fast private coordination. They are for "
            "direct back-and-forth. The feed adds shared memory for the micro-network: "
            "context, posts, links, docs, media, and decisions that people may need to revisit."
        ),
    ),
    PlatformManualCard(
        id="pricing_and_limits.safe_answer",
        title="Pricing and Limits Safe Answer",
        priority="retrieved",
        intents=("pricing", "billing", "membership", "subscription", "limits", "caps", "plans", "price", "cost"),
        surfaces=ALL_STEVE_SURFACES,
        answer=(
            "The safest place to check pricing, billing, and limits is the pricing or "
            "membership page in C-Point. That is where the current plans, caps, and billing "
            "details live."
        ),
        rules=(
            "Steve must not quote prices, caps, discounts, billing rules, or plan limits from memory.",
            "If the user insists, Steve should say he does not want to give stale pricing and point them to the pricing/membership page.",
        ),
    ),
    PlatformManualCard(
        id="safety.professional_advice",
        title="Professional Advice Safety",
        priority="retrieved",
        intents=(
            "medical", "doctor", "health", "symptom", "treatment", "medication", "legal",
            "lawyer", "lawsuit", "contract", "financial", "investment", "invest", "tax",
            "regulatory", "compliance", "mental health", "therapy", "diagnosis",
        ),
        surfaces=ALL_STEVE_SURFACES,
        answer=(
            "Steve does not provide medical, legal, financial, tax, investment, regulatory, "
            "compliance, or mental-health advice. Steve may provide general, non-professional "
            "information and help users organise questions, but must clearly state that the user "
            "should seek advice from a qualified professional."
        ),
        rules=(
            "Steve must not imply expertise, certification, or a duty of care.",
            "Tone is calm, professional, and serious. No jokes.",
        ),
    ),
    PlatformManualCard(
        id="steve.what_can_i_do",
        title="What Steve Can Do",
        priority="retrieved",
        intents=("what can you do", "what can steve do", "help me", "capabilities"),
        surfaces=ALL_STEVE_SURFACES,
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
        surfaces=ALL_STEVE_SURFACES,
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
        surfaces=ALL_STEVE_SURFACES,
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
        surfaces=ALL_STEVE_SURFACES,
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
    "group chat", "post", "feed", "private social layer", "network memory", "compare",
    "different from", "difference between", "pricing", "billing", "membership", "limit",
    "onboarding", "discovery", "bug", "broken", "not working",
    "feature request", "product idea", "complaint", "feedback", "paulo", "founder",
    "vision", "mission",
)

EXPLICIT_X_TERMS = ("x/twitter", "twitter", "x.com", "on x", "tweet", "tweets")

LEGAL_TERMS = (
    "legal", "lawyer", "solicitor", "attorney", "lawsuit", "contract", "jurisdiction",
    "court", "regulation", "regulatory", "compliance", "gdpr", "terms of service",
)
MEDICAL_TERMS = (
    "medical", "doctor", "health", "symptom", "symptoms", "treatment", "medication",
    "diagnosis", "diagnose", "clinical", "hospital", "therapy", "therapist",
    "mental health", "anxiety", "depression",
)
FINANCIAL_TERMS = (
    "financial", "investment", "invest", "investing", "tax", "taxes", "accountant",
    "portfolio", "stock", "stocks", "crypto", "loan", "mortgage", "insurance",
)
PROFESSIONAL_ADVICE_TERMS = LEGAL_TERMS + MEDICAL_TERMS + FINANCIAL_TERMS

GENERAL_PROFESSIONAL_DISCLAIMER = (
    "I can give general context, but this should not be treated as medical, legal, "
    "financial, tax, investment, regulatory, mental-health, or other professional "
    "advice. I'm not qualified to assess your specific situation, and you should "
    "speak with an appropriate qualified professional before making decisions."
)
LEGAL_DISCLAIMER = (
    "I can explain general concepts, but this is not legal advice. You should speak "
    "with a qualified lawyer in the relevant jurisdiction."
)
MEDICAL_DISCLAIMER = (
    "I can offer general information, but this is not medical advice. If this concerns "
    "symptoms, treatment, medication, or risk, please speak with a qualified healthcare professional."
)
FINANCIAL_DISCLAIMER = (
    "I can help with general considerations, but this is not financial, investment, or tax advice. "
    "You should speak with a qualified adviser before making decisions."
)


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


def is_pricing_intent(message: str | None) -> bool:
    msg = _norm(message)
    return any(term in msg for term in _CARD_BY_ID["pricing_and_limits.safe_answer"].intents)


def is_professional_advice_intent(message: str | None) -> bool:
    msg = _norm(message)
    if not msg:
        return False
    return any(term in msg for term in PROFESSIONAL_ADVICE_TERMS)


def select_safety_disclaimer(message: str | None) -> str:
    msg = _norm(message)
    if any(term in msg for term in LEGAL_TERMS):
        return LEGAL_DISCLAIMER
    if any(term in msg for term in MEDICAL_TERMS):
        return MEDICAL_DISCLAIMER
    if any(term in msg for term in FINANCIAL_TERMS):
        return FINANCIAL_DISCLAIMER
    if is_professional_advice_intent(message):
        return GENERAL_PROFESSIONAL_DISCLAIMER
    return ""


def render_global_steve_safety_prompt(message: str | None, surface: str = SURFACE_DM) -> str:
    if not is_professional_advice_intent(message):
        return ""
    disclaimer = select_safety_disclaimer(message) or GENERAL_PROFESSIONAL_DISCLAIMER
    return (
        "STEVE PROFESSIONAL-ADVICE SAFETY:\n"
        "- Do not provide medical, legal, financial, tax, investment, regulatory, compliance, "
        "mental-health, or other professional advice.\n"
        "- You may provide general context and help the user organise questions.\n"
        "- Do not imply professional expertise, certification, or a duty of care.\n"
        "- Keep the tone calm, professional, and serious.\n"
        f"- Include this disclaimer in the user-visible response when relevant: {disclaimer}\n"
        f"- Surface: {surface}."
    )


def append_professional_disclaimer_if_needed(response: str | None, message: str | None) -> str:
    text = (response or "").strip()
    if not text or not is_professional_advice_intent(message):
        return text
    disclaimer = select_safety_disclaimer(message) or GENERAL_PROFESSIONAL_DISCLAIMER
    if disclaimer.lower() in text.lower():
        return text
    return f"{text}\n\n{disclaimer}"


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
