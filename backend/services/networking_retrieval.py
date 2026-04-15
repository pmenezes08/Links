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

_PLANNER_LEAD_PHRASES = (
    "looking for",
    "trying to find",
    "who should i meet",
    "who do you recommend",
    "anyone who",
    "someone who",
    "people who",
)

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

_GEOGRAPHY_ABBREVIATIONS = {
    "us": ("us", "usa", "united states", "america"),
    "usa": ("usa", "us", "united states", "america"),
    "united states": ("united states", "usa", "us", "america"),
    "uk": ("uk", "united kingdom", "britain", "england"),
}

KB_DIMENSIONS = (
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
)

_FACET_DIMENSION_MAP = {
    "geography": ("GeographyCulture", "InferredContext", "Index"),
    "industry": ("Expertise", "CompanyIntel", "LifeCareer", "Index"),
    "roles": ("LifeCareer", "Expertise", "CompanyIntel", "Index"),
    "company_builder": ("LifeCareer", "UniqueFingerprint", "CompanyIntel", "Identity"),
    "traits": ("Identity", "UniqueFingerprint", "Index"),
    "interests": ("Identity", "InferredContext", "UniqueFingerprint"),
    "experiences": ("InferredContext", "LifeCareer", "GeographyCulture", "UniqueFingerprint"),
    "identity_life_stage": ("Identity", "InferredContext", "UniqueFingerprint"),
}

_FACET_HARD_DIMENSION_MAP = {
    "geography": ("GeographyCulture",),
    "industry": ("Expertise",),
    "roles": ("LifeCareer",),
    "company_builder": ("LifeCareer",),
    "traits": ("Identity",),
    "interests": ("Identity",),
    "experiences": ("InferredContext",),
    "identity_life_stage": ("Identity",),
}

_FACET_STRUCTURED_DIMENSION_MAP = {
    "geography": ("GeographyCulture",),
    "industry": ("Expertise", "CompanyIntel"),
    "roles": ("LifeCareer",),
    "company_builder": ("LifeCareer",),
    "traits": ("Identity",),
    "interests": ("Identity",),
    "experiences": ("InferredContext",),
    "identity_life_stage": ("Identity",),
}

_DIMENSION_WEIGHT = {
    "Index": 1.5,
    "LifeCareer": 1.25,
    "GeographyCulture": 1.25,
    "Expertise": 1.25,
    "CompanyIntel": 1.1,
    "Opinions": 1.0,
    "Identity": 1.2,
    "Network": 0.95,
    "UniqueFingerprint": 1.1,
    "InferredContext": 1.1,
}

_STRUCTURED_DIMENSION_FIELDS = {
    "Index": ("city", "country", "industry", "role", "company", "interests", "profile_location", "professional_about", "bio"),
    "LifeCareer": ("role", "company", "professional_about", "bio", "industry"),
    "GeographyCulture": ("city", "country", "profile_location", "bio", "professional_about"),
    "Expertise": ("industry", "role", "interests", "professional_about", "bio", "company"),
    "CompanyIntel": ("company", "industry", "professional_about", "bio"),
    "Opinions": ("bio", "professional_about", "interests"),
    "Identity": ("bio", "interests", "professional_about", "company", "role"),
    "Network": ("interests", "bio", "professional_about"),
    "UniqueFingerprint": ("bio", "professional_about", "company", "role", "interests"),
    "InferredContext": ("bio", "interests", "professional_about", "profile_location", "company"),
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


def _normalize_dimension_list(values: Any) -> list[str]:
    if values is None:
        return []
    if isinstance(values, str):
        values = [values]
    out: list[str] = []
    for value in values or []:
        raw = str(value or "").strip()
        if raw in KB_DIMENSIONS and raw not in out:
            out.append(raw)
    return out


def _normalize_constraint_keys(values: Any) -> list[str]:
    if values is None:
        return []
    if isinstance(values, str):
        values = [values]
    out: list[str] = []
    for value in values or []:
        key = str(value or "").strip()
        if key and key not in out:
            out.append(key)
    return out


def _dimension_terms_from_facets(query_plan: dict[str, Any] | None) -> dict[str, list[str]]:
    out = {dimension: [] for dimension in KB_DIMENSIONS}
    if not isinstance(query_plan, dict):
        return out
    facets = query_plan.get("facets") or {}
    if not isinstance(facets, dict):
        return out
    for facet, dimensions in _FACET_STRUCTURED_DIMENSION_MAP.items():
        terms = _normalize_phrase_list(facets.get(facet))
        if facet == "geography":
            terms = _facet_terms_with_aliases("geography", terms)
        if not terms:
            continue
        for dimension in dimensions:
            out[dimension].extend(terms)
    return {dimension: _dedupe_keep_order(terms) for dimension, terms in out.items()}


def build_dimension_plan(query_plan: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """Build a KB-dimension retrieval plan from planner output."""
    if not isinstance(query_plan, dict):
        return None

    primary = _normalize_dimension_list(query_plan.get("primary_dimensions"))
    secondary = _normalize_dimension_list(query_plan.get("secondary_dimensions"))
    hard = _normalize_dimension_list(query_plan.get("hard_dimensions"))

    if not primary and not secondary:
        facets = query_plan.get("facets") or {}
        if isinstance(facets, dict):
            for facet, dimensions in _FACET_DIMENSION_MAP.items():
                if _normalize_phrase_list(facets.get(facet)):
                    for idx, dimension in enumerate(dimensions):
                        target = primary if idx < 2 else secondary
                        if dimension not in target:
                            target.append(dimension)

    if not primary and query_plan.get("search_rewrite"):
        primary = ["Index", "Expertise", "LifeCareer"]
        secondary = ["Identity", "UniqueFingerprint", "InferredContext"]

    if not hard:
        legacy_hard = _normalize_constraint_keys(query_plan.get("hard_constraints"))
        for facet in legacy_hard:
            for dimension in _FACET_HARD_DIMENSION_MAP.get(facet, _FACET_DIMENSION_MAP.get(facet, ())[:1]):
                if dimension not in hard:
                    hard.append(dimension)

    dimension_terms = _dimension_terms_from_facets(query_plan)
    fallback_terms = _query_keywords(_normalize_text(query_plan.get("search_rewrite") or ""))
    for dimension in primary + secondary + hard:
        if not dimension_terms.get(dimension):
            dimension_terms[dimension] = fallback_terms[:8]

    plan = {
        "primary_dimensions": _dedupe_keep_order(primary),
        "secondary_dimensions": [d for d in _dedupe_keep_order(secondary) if d not in primary],
        "hard_dimensions": _dedupe_keep_order(hard),
        "dimension_terms": {d: terms for d, terms in dimension_terms.items() if terms},
        "named_people": [str(v).strip() for v in (query_plan.get("named_people") or []) if str(v).strip()],
        "search_rewrite": str(query_plan.get("search_rewrite") or "").strip(),
        "needs_clarification": bool(query_plan.get("needs_clarification")),
        "clarifying_question": str(query_plan.get("clarifying_question") or "").strip(),
    }
    relevant = plan["primary_dimensions"] or plan["secondary_dimensions"] or plan["hard_dimensions"]
    return plan if relevant or plan["named_people"] or plan["search_rewrite"] else None


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
    if len(norm.split()) <= 5 and any(token in norm for token in ("more", "them", "him", "her", "those", "that")):
        return True
    return False


def _structural_constraint_count(message: str) -> int:
    text = str(message or "").strip().lower()
    if not text:
        return 0
    count = 0
    count += text.count(" and ")
    count += text.count(",")
    count += text.count(";")
    count += sum(text.count(token) for token in (" who ", " that ", " with ", " in ", " from "))
    return count


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
    if keyword_count >= 3 and any(norm.startswith(prefix) for prefix in _PLANNER_LEAD_PHRASES):
        return True
    if _structural_constraint_count(message) >= 2 and keyword_count >= 3:
        return True
    if keyword_count >= 7:
        return True
    return False


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
    for term in _normalize_phrase_list(list(terms)):
        expanded.append(term)
        if facet == "geography":
            expanded.extend(_normalize_phrase_list(list(_GEOGRAPHY_ABBREVIATIONS.get(term, ()))))
    return _dedupe_keep_order(expanded)


def _match_any_terms(blob: str, terms: Sequence[str]) -> int:
    return sum(1 for term in terms if _contains_term(blob, term))


def _structured_dimension_texts_from_row(
    row: Any,
    getter: Callable[[Any, int], Any],
) -> dict[str, str]:
    fields = {
        "city": _row_value(row, getter, 3),
        "country": _row_value(row, getter, 4),
        "industry": _row_value(row, getter, 5),
        "role": _row_value(row, getter, 6),
        "company": _row_value(row, getter, 7),
        "interests": _row_value(row, getter, 8),
        "profile_location": _row_value(row, getter, 9),
        "professional_about": _row_value(row, getter, 10),
        "bio": _row_value(row, getter, 2),
    }
    texts: dict[str, str] = {}
    for dimension, field_names in _STRUCTURED_DIMENSION_FIELDS.items():
        texts[dimension] = _normalize_text(" ".join(fields.get(field, "") for field in field_names))
    return texts


def _dimension_terms_for_plan(dimension_plan: dict[str, Any], dimension: str) -> list[str]:
    terms = _normalize_phrase_list((dimension_plan.get("dimension_terms") or {}).get(dimension))
    if terms:
        return terms
    return _query_keywords(_normalize_text(dimension_plan.get("search_rewrite") or ""))[:8]


def _structured_match_details_from_plan(
    member_rows: Sequence[Any],
    getter: Callable[[Any, int], Any],
    *,
    retrieval_plan: dict[str, Any],
    cap: int = 120,
) -> dict[str, dict[str, Any]]:
    dimension_plan = build_dimension_plan(retrieval_plan) or {}
    primary_dimensions = dimension_plan.get("primary_dimensions") or []
    secondary_dimensions = dimension_plan.get("secondary_dimensions") or []
    hard_dimensions = set(dimension_plan.get("hard_dimensions") or [])
    relevant_dimensions = _dedupe_keep_order(primary_dimensions + secondary_dimensions + list(hard_dimensions))
    if not relevant_dimensions:
        return {}
    details: dict[str, dict[str, Any]] = {}
    for row in member_rows:
        username = _row_value(row, getter, 0).strip()
        if not username:
            continue
        dimension_texts = _structured_dimension_texts_from_row(row, getter)
        dimension_scores: dict[str, float] = {}
        for dimension in relevant_dimensions:
            terms = _dimension_terms_for_plan(dimension_plan, dimension)
            if not terms:
                continue
            hits = _match_any_terms(dimension_texts.get(dimension, ""), terms)
            if hits:
                dimension_scores[dimension] = hits * _DIMENSION_WEIGHT.get(dimension, 1.0)

        matched_dimensions = {dimension for dimension, score in dimension_scores.items() if score > 0}
        if not matched_dimensions:
            continue
        hard_hits = sum(1 for dimension in hard_dimensions if dimension in matched_dimensions)
        hard_misses = sum(1 for dimension in hard_dimensions if dimension not in matched_dimensions)
        primary_hits = sum(1 for dimension in primary_dimensions if dimension in matched_dimensions)
        secondary_hits = sum(1 for dimension in secondary_dimensions if dimension in matched_dimensions)
        score = (
            sum(dimension_scores.values())
            + primary_hits * 3.0
            + secondary_hits * 1.25
            + hard_hits * 5.0
            - hard_misses * 3.0
        )
        details[username] = {
            "username": username,
            "dimension_scores": dimension_scores,
            "matched_dimensions": matched_dimensions,
            "matched_dimensions_count": len(matched_dimensions),
            "hard_hits": hard_hits,
            "hard_misses": hard_misses,
            "primary_hits": primary_hits,
            "secondary_hits": secondary_hits,
            "structured_score": score,
            "semantic_score": 0.0,
            "metadata_score": 0.0,
            "score": score,
            "primary_dimensions": primary_dimensions,
            "secondary_dimensions": secondary_dimensions,
            "hard_dimensions": list(hard_dimensions),
            "match_sources": {"structured": True, "semantic": False},
        }
    if cap and len(details) > cap:
        ranked = sorted(
            details.values(),
            key=lambda item: (-item["hard_hits"], -item["primary_hits"], -item["matched_dimensions_count"], -item["score"], item["username"]),
        )[:cap]
        return {item["username"]: item for item in ranked}
    return details


def _structured_candidates_from_plan(
    member_rows: Sequence[Any],
    getter: Callable[[Any, int], Any],
    *,
    retrieval_plan: dict[str, Any],
    cap: int,
) -> list[str]:
    details = _structured_match_details_from_plan(
        member_rows,
        getter,
        retrieval_plan=retrieval_plan,
        cap=cap,
    )
    ranked = sorted(
        details.values(),
        key=lambda item: (-item["hard_hits"], -item["primary_hits"], -item["matched_dimensions_count"], -item["score"], item["username"]),
    )
    return [item["username"] for item in ranked[:cap]]


def structured_match_details(
    member_rows: Sequence[Any],
    getter: Callable[[Any, int], Any],
    *,
    retrieval_plan: dict[str, Any] | None = None,
    cap: int = 120,
) -> dict[str, dict[str, Any]]:
    if not retrieval_plan:
        return {}
    return _structured_match_details_from_plan(
        member_rows,
        getter,
        retrieval_plan=retrieval_plan,
        cap=cap,
    )


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


def networking_policy_for_size(member_count: int) -> dict[str, int]:
    """Tune retrieval and prompt caps by network size."""
    if member_count <= 40:
        return {
            "ann_recall_cap": max(20, member_count),
            "prompt_member_cap": max(10, member_count),
            "full_context_cap": max(10, member_count),
        }
    if member_count <= 100:
        return {
            "ann_recall_cap": member_count,
            "prompt_member_cap": min(60, member_count),
            "full_context_cap": min(18, member_count),
        }
    return {
        "ann_recall_cap": min(300, max(200, int(member_count * 0.25))),
        "prompt_member_cap": 40,
        "full_context_cap": 12,
    }


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


def semantic_match_details(
    query_text: str,
    all_usernames: Sequence[str],
    *,
    retrieval_plan: dict[str, Any] | None = None,
    k_recall: int = 200,
    k_final: int = 40,
) -> dict[str, dict[str, Any]]:
    """Return semantic evidence per user, preserving the best-matching chunk source."""
    from backend.services.embedding_service import (
        AGGREGATE_DIMENSION_MAP,
        search_similar_profiles_ranked_detailed,
    )

    usernames = _dedupe_keep_order([str(username).strip() for username in all_usernames if str(username).strip()])
    if not usernames:
        return {}
    target_k = min(max(k_recall, k_final), len(usernames))
    results = search_similar_profiles_ranked_detailed(query_text, usernames, k=target_k)
    dimension_plan = build_dimension_plan(retrieval_plan) or {}
    primary_dimensions = dimension_plan.get("primary_dimensions") or []
    secondary_dimensions = dimension_plan.get("secondary_dimensions") or []
    hard_dimensions = set(dimension_plan.get("hard_dimensions") or [])
    relevant_dimensions = set(primary_dimensions + secondary_dimensions + list(hard_dimensions))

    details: dict[str, dict[str, Any]] = {}
    for rank, result in enumerate(results, start=1):
        username = str(result.get("username") or "").strip()
        if not username:
            continue
        score = float(result.get("score") or 0.0)
        chunk_type = str(result.get("chunk_type") or "Index").strip()
        source_dimensions = list(AGGREGATE_DIMENSION_MAP.get(chunk_type, (chunk_type,)))
        dimension_scores: dict[str, float] = {}
        for dimension in source_dimensions:
            if dimension not in KB_DIMENSIONS:
                continue
            weight = 1.0
            if relevant_dimensions and dimension in relevant_dimensions:
                weight = 1.25
            elif relevant_dimensions:
                weight = 0.75
            dimension_scores[dimension] = score * weight

        matched_dimensions = {dimension for dimension, dim_score in dimension_scores.items() if dim_score > 0}
        details[username] = {
            "username": username,
            "dimension_scores": dimension_scores,
            "matched_dimensions": matched_dimensions,
            "matched_dimensions_count": len(matched_dimensions),
            "hard_hits": sum(1 for dimension in hard_dimensions if dimension in matched_dimensions),
            "hard_misses": 0,
            "primary_hits": sum(1 for dimension in primary_dimensions if dimension in matched_dimensions),
            "secondary_hits": sum(1 for dimension in secondary_dimensions if dimension in matched_dimensions),
            "structured_score": 0.0,
            "semantic_score": score + max(0.0, (target_k - rank) / max(target_k, 1)),
            "metadata_score": 0.0,
            "score": score,
            "primary_dimensions": primary_dimensions,
            "secondary_dimensions": secondary_dimensions,
            "hard_dimensions": list(hard_dimensions),
            "semantic_rank": rank,
            "best_chunk_type": chunk_type,
            "match_sources": {"structured": False, "semantic": True},
        }
    return details


def load_dimension_metadata_scores(
    usernames: Sequence[str],
    *,
    dimension_plan: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    """Load lightweight KB metadata signals for reranking."""
    try:
        from datetime import datetime, timezone
        from backend.services.steve_knowledge_base import get_member_knowledge
    except Exception:
        return {}

    dimensions = list(
        _dedupe_keep_order(
            (dimension_plan or {}).get("primary_dimensions", [])
            + (dimension_plan or {}).get("secondary_dimensions", [])
            + (dimension_plan or {}).get("hard_dimensions", [])
        )
    ) or list(KB_DIMENSIONS)

    def _parse_ts(value: Any) -> Any:
        raw = str(value or "").strip()
        if not raw:
            return None
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            return None

    now = datetime.now(timezone.utc)
    metadata_by_user: dict[str, dict[str, Any]] = {}
    for username in _dedupe_keep_order([str(u).strip() for u in usernames if str(u).strip()])[:80]:
        try:
            docs = get_member_knowledge(username, dimensions)
        except Exception:
            continue
        total_adjustment = 0.0
        dimension_adjustments: dict[str, float] = {}
        for dimension, doc in (docs or {}).items():
            if dimension not in dimensions or not isinstance(doc, dict):
                continue
            adjustment = 0.0
            updated_at = _parse_ts(doc.get("updatedAt"))
            feedback = doc.get("adminFeedback") or {}
            feedback_at = _parse_ts(feedback.get("at"))
            status = str(feedback.get("status") or "").strip().lower()
            if updated_at and (now - updated_at).days <= 365:
                adjustment += 0.05
            if status in {"needs_correction", "missing_info"} and feedback_at and (not updated_at or feedback_at > updated_at):
                adjustment -= 0.35
            if dimension == "InferredContext":
                content = doc.get("content") or {}
                try:
                    confidence = float(content.get("confidence"))
                except Exception:
                    confidence = None
                if confidence is not None:
                    if confidence < 0.35:
                        adjustment -= 0.2
                    elif confidence >= 0.75:
                        adjustment += 0.05
            if adjustment:
                dimension_adjustments[dimension] = adjustment
                total_adjustment += adjustment
        if dimension_adjustments or total_adjustment:
            metadata_by_user[username] = {
                "dimension_adjustments": dimension_adjustments,
                "total_adjustment": total_adjustment,
            }
    return metadata_by_user


def _merge_match_details(
    ordered_usernames: Sequence[str],
    *,
    structured_details: dict[str, dict[str, Any]] | None = None,
    semantic_details: dict[str, dict[str, Any]] | None = None,
    dimension_plan: dict[str, Any] | None = None,
    metadata_scores: dict[str, dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    metadata_scores = metadata_scores or {}
    for username in ordered_usernames:
        base = {"username": username}
        structured = (structured_details or {}).get(username, {})
        semantic = (semantic_details or {}).get(username, {})
        primary_dimensions = (
            (dimension_plan or {}).get("primary_dimensions")
            or structured.get("primary_dimensions")
            or semantic.get("primary_dimensions")
            or []
        )
        secondary_dimensions = (
            (dimension_plan or {}).get("secondary_dimensions")
            or structured.get("secondary_dimensions")
            or semantic.get("secondary_dimensions")
            or []
        )
        hard_dimensions = (
            (dimension_plan or {}).get("hard_dimensions")
            or structured.get("hard_dimensions")
            or semantic.get("hard_dimensions")
            or []
        )
        dimension_scores: dict[str, float] = {}
        for source in (structured, semantic):
            for dimension, score in (source.get("dimension_scores") or {}).items():
                dimension_scores[dimension] = dimension_scores.get(dimension, 0.0) + float(score or 0.0)
        matched_dimensions = {dimension for dimension, score in dimension_scores.items() if score > 0}
        metadata_score = float((metadata_scores.get(username) or {}).get("total_adjustment") or 0.0)
        primary_hits = sum(1 for dimension in primary_dimensions if dimension in matched_dimensions)
        secondary_hits = sum(1 for dimension in secondary_dimensions if dimension in matched_dimensions)
        hard_hits = sum(1 for dimension in hard_dimensions if dimension in matched_dimensions)
        hard_misses = sum(1 for dimension in hard_dimensions if dimension not in matched_dimensions)
        combined_score = (
            float(structured.get("structured_score") or 0.0) * _STRUCTURED_WEIGHT
            + float(semantic.get("semantic_score") or 0.0) * _SEMANTIC_WEIGHT
            + sum(dimension_scores.values()) * 0.35
            + metadata_score
        )
        merged[username] = {
            **base,
            "dimension_scores": dimension_scores,
            "matched_dimensions": matched_dimensions,
            "matched_dimensions_count": len(matched_dimensions),
            "primary_hits": primary_hits,
            "secondary_hits": secondary_hits,
            "hard_hits": hard_hits,
            "hard_misses": hard_misses,
            "structured_score": float(structured.get("structured_score") or 0.0),
            "semantic_score": float(semantic.get("semantic_score") or 0.0),
            "metadata_score": metadata_score,
            "score": combined_score,
            "primary_dimensions": primary_dimensions,
            "secondary_dimensions": secondary_dimensions,
            "hard_dimensions": list(hard_dimensions),
            "match_sources": {
                "structured": bool(structured),
                "semantic": bool(semantic),
            },
        }
    return merged


def _tiered_matches_from_details(
    ordered_usernames: Sequence[str],
    *,
    structured_details: dict[str, dict[str, Any]] | None = None,
    semantic_details: dict[str, dict[str, Any]] | None = None,
    dimension_plan: dict[str, Any] | None = None,
    metadata_scores: dict[str, dict[str, Any]] | None = None,
    forced_usernames: Sequence[str] = (),
    semantic_ids: Sequence[str] = (),
) -> dict[str, str]:
    details = _merge_match_details(
        ordered_usernames,
        structured_details=structured_details,
        semantic_details=semantic_details,
        dimension_plan=dimension_plan,
        metadata_scores=metadata_scores,
    )
    forced = set(_dedupe_keep_order([str(u).strip() for u in forced_usernames if str(u).strip()]))
    semantic_rank = {u: idx for idx, u in enumerate(semantic_ids, start=1)}
    tier_map: dict[str, str] = {}
    for username in ordered_usernames:
        info = details.get(username)
        if not info:
            if details:
                tier_map[username] = "broader" if username in forced else "discard"
            else:
                tier_map[username] = "broader" if username in forced else "direct"
            continue
        primary_dimensions = info.get("primary_dimensions") or []
        hard_dimensions = info.get("hard_dimensions") or []
        direct_required = len(hard_dimensions) if hard_dimensions else (2 if len(primary_dimensions) >= 2 else 1)
        if info.get("hard_misses", 0) == 0 and info.get("primary_hits", 0) >= max(1, direct_required):
            tier_map[username] = "direct"
        elif info.get("primary_hits", 0) > 0 or info.get("secondary_hits", 0) > 0:
            tier_map[username] = "broader"
        elif username in forced:
            tier_map[username] = "broader"
        elif semantic_rank.get(username, 10**9) <= 3 and len(primary_dimensions) <= 1:
            tier_map[username] = "broader"
        else:
            tier_map[username] = "discard"
    return tier_map


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


def tiered_roster(
    structured_ids: Sequence[str],
    semantic_ids: Sequence[str],
    *,
    cap: int = 40,
    forced_usernames: Sequence[str] = (),
    structured_details: dict[str, dict[str, Any]] | None = None,
    semantic_details: dict[str, dict[str, Any]] | None = None,
    dimension_plan: dict[str, Any] | None = None,
    metadata_scores: dict[str, dict[str, Any]] | None = None,
) -> tuple[list[str], dict[str, str]]:
    """Return the ordered shortlist plus direct/broader/discard tiers."""
    ordered = fuse_roster(
        structured_ids,
        semantic_ids,
        cap=cap,
        forced_usernames=forced_usernames,
    )
    tier_map = _tiered_matches_from_details(
        ordered,
        structured_details=structured_details,
        semantic_details=semantic_details,
        dimension_plan=dimension_plan,
        metadata_scores=metadata_scores,
        forced_usernames=forced_usernames,
        semantic_ids=semantic_ids,
    )
    merged_details = _merge_match_details(
        ordered,
        structured_details=structured_details,
        semantic_details=semantic_details,
        dimension_plan=dimension_plan,
        metadata_scores=metadata_scores,
    )
    directs = sorted(
        [u for u in ordered if tier_map.get(u) == "direct"],
        key=lambda username: -float((merged_details.get(username) or {}).get("score") or 0.0),
    )
    broaders = sorted(
        [u for u in ordered if tier_map.get(u) == "broader"],
        key=lambda username: -float((merged_details.get(username) or {}).get("score") or 0.0),
    )
    final_order = (directs + broaders)[:cap]
    return final_order, {u: tier_map.get(u, "discard") for u in final_order}

