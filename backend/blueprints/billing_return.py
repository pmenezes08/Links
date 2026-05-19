"""Public Stripe billing return page.

Stripe Customer Portal returns users here instead of a protected app route.
That matters on iOS where the browser session may not be logged in even
though the native app is.
"""

from __future__ import annotations

from html import escape
from urllib.parse import quote

from flask import Blueprint, request


billing_return_bp = Blueprint("billing_return", __name__)


@billing_return_bp.route("/billing_return", methods=["GET"])
def billing_return_page():
    target = escape(request.args.get("target") or "personal")
    item_id = escape(request.args.get("id") or "")
    return_path = request.args.get("return_path") or "/premium_dashboard"
    if not return_path.startswith("/"):
        return_path = "/premium_dashboard"
    deep_link = f"cpoint://billing_return?target={quote(target)}&id={quote(item_id)}&return_path={quote(return_path)}"
    web_fallback = escape(return_path)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Return to C-Point</title>
  <style>
    body {{ margin:0; min-height:100vh; display:grid; place-items:center; background:#050505; color:#f7fbfb; font-family:Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    main {{ width:min(440px, calc(100vw - 32px)); border:1px solid rgba(255,255,255,.14); border-radius:24px; padding:28px; background:rgba(255,255,255,.04); }}
    h1 {{ margin:0 0 10px; font-size:26px; }}
    p {{ color:rgba(247,251,251,.72); line-height:1.55; }}
    a {{ display:block; text-align:center; border-radius:999px; padding:13px 16px; text-decoration:none; font-weight:700; }}
    .primary {{ background:#00CEC8; color:#001010; margin-top:22px; }}
    .secondary {{ border:1px solid rgba(255,255,255,.18); color:#f7fbfb; margin-top:10px; }}
  </style>
</head>
<body>
  <main>
    <h1>Return to C-Point</h1>
    <p>Your billing changes are being processed. Open the app to continue, or use the web fallback if you are managing billing from a browser.</p>
    <a class="primary" href="{escape(deep_link)}">Return to C-Point app</a>
    <a class="secondary" href="{web_fallback}">Continue on web</a>
  </main>
</body>
</html>"""
