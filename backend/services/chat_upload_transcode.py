"""Best-effort server-side transcode for chat videos (HEVC/MOV fallback)."""

from __future__ import annotations

import logging
import os
import tempfile
import threading
from typing import Optional

from backend.services.media_processing import ffmpeg_available, transcode_video_file
from backend.services.r2_storage import download_bytes_from_r2, upload_to_r2

logger = logging.getLogger(__name__)


def schedule_chat_video_transcode(object_key: str, public_url: Optional[str] = None) -> None:
    """Fire-and-forget transcode for iOS MOV/HEVC originals."""
    if not ffmpeg_available():
        return
    if not object_key.lower().endswith((".mov", ".m4v")):
        return
    thread = threading.Thread(
        target=_transcode_worker,
        args=(object_key, public_url),
        daemon=True,
        name=f"chat-transcode-{object_key[-24:]}",
    )
    thread.start()


def _transcode_worker(object_key: str, _public_url: Optional[str]) -> None:
    try:
        raw = download_bytes_from_r2(object_key)
        if not raw:
            return
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "source.mov")
            with open(src, "wb") as f:
                f.write(raw)
            out = transcode_video_file(src, profile="story")
            if not out or not os.path.exists(out):
                return
            with open(out, "rb") as f:
                data = f.read()
            mp4_key = object_key.rsplit(".", 1)[0] + ".mp4"
            ok, _url = upload_to_r2(data, mp4_key, "video/mp4")
            if ok:
                logger.info("chat video transcode complete: %s -> %s", object_key, mp4_key)
    except Exception as exc:
        logger.warning("chat video transcode failed for %s: %s", object_key, exc)
