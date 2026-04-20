"""Matrix C3 — Signup canonical-email uniqueness (integration).

These tests exercise the *SQL-level* uniqueness check that protects
against the dot/plus alias trick. We don't boot Flask — we just replay
the SELECT the signup handler does and assert it detects a collision.

This is the contract the signup blueprint relies on. If anything here
fails, one user can farm N free trials by re-casing + re-dotting their
Gmail alias, which blows the entitlements budget.

Maps to the KB Tests-page row ``signup:canonical_uniqueness``.
"""

from __future__ import annotations

import pytest

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.email_normalization import canonicalize_with_policy

from tests.fixtures import make_user


def _signup_collision_check(email: str) -> bool:
    """Replay the signup-handler uniqueness test. Returns True on collision."""
    canonical = canonicalize_with_policy(email)
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT 1 FROM users WHERE canonical_email={ph} OR email={ph}",
            (canonical, email),
        )
        return c.fetchone() is not None


def _insert_as_signup_does(username: str, email: str) -> None:
    """Replay the INSERT path — writes both raw email and canonical_email."""
    canonical = canonicalize_with_policy(email)
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO users (username, email, canonical_email, subscription)
            VALUES ({ph}, {ph}, {ph}, 'free')
            """,
            (username, email, canonical),
        )
        try:
            conn.commit()
        except Exception:
            pass


def test_exact_duplicate_email_is_blocked():
    _insert_as_signup_does("alice1", "alice@example.com")
    assert _signup_collision_check("alice@example.com") is True


def test_gmail_dot_alias_is_blocked():
    """The core dot-alias trick. First signup wins; second must collide."""
    _insert_as_signup_does("alice1", "alice.smith@gmail.com")
    assert _signup_collision_check("alicesmith@gmail.com") is True
    assert _signup_collision_check("a.l.i.c.e.smith@gmail.com") is True


def test_gmail_plus_alias_is_blocked():
    _insert_as_signup_does("alice1", "alice@gmail.com")
    assert _signup_collision_check("alice+newsletter@gmail.com") is True
    assert _signup_collision_check("alice+spam@gmail.com") is True


def test_gmail_combined_dot_and_plus_alias_is_blocked():
    _insert_as_signup_does("alice1", "alicesmith@gmail.com")
    assert _signup_collision_check("Alice.Smith+promo@gmail.com") is True


def test_different_gmail_user_is_not_blocked():
    """Don't over-collapse — different people must be allowed through."""
    _insert_as_signup_does("alice1", "alice.smith@gmail.com")
    assert _signup_collision_check("bob.smith@gmail.com") is False
    assert _signup_collision_check("alice.jones@gmail.com") is False


def test_non_gmail_dots_are_not_collapsed():
    """Corporate domains may treat first.last and firstlast as different."""
    _insert_as_signup_does("alice1", "alice.smith@mycompany.io")
    # 'alicesmith@mycompany.io' is a *different* person for non-dot-
    # insignificant domains. We MUST let them sign up.
    assert _signup_collision_check("alicesmith@mycompany.io") is False


def test_legacy_user_with_null_canonical_still_collides_on_raw_email():
    """Rows that predate the column have NULL canonical_email — the OR
    clause in the signup check must still catch exact-email collisions."""
    # Emulate a legacy row by using make_user (doesn't set canonical_email).
    make_user("legacy1", email="legacy@example.com")
    assert _signup_collision_check("legacy@example.com") is True


def test_fresh_email_passes_the_check():
    _insert_as_signup_does("alice1", "alice@gmail.com")
    assert _signup_collision_check("completely-different@gmail.com") is False


def test_case_insensitive_collision():
    _insert_as_signup_does("alice1", "alice@example.com")
    assert _signup_collision_check("ALICE@example.com") is True
    assert _signup_collision_check("Alice@Example.Com") is True
