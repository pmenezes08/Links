"""Unit tests for the B2B networking access gate (networking_billing)."""

from __future__ import annotations

from backend.services.networking_billing import (
    MODE_CAP,
    MODE_EXEMPT,
    MODE_NO_PACKAGE,
    networking_gate_decision,
)
from backend.services.networking_ai_config import DEFAULT_CONFIG, NetworkingAiConfig


def _state(active, status="active", synthetic=False):
    return {
        "steve_package_subscription_active": active,
        "steve_package_subscription_status": status,
        "steve_package_stripe_subscription_id": ("trial_pkg_5" if synthetic else "sub_real"),
    }


def _billing(state, *, synthetic=False):
    class _B:
        @staticmethod
        def get_billing_state(_cid):
            return state

        @staticmethod
        def is_synthetic_steve_package_trial(s):
            return synthetic or str(s.get("steve_package_subscription_id", "")).startswith("trial_pkg_")

    return _B


CFG = DEFAULT_CONFIG  # requires_steve_package=True, weekly=20, trial=5


def test_exempt_user_bypasses_package_and_cap():
    d = networking_gate_decision("admin", 5, CFG, billing=_billing(_state(False)), exempt_fn=lambda u: True)
    assert d["mode"] == MODE_EXEMPT


def test_no_active_package_blocks():
    d = networking_gate_decision(
        "alice", 5, CFG, billing=_billing(_state(False, status="(none)")), exempt_fn=lambda u: False
    )
    assert d["mode"] == MODE_NO_PACKAGE


def test_paid_package_applies_full_weekly_cap():
    d = networking_gate_decision(
        "alice", 5, CFG, billing=_billing(_state(True, status="active")), exempt_fn=lambda u: False
    )
    assert d["mode"] == MODE_CAP
    assert d["in_trial"] is False
    assert d["effective_cap"] == 20


def test_trial_package_applies_reduced_cap():
    d = networking_gate_decision(
        "alice", 5, CFG,
        billing=_billing(_state(True, status="trialing", synthetic=True), synthetic=True),
        exempt_fn=lambda u: False,
    )
    assert d["mode"] == MODE_CAP
    assert d["in_trial"] is True
    assert d["effective_cap"] == 5


def test_kb_toggle_off_disables_package_requirement():
    cfg = NetworkingAiConfig(requires_steve_package=False)
    # No package, but the gate is off -> falls through to the paid weekly cap.
    d = networking_gate_decision(
        "alice", 5, cfg, billing=_billing(_state(False)), exempt_fn=lambda u: False
    )
    assert d["mode"] == MODE_CAP
    assert d["in_trial"] is False
    assert d["effective_cap"] == 20


def test_billing_read_failure_fails_closed():
    class _Boom:
        @staticmethod
        def get_billing_state(_cid):
            raise RuntimeError("db down")

        @staticmethod
        def is_synthetic_steve_package_trial(_s):
            return False

    d = networking_gate_decision("alice", 5, CFG, billing=_Boom, exempt_fn=lambda u: False)
    assert d["mode"] == MODE_NO_PACKAGE
