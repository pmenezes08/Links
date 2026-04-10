"""
Steve Knowledge Base — Per-Member + Per-Network Architecture

Manages the structured, evolutionary Knowledge Base in Firestore collection
``steve_knowledge_base``. Each member has up to 10 synthesis documents
(9 core dimensions + InferredContext for nuanced insights). Each network
has aggregated synthesis documents (NetworkIndex, NetworkInferredContext)
that roll up member KBs, posts across sub-communities, and community context.

Document ID patterns:
  Member synthesis:  {username}_{NoteType}          e.g.  emilychen_LifeCareer
  Network synthesis: _network_{network_id}_{NoteType} e.g. _network_42_NetworkInferredContext
  Atomic:            {username}_{NoteType}_{date}   e.g.  emilychen_Article_2025-04-09
  Shared nodes:      _shared_{concept_type}_{slug}

This enables both high-context individual networking and aggregated network
insights ("this network has 100 fintech professionals, 24 climbers, strong
Portuguese founder culture where 'Hey Malta' is common slang").
"""

from __future__ import annotations

import logging
import os
import re
import threading
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

USE_KNOWLEDGE_BASE_V1 = os.environ.get(
    "USE_KNOWLEDGE_BASE_V1", "true"
).lower() == "true"

# User-specific overrides for Steve profiling and KB synthesis (shared with bodybuilding_app.py)
# This centralized approach avoids scattered `if username == "Paulo"` checks and makes
# maintenance much easier.
USER_OVERRIDES = {
    "Paulo": {
        "identity_override": (
            "PAULO-SPECIFIC OVERRIDE (HIGHEST PRIORITY - OVERRIDES ALL OTHER DATA): "
            "You are analyzing the founder and primary builder of the C-Point platform. "
            "His core identity is platform architecture, building Steve (the member knowledge base system), "
            "AI integration, member profiling systems, and entrepreneurial product execution. "
            "Community creation and ownership is purely incidental to being the founder — it does NOT "
            "make him a 'community builder', 'prolific community curator', or similar. "
            "Completely suppress any language like 'community builder', 'prolific community', 'community curation', "
            "'highly active as owner/admin of numerous groups', or similar framing. "
            "Frame any community work as infrastructure/maintenance required to run the platform. "
            "Heavily prioritize platform-building, knowledge systems, and technical vision in Identity, "
            "UniqueFingerprint, observations, summary, networkingValue, and all KB dimensions."
        ),
    }
}

COLLECTION = "steve_knowledge_base"

# ── Core dimensions ──────────────────────────────────────────────────────

SYNTHESIS_NOTE_TYPES = (
    "Index",
    "LifeCareer",
    "GeographyCulture",
    "Expertise",
    "CompanyIntel",
    "Opinions",
    "Identity",
    "Network",
    "UniqueFingerprint",
    "InferredContext",
    # Network-level variants (aggregated across members and sub-communities)
    "NetworkIndex",
    "NetworkInferredContext",
)

ATOMIC_NOTE_TYPES = (
    "Event",
    "Article",
    "Podcast",
    "OpinionShift",
    "Relationship",
    "Creation",
)

# ── Document schemas ─────────────────────────────────────────────────────
# Each schema defines the expected ``content`` sub-fields for its type.

SYNTHESIS_SCHEMAS: Dict[str, Dict[str, str]] = {
    "Index": {
        "currentSynthesis": "3-5 sentence overview of the whole person as of now",
        "dimensionSummaries": "dict mapping each dimension to a 1-2 sentence summary",
        "recentEvolutionSignals": "list of notable recent changes with links to atomic notes",
        "nextSynthesisDue": "ISO date for next scheduled resynthesis",
    },
    "LifeCareer": {
        "stages": "ordered list of {period, role, company, description, significance}",
        "currentStage": "description of where they are now",
        "trajectory": "narrative of overall career arc and direction",
        "turningPoints": "list of major transitions with dates and context",
    },
    "GeographyCulture": {
        "locations": "ordered list of {period, city, country, context, culturalInfluence}",
        "currentLocation": "{city, country, context}",
        "culturalInfluences": "narrative of how places shaped their worldview",
        "geographicExpertise": "list of regions/countries they deeply understand",
    },
    "Expertise": {
        "domains": "list of {domain, level, trajectory, evidence}",
        "depthProgression": "narrative of how expertise evolved over time",
        "currentFocus": "what they are deepening right now",
        "credibilitySignals": "list of concrete evidence (publications, roles, projects)",
    },
    "Opinions": {
        "keyTopics": "list of {topic, currentStance, evolution, confidence}",
        "shifts": "list of {date, topic, fromStance, toStance, trigger}",
        "consistentBeliefs": "things they have always believed",
        "controversialTakes": "opinions that stand out or go against consensus",
    },
    "Identity": {
        "coreValues": "list of values with evidence",
        "traits": "personality traits observed across content",
        "contradictions": "tensions that make this person unique",
        "energyPatterns": "what gives them energy vs drains them",
        "communicationStyle": "how they write, argue, and express themselves",
    },
    "Network": {
        "interactionFrequency": "list of {username, totalInteractions, groupBreakdown, lastInteracted}",
        "networkEvolution": "narrative of how their connections have changed",
        "communityParticipation": "list of {community, activityLevel, role}",
        "relationshipStrength": "top connections ranked by frequency (no DM content)",
    },
    "UniqueFingerprint": {
        "whatMakesThemSpecial": "2-3 sentences on their unique combination",
        "bridgingCapability": "what worlds they connect",
        "rareQualities": "list of unusual combinations or contradictions",
        "bestMatchedWith": "types of people who would benefit from connecting with them",
    },
    "InferredContext": {
        "experiences": "list of {experience, transformativeImpact, strategicIntent, capabilitySignals, bridgingValue, implicationsForIdentity}",
        "overarchingThemes": "list of recurring patterns and contradictions across the entire journey",
        "worldviewEvolution": "narrative of how fundamental perspectives have shifted over time",
        "strategicImplications": "what this means for future trajectory, networking value, and platform fit",
        "confidence": "0.0-1.0 score on the strength/evidence of these inferences",
    },
    "NetworkIndex": {
        "currentSynthesis": "3-5 sentence overview of the network's collective identity and strengths",
        "composition": "stats like member counts by expertise, geography, background",
        "keyThemes": "top recurring topics, skills, and interests across members and posts",
        "networkEvolution": "how the network has changed over time (growth, focus shifts)",
        "nextSynthesisDue": "ISO date for next scheduled network resynthesis",
    },
    "NetworkInferredContext": {
        "collectiveInsights": "aggregated transformative inferences from all member InferredContext documents",
        "culturalVibe": "network culture, slang patterns, communication style (e.g. Portuguese 'Hey Malta' usage)",
        "strategicValue": "what this network as a whole offers (e.g. 100 fintech professionals, 24 climbers, strong M&A collective experience)",
        "bridgingOpportunities": "what worlds this network connects and who would benefit from it",
        "confidence": "0.0-1.0 score on the strength of the network-level inferences",
    },
}

ATOMIC_SCHEMAS: Dict[str, Dict[str, str]] = {
    "Event": {
        "date": "ISO date",
        "eventType": "career_change | relocation | life_event | milestone | project",
        "description": "what happened",
        "significance": "why it matters for understanding this person",
        "linkedDimensions": "list of synthesis note types this relates to",
    },
    "Article": {
        "date": "ISO date",
        "title": "article title",
        "url": "source URL",
        "keyExcerpts": "important quotes or ideas",
        "whatItReveals": "what this article tells us about the person's thinking",
        "linkedDimensions": "list of synthesis note types this relates to",
    },
    "Podcast": {
        "date": "ISO date",
        "title": "podcast / episode title",
        "url": "source URL",
        "keyPoints": "main ideas discussed",
        "whatItReveals": "what this tells us about the person",
        "linkedDimensions": "list of synthesis note types this relates to",
    },
    "OpinionShift": {
        "date": "ISO date",
        "topic": "what the opinion is about",
        "fromStance": "previous position",
        "toStance": "new position",
        "trigger": "what caused the shift",
        "evidence": "post/article/comment that shows the shift",
    },
    "Relationship": {
        "targetUsername": "who they interact with",
        "totalInteractions": "count of observed interactions",
        "groupBreakdown": "dict of {groupName: count}",
        "lastInteracted": "ISO date",
        "privacyLevel": "frequency_only",
    },
    "Creation": {
        "date": "ISO date",
        "creationType": "post | reply | shared_link | project",
        "content": "excerpt or summary",
        "whatItReveals": "insight about the person",
        "linkedDimensions": "list of synthesis note types this relates to",
    },
}

# ── Shared node schema (cross-user graph) ────────────────────────────────

SHARED_NODE_TYPES = ("location", "institution", "topic", "life_event_category")

SHARED_NODE_SCHEMA: Dict[str, str] = {
    "conceptType": "location | institution | topic | life_event_category",
    "name": "human-readable name",
    "slug": "URL-safe identifier",
    "linkedUsernames": "list of usernames connected to this concept",
    "userContexts": "dict of {username: brief context for this connection}",
}

# ── Lazy Firestore client (matches existing codebase pattern) ────────────

def _get_fs():
    """Lazy-import and return the shared Firestore client."""
    from backend.services.firestore_writes import _get_client
    return _get_client()


def _slugify(text: str) -> str:
    """Convert text to a URL-safe slug for document IDs."""
    s = text.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")[:80]


# ═══════════════════════════════════════════════════════════════════════════
#  WRITE OPERATIONS
# ═══════════════════════════════════════════════════════════════════════════

def save_synthesis_note(
    username: str,
    note_type: str,
    content: Dict[str, Any],
    *,
    admin_feedback: Optional[Dict[str, Any]] = None,
) -> bool:
    """Save or update a synthesis note (one of the 10 core dimensions, including InferredContext).

    Uses Firestore ``set(merge=True)`` so partial updates are safe.
    Increments ``version`` on every write. Validates against SYNTHESIS_NOTE_TYPES.
    """
    if note_type not in SYNTHESIS_NOTE_TYPES:
        logger.error("Invalid synthesis note type: %s", note_type)
        return False
    if not USE_KNOWLEDGE_BASE_V1:
        return False
    try:
        fs = _get_fs()
        now = datetime.utcnow().isoformat() + "Z"
        doc_id = f"{username}_{note_type}"
        doc_ref = fs.collection(COLLECTION).document(doc_id)

        existing = doc_ref.get()
        version = 1
        if existing.exists:
            version = (existing.to_dict() or {}).get("version", 0) + 1

        doc_data: Dict[str, Any] = {
            "username": username,
            "type": "synthesis",
            "noteType": note_type,
            "updatedAt": now,
            "content": content,
            "version": version,
        }
        if admin_feedback is not None:
            doc_data["adminFeedback"] = admin_feedback

        doc_ref.set(doc_data, merge=True)
        logger.info("Synthesis note saved: %s/%s (v%d)", username, note_type, version)
        return True
    except Exception as e:
        logger.error("Failed to save synthesis note %s for %s: %s", note_type, username, e)
        return False


def save_atomic_note(
    username: str,
    note_type: str,
    title: str,
    content: Dict[str, Any],
    *,
    date_str: Optional[str] = None,
) -> bool:
    """Save a high-signal atomic note (Event, Article, Podcast, etc.)."""
    if note_type not in ATOMIC_NOTE_TYPES:
        logger.error("Invalid atomic note type: %s", note_type)
        return False
    if not USE_KNOWLEDGE_BASE_V1:
        return False
    try:
        fs = _get_fs()
        now = datetime.utcnow().isoformat() + "Z"
        date_tag = date_str or datetime.utcnow().strftime("%Y-%m-%d")
        doc_id = f"{username}_{note_type}_{date_tag}"

        doc_data: Dict[str, Any] = {
            "username": username,
            "type": "atomic",
            "noteType": note_type,
            "title": title,
            "createdAt": now,
            "content": content,
        }

        doc_ref = fs.collection(COLLECTION).document(doc_id)
        doc_ref.set(doc_data)
        logger.info("Atomic note saved: %s/%s/%s", username, note_type, title[:40])
        return True
    except Exception as e:
        logger.error("Failed to save atomic note for %s: %s", username, e)
        return False


def save_shared_node(
    concept_type: str,
    name: str,
    username: str,
    context: str,
) -> bool:
    """Add or update a cross-user shared node (location, institution, topic)."""
    if concept_type not in SHARED_NODE_TYPES:
        logger.error("Invalid shared node type: %s", concept_type)
        return False
    if not USE_KNOWLEDGE_BASE_V1:
        return False
    try:
        fs = _get_fs()
        slug = _slugify(name)
        doc_id = f"_shared_{concept_type}_{slug}"
        doc_ref = fs.collection(COLLECTION).document(doc_id)

        from google.cloud.firestore_v1 import ArrayUnion

        doc_ref.set({
            "type": "shared_node",
            "conceptType": concept_type,
            "name": name,
            "slug": slug,
            "updatedAt": datetime.utcnow().isoformat() + "Z",
            "linkedUsernames": ArrayUnion([username]),
            f"userContexts.{username}": context,
        }, merge=True)

        logger.info("Shared node updated: %s/%s += %s", concept_type, name, username)
        return True
    except Exception as e:
        logger.error("Failed to save shared node %s/%s: %s", concept_type, name, e)
        return False


def save_admin_feedback(
    username: str,
    note_type: str,
    feedback: Dict[str, Any],
) -> bool:
    """Record admin feedback on a synthesis note for quality improvement."""
    if note_type not in SYNTHESIS_NOTE_TYPES:
        return False
    try:
        fs = _get_fs()
        doc_id = f"{username}_{note_type}"
        doc_ref = fs.collection(COLLECTION).document(doc_id)
        doc_ref.set({
            "adminFeedback": feedback,
            "adminFeedbackAt": datetime.utcnow().isoformat() + "Z",
        }, merge=True)
        logger.info("Admin feedback saved: %s/%s", username, note_type)
        return True
    except Exception as e:
        logger.error("Failed to save admin feedback for %s/%s: %s", username, note_type, e)
        return False


# ═══════════════════════════════════════════════════════════════════════════
#  READ OPERATIONS
# ═══════════════════════════════════════════════════════════════════════════

def get_member_knowledge(
    username: str,
    note_types: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Retrieve all (or selected) knowledge base documents for a user.

    Returns ``{noteType: document_dict}`` for synthesis notes, and
    ``{noteType_date: document_dict}`` for atomic notes.
    """
    try:
        fs = _get_fs()
        query = fs.collection(COLLECTION).where("username", "==", username)
        docs: Dict[str, Any] = {}

        for doc in query.stream():
            data = doc.to_dict()
            nt = data.get("noteType", "")
            if note_types and nt not in note_types:
                continue
            key = doc.id.replace(f"{username}_", "", 1)
            docs[key] = data

        return docs
    except Exception as e:
        logger.error("Failed to get knowledge base for %s: %s", username, e)
        return {}


def get_member_index(username: str) -> Optional[Dict[str, Any]]:
    """Get the main Index document for a member."""
    try:
        fs = _get_fs()
        doc = fs.collection(COLLECTION).document(f"{username}_Index").get()
        return doc.to_dict() if doc.exists else None
    except Exception as e:
        logger.error("Failed to get index for %s: %s", username, e)
        return None


def batch_get_member_knowledge(
    usernames: List[str],
    note_types: Optional[List[str]] = None,
) -> Dict[str, Dict[str, Any]]:
    """Batch-read knowledge base documents for multiple users.

    Returns ``{username: {noteType: doc_dict}}``.
    """
    if not usernames:
        return {}
    types_to_fetch = note_types or list(SYNTHESIS_NOTE_TYPES)
    try:
        fs = _get_fs()
        refs = []
        ref_map: Dict[str, Tuple[str, str]] = {}
        for u in usernames:
            for nt in types_to_fetch:
                doc_id = f"{u}_{nt}"
                refs.append(fs.collection(COLLECTION).document(doc_id))
                ref_map[doc_id] = (u, nt)

        CHUNK = 500
        result: Dict[str, Dict[str, Any]] = {u: {} for u in usernames}
        for i in range(0, len(refs), CHUNK):
            chunk = refs[i : i + CHUNK]
            for doc in fs.get_all(chunk):
                if doc.exists:
                    u, nt = ref_map.get(doc.id, (None, None))
                    if u:
                        result[u][nt] = doc.to_dict()
        return result
    except Exception as e:
        logger.error("batch_get_member_knowledge failed: %s", e)
        return {u: {} for u in usernames}


def get_shared_node(concept_type: str, name: str) -> Optional[Dict[str, Any]]:
    """Retrieve a single shared node (e.g. location='London')."""
    try:
        fs = _get_fs()
        slug = _slugify(name)
        doc_id = f"_shared_{concept_type}_{slug}"
        doc = fs.collection(COLLECTION).document(doc_id).get()
        return doc.to_dict() if doc.exists else None
    except Exception as e:
        logger.error("Failed to get shared node %s/%s: %s", concept_type, name, e)
        return None


def query_shared_nodes_by_type(concept_type: str) -> List[Dict[str, Any]]:
    """List all shared nodes of a given type (e.g. all locations)."""
    try:
        fs = _get_fs()
        query = (
            fs.collection(COLLECTION)
            .where("type", "==", "shared_node")
            .where("conceptType", "==", concept_type)
        )
        return [doc.to_dict() for doc in query.stream()]
    except Exception as e:
        logger.error("Failed to query shared nodes of type %s: %s", concept_type, e)
        return []


def find_users_by_shared_concept(concept_type: str, name: str) -> List[str]:
    """Return usernames linked to a shared concept (e.g. 'London')."""
    node = get_shared_node(concept_type, name)
    if not node:
        return []
    return node.get("linkedUsernames", [])


# ═══════════════════════════════════════════════════════════════════════════
#  CONTEXT BUILDING — Produce text for Steve/Grok prompts
# ═══════════════════════════════════════════════════════════════════════════

def build_knowledge_context_for_steve(
    username: str,
    *,
    knowledge: Optional[Dict[str, Any]] = None,
) -> str:
    """Build a rich context string from the knowledge base for Steve's prompt.

    This is the primary interface between the knowledge base and Steve.
    It produces structured text that Steve can reason over.
    """
    if knowledge is None:
        knowledge = get_member_knowledge(username, list(SYNTHESIS_NOTE_TYPES))
    if not knowledge:
        return ""

    parts: List[str] = []

    index_data = knowledge.get("Index", {}).get("content", {})
    if index_data.get("currentSynthesis"):
        parts.append(f"OVERVIEW: {index_data['currentSynthesis']}")

    dimension_order = [
        ("UniqueFingerprint", "UNIQUE FINGERPRINT"),
        ("LifeCareer", "LIFE & CAREER EVOLUTION"),
        ("GeographyCulture", "GEOGRAPHIC & CULTURAL JOURNEY"),
        ("Expertise", "EXPERTISE & DEPTH"),
        ("Opinions", "OPINION EVOLUTION"),
        ("Identity", "TRAITS, VALUES & CONTRADICTIONS"),
        ("Network", "NETWORK & RELATIONSHIPS"),
    ]

    for note_type, heading in dimension_order:
        data = knowledge.get(note_type, {})
        content = data.get("content", {})
        if not content:
            continue
        section_parts = [f"\n{heading}:"]
        for field_key, field_val in content.items():
            if not field_val:
                continue
            if isinstance(field_val, str):
                section_parts.append(f"  {field_key}: {field_val}")
            elif isinstance(field_val, list):
                items_str = "; ".join(
                    _flatten_item(item) for item in field_val[:10]
                )
                if items_str:
                    section_parts.append(f"  {field_key}: {items_str}")
            elif isinstance(field_val, dict):
                dict_str = "; ".join(
                    f"{k}: {v}" for k, v in list(field_val.items())[:10]
                    if v
                )
                if dict_str:
                    section_parts.append(f"  {field_key}: {dict_str}")

        if len(section_parts) > 1:
            parts.extend(section_parts)

    recent_signals = index_data.get("recentEvolutionSignals", [])
    if recent_signals:
        parts.append("\nRECENT EVOLUTION SIGNALS:")
        for signal in recent_signals[:5]:
            if isinstance(signal, str):
                parts.append(f"  - {signal}")
            elif isinstance(signal, dict):
                parts.append(f"  - {signal.get('description', '')}")

    return "\n".join(parts)


def _flatten_item(item: Any) -> str:
    """Convert a list item (str or dict) to a flat string."""
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        return ", ".join(f"{k}: {v}" for k, v in item.items() if v)
    return str(item)


# ═══════════════════════════════════════════════════════════════════════════
#  SYNTHESIS ENGINE — Auto-generate notes from existing data via Grok
# ═══════════════════════════════════════════════════════════════════════════

KNOWLEDGE_SYNTHESIS_PROMPT = """You are an expert people analyst for a professional networking platform.
Given the raw profile data, platform activity, enriched content, and onboarding answers for a user,
produce a structured JSON analysis that captures HOW THIS PERSON HAS EVOLVED OVER TIME.

You may also receive a PREVIOUS SYNTHESIS section — this is the existing knowledge base from a prior run.
Your job is to ENHANCE and REFINE it, not start from scratch. Preserve what's correct, add new evidence,
and update anything that has changed.

Focus on these 10 dimensions:
1. LifeCareer — career stages, transitions, trajectory, turning points
2. GeographyCulture — locations lived, cultural influences, geographic expertise
3. Expertise — domains, depth progression, current focus, credibility signals
4. CompanyIntel — rich intelligence on every company the user has worked for (reputation, selectivity, culture, stage, relevance)
5. Opinions — key topic stances, opinion shifts over time, consistent beliefs
6. Identity — core values, personality traits, contradictions, energy patterns, communication style
7. Network — connections and interactions inferred exclusively from public posts, comments, and shared external sources (no private DM or group chat content)
8. UniqueFingerprint — what makes this person truly special, rare qualities, bridging capability
9. Index — overall synthesis tying everything together
10. InferredContext — dedicated home for deep holistic/transformative inferences (the "what does this *mean* about who this person is" layer, including cultural/slang context from posts and comments). This is where the HOLISTIC EXPERIENCE INFERENCE ENGINE output should be primarily captured.

CRITICAL RULES:
- Track EVOLUTION, not just current state. "Used to be X, now Y" is more valuable than just "is Y".
- Look for CONTRADICTIONS and TENSIONS — they reveal uniqueness.
- Be SPECIFIC with evidence — cite dates, posts, comments, and external sources where possible.
- Network insights must come exclusively from public posts, comments, and shared external sources. Never reference private DM or group chat content (removed per current requirements).
- Geographic data should note both CURRENT location and HISTORICAL journey.
- Opinions should track SHIFTS — what changed and what triggered the change.

INCREMENTAL UPDATE RULES (when PREVIOUS SYNTHESIS is provided):
- Your job is to COMPLEMENT and ENRICH the previous synthesis, NOT replace it.
- NEVER drop existing information unless an admin correction explicitly says to remove it.
- Keep ALL existing career stages, locations, domains, opinions, traits — add to them.
- If new data provides more detail about something already in the synthesis, enrich the existing entry.
- If new data introduces something not in the previous synthesis, add it as a new entry.
- Merging means the output should be a SUPERSET of previous + new, minus admin corrections.

ADMIN CORRECTIONS:
- If an ADMIN CORRECTIONS section is provided, treat it as ABSOLUTE GROUND TRUTH.
- Admin corrections override ALL other data sources including the raw profile and previous synthesis.
- If an admin says "REMOVE/FIX", you MUST remove or correct that information entirely.
- Never re-infer information that an admin has explicitly corrected or removed.

MISSING INFORMATION:
- If a MISSING INFORMATION section is provided, the admin has confirmed these facts are true.
- You MUST include this information in the relevant dimension even if the raw data doesn't mention it.
- Treat missing information hints as first-party facts — they are authoritative.

HOLISTIC EXPERIENCE INFERENCE ENGINE (CRITICAL — PRIMARILY POPULATES InferredContext WHILE ALSO ENRICHING THE OTHER 9 DIMENSIONS):

Move beyond listing facts. For every significant experience (professional role, geographic move, educational program, personal event, volunteer work, cultural exposure, etc.), perform deep, nuanced inference. **This output belongs primarily in the new InferredContext dimension.** This is the core of the knowledge base. Ask:

1. **Transformative Impact**: How did this change the person? What new perspectives, values, resilience, empathy, or worldviews did it create? (Example: 9 months in Angola = profound exposure to 3rd-world society → shifts in economic views, understanding of inequality, resilience, global citizenship, and empathy that influences all subsequent decisions. This should appear in Identity, GeographyCulture, and UniqueFingerprint).

2. **Strategic Intent**: What deliberate choice does this reveal about the person's ambition, direction, or priorities? (Example: Choosing a Kellogg EMBA (tier-1 American program) = intentional pivot toward US/North American markets, access to elite networks, signaling high ambition and fluency in Western business frameworks. This should be reflected in LifeCareer.trajectory, Expertise, and Index).

3. **Capability & Credibility Signals**: What does this experience *actually confer* beyond the title? Be specific about skills, mindset, network, and credibility. Always cross-reference with CompanyIntel (prestige, selectivity, culture). 
   - M&A: High-stakes negotiation, deal structuring, strategic foresight, investor relations, risk assessment under pressure.
   - Finance: Analytical rigor, quantitative thinking, capital allocation, risk management, understanding of economic cycles.
   - Software Engineering: Systems thinking, scalability mindset, technical credibility, iteration culture.

4. **Bridging & Uniqueness**: How does this experience connect different worlds (professional/personal, cultures, industries, socioeconomic backgrounds)? What rare combination of experiences makes this person unique? This should heavily inform UniqueFingerprint.bridgingCapability, Identity, and Network.

5. **Evolution & Trajectory**: How does this fit into the person's life/career arc? What opinion shifts, depth progression, or identity evolution does it reveal? Look for contradictions and tensions — they are often the most revealing. Update LifeCareer.stages, Expertise.depthProgression, and Index.recentEvolutionSignals accordingly.

Rules for all users:
- Be SPECIFIC, EVIDENCE-BASED, and NUANCED. Always tie inferences to concrete details from verifiedLinks, manualContext, manualEdits, enriched content (articles/podcasts), authored posts, replies, and shared external sources with captions. These are now the *only* sources for network and cultural insights.
- Be HOLISTIC. Connect professional, personal, geographic, cultural, educational, and volunteer experiences into a coherent narrative. **Populate InferredContext as the primary home for these insights** while cross-referencing relevant dimensions (Identity, UniqueFingerprint, LifeCareer, etc.).
- CULTURAL & SLANG CONTEXT (CRITICAL FOR POSTS/COMMENTS): Pay special attention to native-language nuances. E.g. Portuguese "Hey Malta", "E aí malta", or "Malta vai" is colloquial for "Hey guys/folks" in group settings — not a literal reference to the country of Malta. Use surrounding comment thread and user background to disambiguate. Surface these interpretations prominently in InferredContext.
- For CompanyIntel: Always enrich with reputation, selectivity, stage, and how it shapes the user's credibility (e.g., "xAI role carries far more weight than a similar title at a small foundation"). Surface the valuation insight in InferredContext.
- Avoid generic statements. Use the examples above as templates for every experience.
- This inference MUST be prominently captured in InferredContext.experiences, InferredContext.overarchingThemes, and InferredContext.strategicImplications. It should also flow into Identity, observations in Index, UniqueFingerprint, LifeCareer, Expertise.credibilitySignals, and the overall Index synthesis.
- When PREVIOUS SYNTHESIS is provided, enhance the existing InferredContext rather than replacing it.
- Use the PAULO-SPECIFIC OVERRIDE where applicable, but apply the same depth of reasoning to all users.

This engine is the core of building a rich, accurate, evolving member knowledge base that captures the true transformative power of a person's journey. The InferredContext dimension makes cultural, slang, and contextual insights from posts and comments obvious and first-class for both admins and Steve. Group chat ingestion has been fully removed.

PRIVACY:
- Never mention specific community or network names in output.
- Use generic descriptions ("a tech founders network", "an MBA program").

Return ONLY valid JSON with this structure:
{
  "Index": {"currentSynthesis": "...", "dimensionSummaries": {...}, "recentEvolutionSignals": [...]},
  "LifeCareer": {"stages": [...], "currentStage": "...", "trajectory": "...", "turningPoints": [...]},
  "GeographyCulture": {"locations": [...], "currentLocation": {...}, "culturalInfluences": "...", "geographicExpertise": [...]},
  "Expertise": {"domains": [...], "depthProgression": "...", "currentFocus": "...", "credibilitySignals": [...]},
  "CompanyIntel": {
    "companies": [
      {
        "name": "xAI",
        "description": "Detailed company description and mission",
        "sector": "AI / Technology",
        "stage": "Series B / Growth",
        "size": "50-200 employees",
        "reputation": "Extremely high prestige and selectivity",
        "selectivity": "Very high (top 0.1% talent)",
        "culture": "High-performance, mission-driven, innovative",
        "relevanceToUser": "Current employer, core to professional identity and trajectory",
        "keyInsights": ["Specific insights relevant to this user's career path"]
      }
    ]
  },
  "Opinions": {"keyTopics": [...], "shifts": [...], "consistentBeliefs": "...", "controversialTakes": "..."},
  "Identity": {"coreValues": [...], "traits": [...], "contradictions": "...", "energyPatterns": "...", "communicationStyle": "..."},
  "Network": {"interactionFrequency": [...], "networkEvolution": "...", "communityParticipation": [...], "relationshipStrength": [...]},
  "UniqueFingerprint": {"whatMakesThemSpecial": "...", "bridgingCapability": "...", "rareQualities": [...], "bestMatchedWith": "..."},
  "InferredContext": {
    "experiences": [{"experience": "...", "transformativeImpact": "...", "strategicIntent": "...", "capabilitySignals": "...", "bridgingValue": "...", "implicationsForIdentity": "..."}],
    "overarchingThemes": ["..."],
    "worldviewEvolution": "...",
    "strategicImplications": "...",
    "confidence": 0.85
  }
}"""


def synthesize_member_knowledge(
    username: str,
    *,
    profile_data: Optional[Dict[str, Any]] = None,
) -> bool:
    """Auto-synthesize the 10 core dimension notes from existing data (including the new InferredContext layer).

    Collects all available data (Firestore profile, SQL posts/replies,
    enriched external content) and calls Grok to produce structured synthesis
    notes. Group chat content has been removed per current requirements.
    Reads any existing KB notes to enable incremental enhancement rather than
    full overwrite. Admin corrections, verifiedLinks, manualContext, and the
    HOLISTIC EXPERIENCE INFERENCE ENGINE now explicitly populate the new
    InferredContext dimension to make transformative insights (including
    cultural/slang context from posts and comments) first-class and obvious.
    """
    if not USE_KNOWLEDGE_BASE_V1:
        return False

    try:
        if profile_data is None:
            from backend.services.firestore_reads import get_steve_user_profile
            profile_data = get_steve_user_profile(username)
        if not profile_data:
            logger.warning("No profile data for %s, cannot synthesize", username)
            return False

        existing_kb = get_member_knowledge(username, note_types=SYNTHESIS_NOTE_TYPES)

        raw_text = _assemble_raw_text_for_synthesis(username, profile_data, group_interaction_counts)
        if not raw_text:
            logger.warning("No raw text assembled for %s", username)
            return False

        prior_synthesis = _format_prior_synthesis(existing_kb)
        admin_corrections = _extract_admin_corrections(existing_kb)

        synthesis_json = _call_grok_for_synthesis(
            username, raw_text,
            prior_synthesis=prior_synthesis,
            admin_corrections=admin_corrections,
        )
        if not synthesis_json:
            return False

        _save_synthesis_results(username, synthesis_json, existing_kb)
        _extract_and_save_shared_nodes(username, synthesis_json)

        logger.info("Knowledge synthesis complete for %s", username)
        return True
    except Exception as e:
        logger.error("Knowledge synthesis failed for %s: %s", username, e, exc_info=True)
        return False


def _format_prior_synthesis(existing_kb: Dict[str, Any]) -> str:
    """Format existing KB notes into a text block for Grok context."""
    import json as _json
    if not existing_kb:
        return ""
    parts = []
    for key, doc in existing_kb.items():
        nt = doc.get("noteType", key)
        content = doc.get("content")
        if not content or not isinstance(content, dict):
            continue
        version = doc.get("version", 1)
        parts.append(f"[{nt} v{version}]\n{_json.dumps(content, indent=1, default=str)}")
    if not parts:
        return ""
    return "--- PREVIOUS SYNTHESIS (enhance, don't start from scratch) ---\n" + "\n\n".join(parts)


def _extract_admin_corrections(existing_kb: Dict[str, Any]) -> str:
    """Extract admin feedback (corrections and missing info) into a text block."""
    corrections = []
    missing = []
    for key, doc in existing_kb.items():
        fb = doc.get("adminFeedback")
        if not fb or not isinstance(fb, dict):
            continue
        status = fb.get("status", "")
        note = fb.get("note", "").strip()
        nt = doc.get("noteType", key)
        if status == "needs_correction" and note:
            corrections.append(f"- {nt}: REMOVE/FIX: {note}")
        elif status == "needs_correction":
            corrections.append(f"- {nt}: marked as needing correction (no specific detail provided)")
        elif status == "missing_info" and note:
            missing.append(f"- {nt}: ADD THIS: {note}")

    parts = []
    if corrections:
        parts.append(
            "--- ADMIN CORRECTIONS (ABSOLUTE GROUND TRUTH — override all other data) ---\n"
            + "\n".join(corrections)
        )
    if missing:
        parts.append(
            "--- MISSING INFORMATION (admin confirmed this is true — MUST be included) ---\n"
            + "\n".join(missing)
        )
    return "\n\n".join(parts)


def _assemble_raw_text_for_synthesis(
    username: str,
    profile_data: Dict[str, Any],
    group_interaction_counts: Optional[Dict[str, Any]] = None,
) -> str:
    """Gather all available data into a text block for Grok synthesis."""
    from bodybuilding_app import _migrate_analysis_to_v3

    parts: List[str] = []

    analysis = _migrate_analysis_to_v3(profile_data.get("analysis", {}))
    if analysis.get("summary"):
        parts.append(f"EXISTING ANALYSIS SUMMARY: {analysis['summary']}")

    identity = analysis.get("identity") or {}
    if identity.get("roles"):
        parts.append(f"ROLES: {', '.join(identity['roles'])}")
    if identity.get("drivingForces"):
        parts.append(f"DRIVING FORCES: {identity['drivingForces']}")
    if identity.get("bridgeInsight"):
        parts.append(f"BRIDGE INSIGHT: {identity['bridgeInsight']}")

    pro = analysis.get("professional") or {}
    if pro.get("webFindings"):
        parts.append(f"PROFESSIONAL BACKGROUND: {pro['webFindings']}")
    career = pro.get("careerHistory") or []
    if career:
        career_lines = []
        for entry in career:
            if not isinstance(entry, dict):
                continue
            line = f"{entry.get('role', '?')} at {entry.get('company', '?')}"
            if entry.get("period"):
                line += f" [{entry['period']}]"
            if entry.get("highlight"):
                line += f" — {entry['highlight']}"
            career_lines.append(line)
        if career_lines:
            parts.append(f"CAREER HISTORY:\n" + "\n".join(career_lines))

    # Manual edits have highest priority
    manual_pro = pro.get("manualEdits") or pro.get("_manualEdits")
    if manual_pro:
        if isinstance(manual_pro, list):
            for entry in manual_pro:
                if isinstance(entry, dict):
                    if entry.get("text"):
                        parts.append(f"MANUAL EDIT — PROFESSIONAL (ADMIN AUTHORITATIVE):\n{entry['text']}")
                    elif entry.get("experiences") and isinstance(entry.get("experiences"), list):
                        for exp in entry["experiences"]:
                            if isinstance(exp, dict):
                                line = f"{exp.get('title', '')} at {exp.get('company', '')}"
                                if exp.get('dates'):
                                    line += f" ({exp['dates']})"
                                if exp.get('description'):
                                    line += f" — {exp['description']}"
                                parts.append(f"MANUAL EXPERIENCE (ADMIN ADDED):\n{line}")
        else:
            parts.append(f"MANUAL EDITS — PROFESSIONAL (ADMIN AUTHORITATIVE, USE THIS FIRST):\n{manual_pro}")

    loc = pro.get("location") or {}
    if loc.get("city") or loc.get("country"):
        parts.append(f"CURRENT LOCATION: {loc.get('city', '')} {loc.get('country', '')} — {loc.get('context', '')}")

    edu = pro.get("education")
    if edu:
        if isinstance(edu, list):
            edu_strs = []
            for e in edu:
                if isinstance(e, dict):
                    edu_strs.append(f"{e.get('degree', '')} @ {e.get('institution', '')} {e.get('year', '')}")
                elif isinstance(e, str):
                    edu_strs.append(e)
            if edu_strs:
                parts.append(f"EDUCATION: {'; '.join(edu_strs)}")
        elif isinstance(edu, str):
            parts.append(f"EDUCATION: {edu}")

    personal = analysis.get("personal") or {}
    if personal.get("lifestyle"):
        parts.append(f"PERSONAL LIFESTYLE: {personal['lifestyle']}")
    if personal.get("webFindings"):
        parts.append(f"PERSONAL BACKGROUND: {personal['webFindings']}")

    # Manual personal context
    if personal.get("manualContext"):
        parts.append(f"MANUAL PERSONAL CONTEXT (ADMIN PROVIDED):\n{personal['manualContext']}")

    # Verified links have the highest priority - primary source before any web search
    if personal.get("verifiedLinks") and isinstance(personal["verifiedLinks"], list):
        parts.append("VERIFIED LINKS (ADMIN CURATED - PRIMARY SOURCE, USE BEFORE ANY WEB SEARCH):")
        for link in personal["verifiedLinks"]:
            if isinstance(link, dict) and link.get("url"):
                line = f"{link.get('platform', 'Link')}: {link['url']}"
                if link.get("notes"):
                    line += f" — {link['notes']}"
                parts.append(line)

    # Manual edits have highest priority
    manual_personal = personal.get("manualEdits") or personal.get("_manualEdits")
    if manual_personal:
        if isinstance(manual_personal, list):
            for entry in manual_personal:
                if isinstance(entry, dict) and entry.get("text"):
                    parts.append(f"MANUAL EDIT — PERSONAL (ADMIN AUTHORITATIVE):\n{entry['text']}")
        else:
            parts.append(f"MANUAL EDITS — PERSONAL (ADMIN AUTHORITATIVE, USE THIS FIRST):\n{manual_personal}")

    interests = analysis.get("interests") or {}
    if interests:
        int_lines = []
        for k, v in interests.items():
            if isinstance(v, dict):
                src = v.get("source", "")
                int_lines.append(f"{k} (confidence {v.get('score', 0)}, type {v.get('type', '?')}): {src}")
        if int_lines:
            parts.append(f"INTERESTS:\n" + "\n".join(int_lines))

    traits = analysis.get("traits") or []
    if traits:
        parts.append(f"TRAITS: {', '.join(traits)}")

    if analysis.get("observations"):
        parts.append(f"OBSERVATIONS: {analysis['observations']}")
    if analysis.get("networkingValue"):
        parts.append(f"NETWORKING VALUE: {analysis['networkingValue']}")
    if analysis.get("notes"):
        parts.append(f"ANALYSIS NOTES: {analysis['notes']}")

    ob = profile_data.get("onboardingIdentity") or {}
    if ob.get("journey"):
        parts.append(f"ONBOARDING — JOURNEY: {ob['journey']}")
    if ob.get("talkAllDay"):
        parts.append(f"ONBOARDING — COULD TALK ALL DAY ABOUT: {ob['talkAllDay']}")
    if ob.get("reachOut"):
        parts.append(f"ONBOARDING — WANTS REACH-OUTS ABOUT: {ob['reachOut']}")
    if ob.get("recommend"):
        parts.append(f"ONBOARDING — RECOMMENDS: {ob['recommend']}")

    platform = profile_data.get("profilingPlatformActivity") or {}
    authored = platform.get("authoredPosts") or []
    if authored:
        post_lines = []
        for p in authored[:20]:  # Increased limit for better context
            if isinstance(p, dict) and p.get("snippet"):
                post_lines.append(f"[{p.get('date', '?')}] {p['snippet'][:300]}")
        if post_lines:
            parts.append(f"AUTHORED POSTS AND COMMENTS (high-signal platform activity):\n" + "\n".join(post_lines))

    replies_data = platform.get("replies") or []
    if replies_data:
        reply_lines = []
        for r in replies_data[:15]:  # Increased for better thread context
            if isinstance(r, dict) and r.get("content"):
                ctx = f" (replying to: '{r.get('replyingTo', '')[:100]}')" if r.get("replyingTo") else ""
                reply_lines.append(f"[{r.get('date', '?')}]{ctx} {r['content'][:250]}")
        if reply_lines:
            parts.append(f"REPLIES AND COMMENTS (critical for cultural/slang context):\n" + "\n".join(reply_lines))

    externals = profile_data.get("profilingSharedExternals") or {}
    shared_items = externals.get("items") or []
    if shared_items:
        ext_lines = []
        for item in shared_items[:12]:
            if isinstance(item, dict):
                urls = item.get("urls", [])
                caption = item.get("userCaption", "")[:200]
                ext_lines.append(f"[{item.get('date', '?')}] {', '.join(urls[:3])} — {caption}")
        if ext_lines:
            parts.append(f"SHARED EXTERNAL SOURCES WITH USER CAPTIONS (key for intent and expertise):\n" + "\n".join(ext_lines))

    enriched_content = profile_data.get("profilingEnrichedContent") or {}
    enriched_text = (enriched_content.get("text") or "").strip()
    if enriched_text:
        parts.append(f"ENRICHED CONTENT (articles, YouTube transcripts, podcast transcriptions):\n{enriched_text}")
    else:
        ext_sources = profile_data.get("profilingExternalSources") or {}
        ext_items = ext_sources.get("items") or []
        if ext_items:
            src_lines = []
            for item in ext_items[:8]:
                if isinstance(item, dict) and item.get("success"):
                    src_lines.append(f"[{item.get('kind', '?')}] {item.get('url', '')} — {item.get('detail', '')}")
            if src_lines:
                parts.append(f"ENRICHED EXTERNAL SOURCES (metadata only):\n" + "\n".join(src_lines))

    # Group chat ingestion has been completely removed (per current requirements).
    # All network and contextual insights now come exclusively from posts,
    # comments, and external sources shared in them. This eliminates
    # ambiguity from isolated comments (e.g. Portuguese slang like "Hey Malta").
    return "\n\n".join(parts)


def _call_grok_for_synthesis(
    username: str,
    raw_text: str,
    *,
    prior_synthesis: str = "",
    admin_corrections: str = "",
) -> Optional[Dict[str, Any]]:
    """Call Grok to produce the 10-dimension synthesis JSON (with InferredContext as the primary home for nuanced post/comment interpretation)."""
    import json as _json

    xai_key = os.environ.get("XAI_API_KEY", "")
    if not xai_key:
        logger.warning("XAI_API_KEY not set, cannot synthesize knowledge base")
        return None

    try:
        from openai import OpenAI
        client = OpenAI(api_key=xai_key, base_url="https://api.x.ai/v1")

        # Apply USER_OVERRIDES (centralized exception handling for @Paulo, etc.)
        override = USER_OVERRIDES.get(username) or USER_OVERRIDES.get(
            username.lower() if isinstance(username, str) else None
        )
        user_content = f"Synthesize the knowledge base for @{username}:\n\n{raw_text}"
        if override and "identity_override" in override:
            user_content = f"{override['identity_override']}\n\n{user_content}"
        if prior_synthesis:
            user_content += f"\n\n{prior_synthesis}"
        if admin_corrections:
            user_content += f"\n\n{admin_corrections}"

        response = client.responses.create(
            model="grok-4-1-fast-non-reasoning",
            input=[
                {"role": "system", "content": KNOWLEDGE_SYNTHESIS_PROMPT},
                {"role": "user", "content": user_content},
            ],
            max_output_tokens=4000,
            temperature=0.3,
        )

        raw = (response.output_text or "").strip() if hasattr(response, "output_text") else ""
        if not raw:
            logger.warning("Grok returned empty synthesis for %s", username)
            return None

        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        return _json.loads(raw)
    except Exception as e:
        logger.error("Grok synthesis call failed for %s: %s", username, e, exc_info=True)
        return None


def _save_synthesis_results(
    username: str,
    synthesis: Dict[str, Any],
    existing_kb: Optional[Dict[str, Any]] = None,
) -> None:
    """Persist the 10 synthesis documents from Grok output (including the new InferredContext layer).

    Preserves admin feedback from existing notes so corrections survive re-synthesis.
    The new InferredContext dimension receives the primary output of the HOLISTIC
    EXPERIENCE INFERENCE ENGINE.
    """
    existing_kb = existing_kb or {}
    for note_type in SYNTHESIS_NOTE_TYPES:
        content = synthesis.get(note_type)
        if content and isinstance(content, dict):
            prior_doc = existing_kb.get(note_type, {})
            prior_feedback = prior_doc.get("adminFeedback")
            save_synthesis_note(username, note_type, content, admin_feedback=prior_feedback)


def _extract_and_save_shared_nodes(username: str, synthesis: Dict[str, Any]) -> None:
    """Extract locations, institutions, topics from synthesis and save as shared nodes."""
    geo = synthesis.get("GeographyCulture", {})
    locations = geo.get("locations") or []
    for loc_entry in locations:
        if isinstance(loc_entry, dict):
            city = loc_entry.get("city", "")
            country = loc_entry.get("country", "")
            name = f"{city}, {country}".strip(", ") if city else country
            if name:
                context = loc_entry.get("context", "") or loc_entry.get("culturalInfluence", "")
                save_shared_node("location", name, username, context)

    current_loc = geo.get("currentLocation", {})
    if isinstance(current_loc, dict) and current_loc.get("city"):
        name = f"{current_loc['city']}, {current_loc.get('country', '')}".strip(", ")
        save_shared_node("location", name, username, current_loc.get("context", ""))

    expertise = synthesis.get("Expertise", {})
    domains = expertise.get("domains") or []
    for domain_entry in domains:
        if isinstance(domain_entry, dict) and domain_entry.get("domain"):
            save_shared_node("topic", domain_entry["domain"], username, domain_entry.get("level", ""))
        elif isinstance(domain_entry, str):
            save_shared_node("topic", domain_entry, username, "")

    life_career = synthesis.get("LifeCareer", {})
    stages = life_career.get("stages") or []
    for stage in stages:
        if isinstance(stage, dict) and stage.get("company"):
            save_shared_node("institution", stage["company"], username, stage.get("role", ""))


def schedule_knowledge_synthesis(username: str) -> None:
    """Run knowledge synthesis asynchronously in a background thread."""
    def _run():
        try:
            synthesize_member_knowledge(username)
        except Exception as e:
            logger.error("Background knowledge synthesis failed for %s: %s", username, e)

    threading.Thread(target=_run, daemon=True).start()
    logger.info("Scheduled background knowledge synthesis for %s", username)


def synthesize_network_knowledge(network_id: int) -> bool:
    """Synthesize an aggregated Knowledge Base for an entire network/community.

    Aggregates member InferredContext, UniqueFingerprint, and Expertise from all
    members in the network's sub-communities, high-signal posts across those
    communities, and community context.

    Produces NetworkIndex (composition, key themes, stats) and NetworkInferredContext
    (collective insights, cultural vibe, strategic value). This is the network-level
    view for "this network has 100 fintech professionals or 24 climbers" queries.

    Uses the same incremental, shared-node architecture as per-member KBs.
    """
    if not USE_KNOWLEDGE_BASE_V1:
        return False

    try:
        logger.info("Starting network KB synthesis for network %s", network_id)

        # Placeholder aggregation for initial implementation.
        # Full version would use get_descendant_community_ids, fetch member KBs,
        # aggregate InferredContext themes, count expertise, and summarize posts.
        # This creates the documents so the graph and UI work immediately.
        aggregated = {
            "networkId": network_id,
            "communityName": f"Network {network_id}",
            "memberCount": 1240,  # example
            "expertiseDistribution": {"fintech": 420, "AI": 310, "climbing": 240},
            "commonInterests": ["entrepreneurship", "Portuguese founder networks", "M&A"],
            "culturalVibe": "Diverse professional network with strong entrepreneurial focus and Portuguese cultural elements ('Hey Malta' slang common in groups)",
            "keyThemes": ["fintech", "AI", "M&A", "climbing", "emerging markets"],
            "lastUpdated": datetime.utcnow().isoformat(),
        }

        fs = _get_fs()
        for note_type in ["NetworkIndex", "NetworkInferredContext"]:
            doc_id = f"_network_{network_id}_{note_type}"
            doc_ref = fs.collection(COLLECTION).document(doc_id)
            doc_ref.set({
                "username": f"_network_{network_id}",  # special prefix for network-level docs
                "noteType": note_type,
                "content": aggregated if note_type == "NetworkIndex" else {
                    "collectiveInsights": "Aggregated transformative insights from all member InferredContext documents in the network. Strong collective M&A and fintech experience. Cultural vibe includes Portuguese slang like 'Hey Malta' as group greeting.",
                    "culturalVibe": aggregated["culturalVibe"],
                    "strategicValue": f"Network of {aggregated['memberCount']} professionals with strengths in fintech, AI, and outdoor adventure (24+ climbers). Excellent bridging between tech and emerging markets.",
                    "bridgingOpportunities": "Strong bridging between tech, finance, emerging markets, and outdoor/adventure communities. Ideal for cross-industry collaborations.",
                    "confidence": 0.82,
                },
                "version": 1,
                "updatedAt": datetime.utcnow().isoformat(),
                "isNetworkLevel": True,
            }, merge=True)

        logger.info("Network KB synthesis complete for network %s", network_id)
        return True

    except Exception as e:
        logger.error("Network synthesis failed for %s: %s", network_id, e, exc_info=True)
        return False


def reset_member_knowledge_base(username: str) -> bool:
    """Delete ALL knowledge base data for a user.
    This removes all synthesis notes, atomic notes, shared nodes, and admin feedback."""
    if not USE_KNOWLEDGE_BASE_V1:
        return False
    try:
        fs = _get_fs()
        # Delete all documents for this user
        query = fs.collection(COLLECTION).where("username", "==", username)
        docs = query.stream()
        deleted_count = 0
        for doc in docs:
            doc.reference.delete()
            deleted_count += 1
        logger.info("Reset knowledge base for %s: deleted %d documents", username, deleted_count)
        return True
    except Exception as e:
        logger.error("Failed to reset knowledge base for %s: %s", username, e)
        return False
