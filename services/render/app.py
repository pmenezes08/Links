"""cpoint-render — an isolated headless-Chromium render worker.

`POST /render { html, width?, height?, full_page? }` renders a self-contained
HTML document and returns a PNG screenshot plus render diagnostics (console
errors, scroll dimensions, blank/overflow flags). Consumed by the Steve Builder
pipeline in the main app (cpoint-app) to screenshot generated artifacts for the
vision-judge and to detect render failures.

Design notes:
- **Private service** — every request must carry the shared secret (mirrors the
  `/api/cron/*` `X-Cron-Secret` pattern). Fails closed if no secret is set.
- **Stateless, fresh browser per request** — build volume is low and async, so
  the ~1s launch cost is worth the crash isolation (no shared-browser zombies).
- Renders never raise to the caller: a render failure returns HTTP 200 with
  `error` set so the builder degrades gracefully instead of failing a build.
"""

from __future__ import annotations

import base64
import hmac
import logging
import os

from flask import Flask, jsonify, request
from playwright.sync_api import sync_playwright

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cpoint-render")

app = Flask(__name__)

_SECRET = os.environ.get("RENDER_SHARED_SECRET", "")
_MAX_HTML_BYTES = 5 * 1024 * 1024          # generous ceiling; artifacts are ~tens of KB
_DEFAULT_W, _DEFAULT_H = 420, 760          # mobile-first, matches the app's play surface
_NAV_TIMEOUT_MS = 15000
_IDLE_TIMEOUT_MS = 4000


def _authorized(req) -> bool:
    """Constant-time secret check. Refuses when no secret is configured."""
    got = req.headers.get("X-Render-Secret", "")
    return bool(_SECRET) and hmac.compare_digest(got, _SECRET)


@app.get("/healthz")
def healthz():
    return jsonify(ok=True)


@app.post("/render")
def render():
    if not _authorized(request):
        return jsonify(error="unauthorized"), 401

    body = request.get_json(silent=True) or {}
    html = body.get("html")
    if not isinstance(html, str) or not html.strip():
        return jsonify(error="missing_html"), 400
    if len(html.encode("utf-8")) > _MAX_HTML_BYTES:
        return jsonify(error="html_too_large"), 413

    try:
        width = max(200, min(1600, int(body.get("width") or _DEFAULT_W)))
        height = max(200, min(2400, int(body.get("height") or _DEFAULT_H)))
    except (TypeError, ValueError):
        width, height = _DEFAULT_W, _DEFAULT_H
    full_page = bool(body.get("full_page", True))

    console_errors: list[str] = []

    def _on_console(msg) -> None:
        if msg.type == "error":
            console_errors.append(f"console.error: {msg.text}"[:300])

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
            )
            try:
                page = browser.new_page(
                    viewport={"width": width, "height": height},
                    device_scale_factor=2,
                )
                page.on("console", _on_console)
                page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"[:300]))
                page.set_content(html, wait_until="load", timeout=_NAV_TIMEOUT_MS)
                try:
                    page.wait_for_load_state("networkidle", timeout=_IDLE_TIMEOUT_MS)
                except Exception:
                    pass  # animations / timers may keep the page non-idle — that's fine
                metrics = page.evaluate(
                    "() => ({"
                    " sh: document.body ? document.body.scrollHeight : 0,"
                    " sw: document.body ? document.body.scrollWidth : 0,"
                    " text: (document.body ? document.body.innerText : '').trim().length,"
                    " nodes: document.querySelectorAll('body *').length })"
                )
                shot = page.screenshot(full_page=full_page, type="png")
            finally:
                browser.close()
    except Exception as e:  # never raise to the caller
        logger.warning("render failed: %s", e)
        return jsonify(error="render_failed", detail=str(e)[:300]), 200

    blank = metrics.get("text", 0) == 0 and metrics.get("nodes", 0) <= 2
    overflow = metrics.get("sw", 0) > width + 4
    return jsonify(
        screenshot=base64.b64encode(shot).decode("ascii"),
        console_errors=console_errors[:30],
        dimensions={
            "scroll_height": metrics.get("sh", 0),
            "scroll_width": metrics.get("sw", 0),
            "viewport": {"width": width, "height": height},
        },
        blank=blank,
        overflow=overflow,
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
