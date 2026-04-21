"""Matrix A — ``backend.services.entitlements.resolve_entitlements`` contract.

The resolver is the single source of truth for "what can this user do
right now". A bug here either (a) lets free users burn Steve credits, or
(b) locks paying users out. Either is a revenue event.

The tier priority we lock in:

    SPECIAL  >  (personal) PREMIUM  >  Enterprise seat  >  TRIAL  >  FREE

Plus two cross-cutting invariants:

  * Technical caps (``max_output_tokens_*``, ``max_context_messages``,
    ``max_images_per_turn``) apply to every tier including SPECIAL —
    they are product safety rails, not monetisation knobs.
  * ``inherited_from`` is populated only when the user's effective
    Premium access comes from an Enterprise seat (either because they
    have no personal plan *or* because the seat is present alongside a
    personal plan — in which case the admin UI uses the flag to warn
    about double-pay).
"""

from __future__ import annotations

from backend.services.entitlements import (
    TIER_FREE,
    TIER_PREMIUM,
    TIER_SPECIAL,
    TIER_TRIAL,
    resolve_entitlements,
)

from tests.fixtures import (
    days_ago,
    kb_override_field,
    make_community,
    make_enterprise_seat,
    make_user,
)


# ── 1. Tier resolution ──────────────────────────────────────────────────


class TestTierResolution:
    def test_free_user(self, mysql_dsn):
        make_user("free_user", subscription="free", created_at=days_ago(60))
        ent = resolve_entitlements("free_user")
        assert ent["tier"] == TIER_FREE
        assert ent["can_use_steve"] is False
        assert ent["steve_uses_per_month"] == 0
        assert ent["whisper_minutes_per_month"] == 0
        assert ent["ai_daily_limit"] == 0

    def test_trial_user_during_window(self, mysql_dsn):
        make_user("new_user", subscription="free", created_at=days_ago(7))
        ent = resolve_entitlements("new_user")
        assert ent["tier"] == TIER_TRIAL
        assert ent["can_use_steve"] is True
        assert ent["steve_uses_per_month"] > 0

    def test_trial_expired_falls_back_to_free(self, mysql_dsn):
        """30-day trial cutoff — at day 31 user must be FREE again."""
        make_user("lapsed", subscription="free", created_at=days_ago(31))
        ent = resolve_entitlements("lapsed")
        assert ent["tier"] == TIER_FREE
        assert ent["can_use_steve"] is False

    def test_personal_premium(self, mysql_dsn):
        make_user("paying", subscription="premium", created_at=days_ago(200))
        ent = resolve_entitlements("paying")
        assert ent["tier"] == TIER_PREMIUM
        assert ent["can_use_steve"] is True
        assert ent["inherited_from"] is None

    def test_premium_legacy_pro_and_paid_aliases(self, mysql_dsn):
        """Legacy rows with subscription='pro' or 'paid' must still resolve to premium."""
        for sub in ("pro", "paid"):
            make_user(f"user_{sub}", subscription=sub, created_at=days_ago(90))
            ent = resolve_entitlements(f"user_{sub}")
            assert ent["tier"] == TIER_PREMIUM, f"subscription={sub!r}"

    def test_special_beats_personal_premium(self, mysql_dsn):
        """Special wins even if the user ALSO has a paid subscription."""
        make_user("paulo", subscription="premium", is_special=True,
                  created_at=days_ago(400))
        ent = resolve_entitlements("paulo")
        assert ent["tier"] == TIER_SPECIAL
        # Special gets unlimited business caps (represented as None).
        assert ent["steve_uses_per_month"] is None
        assert ent["whisper_minutes_per_month"] is None
        # But technical caps are still enforced.
        assert ent["ai_daily_limit"] > 0
        assert ent["max_tool_invocations_per_turn"] > 0


# ── 2. Unknown / anonymous ──────────────────────────────────────────────


class TestUnknownAndAnonymous:
    def test_anonymous_user_denied(self, mysql_dsn):
        ent = resolve_entitlements(None)
        assert ent["tier"] == "anonymous"
        assert ent["can_use_steve"] is False
        assert ent["can_create_communities"] is False

    def test_unknown_username_denied(self, mysql_dsn):
        ent = resolve_entitlements("ghost_user_never_inserted")
        assert ent["tier"] == "unknown"
        assert ent["can_use_steve"] is False


# ── 3. Enterprise seat interaction ──────────────────────────────────────


class TestEnterpriseSeatInteraction:
    def test_free_user_with_enterprise_seat_gets_premium(self, mysql_dsn):
        """A Free user joining an Enterprise community inherits Premium entitlements."""
        make_user("employee", subscription="free", created_at=days_ago(60))
        cid = make_community("ACME Corp", tier="enterprise")
        make_enterprise_seat("employee", cid)
        ent = resolve_entitlements("employee")
        assert ent["tier"] == TIER_PREMIUM
        assert ent["can_use_steve"] is True
        assert ent["inherited_from"] == f"enterprise:c{cid}"

    def test_personal_premium_plus_seat_stamps_inherited_from(self, mysql_dsn):
        """Double-pay warning: admin UI must see ``inherited_from`` even when
        the user has a personal Premium subscription on top of the seat."""
        make_user("double", subscription="premium", created_at=days_ago(100))
        cid = make_community("ACME Corp", tier="enterprise")
        make_enterprise_seat("double", cid,
                             had_personal_premium_at_join=True)
        ent = resolve_entitlements("double")
        assert ent["tier"] == TIER_PREMIUM
        # The personal subscription is still the reason they're Premium, but
        # the seat presence is stamped so the client can nudge to cancel.
        assert ent["inherited_from"] == f"enterprise:c{cid}"

    def test_ended_seat_outside_grace_window_downgrades(self, mysql_dsn):
        """Seat ended 10d ago with no grace_until → user is no longer covered."""
        make_user("exited", subscription="free", created_at=days_ago(90))
        cid = make_community("ACME Corp", tier="enterprise")
        make_enterprise_seat("exited", cid,
                             started_at=days_ago(40),
                             ended_at=days_ago(10),
                             end_reason="voluntary_leave",
                             grace_until=None)
        ent = resolve_entitlements("exited")
        assert ent["tier"] == TIER_FREE
        assert ent["inherited_from"] is None

    def test_ended_seat_inside_grace_window_still_premium(self, mysql_dsn):
        """Seat ended but grace_until is in the future → still Premium."""
        make_user("grace", subscription="free", created_at=days_ago(90))
        cid = make_community("ACME Corp", tier="enterprise")
        make_enterprise_seat("grace", cid,
                             started_at=days_ago(40),
                             ended_at=days_ago(2),
                             end_reason="voluntary_leave",
                             grace_until=days_ago(-5))  # 5 days in future
        ent = resolve_entitlements("grace")
        assert ent["tier"] == TIER_PREMIUM
        assert ent["inherited_from"] is not None


# ── 4. KB-driven configuration ──────────────────────────────────────────


class TestKBDrivenConfiguration:
    """The resolver reads caps from the KB at request time — admin edits
    must flow through without a redeploy. We verify by writing a minimal
    one-field KB page and asserting the resolver picks it up."""

    def test_steve_uses_per_month_comes_from_kb(self, mysql_dsn):
        kb_override_field("credits-entitlements",
                          "steve_uses_per_month_user_facing", 250)
        make_user("paying", subscription="premium", created_at=days_ago(30))
        ent = resolve_entitlements("paying")
        assert ent["steve_uses_per_month"] == 250

    def test_hard_limits_come_from_kb(self, mysql_dsn):
        kb_override_field("hard-limits", "ai_daily_limit", 25)
        make_user("paying", subscription="premium", created_at=days_ago(30))
        ent = resolve_entitlements("paying")
        assert ent["ai_daily_limit"] == 25

    def test_special_daily_limit_is_distinct_from_premium(self, mysql_dsn):
        """Special users get ``ai_daily_limit_special`` (technical cap, still > Premium)."""
        kb_override_field("hard-limits", "ai_daily_limit", 10)
        # Seed a *second* field on the same page — we need a helper that
        # upserts without clobbering existing fields. For now overwrite
        # with both fields at once.
        from tests.fixtures import seed_kb
        seed_kb([
            {
                "slug": "hard-limits",
                "title": "Hard Limits",
                "category": "policy",
                "fields": [
                    {"name": "ai_daily_limit", "type": "integer",
                     "label": "ai_daily_limit", "value": 10},
                    {"name": "ai_daily_limit_special", "type": "integer",
                     "label": "ai_daily_limit_special", "value": 200},
                ],
            },
        ])
        make_user("premium_u", subscription="premium", created_at=days_ago(30))
        make_user("special_u", subscription="free", is_special=True,
                  created_at=days_ago(30))
        assert resolve_entitlements("premium_u")["ai_daily_limit"] == 10
        assert resolve_entitlements("special_u")["ai_daily_limit"] == 200


# ── 4b. Per-tier community / member caps ────────────────────────────────


class TestPerTierMemberCaps:
    """Phase 3 (April 2026) decoupled per-community member caps from the
    user's subscription. Member caps now live on the *community* tier
    (Free=25, Paid L1/L2/L3, Enterprise) — the user tier only gates
    Steve access and the count of communities a user can own.

    The resolver still projects ``members_per_owned_community`` but only
    as a Free-specific fallback used by
    :func:`ensure_free_parent_member_capacity`; Premium / Special set it
    to ``None`` to make "user-tier cap" absence explicit.
    """

    def test_free_member_cap_reads_from_kb_free_field(self, mysql_dsn):
        from tests.fixtures import seed_kb
        seed_kb([
            {
                "slug": "user-tiers",
                "title": "User Tiers",
                "category": "product",
                "fields": [
                    {"name": "free_communities_max", "type": "integer",
                     "label": "free_communities_max", "value": 5},
                    {"name": "free_members_per_owned_community", "type": "integer",
                     "label": "free_members_per_owned_community", "value": 25},
                ],
            },
        ])
        make_user("free_user", subscription="free", created_at=days_ago(60))
        ent = resolve_entitlements("free_user")
        assert ent["tier"] == TIER_FREE
        # The value the user reported in the bug: Free cap = 25 from the KB.
        assert ent["members_per_owned_community"] == 25

    def test_premium_has_no_user_tier_member_cap(self, mysql_dsn):
        """Phase 3: Premium users do not carry a user-tier member cap.

        ``members_per_owned_community`` is ``None`` for Premium — the
        community's own tier (Free 25 / Paid L1 75 / L2 150 / L3 250 /
        Enterprise unlimited) drives the cap. The
        ``premium_members_per_owned_community`` KB field has been
        retired; even if a stale KB still carries it, it must be
        ignored.
        """
        from tests.fixtures import seed_kb
        seed_kb([
            {
                "slug": "user-tiers",
                "title": "User Tiers",
                "category": "product",
                "fields": [
                    {"name": "free_members_per_owned_community", "type": "integer",
                     "label": "free_members_per_owned_community", "value": 25},
                    # Stale KB entry — must be ignored by the resolver.
                    {"name": "premium_members_per_owned_community", "type": "integer",
                     "label": "premium_members_per_owned_community", "value": 200},
                ],
            },
        ])
        make_user("paying", subscription="premium", created_at=days_ago(30))
        ent = resolve_entitlements("paying")
        assert ent["tier"] == TIER_PREMIUM
        assert ent["members_per_owned_community"] is None
        # The field must not be exposed on ent either.
        assert "premium_members_per_owned_community" not in ent

    def test_trial_inherits_free_member_cap(self, mysql_dsn):
        """Documented policy: trial communities that overshoot Free limits
        lock read-only on trial lapse, so the trial member cap tracks Free."""
        from tests.fixtures import seed_kb
        seed_kb([
            {
                "slug": "user-tiers",
                "title": "User Tiers",
                "category": "product",
                "fields": [
                    {"name": "free_members_per_owned_community", "type": "integer",
                     "label": "free_members_per_owned_community", "value": 25},
                ],
            },
        ])
        make_user("trial_user", subscription="free", created_at=days_ago(5))
        ent = resolve_entitlements("trial_user")
        assert ent["tier"] == TIER_TRIAL
        assert ent["members_per_owned_community"] == 25

    def test_free_communities_max_reads_from_kb(self, mysql_dsn):
        """The Free-tier community-count cap is the count limit the
        ``/create_community`` route enforces. Admin must be able to raise
        it from 2 to 5 (or any value) via the KB without a redeploy."""
        from tests.fixtures import seed_kb
        seed_kb([
            {
                "slug": "user-tiers",
                "title": "User Tiers",
                "category": "product",
                "fields": [
                    {"name": "free_communities_max", "type": "integer",
                     "label": "free_communities_max", "value": 5},
                ],
            },
        ])
        make_user("free_user", subscription="free", created_at=days_ago(60))
        ent = resolve_entitlements("free_user")
        assert ent["tier"] == TIER_FREE
        assert ent["communities_max"] == 5

    def test_special_user_member_cap_is_unlimited(self, mysql_dsn):
        """Special users get unlimited member caps (represented as None).
        KB edits to Free caps must not leak into Special."""
        from tests.fixtures import seed_kb
        seed_kb([
            {
                "slug": "user-tiers",
                "title": "User Tiers",
                "category": "product",
                "fields": [
                    {"name": "free_members_per_owned_community", "type": "integer",
                     "label": "free_members_per_owned_community", "value": 25},
                ],
            },
        ])
        make_user("founder", subscription="free", is_special=True,
                  created_at=days_ago(400))
        ent = resolve_entitlements("founder")
        assert ent["tier"] == TIER_SPECIAL
        assert ent["members_per_owned_community"] is None


# ── 5. Cross-cutting invariants ─────────────────────────────────────────


class TestCrossCuttingInvariants:
    def test_every_tier_has_technical_caps(self, mysql_dsn):
        """``max_output_tokens_*`` and ``max_context_messages`` must be set
        regardless of tier — they're product safety, not monetisation."""
        make_user("free_u", subscription="free", created_at=days_ago(60))
        make_user("trial_u", subscription="free", created_at=days_ago(5))
        make_user("premium_u", subscription="premium", created_at=days_ago(30))
        make_user("special_u", subscription="free", is_special=True,
                  created_at=days_ago(30))
        for username in ("free_u", "trial_u", "premium_u", "special_u"):
            ent = resolve_entitlements(username)
            assert ent["max_output_tokens_dm"] > 0, username
            assert ent["max_output_tokens_group"] > 0, username
            assert ent["max_context_messages"] > 0, username
            assert ent["max_images_per_turn"] > 0, username

    def test_internal_weights_always_present(self, mysql_dsn):
        """The Steve router needs weights on every call — resolver must
        populate them even for FREE tier (who can't use Steve but might
        still call ``resolve_entitlements`` from the client)."""
        make_user("free_u", subscription="free", created_at=days_ago(60))
        ent = resolve_entitlements("free_u")
        assert isinstance(ent["internal_weights"], dict)
        assert "dm" in ent["internal_weights"]
        assert "group" in ent["internal_weights"]

    def test_resolver_never_raises(self, mysql_dsn):
        """Even with a broken KB, the resolver must return a shape, not crash."""
        # No KB seed at all — service must fall back to ``_DEFAULTS``.
        make_user("paying", subscription="premium", created_at=days_ago(30))
        ent = resolve_entitlements("paying")
        assert ent["tier"] == TIER_PREMIUM
        assert ent["steve_uses_per_month"] > 0
