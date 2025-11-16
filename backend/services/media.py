"""Media and file helper utilities."""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Iterable, Optional
from urllib.parse import urljoin

from flask import current_app, request
from werkzeug.utils import secure_filename

try:
    from PIL import Image

    PIL_AVAILABLE = True
except ImportError:  # pragma: no cover - optional dependency
    Image = None  # type: ignore
    PIL_AVAILABLE = False

logger = logging.getLogger(__name__)

DEFAULT_ALLOWED_EXTENSIONS = {
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "mp4",
    "webm",
    "mov",
    "m4v",
    "avi",
    "m4a",
    "mp3",
    "ogg",
    "wav",
    "opus",
}


def get_allowed_extensions(overrides: Optional[Iterable[str]] = None) -> set[str]:
    if overrides is not None:
        return {ext.lower().lstrip(".") for ext in overrides}
    config_exts = current_app.config.get("ALLOWED_EXTENSIONS")
    if config_exts:
        return {ext.lower().lstrip(".") for ext in config_exts}
    return set(DEFAULT_ALLOWED_EXTENSIONS)


def optimize_image(file_path: str, max_width: int = 1920, quality: int = 85) -> bool:
    """Optimize image for web - compress and resize if needed, preserving format when possible."""
    if not PIL_AVAILABLE:
        return False

    try:
        ext = os.path.splitext(file_path)[1].lower()
        with Image.open(file_path) as img:  # type: ignore[arg-type]
            if img.width > max_width:
                ratio = max_width / img.width
                new_height = int(img.height * ratio)
                img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)

            if ext in (".jpg", ".jpeg"):
                if img.mode not in ("RGB", "L"):
                    img = img.convert("RGB")
                img.save(file_path, format="JPEG", quality=quality, optimize=True, progressive=True)
            elif ext == ".png":
                save_params = {"optimize": True}
                try:
                    save_params["compress_level"] = 9
                except Exception:
                    pass
                img.save(file_path, format="PNG", **save_params)
            elif ext == ".webp":
                img.save(file_path, format="WEBP", quality=quality, method=6)
            else:
                return False
            return True
    except Exception as exc:  # pragma: no cover - logging only
        logger.warning("Could not optimize image %s: %s", file_path, exc)
        return False


def allowed_file(filename: str, allowed_extensions: Optional[Iterable[str]] = None) -> bool:
    if not filename:
        return False
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return extension in get_allowed_extensions(allowed_extensions)


def _uploads_root() -> str:
    upload_folder = current_app.config.get("UPLOAD_FOLDER")
    if not upload_folder:
        raise RuntimeError("UPLOAD_FOLDER is not configured")
    return upload_folder


def save_uploaded_file(file, subfolder: Optional[str] = None, allowed_extensions: Optional[Iterable[str]] = None):
    """Persist an uploaded file into the configured uploads directory."""
    if not file or not file.filename:
        return None
    if not allowed_file(file.filename, allowed_extensions):
        return None

    filename = secure_filename(file.filename)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    name, ext = os.path.splitext(filename)
    unique_filename = f"{name}_{timestamp}{ext}"

    upload_root = _uploads_root()
    if subfolder:
        upload_path = os.path.join(upload_root, subfolder)
        os.makedirs(upload_path, exist_ok=True)
        filepath = os.path.join(upload_path, unique_filename)
        return_path = f"uploads/{subfolder}/{unique_filename}"
    else:
        os.makedirs(upload_root, exist_ok=True)
        filepath = os.path.join(upload_root, unique_filename)
        return_path = f"uploads/{unique_filename}"

    file.save(filepath)
    try:
        ext = (os.path.splitext(filename)[1] or "").lower().lstrip(".")
        if ext in {"png", "jpg", "jpeg", "gif", "webp"}:
            optimize_image(filepath, max_width=1280, quality=80)
    except Exception:
        pass
    return return_path


def normalize_upload_reference(path: Optional[str]) -> Optional[str]:
    if not path:
        return None
    p = str(path).strip()
    if not p:
        return None
    if p.startswith("static/uploads/"):
        p = p[len("static/") :]
    if p.startswith("/static/uploads/"):
        p = p[len("/static/") :]
    if p.startswith("/uploads/"):
        p = p[1:]
    if not p.startswith("uploads/"):
        p = f"uploads/{p.lstrip('/')}"
    return p


def resolve_upload_abspath(path: Optional[str]) -> Optional[str]:
    rel = normalize_upload_reference(path)
    if not rel:
        return None
    relative_inside_uploads = rel.split("uploads/", 1)[1] if "uploads/" in rel else rel
    return os.path.join(_uploads_root(), relative_inside_uploads)


def load_upload_bytes(path: Optional[str]) -> Optional[bytes]:
    abs_path = resolve_upload_abspath(path)
    if not abs_path or not os.path.exists(abs_path):
        return None
    try:
        with open(abs_path, "rb") as fh:
            return fh.read()
    except Exception as exc:  # pragma: no cover - logging only
        logger.error("Failed reading upload file %s: %s", abs_path, exc)
        return None


def get_public_upload_url(path: Optional[str]) -> Optional[str]:
    rel = normalize_upload_reference(path)
    if not rel:
        return None
    rel_url = f"/{rel}"
    public_base = current_app.config.get("PUBLIC_BASE_URL")
    if public_base:
        return urljoin(public_base.rstrip("/") + "/", rel)
    try:
        base = request.host_url.rstrip("/")
        return f"{base}{rel_url}"
    except Exception:  # pragma: no cover - fallback when outside request context
        return rel_url
