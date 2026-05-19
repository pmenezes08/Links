"""Smoke tests for Premium CTA markdown in Steve DM replies."""

from __future__ import annotations

import os
from unittest.mock import patch


def test_premium_subscription_cta_contains_membership_markdown_link():
    from backend.services import steve_dm_reply as sdr

    with patch.dict(os.environ, {"PUBLIC_BASE_URL": "https://staging.example.run.app"}, clear=False):
        body = sdr._premium_subscription_dm_cta()
    assert "https://staging.example.run.app/account_settings/membership" in body
    assert "[Manage membership](" in body
