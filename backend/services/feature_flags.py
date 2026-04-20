"""Centralised feature-flag reader.

Every runtime-behaviour change lives behind a flag so we can kill it from
Cloud Run env vars without a redeploy. Flags are read lazily per call so
that ``gcloud run services update --update-env-vars`` takes effect on the
next request, not the next deploy.
"""

from __future__ import annotations

import os
from typing import Optional


_TRUE_VALUES = {"1", "true", "yes", "on", "enabled"}
_FALSE_VALUES = {"0", "false", "no", "off", "disabled"}


def _as_bool(raw: Optional[str], default: bool) -> bool:
    if raw is None:
        return default
    s = str(raw).strip().lower()
    if s in _TRUE_VALUES:
        return True
    if s in _FALSE_VALUES:
        return False
    return default


def is_enabled(name: str, default: bool = False) -> bool:
    """Return True if the flag is on. Reads ``os.environ`` every call."""
    return _as_bool(os.environ.get(name), default)


# Named helpers — preferred over raw name strings so typos fail at import.

def entitlements_enforcement_enabled() -> bool:
    """Master gate for entitlements enforcement (Wave 4).

    When **off** every Steve entry point uses its legacy hard-coded caps
    (``AI_DAILY_LIMIT``, etc.) exactly as before. When **on** the same
    paths call :func:`backend.services.entitlements.resolve_entitlements`
    and return the shared ``entitlements_error`` JSON when blocked.

    Default is ``False`` so a stray deploy can't accidentally flip
    behaviour in production. Staging sets the env var to ``true``.
    """
    return is_enabled("ENTITLEMENTS_ENFORCEMENT_ENABLED", default=False)
