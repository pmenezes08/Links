"""ETag / 304 conditional-response helper for cacheable GET JSON endpoints.

On a weak/repeat connection, every poll or revisit currently re-downloads the
full JSON body even when nothing changed (all `/api/` JSON defaults to
`no-store`). Attaching a content ETag + `must-revalidate` lets the client send
`If-None-Match` and get an empty **304 Not Modified** instead of the whole body.

The global ``add_cache_headers`` after-request hook is non-clobbering — it only
applies `private, no-store` when the handler did not already set Cache-Control —
so setting the header here wins. Bodies stay **private** (per-user), so this
never enables shared/intermediary caching.
"""

from __future__ import annotations

import hashlib
from typing import Any

from flask import Response, jsonify, request


def json_with_etag(payload: Any, *, max_age: int = 0) -> Response:
    """``jsonify(payload)`` plus a content ETag and revalidate headers.

    Returns a **304** (empty body) when the request's ``If-None-Match`` matches
    the current body, otherwise a normal 200 with the ETag set. Any failure in
    conditional handling degrades gracefully to the plain 200 response.
    """
    resp = jsonify(payload)
    try:
        body = resp.get_data()
        # md5 is a cache key here, not a security primitive.
        resp.set_etag(hashlib.md5(body).hexdigest())  # noqa: S324
        resp.headers["Cache-Control"] = f"private, max-age={max_age}, must-revalidate"
        return resp.make_conditional(request)
    except Exception:
        return resp
