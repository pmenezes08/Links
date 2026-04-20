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
    from .content_generation import content_generation_bp
    from .group_chat import group_chat_bp
    from .admin_users import admin_users_bp
    from .knowledge_base import knowledge_base_bp
    from .me import me_bp
    from .steve_chat import steve_chat_bp
    from .summaries import summaries_bp
    from .enterprise import enterprise_bp
    from .subscription_webhooks import subscription_webhooks_bp

    app.register_blueprint(public_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(onboarding_bp)
    app.register_blueprint(notifications_bp)
    app.register_blueprint(communities_bp)
    app.register_blueprint(content_generation_bp)
    app.register_blueprint(group_chat_bp)
    app.register_blueprint(admin_users_bp)
    app.register_blueprint(knowledge_base_bp)
    app.register_blueprint(me_bp)
    app.register_blueprint(steve_chat_bp)
    app.register_blueprint(summaries_bp)
    app.register_blueprint(enterprise_bp)
    app.register_blueprint(subscription_webhooks_bp)
