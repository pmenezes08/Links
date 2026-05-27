"""Password reset token lifecycle and email delivery."""

from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlparse

from flask import request
from werkzeug.security import generate_password_hash

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.email_normalization import canonical_email
from backend.services import transactional_email

logger = logging.getLogger(__name__)

TOKEN_MAX_AGE_HOURS = 24
RATE_LIMIT_MINUTES = 10

GENERIC_SUCCESS_MESSAGE = (
    "If an account exists with the provided information, a reset link has been sent."
)


def ensure_table(cursor) -> None:
    """Create password_reset_tokens if missing (MySQL/SQLite aware)."""
    try:
        if USE_MYSQL:
            cursor.execute(
                """CREATE TABLE IF NOT EXISTS password_reset_tokens (
                      id INTEGER PRIMARY KEY AUTO_INCREMENT,
                      username VARCHAR(191) NOT NULL,
                      email VARCHAR(191) NOT NULL,
                      token VARCHAR(191) NOT NULL UNIQUE,
                      created_at TEXT NOT NULL,
                      used TINYINT(1) DEFAULT 0
                    )"""
            )
        else:
            cursor.execute(
                """CREATE TABLE IF NOT EXISTS password_reset_tokens (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      username VARCHAR(191) NOT NULL,
                      email TEXT NOT NULL,
                      token TEXT NOT NULL UNIQUE,
                      created_at TEXT NOT NULL,
                      used INTEGER DEFAULT 0,
                      FOREIGN KEY (username) REFERENCES users (username)
                    )"""
            )
    except Exception as exc:
        logger.error("Failed ensuring password_reset_tokens table: %s", exc)


def _build_reset_url(token: str) -> str:
    scheme = (os.getenv("CANONICAL_SCHEME") or "https").lower()
    host = (os.getenv("CANONICAL_HOST") or "").strip()
    if not host:
        try:
            host = request.headers.get("Host") or ""
        except RuntimeError:
            host = ""
    if not host:
        try:
            parsed = urlparse(request.url_root)
            host = parsed.netloc
            if parsed.scheme:
                scheme = parsed.scheme
        except RuntimeError:
            pass
    base = f"{scheme}://{host}".rstrip("/") if host else ""
    if not base:
        try:
            base = request.host_url.rstrip("/")
        except RuntimeError:
            base = "https://app.c-point.co"
    return f"{base}/reset_password/{token}"


def _render_reset_email(reset_link: str) -> Tuple[str, str, str]:
    subject = "Reset your C-Point password"
    html = f"""
        <div style='font-family:Arial,sans-serif;font-size:14px;color:#111'>
          <p>We received a request to reset the password for your C-Point account.</p>
          <p><a href='{reset_link}' style='display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none'>Reset Password</a></p>
          <p>Or open this link: <a href='{reset_link}'>{reset_link}</a></p>
          <p>This link expires in 24 hours. If you did not request this, you can ignore this email.</p>
        </div>
    """
    text = (
        "We received a request to reset the password for your C-Point account.\n\n"
        f"Reset your password: {reset_link}\n\n"
        "This link expires in 24 hours. If you did not request this, you can ignore this email."
    )
    return subject, html, text


def _find_username_by_email(cursor, email: str) -> Optional[str]:
    ph = get_sql_placeholder()
    canon = canonical_email(email)
    cursor.execute(
        f"SELECT username FROM users WHERE canonical_email = {ph} OR LOWER(email) = LOWER({ph})",
        (canon, email.strip()),
    )
    row = cursor.fetchone()
    if not row:
        return None
    return row["username"] if hasattr(row, "keys") else row[0]


def _token_row_valid(row: Any) -> Tuple[bool, Optional[str]]:
    """Return (ok, username) for a token row."""
    if not row:
        return False, None
    username = row["username"] if hasattr(row, "keys") else row[0]
    used = row["used"] if hasattr(row, "keys") else row[2]
    created_raw = row["created_at"] if hasattr(row, "keys") else row[1]
    if used:
        return False, None
    try:
        created_at = datetime.fromisoformat(str(created_raw))
    except (TypeError, ValueError):
        return False, None
    if datetime.now() - created_at > timedelta(hours=TOKEN_MAX_AGE_HOURS):
        return False, None
    return True, username


def request_reset(email: str) -> Dict[str, Any]:
    """Issue a reset token and send email when a matching account exists."""
    email = (email or "").strip()
    if not email:
        return {"success": True, "message": GENERIC_SUCCESS_MESSAGE}

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            ensure_table(cursor)
            username = _find_username_by_email(cursor, email)
            if not username:
                return {"success": True, "message": GENERIC_SUCCESS_MESSAGE}

            ph = get_sql_placeholder()
            cursor.execute(
                f"""
                SELECT created_at FROM password_reset_tokens
                WHERE username = {ph} AND used = 0
                ORDER BY id DESC LIMIT 1
                """,
                (username,),
            )
            last = cursor.fetchone()
            if last:
                last_raw = last["created_at"] if hasattr(last, "keys") else last[0]
                try:
                    last_time = datetime.fromisoformat(str(last_raw))
                    if datetime.now() - last_time < timedelta(minutes=RATE_LIMIT_MINUTES):
                        return {"success": True, "message": GENERIC_SUCCESS_MESSAGE}
                except (TypeError, ValueError):
                    pass

            token = secrets.token_urlsafe(32)
            created_at = datetime.now().isoformat()
            cursor.execute(
                f"DELETE FROM password_reset_tokens WHERE username = {ph} AND used = 0",
                (username,),
            )
            ins_ph = ", ".join([ph] * 4)
            cursor.execute(
                f"""
                INSERT INTO password_reset_tokens (username, email, token, created_at)
                VALUES ({ins_ph})
                """,
                (username, email, token, created_at),
            )
            conn.commit()

            reset_link = _build_reset_url(token)
            subject, html, text = _render_reset_email(reset_link)
            sent_ok = transactional_email.send(email, subject, html, text=text)
            logger.info(
                "Password reset email for %s: sent=%s",
                username,
                sent_ok,
            )
    except Exception as exc:
        logger.error("Error in password reset request: %s", exc)

    return {"success": True, "message": GENERIC_SUCCESS_MESSAGE}


def get_token_context(token: str) -> Optional[Dict[str, str]]:
    """Return {username, token} when token is valid for the reset form."""
    if not token:
        return None
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            ph = get_sql_placeholder()
            cursor.execute(
                f"""
                SELECT username, created_at, used
                FROM password_reset_tokens
                WHERE token = {ph}
                """,
                (token,),
            )
            row = cursor.fetchone()
            ok, username = _token_row_valid(row)
            if not ok or not username:
                return None
            return {"username": username, "token": token}
    except Exception as exc:
        logger.error("get_token_context error: %s", exc)
        return None


def complete_reset(token: str, new_password: str, confirm_password: str) -> Tuple[bool, str]:
    """Apply a new password. Returns (success, message_or_error_key)."""
    if not new_password or not confirm_password:
        return False, "Please fill in all fields."
    if new_password != confirm_password:
        return False, "Passwords do not match."
    if len(new_password) < 6:
        return False, "Password must be at least 6 characters long."

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            ph = get_sql_placeholder()
            cursor.execute(
                f"""
                SELECT username, created_at, used
                FROM password_reset_tokens
                WHERE token = {ph}
                """,
                (token,),
            )
            row = cursor.fetchone()
            ok, username = _token_row_valid(row)
            if not ok or not username:
                return False, "Invalid or expired reset link."

            hashed = generate_password_hash(new_password)
            cursor.execute(
                f"UPDATE users SET password = {ph} WHERE username = {ph}",
                (hashed, username),
            )
            cursor.execute(
                f"UPDATE password_reset_tokens SET used = 1 WHERE token = {ph}",
                (token,),
            )
            conn.commit()
            return True, "Your password has been reset successfully."
    except Exception as exc:
        logger.error("complete_reset error: %s", exc)
        return False, "An error occurred. Please try again."
