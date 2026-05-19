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
import re
from functools import wraps
from typing import Any, Dict, Optional, Tuple

from flask import g, jsonify, request, session

from backend.services import ai_usage
from backend.services import community_billing
from backend.services import entitlements_errors as errs
from backend.services import knowledge_base as kb
from backend.services import community as community_svc
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.entitlements import resolve_entitlements
from backend.services.feature_flags import entitlements_enforcement_enabled
from backend.services.steve_community_config import get_paid_steve_package_config


logger = logging.getLogger(__name__)
STEVE_MENTION_RE = re.compile(r"@steve\b", re.IGNORECASE)


def _community_tiers_field_map() -> Dict[str, Any]:
    try:
        page = kb.get_page("community-tiers") or {}
    except Exception:
        return {}
    out: Dict[str, Any] = {}
    for f in page.get("fields") or []:
        name = f.get("name")
        if name:
            out[str(name)] = f.get("value")
    return out


def _truthy_kb(raw: Any, default: bool = True) -> bool:
    if raw is None:
        return default
    if isinstance(raw, bool):
        return raw
    s = str(raw).strip().lower()
    if s in ("0", "false", "no", "off", ""):
        return False
    if s in ("1", "true", "yes", "on"):
        return True
    return bool(raw)


def _user_member_community(username: str, community_id: int) -> bool:
    if not username or not community_id:
        return False
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""
                SELECT 1 FROM user_communities uc
                INNER JOIN users u ON u.id = uc.user_id
                WHERE LOWER(u.username) = LOWER({ph})
                  AND uc.community_id = {ph}
                LIMIT 1
                """,
                (username, int(community_id)),
            )
            return c.fetchone() is not None
    except Exception:
        return False


# ─── Core check ─────────────────────────────────────────────────────────


def mentions_steve(text: Optional[str]) -> bool:
    return bool(text and STEVE_MENTION_RE.search(str(text)))


def check_steve_access(
    username: str,
    surface: str,
    *,
    duration_seconds: Optional[float] = None,
    community_id: Optional[Any] = None,
    locale: Optional[str] = None,
    estimated_credits_debit: Optional[float] = None,
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

    ``community_id`` scopes Steve calls that occur inside a community
    (feed replies, group @Steve). When an active Steve Community Package exists on
    the billing root, the Knowledge Base toggles decide whether members consume the
    shared monthly pool vs personal allowances.
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
            locale=locale,
        )
        return False, payload, status, {}

    est_debit: float = 0.0
    if surface in ai_usage.STEVE_SURFACES:
        if estimated_credits_debit is not None:
            est_debit = float(estimated_credits_debit)
        else:
            try:
                from backend.services.steve_credit_weights import estimate_credits_debited

                heavy = surface in (ai_usage.SURFACE_FEED, ai_usage.SURFACE_GROUP)
                est_debit = estimate_credits_debited(surface, heavy_tools=heavy)
            except Exception:
                est_debit = 1.0

    kb_fields = _community_tiers_field_map()
    steve_pkg_config = get_paid_steve_package_config(kb_fields)
    premium_priority = _truthy_kb(
        kb_fields.get("paid_steve_package_premium_priority"), True
    )
    fallback_when_empty = _truthy_kb(
        kb_fields.get("paid_steve_package_fallback_when_empty"), True
    )
    free_blocked_when_empty = _truthy_kb(
        kb_fields.get("paid_steve_package_free_members_blocked_when_empty"), True
    )
    free_member_pool_access = _truthy_kb(
        kb_fields.get("paid_steve_package_free_member_access"), True
    )

    root_id: Optional[int] = None
    cid_ctx: Optional[int] = None
    pool_active = False
    pool_cap = 0
    pool_used = 0
    provider_cost_exhausted = False
    member_ctx = False

    if community_id is not None and surface in ai_usage.STEVE_SURFACES:
        try:
            cid_ctx = int(community_id)
        except (TypeError, ValueError):
            cid_ctx = None
        if cid_ctx:
            member_ctx = _user_member_community(username, cid_ctx)
            root_id, _ = community_svc.resolve_root_community_id(cid_ctx)
            pool_active = community_billing.has_active_steve_package(root_id)
            if pool_active:
                pool_cap = max(0, int(steve_pkg_config.monthly_credit_pool or 0))
                if pool_cap > 0:
                    pool_used = ai_usage.community_monthly_steve_pool_usage(root_id)
                ceiling = float(steve_pkg_config.monthly_provider_cost_ceiling_usd or 0)
                reservation = float(steve_pkg_config.provider_cost_reservation_usd or 0)
                if ceiling > 0 and reservation > 0:
                    try:
                        spent = ai_usage.monthly_community_spend_usd(root_id)
                        provider_cost_exhausted = (spent + reservation) > ceiling
                    except Exception as err:
                        logger.warning(
                            "community provider spend check failed (failing open): community=%s err=%s",
                            root_id,
                            err,
                        )

    pool_has_room = (
        pool_cap > 0
        and (float(pool_used) + est_debit) <= float(pool_cap)
        and not provider_cost_exhausted
    )
    pool_exhausted = (pool_cap > 0 and (float(pool_used) + est_debit) > float(pool_cap)) or provider_cost_exhausted
    uses_community_pool = (
        surface in ai_usage.STEVE_SURFACES
        and pool_active
        and pool_has_room
        and (
            (bool(ent.get("can_use_steve")) and premium_priority)
            or (
                not ent.get("can_use_steve")
                and free_member_pool_access
                and member_ctx
            )
        )
    )
    ent["steve_billing_source"] = "community_pool" if uses_community_pool else "personal"
    ent["steve_billing_root_community_id"] = root_id if uses_community_pool else None
    ent["steve_community_provider_cost_exhausted"] = provider_cost_exhausted

    # 1. Tier gate — Premium/Special/Enterprise seat OR eligible pool member.
    if ent.get("can_use_steve"):
        pass
    else:
        if pool_active and free_member_pool_access and member_ctx and pool_has_room:
            pass
        elif (
            pool_active
            and free_member_pool_access
            and member_ctx
            and pool_exhausted
            and free_blocked_when_empty
        ):
            usage_snapshot = _snapshot(username, ent)
            payload, status = errs.build_error(
                errs.REASON_COMMUNITY_POOL_EXHAUSTED,
                ent=ent,
                usage=usage_snapshot,
                locale=locale,
            )
            ai_usage.log_block(
                username,
                surface=surface,
                reason=errs.REASON_COMMUNITY_POOL_EXHAUSTED,
                community_id=root_id,
            )
            return False, payload, status, ent
        else:
            payload, status = errs.build_error(
                errs.REASON_PREMIUM_REQUIRED, ent=ent, locale=locale
            )
            ai_usage.log_block(
                username,
                surface=surface,
                reason=errs.REASON_PREMIUM_REQUIRED,
                community_id=root_id,
            )
            return False, payload, status, ent

    # 2. Daily cap (rolling 24h).
    daily_cap = ent.get("ai_daily_limit")
    if not uses_community_pool and isinstance(daily_cap, int) and daily_cap > 0:
        used = ai_usage.daily_count(username)
        if used >= daily_cap:
            usage_snapshot = _snapshot(username, ent)
            payload, status = errs.build_error(
                errs.REASON_DAILY_CAP, ent=ent, usage=usage_snapshot, locale=locale
            )
            ai_usage.log_block(
                username,
                surface=surface,
                reason=errs.REASON_DAILY_CAP,
                community_id=root_id,
            )
            return False, payload, status, ent

    # 3. Monthly Steve cap (personal allowance) vs shared community pool.
    monthly_cap = ent.get("steve_uses_per_month")
    if surface in ai_usage.STEVE_SURFACES and isinstance(monthly_cap, int) and monthly_cap > 0:
        skip_personal_monthly = uses_community_pool
        if ent.get("can_use_steve"):
            if (
                pool_active
                and premium_priority
                and pool_exhausted
                and not fallback_when_empty
            ):
                usage_snapshot = _snapshot(username, ent)
                payload, status = errs.build_error(
                    errs.REASON_COMMUNITY_POOL_EXHAUSTED,
                    ent=ent,
                    usage=usage_snapshot,
                    locale=locale,
                )
                ai_usage.log_block(
                    username,
                    surface=surface,
                    reason=errs.REASON_COMMUNITY_POOL_EXHAUSTED,
                    community_id=root_id,
                )
                return False, payload, status, ent
        elif (
            not ent.get("can_use_steve")
            and pool_active
            and free_member_pool_access
            and member_ctx
            and pool_has_room
        ):
            skip_personal_monthly = True

        if not skip_personal_monthly:
            used_m = ai_usage.monthly_steve_count(username)
            if float(used_m) + est_debit > float(monthly_cap):
                usage_snapshot = _snapshot(username, ent)
                payload, status = errs.build_error(
                    errs.REASON_MONTHLY_STEVE_CAP,
                    ent=ent,
                    usage=usage_snapshot,
                    locale=locale,
                )
                ai_usage.log_block(
                    username,
                    surface=surface,
                    reason=errs.REASON_MONTHLY_STEVE_CAP,
                    community_id=root_id,
                )
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
                    errs.REASON_MONTHLY_WHISPER_CAP,
                    ent=ent,
                    usage=usage_snapshot,
                    locale=locale,
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
                    locale=locale,
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


def preflight_steve_mention(
    username: str,
    text: Optional[str],
    surface: str,
    *,
    community_id: Optional[Any] = None,
) -> Tuple[bool, Optional[Dict[str, Any]], Optional[int], Dict[str, Any]]:
    """Check whether a Steve mention may be persisted.

    Save-time preflight and reply generation must share the same entitlement
    decision, otherwise blocked Steve calls can leave user-authored mentions
    behind without a Steve reply.
    """
    if not mentions_steve(text):
        return True, None, None, {}
    if not entitlements_enforcement_enabled():
        return True, None, None, {}
    return check_steve_access(username, surface, community_id=community_id)


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
    community_id: Optional[Any] = None,
    estimated_credits_debit: Optional[float] = None,
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
        username,
        surface,
        duration_seconds=duration_seconds,
        community_id=community_id,
        estimated_credits_debit=estimated_credits_debit,
    )
    if allowed:
        return True, None, ent
    reason = (payload or {}).get("reason")
    if not enforce:
        # Flag off — pretend we allowed it but report the reason for logging.
        return True, reason, ent
    return False, reason, ent
