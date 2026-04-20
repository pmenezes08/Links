"""Matrix B — ``backend.services.ai_usage`` counter correctness.

These tests lock down the three behaviours that were wrong until the
April 2026 bug-fix wave:

  1.  ``whisper_minutes_this_month`` must include every successful
      ``surface='whisper'`` row with a ``duration_seconds`` and ignore
      everything else (the bug was that the legacy DM upload path never
      logged a whisper row at all, so minutes stayed at 0).
  2.  ``daily_count`` must be scoped to :data:`STEVE_SURFACES` so the
      daily counter can never exceed the monthly one (the bug was that
      ``daily_count`` counted *any* AI call in the last 24h while
      ``monthly_steve_count`` filtered strictly by surface).
  3.  Blocked calls (``success=0``) never count against allowances.

Each test starts with a truncated DB (see ``conftest._clean_db``) and
inserts only the rows it cares about. Timestamps are fabricated with
:func:`tests.fixtures.hours_ago` / :func:`days_ago` so we don't depend
on wall-clock drift.
"""

from __future__ import annotations

import pytest

from backend.services import ai_usage
from backend.services.ai_usage import (
    SURFACE_CONTENT_GEN,
    SURFACE_DM,
    SURFACE_FEED,
    SURFACE_GROUP,
    SURFACE_POST_SUMMARY,
    SURFACE_VOICE_SUMMARY,
    SURFACE_WHISPER,
    daily_any_count,
    daily_count,
    monthly_steve_count,
    whisper_minutes_this_month,
)

from tests.fixtures import (
    days_ago,
    hours_ago,
    last_month_midpoint,
    log_row,
    log_rows,
    make_user,
)


# ── 1. Whisper minutes ──────────────────────────────────────────────────


class TestWhisperMinutes:
    """Regression net for the 'voice transcription shows 0 min' bug."""

    def test_single_whisper_row_counts_as_minutes(self, mysql_dsn):
        make_user("alice")
        log_row("alice", surface=SURFACE_WHISPER, duration_seconds=60.0)
        assert whisper_minutes_this_month("alice") == pytest.approx(1.0)

    def test_sums_across_rows(self, mysql_dsn):
        make_user("alice")
        # 1 minute + 10 seconds = 70s = 7/6 minutes.
        log_row("alice", surface=SURFACE_WHISPER, duration_seconds=60.0)
        log_row("alice", surface=SURFACE_WHISPER, duration_seconds=10.0)
        assert whisper_minutes_this_month("alice") == pytest.approx(70 / 60)

    def test_ignores_non_whisper_surfaces(self, mysql_dsn):
        """A voice_summary row must NOT add to whisper minutes.

        Voice notes always produce *two* rows (whisper + voice_summary);
        the summary row has no ``duration_seconds``, but let's verify
        explicitly that even a mis-logged summary row with a duration
        would still be ignored.
        """
        make_user("alice")
        log_row("alice", surface=SURFACE_VOICE_SUMMARY, duration_seconds=999.0)
        log_row("alice", surface=SURFACE_DM)
        assert whisper_minutes_this_month("alice") == 0.0

    def test_ignores_failed_whisper_calls(self, mysql_dsn):
        make_user("alice")
        log_row("alice", surface=SURFACE_WHISPER, duration_seconds=120.0,
                success=False, reason_blocked="api_error")
        log_row("alice", surface=SURFACE_WHISPER, duration_seconds=30.0)
        assert whisper_minutes_this_month("alice") == pytest.approx(30 / 60)

    def test_ignores_last_month_rows(self, mysql_dsn):
        make_user("alice")
        log_row("alice", surface=SURFACE_WHISPER, duration_seconds=600.0,
                created_at=last_month_midpoint())
        log_row("alice", surface=SURFACE_WHISPER, duration_seconds=30.0)
        assert whisper_minutes_this_month("alice") == pytest.approx(0.5)

    def test_per_user_isolation(self, mysql_dsn):
        make_user("alice")
        make_user("bob")
        log_row("alice", surface=SURFACE_WHISPER, duration_seconds=60.0)
        log_row("bob", surface=SURFACE_WHISPER, duration_seconds=120.0)
        assert whisper_minutes_this_month("alice") == pytest.approx(1.0)
        assert whisper_minutes_this_month("bob") == pytest.approx(2.0)


# ── 2. daily vs monthly consistency ─────────────────────────────────────


class TestDailyMonthlyConsistency:
    """Regression net for the 'daily 3 > monthly 2' bug.

    The invariant is simple: ``daily_count(u) <= monthly_steve_count(u)``
    for every user, for every inhabited surface set. We prove it by
    construction — every row counted daily must also be counted monthly.
    """

    def test_daily_never_exceeds_monthly(self, mysql_dsn):
        make_user("alice")
        log_rows("alice", SURFACE_DM, 2, created_at=hours_ago(2))
        log_rows("alice", SURFACE_GROUP, 1, created_at=hours_ago(1))
        daily = daily_count("alice")
        monthly = monthly_steve_count("alice")
        assert daily == 3
        assert monthly == 3
        assert daily <= monthly

    def test_whisper_excluded_from_daily_count(self, mysql_dsn):
        """Whisper has its own minute-based cap; it does NOT count as a Steve call."""
        make_user("alice")
        log_row("alice", surface=SURFACE_WHISPER, duration_seconds=60.0,
                created_at=hours_ago(1))
        log_row("alice", surface=SURFACE_DM, created_at=hours_ago(1))
        assert daily_count("alice") == 1  # only the DM
        assert monthly_steve_count("alice") == 1

    def test_content_gen_excluded_from_daily_count(self, mysql_dsn):
        """Content-gen is community-pool; never billed against personal Steve cap."""
        make_user("alice")
        log_row("alice", surface=SURFACE_CONTENT_GEN, created_at=hours_ago(1))
        log_row("alice", surface=SURFACE_FEED, created_at=hours_ago(1))
        assert daily_count("alice") == 1
        assert monthly_steve_count("alice") == 1

    def test_daily_any_count_includes_all_surfaces(self, mysql_dsn):
        """The admin-dashboard 'any AI today' metric is not Steve-scoped."""
        make_user("alice")
        log_row("alice", surface=SURFACE_WHISPER, duration_seconds=30.0,
                created_at=hours_ago(1))
        log_row("alice", surface=SURFACE_DM, created_at=hours_ago(1))
        log_row("alice", surface=SURFACE_CONTENT_GEN, created_at=hours_ago(1))
        assert daily_any_count("alice") == 3
        assert daily_count("alice") == 1  # Steve-scoped

    def test_daily_is_rolling_24h_not_calendar(self, mysql_dsn):
        """23h ago counts; 25h ago does not."""
        make_user("alice")
        log_row("alice", surface=SURFACE_DM, created_at=hours_ago(23))
        log_row("alice", surface=SURFACE_DM, created_at=hours_ago(25))
        assert daily_count("alice") == 1

    def test_monthly_scoped_to_calendar_month(self, mysql_dsn):
        make_user("alice")
        log_row("alice", surface=SURFACE_DM,
                created_at=last_month_midpoint())
        log_row("alice", surface=SURFACE_DM)
        assert monthly_steve_count("alice") == 1


# ── 3. success=0 handling ───────────────────────────────────────────────


class TestBlockedRowsExcluded:
    """Blocked calls are logged for analytics but must not eat allowance."""

    def test_blocked_dm_does_not_count_daily(self, mysql_dsn):
        make_user("alice")
        log_row("alice", surface=SURFACE_DM, success=False,
                reason_blocked="daily_limit_reached")
        log_row("alice", surface=SURFACE_DM)
        assert daily_count("alice") == 1

    def test_blocked_dm_does_not_count_monthly(self, mysql_dsn):
        make_user("alice")
        log_row("alice", surface=SURFACE_DM, success=False,
                reason_blocked="monthly_limit_reached")
        assert monthly_steve_count("alice") == 0

    def test_log_usage_helper_writes_expected_shape(self, mysql_dsn):
        """Use the real ``log_usage`` entry point (not the test fixture)
        to ensure its column mapping is still correct."""
        make_user("alice")
        ai_usage.log_usage(
            "alice",
            surface=SURFACE_DM,
            tokens_in=10, tokens_out=20,
            cost_usd=0.000123, model="grok-4-1-fast-reasoning",
        )
        ai_usage.log_block("alice", surface=SURFACE_DM,
                           reason="daily_limit_reached")
        assert daily_count("alice") == 1
        assert monthly_steve_count("alice") == 1


# ── 4. Current-month summary (powers the AI Usage modal) ────────────────


class TestCurrentMonthSummary:
    """End-to-end: confirm the Manage Membership modal gets consistent totals."""

    def test_summary_matches_individual_counters(self, mysql_dsn):
        make_user("alice")
        log_rows("alice", SURFACE_DM, 3)
        log_rows("alice", SURFACE_GROUP, 2)
        log_row("alice", surface=SURFACE_WHISPER, duration_seconds=90.0)
        log_row("alice", surface=SURFACE_WHISPER, duration_seconds=30.0)

        summary = ai_usage.current_month_summary("alice")

        assert summary["by_surface"][SURFACE_DM] == 3
        assert summary["by_surface"][SURFACE_GROUP] == 2
        assert summary["by_surface"][SURFACE_WHISPER] == 2
        assert summary["steve_call_count"] == 5
        assert summary["whisper_minutes"] == pytest.approx(2.0)
        # Consistency invariant: summary's steve count == monthly_steve_count.
        assert summary["steve_call_count"] == monthly_steve_count("alice")
        # Whisper minutes via summary == whisper_minutes_this_month.
        assert summary["whisper_minutes"] == pytest.approx(
            whisper_minutes_this_month("alice"), rel=1e-6
        )
