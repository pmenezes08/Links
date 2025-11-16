"""Blueprint registry for the backend package."""

from __future__ import annotations

from flask import Flask


def register_blueprints(app: Flask) -> None:
    """Register all blueprints with the provided Flask application."""
    from .public import public_bp

    app.register_blueprint(public_bp)
