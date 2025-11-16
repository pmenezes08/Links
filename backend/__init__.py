"""Backend package initialization helpers."""

from __future__ import annotations

from flask import Flask

from .blueprints import register_blueprints


def init_app(app: Flask) -> None:
    """Attach blueprints and future extensions to the given Flask app."""
    register_blueprints(app)
