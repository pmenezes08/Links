"""Branding asset settings shared by admin and public onboarding surfaces."""

from __future__ import annotations

import os
from typing import Optional

from flask import current_app, request

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder


ONBOARDING_WELCOME_VIDEO_KEY = "onboarding_welcome_video"
ALLOWED_ONBOARDING_VIDEO_EXTENSIONS = {"mp4", "webm"}
MAX_ONBOARDING_VIDEO_BYTES = 75 * 1024 * 1024


def ensure_site_settings_table(cursor) -> None:
    if USE_MYSQL:
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS site_settings (`key` VARCHAR(191) PRIMARY KEY, `value` TEXT)"
        )
    else:
        cursor.execute("CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT)")


def get_setting(key: str) -> Optional[str]:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        ensure_site_settings_table(cursor)
        if USE_MYSQL:
            cursor.execute(f"SELECT `value` FROM site_settings WHERE `key` = {ph}", (key,))
        else:
            cursor.execute(f"SELECT value FROM site_settings WHERE key = {ph}", (key,))
        row = cursor.fetchone()
        if not row:
            return None
        value = row[0] if isinstance(row, tuple) else row["value"]
        return str(value) if value else None


def set_setting(key: str, value: str) -> None:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        ensure_site_settings_table(cursor)
        if USE_MYSQL:
            cursor.execute(
                "INSERT INTO site_settings (`key`,`value`) VALUES (%s,%s) "
                "ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
                (key, value),
            )
        else:
            cursor.execute(
                "INSERT INTO site_settings (key,value) VALUES (?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )
        conn.commit()


def delete_setting(key: str) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        ensure_site_settings_table(cursor)
        if USE_MYSQL:
            cursor.execute(f"DELETE FROM site_settings WHERE `key` = {ph}", (key,))
        else:
            cursor.execute(f"DELETE FROM site_settings WHERE key = {ph}", (key,))
        conn.commit()


def resolve_public_asset_url(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.startswith("http://") or text.startswith("https://"):
        return text
    if text.startswith("/uploads/") or text.startswith("/static/"):
        return text
    if text.startswith("uploads/") or text.startswith("static/"):
        return f"/{text}"
    try:
        from backend.services.r2_storage import R2_PUBLIC_URL

        if R2_PUBLIC_URL:
            return f"{R2_PUBLIC_URL.rstrip('/')}/{text.lstrip('/')}"
    except Exception:
        pass
    public_base = current_app.config.get("PUBLIC_BASE_URL") or os.environ.get("PUBLIC_BASE_URL")
    if public_base:
        return f"{public_base.rstrip('/')}/{text.lstrip('/')}"
    try:
        return f"{request.host_url.rstrip('/')}/{text.lstrip('/')}"
    except Exception:
        return f"/{text.lstrip('/')}"


def get_onboarding_welcome_video_url() -> Optional[str]:
    return resolve_public_asset_url(get_setting(ONBOARDING_WELCOME_VIDEO_KEY))


def validate_onboarding_video_file(file_storage) -> Optional[str]:
    filename = getattr(file_storage, "filename", "") or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_ONBOARDING_VIDEO_EXTENSIONS:
        return "Invalid file type. Use MP4 or WebM."

    content_length = getattr(file_storage, "content_length", None) or request.content_length
    if content_length and int(content_length) > MAX_ONBOARDING_VIDEO_BYTES:
        return "Video is too large. Upload a file under 75 MB."

    mimetype = (getattr(file_storage, "mimetype", "") or "").lower()
    if mimetype and mimetype not in {"application/octet-stream", "video/mp4", "video/webm"}:
        return "Invalid video type. Use MP4 or WebM."

    return None
