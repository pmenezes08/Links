"""OAuth-attested email verification timestamps for SQL `users` rows.

Google ID tokens (and similar) include `email_verified`. When true, we set
`email_verified_at` if still NULL so client flows that key off a recent
verification (e.g. dashboard onboarding) behave like invite / link signup.
"""

from __future__ import annotations

from datetime import datetime


def first_oauth_verified_at_iso() -> str:
    """ISO timestamp for `users.email_verified_at`, aligned with invite signup in auth blueprint."""
    return datetime.now().isoformat()


def apply_oauth_email_verified(cursor, ph: str, username: str, oauth_email_verified: bool) -> None:
    """If the IdP attests the email is verified, set verified flag and first-seen timestamp.

    Uses COALESCE on `email_verified_at` so an existing value is never overwritten.
    No-op when ``oauth_email_verified`` is false.
    """
    if not oauth_email_verified:
        return
    ts = first_oauth_verified_at_iso()
    cursor.execute(
        f"UPDATE users SET email_verified = 1, email_verified_at = COALESCE(email_verified_at, {ph}) WHERE username = {ph}",
        (ts, username),
    )
