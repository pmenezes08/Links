"""Cron endpoint for owner billing CTA notifications.

``POST /api/cron/steve-trial-lifecycle`` — driven by Cloud Scheduler
(see docs/cloud-scheduler-cron.md). Auth is the shared ``X-Cron-Secret``
header validated against the ``CRON_SHARED_SECRET`` env var, exactly like
the other ``/api/cron/*`` routes. ``?dry_run=1`` returns candidate counts
without sending anything.

The gate-driven triggers (member blocked / pool exhausted) have no HTTP
surface — they fire inline from :mod:`backend.services.entitlements_gate`.
"""

from __future__ import annotations

import os

from flask import Blueprint, jsonify, request

owner_billing_ctas_bp = Blueprint("owner_billing_ctas", __name__)


def _cron_authed() -> bool:
    expected = os.environ.get("CRON_SHARED_SECRET") or ""
    if not expected:
        return False
    provided = request.headers.get("X-Cron-Secret") or ""
    return provided == expected


def _bool_arg(name: str) -> bool:
    return (request.args.get(name) or "").strip().lower() in {"1", "true", "yes", "on"}


@owner_billing_ctas_bp.route("/api/cron/steve-trial-lifecycle", methods=["POST"])
def cron_steve_trial_lifecycle():
    """Notify owners whose Steve Community Package trial is ending / has ended.

    Idempotent (audit-log dedup, once per community per event, ever) — safe
    for Scheduler retries. Kill switch: OWNER_BILLING_CTAS_ENABLED=false
    returns ``{"success": true, "skipped": true}`` instead of 5xx.
    """
    if not _cron_authed():
        return jsonify({"success": False, "error": "forbidden"}), 403
    from backend.services.owner_billing_ctas import run_trial_lifecycle_sweep

    out = run_trial_lifecycle_sweep(dry_run=_bool_arg("dry_run"))
    return jsonify(out), 200 if out.get("success") else 500
