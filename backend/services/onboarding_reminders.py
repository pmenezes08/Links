"""Deferred onboarding reminder dispatch."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from backend.services.notifications import create_notification
from backend.services.onboarding_session import _parse_iso_utc

logger = logging.getLogger(__name__)

REMINDERS = (
    (
        24,
        "onboarding_reminder_24h_sent_at",
        "onboarding_reminder_24h",
        "Your C-Point profile is saved. Continue onboarding when you have a minute.",
    ),
    (
        48,
        "onboarding_reminder_48h_sent_at",
        "onboarding_reminder_48h",
        "A gentle reminder to finish your C-Point profile so people can understand who you are in your communities.",
    ),
)


def _firestore_client():
    from backend.services.firestore_reads import _get_client

    return _get_client()


def _doc_to_dict(snapshot: Any) -> Dict[str, Any]:
    if hasattr(snapshot, "to_dict"):
        return snapshot.to_dict() or {}
    if isinstance(snapshot, dict):
        return snapshot
    return {}


def _doc_id(snapshot: Any) -> str:
    return str(getattr(snapshot, "id", "") or "")


def _doc_ref(snapshot: Any) -> Optional[Any]:
    return getattr(snapshot, "reference", None)


def dispatch_onboarding_reminders(
    *,
    db: Optional[Any] = None,
    now_utc: Optional[datetime] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Send 24h/48h reminders once for deferred, incomplete onboarding."""
    now = now_utc or datetime.now(timezone.utc)
    fs = db or _firestore_client()
    checked = 0
    sent = 0
    skipped = 0

    try:
        snapshots = fs.collection("steve_onboarding").stream()
    except Exception as exc:
        logger.warning("onboarding reminders: firestore stream failed: %s", exc)
        return {"success": False, "error": "firestore_unavailable", "checked": 0, "sent": 0}

    for snap in snapshots:
        checked += 1
        username = _doc_id(snap)
        doc = _doc_to_dict(snap)
        if not username or doc.get("completed_at") or doc.get("stage") == "complete":
            skipped += 1
            continue

        deferred_at = _parse_iso_utc(doc.get("profile_deferred_at"))
        defer_until = _parse_iso_utc(doc.get("profile_defer_until"))
        if not deferred_at or (defer_until and defer_until <= now):
            skipped += 1
            continue

        age_hours = (now - deferred_at).total_seconds() / 3600
        markers: Dict[str, str] = {}
        for threshold_hours, marker_key, notification_type, message in REMINDERS:
            if age_hours < threshold_hours or doc.get(marker_key):
                continue
            if not dry_run:
                create_notification(
                    username,
                    "Steve",
                    notification_type,
                    None,
                    None,
                    message,
                    link="/premium_dashboard",
                    preview_text=message,
                )
                markers[marker_key] = now.isoformat()
            sent += 1

        if markers and not dry_run:
            ref = _doc_ref(snap)
            if ref:
                try:
                    ref.set({**markers, "updated_at": now.isoformat()}, merge=True)
                except Exception as exc:
                    logger.warning("onboarding reminders: marker write failed for %s: %s", username, exc)

    return {"success": True, "checked": checked, "sent": sent, "skipped": skipped, "dry_run": dry_run}
