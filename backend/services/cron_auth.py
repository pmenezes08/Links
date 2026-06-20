"""Shared Cloud Scheduler / internal-worker authentication.

Cron and internal-worker endpoints are invoked by Cloud Scheduler / Cloud Tasks,
not by a logged-in browser session, so they authenticate with a shared secret
header (``X-Cron-Secret``) rather than a cookie. Centralizing the check here
keeps every endpoint consistent (constant-time compare, non-enumerating,
uniform failure shape) instead of re-implementing the ad-hoc check per route.
"""

from __future__ import annotations

import hmac
import os
from typing import Optional


def _const_eq(provided: str, expected: str) -> bool:
    return bool(provided) and bool(expected) and hmac.compare_digest(provided, expected)


def cron_authed(request, *, extra_secret_env: Optional[str] = None,
                extra_header: Optional[str] = None) -> bool:
    """Return True when the request carries a valid shared secret.

    Accepts the standard ``X-Cron-Secret`` header matched against
    ``CRON_SHARED_SECRET``. Endpoints also invoked by Cloud Tasks may accept a
    dedicated secret/header pair (e.g. builder jobs use ``X-Builder-Job-Secret``
    matched against ``BUILDER_JOB_SECRET``).
    """
    expected = (os.environ.get("CRON_SHARED_SECRET") or "").strip()
    provided = (request.headers.get("X-Cron-Secret") or "").strip()
    if _const_eq(provided, expected):
        return True
    if extra_secret_env:
        extra_expected = (os.environ.get(extra_secret_env) or "").strip()
        extra_provided = (request.headers.get(extra_header or "X-Cron-Secret") or "").strip()
        if _const_eq(extra_provided, extra_expected):
            return True
    return False
