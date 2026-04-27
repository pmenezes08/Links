"""Server-side media optimization helpers."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from typing import Optional

try:
    from PIL import Image, ImageOps

    PIL_AVAILABLE = True
except ImportError:  # pragma: no cover - optional dependency
    Image = None  # type: ignore
    ImageOps = None  # type: ignore
    PIL_AVAILABLE = False


logger = logging.getLogger(__name__)


IMAGE_PROFILES = {
    "story": {"max_width": 1440, "quality": 84},
    "feed": {"max_width": 1920, "quality": 85},
    "background": {"max_width": 1920, "quality": 85},
}


def ffmpeg_available() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def probe_duration_seconds(path: str) -> Optional[float]:
    if not shutil.which("ffprobe"):
        return None
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
        value = (result.stdout or "").strip()
        return float(value) if value else None
    except Exception as exc:
        logger.warning("Could not probe media duration for %s: %s", path, exc)
        return None


def optimize_image_file(path: str, profile: str = "feed") -> bool:
    if not PIL_AVAILABLE:
        return False
    config = IMAGE_PROFILES.get(profile, IMAGE_PROFILES["feed"])
    ext = os.path.splitext(path)[1].lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        return False
    try:
        with Image.open(path) as img:  # type: ignore[arg-type]
            img = ImageOps.exif_transpose(img)
            max_width = int(config["max_width"])
            if img.width > max_width:
                ratio = max_width / img.width
                img = img.resize((max_width, int(img.height * ratio)), Image.Resampling.LANCZOS)
            quality = int(config["quality"])
            if ext in {".jpg", ".jpeg"}:
                if img.mode not in ("RGB", "L"):
                    img = img.convert("RGB")
                img.save(path, format="JPEG", quality=quality, optimize=True, progressive=True)
            elif ext == ".webp":
                img.save(path, format="WEBP", quality=quality, method=5)
            else:
                save_params = {"optimize": True}
                img.save(path, format="PNG", **save_params)
        return True
    except Exception as exc:
        logger.warning("Could not optimize image %s: %s", path, exc)
        return False


def transcode_video_file(path: str, profile: str = "feed") -> Optional[str]:
    if not ffmpeg_available():
        return None
    output_path = os.path.splitext(path)[0] + "_optimized.mp4"
    scale = "scale='min(1080,iw)':-2" if profile == "story" else "scale='min(1920,iw)':-2"
    crf = "28" if profile == "story" else "26"
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                path,
                "-vf",
                scale,
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                crf,
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-movflags",
                "+faststart",
                output_path,
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            return output_path
    except Exception as exc:
        logger.warning("Could not transcode video %s: %s", path, exc)
    try:
        if os.path.exists(output_path):
            os.remove(output_path)
    except Exception:
        pass
    return None

