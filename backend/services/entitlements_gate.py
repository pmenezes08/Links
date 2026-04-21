"""Shared gate logic for Steve / Whisper entry points.

Used by blueprints (``@require_steve_access`` decorator) *and* by internal
helpers that need the same checks without being tied to a request context
(e.g. ``_trigger_steve_group_reply`` inside the monolith).

The gate itself is intentionally small — resolve entitlements, consult the
counters from :mod:`ai_usage`, build the error payload if denied. All
copy / HTTP-status decisions live in
:mod:`backend.services.entitlements_errors`.
"""

from __future__ import annotations

import logging
from functools import wraps
from typing import Any, Dict, Optional, Tuple

from flask import g, jsonify, request, session

from backend.services import ai_usage
from backend.services import entitlements_errors as errs
from backend.services.entitlements import resolve_entitlements
from backend.services.feature_flags import entitlements_enforcement_enabled


logger = logging.getLogger(__name__)


# ─── Core check ─────────────────────────────────────────────────────────


def check_steve_access(
    username: str,
    surface: str,
    *,
    duration_seconds: Optional[float] = None,
) -> Tuple[bool, Optional[Dict[str, Any]], Optional[int], Dict[str, Any]]:
    """Decide whether ``username`` can invoke Steve on ``surface`` right now.

    Returns a 4-tuple::

        (allowed, error_payload, http_status, ent)

    * ``allowed`` — if True the caller may proceed using ``ent`` for caps.
    * ``error_payload`` / ``http_status`` — populated only when ``allowed``
      is False; return these directly to the client.
    * ``ent`` — the resolved entitlements dict (always populated, used for
      per-turn caps even when ``allowed`` is True).

    ``duration_seconds`` is only meaningful for ``whisper`` / ``voice_summary``
    where a single call can consume multiple "minutes" against the Whisper cap.
    """
    try:
        ent = resolve_entitlements(username)
    except Exception as err:
        # Fail closed: never open the gate when the KB is broken.
        logger.exception("resolve_entitlements failed for %s on %s", username, surface)
        payload, status = errs.build_error(
            errs.REASON_PREMIUM_REQUIRED,
            ent={"tier": "unknown"},
            overrides={"message": "Steve is temporarily unavailable. Please try again."},
        )
        return False, payload, status, {}

    # 1. Tier gate.
    if not ent.get("can_use_steve"):
        payload, status = errs.build_error(errs.REASON_PREMIUM_REQUIRED, ent=ent)
        ai_usage.log_block(username, surface=surface, reason=errs.REASON_PREMIUM_REQUIRED)
        return False, payload, status, ent

    # 2. Daily cap (rolling 24h).
    daily_cap = ent.get("ai_daily_limit")
    if isinstance(daily_cap, int) and daily_cap > 0:
        used = ai_usage.daily_count(username)
        if used >= daily_cap:
            usage_snapshot = _snapshot(username, ent)
            payload, status = errs.build_error(
                errs.REASON_DAILY_CAP, ent=ent, usage=usage_snapshot
            )
            ai_usage.log_block(username, surface=surface, reason=errs.REASON_DAILY_CAP)
            return False, payload, status, ent

    # 3. Monthly Steve cap (personal allowance). Only applies to Steve surfaces
    # and only when the cap is a positive integer (None = unlimited).
    monthly_cap = ent.get("steve_uses_per_month")
    if surface in ai_usage.STEVE_SURFACES and isinstance(monthly_cap, int) and monthly_cap > 0:
        used = ai_usage.monthly_steve_count(username)
        if used >= monthly_cap:
            usage_snapshot = _snapshot(username, ent)
            payload, status = errs.build_error(
                errs.REASON_MONTHLY_STEVE_CAP, ent=ent, usage=usage_snapshot
            )
            ai_usage.log_block(username, surface=surface, reason=errs.REASON_MONTHLY_STEVE_CAP)
            return False, payload, status, ent

    # 4. Whisper cap — only for whisper / voice_summary surfaces.
    if surface in (ai_usage.SURFACE_WHISPER, ai_usage.SURFACE_VOICE_SUMMARY):
        whisper_cap = ent.get("whisper_minutes_per_month")
        if isinstance(whisper_cap, (int, float)) and whisper_cap > 0:
            used_min = ai_usage.whisper_minutes_this_month(username)
            # Pre-charge the about-to-be-consumed minutes so a single long
            # clip can't bust past the ceiling.
            need_min = (float(duration_seconds or 0) / 60.0) if duration_seconds else 0
            if used_min + need_min > float(whisper_cap):
                usage_snapshot = _snapshot(username, ent)
                payload, status = errs.build_error(
                    errs.REASON_MONTHLY_WHISPER_CAP, ent=ent, usage=usage_snapshot
                )
                ai_usage.log_block(
                    username, surface=surface, reason=errs.REASON_MONTHLY_WHISPER_CAP
                )
                return False, payload, status, ent

    # 5. Monthly spend ceiling (internal runaway-cost gate).
    #
    # This is the last line of defence against a runaway prompt or bug
    # burning through API credit. It is **intentionally reused**:
    # * The reason-code returned to the client is
    #   ``REASON_MONTHLY_STEVE_CAP`` — same copy as hitting the Steve
    #   cap — so the user is never told the exact EUR ceiling (and
    #   therefore can never reverse-engineer how many AI calls their
    #   plan "really" buys).
    # * We log the block under a distinct internal reason for analytics.
    # * Fails open on any read error so a transient KB outage can't
    #   lock every paying user out.
    ceiling_eur = ent.get("monthly_spend_ceiling_eur")
    if isinstance(ceiling_eur, (int, float)) and ceiling_eur > 0:
        try:
            spend_usd = ai_usage.monthly_spend_usd(username)
            # The usd_to_eur_rate lives in the KB (model-cost page) and
            # isn't projected into ent; read it lazily here so we don't
            # widen the resolver surface for a single consumer.
            from backend.services.entitlements import _kb_field_value  # type: ignore

            rate = _kb_field_value("credits-entitlements", "usd_to_eur_rate", 0.92)
            try:
                rate_f = float(rate) if rate else 0.92
            except Exception:
                rate_f = 0.92
            spend_eur = float(spend_usd) * rate_f
            if spend_eur >= float(ceiling_eur):
                payload, status = errs.build_error(
                    errs.REASON_MONTHLY_STEVE_CAP,
                    ent=ent,
                    usage=_snapshot(username, ent),
                )
                # Keep the internal breadcrumb separate from the user-facing
                # reason so we can tell these two apart in analytics.
                ai_usage.log_block(
                    username, surface=surface, reason="monthly_spend_ceiling"
                )
                logger.info(
                    "spend ceiling hit: user=%s surface=%s spend_eur=%.4f ceiling_eur=%.2f",
                    username, surface, spend_eur, float(ceiling_eur),
                )
                return False, payload, status, ent
        except Exception as err:  # pragma: no cover - fail-open guard
            logger.warning(
                "spend ceiling check errored (failing open): user=%s err=%s",
                username, err,
            )

    return True, None, None, ent


def _snapshot(username: str, ent: Dict[str, Any]) -> Dict[str, Any]:
    """Small usage snapshot matching the shape expected by build_error."""
    try:
        summary = ai_usage.current_month_summary(username)
    except Exception:
        summary = {}
    return {
        "monthly_steve_used": ai_usage.monthly_steve_count(username),
        "monthly_steve_cap": ent.get("steve_uses_per_month"),
        "daily_used": ai_usage.daily_count(username),
        "daily_cap": ent.get("ai_daily_limit"),
        "whisper_minutes_used": round(ai_usage.whisper_minutes_this_month(username), 2),
        "whisper_minutes_cap": ent.get("whisper_minutes_per_month"),
        "resets_at_monthly": summary.get("resets_at_monthly"),
        "resets_at_daily": summary.get("resets_at_daily"),
    }


# ─── Flask decorator ────────────────────────────────────────────────────


def require_steve_access(surface: str):
    """Decorate a Flask route to enforce entitlements before running.

    Behaviour:
      * If ``ENTITLEMENTS_ENFORCEMENT_ENABLED`` is off, resolves and stashes
        ``ent`` on ``g.ent`` but never blocks (legacy mode).
      * If on, runs :func:`check_steve_access` and returns the shared JSON
        error on denial.
      * On allow, attaches ``g.ent`` and ``g.entitlements_surface`` for the
        view to read.

    Usage::

        @blueprint.route("/api/steve/chat", methods=["POST"])
        @require_steve_access("dm")
        def steve_chat():
            ent = g.ent
            ...
    """
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            username = session.get("username")
            if not username:
                return jsonify({"success": False, "error": "Authentication required"}), 401

            enforce = entitlements_enforcement_enabled()
            # Always resolve so g.ent is populated.
            allowed, payload, status, ent = check_steve_access(username, surface)
            g.ent = ent
            g.entitlements_surface = surface

            if not allowed and enforce:
                return jsonify(payload), status
            # Flag-off legacy path: log the would-have-blocked reason for
            # analytics but let the request through.
            if not allowed and not enforce and payload:
                logger.info(
                    "entitlements soft-block (flag off): user=%s surface=%s reason=%s",
                    username, surface, payload.get("reason"),
                )
            return view(*args, **kwargs)
        return wrapped
    return decorator


# ─── Programmatic gate for internal code (non-Flask) ────────────────────


def gate_or_reason(
    username: str,
    surface: str,
    *,
    duration_seconds: Optional[float] = None,
    enforce_override: Optional[bool] = None,
) -> Tuple[bool, Optional[str], Dict[str, Any]]:
    """Non-Flask version of the gate.

    Returns ``(allowed, reason_or_none, ent)``. Honours the
    ``ENTITLEMENTS_ENFORCEMENT_ENABLED`` flag by default, but callers can
    pass ``enforce_override=True`` to force enforcement (used by
    background workers / webhook handlers that don't care about the web
    flag).
    """
    enforce = enforce_override if enforce_override is not None else entitlements_enforcement_enabled()
    allowed, payload, _status, ent = check_steve_access(
        username, surface, duration_seconds=duration_seconds
    )
    if allowed:
        return True, None, ent
    reason = (payload or {}).get("reason")
    if not enforce:
        # Flag off — pretend we allowed it but report the reason for logging.
        return True, reason, ent
    return False, reason, ent
