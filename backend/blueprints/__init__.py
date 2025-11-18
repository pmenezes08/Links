"""Blueprint registry for the backend package."""

from __future__ import annotations

from flask import Flask


def register_blueprints(app: Flask) -> None:
    """Register all blueprints with the provided Flask application."""
    from .public import public_bp
    from .auth import auth_bp
    from .onboarding import onboarding_bp
    from .notifications import notifications_bp
    from .communities import communities_bp

    app.register_blueprint(public_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(onboarding_bp)
    app.register_blueprint(notifications_bp)
    app.register_blueprint(communities_bp)
