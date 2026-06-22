"""Client for the `cpoint-render` headless-Chromium worker.

Renders a self-contained HTML artifact in real Chromium and returns a PNG
screenshot plus diagnostics (console errors, blank/overflow flags). Used only
on the ASYNC build path to feed the vision-judge and detect render failures.

Best-effort by design: every call returns ``None`` on any problem (no service
URL configured, auth failure, timeout, render error) so a build degrades to
"no render verification" instead of failing. Never raises.

Auth is two-layer, matching how the service is deployed:
- Cloud Run IAM — the worker is private (`--no-allow-unauthenticated`); we send a
  Google-signed ID token for the worker's URL (audience), fetched from the
  instance metadata server. Only works on Cloud Run; ``None`` locally.
- A shared secret header (`X-Render-Secret`) as defence in depth.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)

# (connect, read) — a cold worker may take a few seconds to launch Chromium.
# Read timeout is caller-tunable so a render can't overrun a wall-clock budget.
_CONNECT_TIMEOUT = 5
_DEFAULT_READ_TIMEOUT = 45
_METADATA_IDENTITY_URL = (
    "http://metadata.google.internal/computeMetadata/v1/"
    "instance/service-accounts/default/identity"
)


def _service_url() -> str:
    return (os.environ.get("RENDER_SERVICE_URL") or "").rstrip("/")


def is_configured() -> bool:
    """True when a render service URL is set — gate the whole render pipeline on this."""
    return bool(_service_url())


def _id_token(audience: str) -> Optional[str]:
    """Google-signed ID token for ``audience`` via the metadata server.

    Present on Cloud Run; returns ``None`` off-GCP (local/dev), where Cloud Run
    IAM isn't enforced anyway."""
    try:
        r = requests.get(
            _METADATA_IDENTITY_URL,
            params={"audience": audience},
            headers={"Metadata-Flavor": "Google"},
            timeout=(2, 5),
        )
        if r.status_code == 200 and r.text:
            return r.text.strip()
    except Exception:
        pass
    return None


def render(html: str, *, width: int = 420, height: int = 760,
           full_page: bool = True, read_timeout: float = _DEFAULT_READ_TIMEOUT) -> Optional[Dict[str, Any]]:
    """Render ``html`` and return ``{screenshot, console_errors, dimensions,
    blank, overflow}`` — or ``None`` on any failure (degrade gracefully).
    ``read_timeout`` caps the wait so a slow render can't overrun the caller's budget."""
    url = _service_url()
    if not url or not html:
        return None

    headers = {"Content-Type": "application/json"}
    secret = os.environ.get("RENDER_SHARED_SECRET")
    if secret:
        headers["X-Render-Secret"] = secret
    token = _id_token(url)
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        resp = requests.post(
            f"{url}/render",
            json={"html": html, "width": width, "height": height, "full_page": full_page},
            headers=headers,
            timeout=(_CONNECT_TIMEOUT, max(10.0, float(read_timeout))),
        )
    except Exception:
        logger.warning("render_service: request to %s failed", url, exc_info=True)
        return None

    if resp.status_code != 200:
        logger.warning("render_service: %s/render -> HTTP %s", url, resp.status_code)
        return None
    try:
        data = resp.json()
    except Exception:
        logger.warning("render_service: non-JSON response", exc_info=True)
        return None
    if not isinstance(data, dict) or data.get("error"):
        logger.info("render_service: render error: %s",
                    (data or {}).get("error") if isinstance(data, dict) else "bad_payload")
        return None
    if not data.get("screenshot"):
        return None
    return data
