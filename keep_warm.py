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
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            status = response.getcode()
            print(f"[keep-warm] {url} -> {status}")
    except urllib.error.HTTPError as http_err:
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
