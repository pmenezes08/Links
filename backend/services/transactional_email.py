"""Transactional email via Resend API."""

from __future__ import annotations

import logging
import os
from typing import Optional

import requests

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.getenv("RESEND_API_KEY")
EMAIL_FROM = os.getenv("EMAIL_FROM", "C-Point <no-reply@c-point.co>")


def send(
    to_email: str,
    subject: str,
    html: str,
    *,
    text: Optional[str] = None,
) -> bool:
    """Send a single transactional email. Returns True when Resend accepts the send."""
    if not RESEND_API_KEY:
        logger.error("RESEND_API_KEY not set; skipping email send")
        return False
    try:
        payload = {
            "from": EMAIL_FROM,
            "to": [to_email],
            "subject": subject,
            "html": html,
        }
        if text:
            payload["text"] = text
        response = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json=payload,
            timeout=15,
        )
        if response.status_code in (200, 201):
            logger.info("Resend email queued successfully to=%s", to_email)
            return True
        logger.error("Resend send failed: %s %s", response.status_code, response.text)
        return False
    except Exception as exc:
        logger.error("Resend send exception: %s", exc)
        return False
