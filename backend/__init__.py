"""Backend package initialization helpers."""

from __future__ import annotations

from flask import Flask

from .blueprints import register_blueprints


def init_app(app: Flask) -> None:
    """Attach blueprints, response-header policies, and CLI commands."""
    from .services.http_headers import init_app as _init_http_headers

    _init_http_headers(app)
    register_blueprints(app)

    # Register the Steve community-welcome backfill CLI command. Doing this
    # here keeps the registration off the monolith hot path while ensuring
    # ``flask backfill-steve-welcome`` is available wherever the app is
    # constructed (web, CLI, tests).
    try:
        from .services.steve_community_welcome import register_cli as _register_welcome_cli

        _register_welcome_cli(app)
    except Exception as exc:  # pragma: no cover - defensive
        app.logger.warning(
            "init_app: could not register steve welcome CLI: %s", exc
        )
