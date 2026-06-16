"""Unit tests for the ETag/304 helper. No DB — runs without the MySQL testcontainer."""

from __future__ import annotations

from flask import Flask

from backend.services.http_conditional import json_with_etag


def _app_returning(payload):
    app = Flask(__name__)

    @app.route("/thing")
    def thing():  # noqa: ANN202
        return json_with_etag(payload)

    return app


def test_returns_etag_and_revalidate_headers():
    client = _app_returning({"a": 1, "b": [1, 2, 3]}).test_client()
    r = client.get("/thing")
    assert r.status_code == 200
    assert r.headers.get("ETag")
    assert "must-revalidate" in r.headers.get("Cache-Control", "")
    assert "private" in r.headers.get("Cache-Control", "")


def test_matching_if_none_match_returns_304_empty_body():
    client = _app_returning({"a": 1}).test_client()
    etag = client.get("/thing").headers["ETag"]
    r = client.get("/thing", headers={"If-None-Match": etag})
    assert r.status_code == 304
    assert r.get_data() == b""


def test_etag_differs_for_different_bodies():
    a = _app_returning({"x": 1}).test_client().get("/thing").headers["ETag"]
    b = _app_returning({"x": 2}).test_client().get("/thing").headers["ETag"]
    assert a != b
