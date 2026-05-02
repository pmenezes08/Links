"""``/api/profile_me`` — the canonical "who am I right now" endpoint.

Replaces the version that lived in [bodybuilding_app.py][1]. Two important
differences from the legacy handler:

  1.  **Login epoch** — every successful response carries the ``login_id``
      that ``backend.services.auth_session.establish_login`` minted for this
      session. The client compares it with the value it cached at login
      time; a mismatch means the user logged out and back in (or a new
      account took over the session) and triggers a full client-side state
      wipe before any data is rendered. This is the second-line defense
      against cross-account leakage that complements PR 1's SW + no-store
      headers.
  2.  **Service split** — the SQL + row mapping live in
      :mod:`backend.services.profile_loader`; this module is just the HTTP
      shell + Redis cache + login-epoch wiring. Lets us unit-test the data
      layer without spinning up Flask.

[1]: ../../bodybuilding_app.py
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from flask import Blueprint, jsonify, request, session

from backend.services import auth_session
from backend.services.profile_loader import load_profile


profile_me_bp = Blueprint("profile_me", __name__)
logger = logging.getLogger(__name__)


def _bypass_cache_requested() -> bool:
    """Return True if the client asked for a fresh DB read."""
    return bool(
        request.args.get("_nocache")
        or request.args.get("nocache")
        or request.args.get("refresh")
    )


def _no_store(response):
    """Stamp transition-style cache headers on top of the global no-store policy.

    Keeps the global :func:`backend.services.http_headers.apply_api_cache_policy`
    contract explicit at the route level — if the global hook is ever
    misconfigured, this still guarantees the response cannot be cached by
    intermediaries.
    """
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@profile_me_bp.route("/api/profile_me", methods=["GET"])
def api_profile_me():
    """Return the signed-in user's profile + login epoch.

    Response shape (unchanged from the monolith):

    .. code-block:: json

        {
          "success": true,
          "profile": { ... },
          "login_id": "<uuid4>"
        }

    The ``login_id`` was added in PR 2; older clients ignore it. Newer
    clients (``client/src/App.tsx``) compare it against
    ``localStorage.last_login_id`` and trigger ``resetAllAccountState`` on
    mismatch.
    """
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401

    login_id = session.get("login_id") or ""

    cache_key = f"profile:{username}"
    cached_profile: Dict[str, Any] | None = None
    if not _bypass_cache_requested():
        try:
            from redis_cache import cache as _cache

            cached_profile = _cache.get(cache_key)
        except Exception:
            logger.exception("profile_me: redis cache get failed for %s", username)

    if cached_profile:
        logger.debug("profile_me cache hit for %s", username)
        return _no_store(
            jsonify(
                {
                    "success": True,
                    "profile": cached_profile,
                    "login_id": login_id,
                }
            )
        )

    try:
        profile = load_profile(username)
    except Exception as exc:
        logger.exception("profile_me: load_profile failed for %s: %s", username, exc)
        return jsonify({"success": False, "error": "server error"}), 500

    if not profile:
        return jsonify({"success": False, "error": "not found"}), 404

    try:
        from redis_cache import USER_CACHE_TTL, cache as _cache

        _cache.set(cache_key, profile, USER_CACHE_TTL)
    except Exception:
        logger.exception("profile_me: redis cache set failed for %s", username)

    return _no_store(
        jsonify(
            {
                "success": True,
                "profile": profile,
                "login_id": login_id,
            }
        )
    )


__all__ = ["profile_me_bp"]


# auth_session is imported above to keep the module-level dependency obvious;
# we don't use it directly today but PR 3 will add a "rotate login_id on
# subscription change" call here, so leaving the import documents intent.
_ = auth_session
