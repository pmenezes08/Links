"""Unit tests for cadence-aligned news roundup recency (no LLM calls)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from backend.services.content_generation.ideas import news_roundup
from backend.services.content_generation.ideas.roundup_format import (
    filter_section_items,
    filter_sources,
    news_recency_min_date_for_job,
    news_recency_prompt_clause,
    parse_publication_date,
)
from backend.services.content_generation.llm import NEWS_PUBLIC_DOMAINS


def test_parse_publication_date_iso():
    assert parse_publication_date("2026-04-14") == date(2026, 4, 14)
    assert parse_publication_date("Posted 2026-04-14 online") == date(2026, 4, 14)


def test_parse_publication_date_human():
    assert parse_publication_date("14 Apr 2026") == date(2026, 4, 14)


def test_news_recency_min_date_weekly():
    ref = datetime(2026, 5, 16, 12, 0, 0, tzinfo=timezone.utc)
    job = {"schedule": {"cadence": "weekly"}, "timezone": "UTC"}
    min_d, tz, cadence = news_recency_min_date_for_job(job, ref_utc=ref)
    assert tz == "UTC"
    assert cadence == "weekly"
    assert min_d == date(2026, 5, 9)


def test_news_recency_min_date_biweekly():
    ref = datetime(2026, 5, 16, 12, 0, 0, tzinfo=timezone.utc)
    job = {"schedule": {"cadence": "biweekly"}, "timezone": "UTC"}
    min_d, _, cadence = news_recency_min_date_for_job(job, ref_utc=ref)
    assert cadence == "biweekly"
    assert min_d == date(2026, 5, 2)


def test_news_recency_min_date_monthly():
    ref = datetime(2026, 5, 16, 12, 0, 0, tzinfo=timezone.utc)
    job = {"schedule": {"cadence": "monthly"}, "timezone": "UTC"}
    min_d, _, cadence = news_recency_min_date_for_job(job, ref_utc=ref)
    assert cadence == "monthly"
    assert min_d == date(2026, 4, 16)


def test_news_recency_min_date_daily():
    ref = datetime(2026, 5, 16, 12, 0, 0, tzinfo=timezone.utc)
    job = {"schedule": {"cadence": "daily"}, "timezone": "UTC"}
    min_d, _, cadence = news_recency_min_date_for_job(job, ref_utc=ref)
    assert cadence == "daily"
    assert min_d == date(2026, 5, 14)


def test_news_recency_fallback_unknown_cadence_to_weekly_span():
    ref = datetime(2026, 5, 16, 12, 0, 0, tzinfo=timezone.utc)
    job = {"schedule": {"cadence": "nope"}, "timezone": "UTC"}
    min_d, _, _ = news_recency_min_date_for_job(job, ref_utc=ref)
    assert min_d == date(2026, 5, 9)


def test_news_recency_invalid_timezone_falls_back_utc():
    ref = datetime(2026, 5, 16, 12, 0, 0, tzinfo=timezone.utc)
    job = {"schedule": {"cadence": "weekly"}, "timezone": "Not/AZone"}
    _, tz, _ = news_recency_min_date_for_job(job, ref_utc=ref)
    assert tz == "UTC"


def test_news_recency_prompt_clause_contains_iso_and_tz():
    clause = news_recency_prompt_clause(date(2026, 5, 9), "America/New_York", "weekly")
    assert "2026-05-09" in clause
    assert "America/New_York" in clause


def test_filter_section_items_drops_parseable_old_for_min_date():
    sections = [
        {
            "title": "World",
            "items": [
                {
                    "title": "Old",
                    "url": "https://www.reuters.com/article/old",
                    "outlet": "Reuters",
                    "published_date": "2020-01-05",
                    "why_it_matters": "x",
                    "key_stat": "",
                    "source_label": "old",
                },
                {
                    "title": "Fresh",
                    "url": "https://www.reuters.com/article/fresh",
                    "outlet": "Reuters",
                    "published_date": "2026-05-10",
                    "why_it_matters": "y",
                    "key_stat": "",
                    "source_label": "fresh",
                },
            ],
        }
    ]
    out = filter_section_items(
        sections,
        NEWS_PUBLIC_DOMAINS,
        min_publication_date=date(2026, 5, 9),
    )
    assert len(out) == 1
    assert len(out[0]["items"]) == 1
    assert out[0]["items"][0]["title"] == "Fresh"


def test_filter_sources_respects_min_publication_date():
    rows = [
        {
            "title": "Old",
            "outlet": "Reuters",
            "published_date": "2020-01-01",
            "url": "https://www.reuters.com/a",
        },
        {
            "title": "New",
            "outlet": "Reuters",
            "published_date": "2026-05-15",
            "url": "https://www.reuters.com/b",
        },
    ]
    out = filter_sources(rows, NEWS_PUBLIC_DOMAINS, min_publication_date=date(2026, 5, 9))
    assert len(out) == 1
    assert out[0]["title"] == "New"


def test_news_roundup_raises_when_structured_sections_all_recency_filtered(monkeypatch):
    def _fake_generate(*_a, **_k):
        return {
            "hook": "h",
            "sections": [
                {
                    "title": "World",
                    "items": [
                        {
                            "title": "Old story",
                            "url": "https://www.reuters.com/foo",
                            "outlet": "Reuters",
                            "published_date": "2021-06-01",
                            "why_it_matters": "Because",
                            "key_stat": "",
                            "source_label": "old",
                        }
                    ],
                }
            ],
            "cta": "Thoughts?",
            "sources": [],
            "source_links": ["https://www.reuters.com/foo"],
        }

    monkeypatch.setattr(news_roundup, "generate_web_search_json", _fake_generate)
    far_future = date.today() + timedelta(days=365 * 5)

    def _fixed_recency(_job):
        return far_future, "UTC", "weekly"

    monkeypatch.setattr(news_roundup, "news_recency_min_date_for_job", _fixed_recency)
    monkeypatch.setattr(
        news_roundup,
        "news_recency_prompt_clause",
        lambda *a, **k: "RECENCY (test)",
    )

    job = {
        "community_id": 0,
        "schedule": {"cadence": "weekly"},
        "timezone": "UTC",
        "payload": {"topic_mode": "manual", "topic": "Widgets"},
    }
    with pytest.raises(ValueError, match="recency window"):
        news_roundup.execute(job)


def test_job_schedule_normalize_cadence_daily():
    from backend.services.content_generation.job_schedule import normalize_cadence

    assert normalize_cadence("daily") == "daily"
    assert normalize_cadence("DAILY") == "daily"
