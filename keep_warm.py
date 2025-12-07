#!/usr/bin/env python3
"""
Simple keep-warm script for PythonAnywhere.

Continuously pings key application endpoints so Gunicorn workers stay
hot and ready to serve real traffic without cold-start latency.
"""

from __future__ import annotations

import os
import time
import urllib.error
import urllib.request


DEFAULT_INTERVAL = 60  # seconds
URLS = [
    "https://app.c-point.co/premium_dashboard",
    "https://app.c-point.co/api/profile_me",
]


def fetch(url: str, timeout: float = 10) -> None:
    """Fire-and-forget GET request with basic logging."""
    headers = {}
    cookie = os.environ.get("KEEP_WARM_COOKIE")
    if cookie:
        headers["Cookie"] = cookie

    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = response.getcode()
            print(f"[keep-warm] {url} -> {status}")
    except urllib.error.HTTPError as http_err:
        # 401 is expected for auth-protected endpoints when no cookie is provided
        if http_err.code == 401 and not cookie:
            print(f"[keep-warm] {url} -> 401 (unauthorized, no cookie provided)")
            return
        print(f"[keep-warm] HTTP {http_err.code} for {url}: {http_err.reason}")
    except Exception as exc:  # pragma: no cover - best effort logging
        print(f"[keep-warm] error requesting {url}: {exc}")


def main() -> None:
    interval = float(os.environ.get("KEEP_WARM_INTERVAL", DEFAULT_INTERVAL))
    print(f"[keep-warm] starting, interval={interval}s, urls={URLS}")
    while True:
        start = time.time()
        for url in URLS:
            fetch(url)
        elapsed = time.time() - start
        sleep_for = max(0.0, interval - elapsed)
        time.sleep(sleep_for)


if __name__ == "__main__":
    main()
