"""Media and file helper utilities."""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Iterable, Optional, Tuple
from urllib.parse import urljoin

from flask import current_app, request
from werkzeug.utils import secure_filename

try:
    from PIL import Image

    PIL_AVAILABLE = True
except ImportError:  # pragma: no cover - optional dependency
    Image = None  # type: ignore
    PIL_AVAILABLE = False

# Import R2 storage (lazy to avoid import errors if boto3 not installed)
try:
    from backend.services.r2_storage import (
        R2_ENABLED,
        R2_PUBLIC_URL,
        upload_to_r2,
        upload_file_to_r2,
        get_r2_public_url,
        is_r2_url,
    )
except ImportError:
    R2_ENABLED = False
    R2_PUBLIC_URL = None
    upload_to_r2 = None
    upload_file_to_r2 = None
    get_r2_public_url = None
    is_r2_url = None

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
    """Optimize image for web - compress, resize, and fix EXIF orientation."""
    if not PIL_AVAILABLE:
        return False

    try:
        from PIL import ImageOps
        ext = os.path.splitext(file_path)[1].lower()
        with Image.open(file_path) as img:  # type: ignore[arg-type]
            # Fix EXIF orientation (rotate image based on EXIF data)
            # This is critical for iOS photos which often have rotation in EXIF
            try:
                img = ImageOps.exif_transpose(img)
            except Exception:
                pass  # If EXIF transpose fails, continue with original
            
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
    """
    Persist an uploaded file - saves locally, optimizes, then uploads to R2 CDN.
    
    Returns a path/URL string:
    - If R2 succeeds: returns the CDN URL (https://...)
    - If R2 fails or disabled: returns local path (uploads/...)
    """
    if not file or not file.filename:
        logger.warning("save_uploaded_file: No file or filename provided")
        return None
    
    original_filename = file.filename
    if not allowed_file(original_filename, allowed_extensions):
        logger.warning(f"save_uploaded_file: File not allowed - filename={original_filename}, allowed={allowed_extensions}")
        return None

    filename = secure_filename(original_filename)
    
    # If secure_filename removed the extension, try to preserve it
    if '.' not in filename and '.' in original_filename:
        ext_from_original = original_filename.rsplit('.', 1)[-1].lower()
        if ext_from_original and len(ext_from_original) <= 5:  # sanity check
            filename = f"{filename or 'file'}.{ext_from_original}"
    
    # Handle case where filename becomes empty after secure_filename
    if not filename:
        # Try to infer extension from mimetype
        ext_map = {
            'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
            'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
            'audio/wav': 'wav', 'video/webm': 'webm', 'video/mp4': 'mp4',
            'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
        }
        mime = getattr(file, 'mimetype', '') or ''
        ext = ext_map.get(mime.lower(), 'bin')
        filename = f"file.{ext}"
        logger.info(f"save_uploaded_file: Generated filename from mimetype: {filename}")
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    name, ext = os.path.splitext(filename)
    unique_filename = f"{name}_{timestamp}{ext}"

    # Determine the key/path
    if subfolder:
        r2_key = f"{subfolder}/{unique_filename}"
        return_path = f"uploads/{subfolder}/{unique_filename}"
    else:
        r2_key = unique_filename
        return_path = f"uploads/{unique_filename}"

    # Step 1: Save locally FIRST
    upload_root = _uploads_root()
    if subfolder:
        upload_path = os.path.join(upload_root, subfolder)
        os.makedirs(upload_path, exist_ok=True)
        filepath = os.path.join(upload_path, unique_filename)
    else:
        os.makedirs(upload_root, exist_ok=True)
        filepath = os.path.join(upload_root, unique_filename)

    file.save(filepath)
    
    # Step 2: Optimize images (includes EXIF rotation fix for iOS)
    try:
        file_ext = (os.path.splitext(filename)[1] or "").lower().lstrip(".")
        if file_ext in {"png", "jpg", "jpeg", "gif", "webp"}:
            optimize_image(filepath, max_width=1280, quality=80)
    except Exception:
        pass

    # Step 3: Upload OPTIMIZED file to R2 (after EXIF fix)
    r2_url = None
    if R2_ENABLED and upload_to_r2:
        try:
            with open(filepath, 'rb') as f:
                file_data = f.read()
            success, r2_url = upload_to_r2(file_data, r2_key)
            if success and r2_url:
                logger.info(f"Optimized file uploaded to R2 CDN: {r2_url}")
        except Exception as e:
            logger.warning(f"R2 upload failed, using local path: {e}")
            r2_url = None

    # Return R2 URL if available, otherwise local path
    return r2_url if r2_url else return_path


def normalize_upload_reference(path: Optional[str]) -> Optional[str]:
    """Normalize a path to uploads/... format. Returns None for CDN URLs."""
    if not path:
        return None
    p = str(path).strip()
    if not p:
        return None
    
    # If it's a full URL (R2 CDN or other), don't normalize
    if p.startswith('http://') or p.startswith('https://'):
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
    """Get the public URL for an uploaded file."""
    if not path:
        return None
    
    # If it's already a full URL (R2 CDN or other), return as-is
    if path.startswith('http://') or path.startswith('https://'):
        return path
    
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
