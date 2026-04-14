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


def _row_value(row: Any, getter: Callable[[Any, int], Any], idx: int) -> str:
    try:
        return str(getter(row, idx) or "")
    except Exception:
        return ""


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
) -> list[str]:
    """Return a structured roster ranking from SQL-loaded member rows.

    This intentionally only activates when the ask looks structured enough
    to benefit from metadata/keyword filtering (for example a location or
    an industry/domain cue present in the query).
    """

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
) -> list[str]:
    """Fuse structured and semantic rankings into one ordered shortlist."""

    structured = _dedupe_keep_order([str(username).strip() for username in structured_ids if str(username).strip()])
    semantic = _dedupe_keep_order([str(username).strip() for username in semantic_ids if str(username).strip()])

    if not structured:
        return semantic[:cap]
    if not semantic:
        return structured[:cap]

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
    return ranked[:cap]

