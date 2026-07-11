"""Owner upgrade-prompt backend (Phase 1 of the owner upgrade surface).

Locks the contracts the (Phase 2) client page will rely on:

1. **Eligibility is a server decision** — owner-only with the
   non-enumerating 404 (missing community ≡ not yours ≡ delegated admin),
   root-normalized, free-tier-only, honoring the durable dismiss flag.
2. **Frequency window** — a recent ``upgrade_page_shown`` retention event
   closes ``interstitial_allowed`` without touching ``eligible`` (the
   voluntary path is never gated).
3. **Evidence floors** — blocked-Steve demand counts distinct members
   only and is withheld below the floor; weak numbers never leave the
   server as anti-evidence.
4. **Trial truth** — ``trial_eligible``/``trial_days`` read the same KB
   policy + one-per-customer marker as checkout, so the CTA label can
   never promise a trial checkout won't grant.
5. The new retention event types / sources are accepted by the sink.
"""

from __future__ import annotations

import pytest
from flask import Flask

from backend.blueprints.owner_upgrade import owner_upgrade_bp
from backend.services import ai_usage, community_billing, retention_events
from backend.services import knowledge_base as kb
from backend.services import subscription_audit

from tests.fixtures import make_community, make_user

pytestmark = pytest.mark.usefixtures("mysql_dsn")


@pytest.fixture
def client(mysql_dsn):
    community_billing.ensure_tables()
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(owner_upgrade_bp)
    with app.test_client() as c:
        yield c


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _get(client, community_id) -> tuple:
    resp = client.get(f"/api/owner/upgrade_prompt?community_id={community_id}")
    return resp.status_code, resp.get_json()


# ── 1. Access control ───────────────────────────────────────────────────


class TestAccess:
    def test_anon_is_rejected(self, client):
        status, _ = _get(client, 1)
        assert status == 401

    def test_missing_community_id_is_400(self, client):
        make_user("up_noid", subscription="free")
        _login(client, "up_noid")
        resp = client.get("/api/owner/upgrade_prompt")
        assert resp.status_code == 400
        assert resp.get_json()["reason"] == "missing_params"

    def test_non_owner_gets_non_enumerating_404(self, client):
        make_user("up_owner", subscription="free")
        make_user("up_outsider", subscription="free")
        cid = make_community("c-up-owner", tier="free",
                             creator_username="up_owner")
        _login(client, "up_outsider")

        status_real, body_real = _get(client, cid)
        status_missing, body_missing = _get(client, 99999999)
        # Not-yours and missing must be indistinguishable.
        assert status_real == status_missing == 404
        assert body_real == body_missing

    def test_dismiss_non_owner_gets_404(self, client):
        make_user("up_owner2", subscription="free")
        make_user("up_outsider2", subscription="free")
        cid = make_community("c-up-owner2", tier="free",
                             creator_username="up_owner2")
        _login(client, "up_outsider2")
        resp = client.post("/api/owner/upgrade_prompt/dismiss",
                           json={"community_id": cid})
        assert resp.status_code == 404


# ── 2. Eligibility matrix ───────────────────────────────────────────────


class TestEligibility:
    def test_free_root_owner_is_eligible(self, client):
        kb.seed_default_pages(force=True)
        make_user("elig_owner", subscription="free")
        cid = make_community("c-elig", tier="free",
                             creator_username="elig_owner")
        _login(client, "elig_owner")

        status, body = _get(client, cid)
        assert status == 200, body
        assert body["eligible"] is True
        assert body["reason"] is None
        assert body["interstitial_allowed"] is True
        assert body["tier"] == "free"
        assert body["community_id"] == cid
        assert body["community_name"] == "c-elig"
        assert body["stats"]["member_cap"] == 25
        assert body["stats"]["cap_warning"] is False
        # KB default trial policy: 14 days, not yet consumed.
        assert body["trial_eligible"] is True
        assert body["trial_days"] == 14

    def test_sub_community_resolves_to_root(self, client):
        make_user("elig_root", subscription="free")
        parent = make_community("c-elig-parent", tier="free",
                                creator_username="elig_root")
        child = make_community("c-elig-child", tier="free",
                               creator_username="elig_root",
                               parent_community_id=parent)
        _login(client, "elig_root")

        status, body = _get(client, child)
        assert status == 200
        assert body["community_id"] == parent
        assert body["community_name"] == "c-elig-parent"

    def test_paid_tier_is_not_eligible(self, client):
        make_user("elig_paid", subscription="free")
        cid = make_community("c-elig-paid", tier="paid_l1",
                             creator_username="elig_paid")
        community_billing.mark_subscription(
            cid, tier_code="paid_l1", subscription_id="sub_elig_paid",
            status="active",
        )
        _login(client, "elig_paid")

        status, body = _get(client, cid)
        assert status == 200
        assert body["eligible"] is False
        assert body["reason"] == "not_free_tier"
        assert body["interstitial_allowed"] is False

    def test_dismiss_is_durable_and_idempotent(self, client):
        make_user("elig_dismiss", subscription="free")
        cid = make_community("c-elig-dismiss", tier="free",
                             creator_username="elig_dismiss")
        _login(client, "elig_dismiss")

        resp = client.post("/api/owner/upgrade_prompt/dismiss",
                           json={"community_id": cid})
        assert resp.status_code == 200
        assert resp.get_json()["dismissed"] is True

        status, body = _get(client, cid)
        assert body["eligible"] is False
        assert body["reason"] == "dismissed"
        assert body["dismissed"] is True
        assert body["interstitial_allowed"] is False

        # Second dismiss stays 200 (idempotent).
        resp2 = client.post("/api/owner/upgrade_prompt/dismiss",
                            json={"community_id": cid})
        assert resp2.status_code == 200


# ── 3. Frequency window ─────────────────────────────────────────────────


class TestFrequencyWindow:
    def test_recent_shown_event_closes_interstitial_not_eligibility(self, client):
        make_user("freq_owner", subscription="free")
        cid = make_community("c-freq", tier="free",
                             creator_username="freq_owner")
        assert retention_events.record_event(
            "freq_owner",
            event_type="upgrade_page_shown",
            source="upgrade_interstitial",
            community_id=cid,
            detail="cohort:cap_pressure",
        ) is True
        _login(client, "freq_owner")

        status, body = _get(client, cid)
        assert status == 200
        assert body["eligible"] is True             # voluntary path stays open
        assert body["interstitial_allowed"] is False  # window consumed

    def test_window_is_per_owner(self, client):
        """Another owner's impression must not close this owner's window."""
        make_user("freq_a", subscription="free")
        make_user("freq_b", subscription="free")
        cid_a = make_community("c-freq-a", tier="free", creator_username="freq_a")
        make_community("c-freq-b", tier="free", creator_username="freq_b")
        retention_events.record_event(
            "freq_b", event_type="upgrade_page_shown",
            source="upgrade_interstitial",
        )
        _login(client, "freq_a")

        _, body = _get(client, cid_a)
        assert body["interstitial_allowed"] is True


# ── 4. Blocked-demand evidence ──────────────────────────────────────────


class TestBlockedDemand:
    def test_counts_distinct_members_not_rows(self, mysql_dsn):
        make_user("bd_owner", subscription="free")
        cid = make_community("c-bd", tier="free", creator_username="bd_owner")
        for uname in ("bd_m1", "bd_m2", "bd_m3"):
            make_user(uname, subscription="free")
        # One member retries 5 times — must still count once.
        for _ in range(5):
            ai_usage.log_block("bd_m1", surface="feed",
                               reason="premium_required", community_id=cid)
        ai_usage.log_block("bd_m2", surface="dm",
                           reason="community_pool_exhausted", community_id=cid)
        # Unrelated block reason must not count.
        ai_usage.log_block("bd_m3", surface="feed",
                           reason="daily_cap_reached", community_id=cid)

        assert ai_usage.community_blocked_steve_members_30d(cid) == 2

    def test_endpoint_floors_single_blocked_member_to_zero(self, client):
        """One frustrated member is noise — the stat is withheld below the
        floor so the page never renders anti-evidence."""
        make_user("bd_owner2", subscription="free")
        make_user("bd_solo", subscription="free")
        cid = make_community("c-bd2", tier="free", creator_username="bd_owner2")
        ai_usage.log_block("bd_solo", surface="feed",
                           reason="premium_required", community_id=cid)
        _login(client, "bd_owner2")

        _, body = _get(client, cid)
        assert body["stats"]["blocked_steve_members_30d"] == 0

    def test_endpoint_reports_at_or_above_floor(self, client):
        make_user("bd_owner3", subscription="free")
        cid = make_community("c-bd3", tier="free", creator_username="bd_owner3")
        for uname in ("bd_x1", "bd_x2"):
            make_user(uname, subscription="free")
            ai_usage.log_block(uname, surface="feed",
                               reason="premium_required", community_id=cid)
        _login(client, "bd_owner3")

        _, body = _get(client, cid)
        assert body["stats"]["blocked_steve_members_30d"] == 2


# ── 5. Trial truth ──────────────────────────────────────────────────────


class TestTrialTruth:
    def test_consumed_trial_marker_flips_trial_eligible(self, client):
        kb.seed_default_pages(force=True)
        make_user("tt_owner", subscription="free")
        cid = make_community("c-tt", tier="free", creator_username="tt_owner")
        subscription_audit.log(
            username="tt_owner",
            action="community_tier_trial_started",
            source="stripe",
        )
        _login(client, "tt_owner")

        _, body = _get(client, cid)
        assert body["trial_eligible"] is False
        assert body["trial_days"] == 0

    def test_service_matches_checkout_policy(self, mysql_dsn):
        """The endpoint and checkout must read the SAME policy function —
        this pins the shared service so they can't drift apart."""
        kb.seed_default_pages(force=True)
        make_user("tt_shared", subscription="free")
        assert community_billing.community_tier_trial_days("tt_shared") == 14
        subscription_audit.log(
            username="tt_shared",
            action="community_tier_trial_started",
            source="stripe",
        )
        assert community_billing.community_tier_trial_days("tt_shared") == 0


# ── 6. Retention vocabulary ─────────────────────────────────────────────


class TestRetentionVocabulary:
    def test_new_event_types_accepted(self, mysql_dsn):
        make_user("rv_user", subscription="free")
        for etype in (
            "upgrade_page_shown",
            "upgrade_page_tier_viewed",
            "upgrade_page_dismissed",
            "upgrade_page_checkout_started",
            "owner_dashboard_opened",
        ):
            assert retention_events.record_event(
                "rv_user", event_type=etype, source="upgrade_interstitial",
            ) is True, etype

    def test_unknown_event_type_still_rejected(self, mysql_dsn):
        make_user("rv_user2", subscription="free")
        assert retention_events.record_event(
            "rv_user2", event_type="upgrade_page_converted", source="direct",
        ) is False

    def test_upgrade_interstitial_is_valid_checkout_source(self):
        assert subscription_audit.normalize_checkout_source(
            "upgrade_interstitial"
        ) == "upgrade_interstitial"
