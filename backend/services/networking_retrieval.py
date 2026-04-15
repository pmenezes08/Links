"""Hybrid retrieval helpers for Steve networking roster selection.

This module keeps the retrieval logic deterministic and cheap:

- Structured pass: use metadata-like fields already loaded from SQL.
- Semantic pass: reuse the FAISS embedding search over the same roster.
- Fusion: merge both rankings into a single ordered shortlist for prompting.
"""

from __future__ import annotations

import re
from typing import Any, Callable, Iterable, Sequence


_RRF_K = 60
_STRUCTURED_WEIGHT = 1.75
_SEMANTIC_WEIGHT = 1.0

_STOPWORDS = {
    "about",
    "after",
    "against",
    "all",
    "also",
    "and",
    "anyone",
    "around",
    "because",
    "been",
    "best",
    "between",
    "could",
    "does",
    "find",
    "from",
    "have",
    "help",
    "into",
    "just",
    "like",
    "live",
    "lives",
    "many",
    "match",
    "matches",
    "more",
    "need",
    "network",
    "people",
    "person",
    "someone",
    "that",
    "their",
    "them",
    "there",
    "these",
    "they",
    "this",
    "those",
    "want",
    "what",
    "when",
    "where",
    "which",
    "who",
    "with",
    "would",
    "years",
    "your",
}

_FOLLOW_UP_PREFIXES = (
    "what about",
    "how about",
    "and what about",
    "and how about",
    "tell me more about",
    "more on",
    "what about @",
)

_FOLLOW_UP_EXACT = {
    "him",
    "her",
    "them",
    "that person",
    "that one",
    "those people",
}

_INDUSTRY_ALIASES = {
    "tech": (
        "tech",
        "technology",
        "software",
        "saas",
        "engineering",
        "developer",
        "developers",
        "product",
        "data",
        "cloud",
        "ai",
        "artificial intelligence",
        "machine learning",
        "google cloud",
        "startup tech",
    ),
    "healthcare": (
        "healthcare",
        "health care",
        "health-tech",
        "health tech",
        "biotech",
        "medical",
        "medicine",
        "pharma",
        "hospital",
    ),
    "finance": (
        "finance",
        "financial",
        "fintech",
        "banking",
        "investment",
        "investing",
        "private equity",
        "venture capital",
    ),
    "legal": (
        "legal",
        "law",
        "lawyer",
        "attorney",
        "compliance",
    ),
    "marketing": (
        "marketing",
        "brand",
        "branding",
        "growth",
        "demand gen",
    ),
}

_FACET_ALIAS_MAP = {
    "geography": {
        "us": ("us", "usa", "united states", "america"),
        "usa": ("usa", "us", "united states", "america"),
        "united states": ("united states", "usa", "us", "america"),
        "uk": ("uk", "united kingdom", "britain", "england"),
        "lisbon": ("lisbon", "lisboa", "portugal"),
    },
    "company_builder": {
        "founder": ("founder", "cofounder", "co-founder", "built a company", "started a company", "started their own company"),
        "created own company": ("created their own company", "created own company", "built their own company", "built a company", "founded a company", "started a company"),
        "entrepreneur": ("entrepreneur", "startup founder", "cofounder", "business owner"),
    },
    "traits": {
        "goal driven": ("goal driven", "goal-driven", "driven", "high agency", "ambitious"),
        "collaborative": ("collaborative", "team player", "works well with others"),
    },
    "identity_life_stage": {
        "parent": ("parent", "mother", "father", "mom", "dad", "kids", "children", "son", "daughter"),
    },
}


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip().lower()
    if not text:
        return ""
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _contains_term(haystack: str, needle: str) -> bool:
    if not haystack or not needle:
        return False
    return f" {needle} " in f" {haystack} "


def _dedupe_keep_order(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _normalize_phrase_list(values: Any) -> list[str]:
    if values is None:
        return []
    if isinstance(values, str):
        values = [values]
    out: list[str] = []
    for value in values or []:
        norm = _normalize_text(value)
        if norm:
            out.append(norm)
    return _dedupe_keep_order(out)


def _row_value(row: Any, getter: Callable[[Any, int], Any], idx: int) -> str:
    try:
        return str(getter(row, idx) or "")
    except Exception:
        return ""


def _history_user_messages(conversation_history: Any) -> list[str]:
    if not isinstance(conversation_history, list):
        return []
    out: list[str] = []
    for turn in conversation_history:
        if not isinstance(turn, dict):
            continue
        if str(turn.get("role") or "").strip().lower() != "user":
            continue
        content = str(turn.get("content") or "").strip()
        if content:
            out.append(content)
    return out


def _looks_like_follow_up(message: str) -> bool:
    norm = _normalize_text(message)
    if not norm:
        return False
    if any(norm.startswith(prefix) for prefix in _FOLLOW_UP_PREFIXES):
        return True
    if norm in _FOLLOW_UP_EXACT:
        return True
    if "@" in message:
        return True
    if len(norm.split()) <= 5 and any(token in norm for token in ("more", "them", "him", "her", "hugo")):
        return True
    return False


def should_use_reasoning_planner(message: str, conversation_history: Any = None) -> bool:
    """Use the extra planner only when the query is complex enough to justify it."""
    norm = _normalize_text(message)
    if not norm:
        return False
    if _looks_like_follow_up(message) and _history_user_messages(conversation_history):
        return True
    if "@" in message:
        return True
    keyword_count = len(_query_keywords(norm))
    if any(sep in message for sep in (",", ";")) and keyword_count >= 2:
        return True
    if " and " in norm and keyword_count >= 3:
        return True
    if any(term in norm for term in ("goal driven", "goal-driven", "founder", "parent", "climbing", "golf")):
        return True
    return keyword_count >= 6


def build_retrieval_query(message: str, conversation_history: Any = None, query_plan: dict[str, Any] | None = None) -> str:
    """Build a retrieval-oriented query, preserving follow-up context when needed."""
    current = str((query_plan or {}).get("search_rewrite") or message or "").strip()
    if not current:
        return ""
    prior_user_messages = _history_user_messages(conversation_history)
    if not _looks_like_follow_up(message) or not prior_user_messages:
        return current
    prior_context = prior_user_messages[-2:]
    merged = " ".join(m for m in prior_context + [current] if str(m).strip())
    return re.sub(r"\s+", " ", merged).strip()


def resolve_named_people(
    member_rows: Sequence[Any],
    getter: Callable[[Any, int], Any],
    *,
    message: str = "",
    query_plan: dict[str, Any] | None = None,
) -> list[str]:
    """Resolve explicit names/@mentions to usernames so they are always evaluated."""
    by_username: dict[str, str] = {}
    by_display: dict[str, str] = {}
    for row in member_rows:
        username = _row_value(row, getter, 0).strip()
        display_name = _row_value(row, getter, 1).strip()
        if not username:
            continue
        uname_norm = _normalize_text(username)
        if uname_norm:
            by_username[uname_norm] = username
        display_norm = _normalize_text(display_name)
        if display_norm:
            by_display[display_norm] = username

    raw_names: list[str] = []
    raw_names.extend(re.findall(r"@([A-Za-z0-9_]{1,40})", message or ""))
    qp = query_plan or {}
    raw_names.extend(str(v).strip() for v in (qp.get("named_people") or []) if str(v).strip())

    resolved: list[str] = []
    for raw in raw_names:
        norm = _normalize_text(raw)
        if not norm:
            continue
        if norm in by_username:
            resolved.append(by_username[norm])
            continue
        if norm in by_display:
            resolved.append(by_display[norm])
            continue
        for display_norm, username in by_display.items():
            if norm in display_norm or display_norm in norm:
                resolved.append(username)
                break
    return _dedupe_keep_order(resolved)


def _plan_facet_terms(query_plan: dict[str, Any] | None, facet: str) -> list[str]:
    if not isinstance(query_plan, dict):
        return []
    facets = query_plan.get("facets") or {}
    if not isinstance(facets, dict):
        return []
    return _normalize_phrase_list(facets.get(facet))


def _facet_terms_with_aliases(facet: str, terms: Sequence[str]) -> list[str]:
    expanded: list[str] = []
    alias_map = _FACET_ALIAS_MAP.get(facet, {})
    for term in _normalize_phrase_list(list(terms)):
        expanded.append(term)
        aliases = alias_map.get(term, ())
        expanded.extend(_normalize_phrase_list(list(aliases)))
    return _dedupe_keep_order(expanded)


def _match_any_terms(blob: str, terms: Sequence[str]) -> int:
    return sum(1 for term in terms if _contains_term(blob, term))


def _structured_candidates_from_plan(
    member_rows: Sequence[Any],
    getter: Callable[[Any, int], Any],
    *,
    retrieval_plan: dict[str, Any],
    cap: int,
) -> list[str]:
    geography_terms = _facet_terms_with_aliases("geography", _plan_facet_terms(retrieval_plan, "geography"))
    industry_terms = _facet_terms_with_aliases("industry", _plan_facet_terms(retrieval_plan, "industry"))
    role_terms = _facet_terms_with_aliases("roles", _plan_facet_terms(retrieval_plan, "roles"))
    builder_terms = _facet_terms_with_aliases("company_builder", _plan_facet_terms(retrieval_plan, "company_builder"))
    trait_terms = _facet_terms_with_aliases("traits", _plan_facet_terms(retrieval_plan, "traits"))
    interest_terms = _facet_terms_with_aliases("interests", _plan_facet_terms(retrieval_plan, "interests"))
    experience_terms = _facet_terms_with_aliases("experiences", _plan_facet_terms(retrieval_plan, "experiences"))
    identity_terms = _facet_terms_with_aliases("identity_life_stage", _plan_facet_terms(retrieval_plan, "identity_life_stage"))
    hard_constraints = {term for term in _normalize_phrase_list(retrieval_plan.get("hard_constraints"))}

    has_any_requested_facet = any(
        (geography_terms, industry_terms, role_terms, builder_terms, trait_terms, interest_terms, experience_terms, identity_terms)
    )
    if not has_any_requested_facet:
        return []

    scored_rows: list[tuple[str, int, int, float]] = []
    for row in member_rows:
        username = _row_value(row, getter, 0).strip()
        if not username:
            continue
        city = _row_value(row, getter, 3)
        country = _row_value(row, getter, 4)
        industry = _row_value(row, getter, 5)
        role = _row_value(row, getter, 6)
        company = _row_value(row, getter, 7)
        interests = _row_value(row, getter, 8)
        profile_location = _row_value(row, getter, 9)
        professional_about = _row_value(row, getter, 10)
        bio = _row_value(row, getter, 2)

        location_blob = _normalize_text(" ".join([city, country, profile_location, bio, professional_about]))
        professional_blob = _normalize_text(" ".join([industry, role, company, interests, professional_about, bio]))
        general_blob = _normalize_text(" ".join([bio, interests, professional_about, company, role, industry, city, country, profile_location]))

        facet_matches = {
            "geography": _match_any_terms(location_blob, geography_terms),
            "industry": _match_any_terms(professional_blob, industry_terms),
            "roles": _match_any_terms(professional_blob, role_terms),
            "company_builder": _match_any_terms(professional_blob, builder_terms),
            "traits": _match_any_terms(general_blob, trait_terms),
            "interests": _match_any_terms(general_blob, interest_terms),
            "experiences": _match_any_terms(general_blob, experience_terms),
            "identity_life_stage": _match_any_terms(general_blob, identity_terms),
        }

        matched_facets = {facet for facet, score in facet_matches.items() if score > 0}
        if not matched_facets:
            continue

        hard_hits = sum(1 for facet in hard_constraints if facet in matched_facets)
        hard_misses = sum(1 for facet in hard_constraints if facet not in matched_facets)
        total_hits = sum(facet_matches.values())
        score = (
            hard_hits * 12.0
            - hard_misses * 3.5
            + facet_matches["geography"] * 6.0
            + facet_matches["industry"] * 5.0
            + facet_matches["roles"] * 4.0
            + facet_matches["company_builder"] * 5.5
            + facet_matches["traits"] * 3.5
            + facet_matches["interests"] * 3.5
            + facet_matches["experiences"] * 3.5
            + facet_matches["identity_life_stage"] * 4.0
        )
        scored_rows.append((username, hard_hits, len(matched_facets), score + total_hits * 0.25))

    ranked = sorted(scored_rows, key=lambda item: (-item[1], -item[2], -item[3], item[0]))
    return [username for username, _, _, _ in ranked[:cap]]


def _candidate_location_terms(member_rows: Sequence[Any], getter: Callable[[Any, int], Any]) -> list[str]:
    terms: set[str] = set()
    for row in member_rows:
        for idx in (3, 4, 9):  # city, country, profile/location text
            raw = _row_value(row, getter, idx)
            norm = _normalize_text(raw)
            if len(norm) >= 3:
                terms.add(norm)
            if idx == 9 and norm:
                for token in norm.split():
                    if len(token) >= 4 and token not in _STOPWORDS:
                        terms.add(token)
    return sorted(terms, key=lambda term: (-len(term), term))


def _matched_location_terms(message_norm: str, member_rows: Sequence[Any], getter: Callable[[Any, int], Any]) -> list[str]:
    matched: list[str] = []
    for term in _candidate_location_terms(member_rows, getter):
        if not _contains_term(message_norm, term):
            continue
        structured_phrases = (
            f"in {term}",
            f"from {term}",
            f"near {term}",
            f"around {term}",
            f"based in {term}",
            f"lives in {term}",
            f"live in {term}",
            f"located in {term}",
            f"living in {term}",
        )
        if any(phrase in message_norm for phrase in structured_phrases):
            matched.append(term)
    return matched


def _matched_industry_terms(message_norm: str, member_rows: Sequence[Any], getter: Callable[[Any, int], Any]) -> tuple[list[str], list[str]]:
    matched_groups = [
        canonical
        for canonical, aliases in _INDUSTRY_ALIASES.items()
        if any(_contains_term(message_norm, _normalize_text(alias)) for alias in aliases)
    ]

    dynamic_terms: set[str] = set()
    for row in member_rows:
        industry = _normalize_text(_row_value(row, getter, 5))
        if industry and _contains_term(message_norm, industry):
            dynamic_terms.add(industry)

    return matched_groups, sorted(dynamic_terms, key=lambda term: (-len(term), term))


def _query_keywords(message_norm: str) -> list[str]:
    keywords = []
    for token in message_norm.split():
        if len(token) < 4 or token in _STOPWORDS:
            continue
        keywords.append(token)
    return _dedupe_keep_order(keywords)


def structured_candidates(
    member_rows: Sequence[Any],
    message: str,
    getter: Callable[[Any, int], Any],
    *,
    cap: int = 120,
    retrieval_plan: dict[str, Any] | None = None,
) -> list[str]:
    """Return a structured roster ranking from SQL-loaded member rows.

    This intentionally only activates when the ask looks structured enough
    to benefit from metadata/keyword filtering (for example a location or
    an industry/domain cue present in the query).
    """

    if retrieval_plan:
        planned = _structured_candidates_from_plan(
            member_rows,
            getter,
            retrieval_plan=retrieval_plan,
            cap=cap,
        )
        if planned:
            return planned

    message_norm = _normalize_text(message)
    if not message_norm:
        return []

    location_terms = _matched_location_terms(message_norm, member_rows, getter)
    industry_groups, dynamic_industry_terms = _matched_industry_terms(message_norm, member_rows, getter)

    # Narrative asks like "ran the Boston marathon" should fall through to semantic.
    if not location_terms and not industry_groups and not dynamic_industry_terms:
        return []

    query_keywords = _query_keywords(message_norm)
    scored_rows: list[tuple[str, int, float]] = []

    for row in member_rows:
        username = _row_value(row, getter, 0).strip()
        if not username:
            continue

        location_blob = _normalize_text(
            " ".join(
                [
                    _row_value(row, getter, 3),  # city
                    _row_value(row, getter, 4),  # country
                    _row_value(row, getter, 9),  # profile/location text
                    _row_value(row, getter, 2),  # bio
                    _row_value(row, getter, 10),  # professional about
                ]
            )
        )
        professional_blob = _normalize_text(
            " ".join(
                [
                    _row_value(row, getter, 5),  # industry
                    _row_value(row, getter, 6),  # role
                    _row_value(row, getter, 7),  # company
                    _row_value(row, getter, 8),  # interests
                    _row_value(row, getter, 10),  # professional about
                    _row_value(row, getter, 2),  # bio
                ]
            )
        )

        matched_location = sum(1 for term in location_terms if _contains_term(location_blob, term))

        matched_industry = 0
        for canonical in industry_groups:
            aliases = [_normalize_text(alias) for alias in _INDUSTRY_ALIASES.get(canonical, (canonical,))]
            if any(_contains_term(professional_blob, alias) for alias in aliases):
                matched_industry += 1
        for term in dynamic_industry_terms:
            if _contains_term(professional_blob, term):
                matched_industry += 1

        if matched_location == 0 and matched_industry == 0:
            continue

        lexical_hits = sum(
            1
            for keyword in query_keywords
            if _contains_term(location_blob, keyword) or _contains_term(professional_blob, keyword)
        )
        matched_facets = int(matched_location > 0) + int(matched_industry > 0)
        score = (
            matched_facets * 10.0
            + matched_location * 6.0
            + matched_industry * 5.5
            + min(lexical_hits, 4) * 0.6
        )
        scored_rows.append((username, matched_facets, score))

    ranked = sorted(scored_rows, key=lambda item: (-item[1], -item[2], item[0]))
    return [username for username, _, _ in ranked[:cap]]


def semantic_candidates(
    query_text: str,
    all_usernames: Sequence[str],
    *,
    k_recall: int = 200,
    k_final: int = 40,
) -> list[str]:
    """Return the FAISS-ranked semantic roster for the given usernames."""

    from backend.services.embedding_service import search_similar_profiles_ranked

    usernames = _dedupe_keep_order([str(username).strip() for username in all_usernames if str(username).strip()])
    if not usernames:
        return []

    target_k = min(max(k_recall, k_final), len(usernames))
    ranked = search_similar_profiles_ranked(query_text, usernames, k=target_k)
    return [username for username, _ in ranked[:target_k]]


def fuse_roster(
    structured_ids: Sequence[str],
    semantic_ids: Sequence[str],
    *,
    cap: int = 40,
    rrf_k: int = _RRF_K,
    forced_usernames: Sequence[str] = (),
) -> list[str]:
    """Fuse structured and semantic rankings into one ordered shortlist."""

    structured = _dedupe_keep_order([str(username).strip() for username in structured_ids if str(username).strip()])
    semantic = _dedupe_keep_order([str(username).strip() for username in semantic_ids if str(username).strip()])

    forced = _dedupe_keep_order([str(username).strip() for username in forced_usernames if str(username).strip()])
    if not structured and not semantic:
        return forced[:cap]
    if not structured:
        ranked = semantic[:cap]
        return (forced + [u for u in ranked if u not in forced])[:cap]
    if not semantic:
        ranked = structured[:cap]
        return (forced + [u for u in ranked if u not in forced])[:cap]

    scores: dict[str, float] = {}
    first_rank: dict[str, tuple[int, int]] = {}

    for rank, username in enumerate(structured, start=1):
        scores[username] = scores.get(username, 0.0) + (_STRUCTURED_WEIGHT / (rrf_k + rank))
        first_rank.setdefault(username, (rank, 10**9))

    for rank, username in enumerate(semantic, start=1):
        scores[username] = scores.get(username, 0.0) + (_SEMANTIC_WEIGHT / (rrf_k + rank))
        s_rank = first_rank.get(username, (10**9, 10**9))[0]
        first_rank[username] = (s_rank, rank)

    intersection = set(structured) & set(semantic)
    for username in intersection:
        scores[username] += 0.05

    ranked = sorted(
        scores,
        key=lambda username: (
            -scores[username],
            first_rank.get(username, (10**9, 10**9))[0],
            first_rank.get(username, (10**9, 10**9))[1],
            username,
        ),
    )
    final_ranked = ranked[:cap]
    if forced:
        final_ranked = forced + [u for u in final_ranked if u not in forced]
    return final_ranked[:cap]

