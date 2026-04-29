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
    from .post_views import post_views_bp
    from .content_generation import content_generation_bp
    from .group_chat import group_chat_bp
    from .admin_users import admin_users_bp
    from .knowledge_base import knowledge_base_bp
    from .me import me_bp
    from .steve_chat import steve_chat_bp
    from .summaries import summaries_bp
    from .enterprise import enterprise_bp
    from .subscription_webhooks import subscription_webhooks_bp
    from .subscriptions import subscriptions_bp
    from .admin_subscriptions import admin_subscriptions_bp
    from .billing_return import billing_return_bp
    from .dm_chats import dm_chats_bp
    from .steve_feedback import steve_feedback_bp
    from .community_stories import community_stories_bp
    from .community_invites import community_invites_bp
    from .media_assets import media_assets_bp
    from .community_calendar import community_calendar_bp
    from .steve_reminders import steve_reminders_bp

    app.register_blueprint(public_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(onboarding_bp)
    app.register_blueprint(notifications_bp)
    app.register_blueprint(communities_bp)
    app.register_blueprint(post_views_bp)
    app.register_blueprint(content_generation_bp)
    app.register_blueprint(group_chat_bp)
    app.register_blueprint(admin_users_bp)
    app.register_blueprint(knowledge_base_bp)
    app.register_blueprint(me_bp)
    app.register_blueprint(steve_chat_bp)
    app.register_blueprint(summaries_bp)
    app.register_blueprint(enterprise_bp)
    app.register_blueprint(subscription_webhooks_bp)
    app.register_blueprint(subscriptions_bp)
    app.register_blueprint(admin_subscriptions_bp)
    app.register_blueprint(billing_return_bp)
    app.register_blueprint(dm_chats_bp)
    app.register_blueprint(steve_feedback_bp)
    app.register_blueprint(community_stories_bp)
    app.register_blueprint(community_invites_bp)
    app.register_blueprint(media_assets_bp)
    app.register_blueprint(community_calendar_bp)
    app.register_blueprint(steve_reminders_bp)

    # Make sure the Stripe/community-billing columns exist before the
    # first webhook fires. Each service's ensure_tables() is already
    # idempotent; calling it here keeps schema drift from silently
    # breaking writes when the service is only reached via webhook.
    try:
        from backend.services import community_billing as _cb
        _cb.ensure_tables()
        from backend.services import user_billing as _ub
        _ub.ensure_tables()
        from backend.services import subscription_billing_ledger as _ledger
        _ledger.ensure_tables()
        from backend.services import community_lifecycle as _community_lifecycle
        _community_lifecycle.ensure_tables()
        from backend.services import media_assets as _media_assets
        _media_assets.ensure_tables()
        from backend.services import remember_tokens as _remember_tokens
        _remember_tokens.ensure_tables()
    except Exception:
        # Never let schema-bootstrap crash app startup — log and move on.
        import logging
        logging.getLogger(__name__).exception(
            "billing ensure_tables failed during blueprint registration"
        )

    try:
        from backend.services import community as _community
        _community.ensure_community_delete_cascade_constraints()
    except Exception:
        # Same startup rule: schema hardening should be visible in logs, not
        # take the app down.
        import logging
        logging.getLogger(__name__).exception(
            "community delete-cascade FK migration failed during blueprint registration"
        )
