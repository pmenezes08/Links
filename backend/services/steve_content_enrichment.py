"""
Fetch text from URLs shared on-platform for Steve profile analysis.

- Articles: trafilatura (HTML main text)
- YouTube: youtube-transcript-api (captions) first; no Whisper in this module
  (Whisper is invoked from bodybuilding_app for direct audio URLs only)

Failures are non-fatal: each URL is best-effort; callers aggregate errors for Grok "notes".
"""

from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

import requests

logger = logging.getLogger(__name__)

# Rolling window matches _fetch_user_recent_activity (12 months, posts only)
STEVE_ENRICH_MONTHS = 12

MAX_URLS_PER_RUN = 10
MAX_CHARS_PER_SOURCE = 8000
MAX_TOTAL_ENRICHMENT_CHARS = 24000
FETCH_TIMEOUT_SEC = 15
MAX_PARALLEL_FETCHES = 4
MAX_AUDIO_BYTES_WHISPER = 24 * 1024 * 1024  # under OpenAI ~25MB limit

_YT_VIDEO_RE = re.compile(
    r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|youtube\.com/shorts/)([a-zA-Z0-9_-]{11})"
)
_AUDIO_EXT_RE = re.compile(r"\.(mp3|m4a|wav|aac|ogg|webm)(\?|$)", re.I)

# Hosts where we do not attempt generic HTML extraction (handled elsewhere or unsupported)
_SKIP_HTML_HOSTS = frozenset(
    {
        "open.spotify.com",
        "podcasts.apple.com",
        "music.apple.com",
        "anchor.fm",
    }
)


def _truncate(s: str, max_len: int) -> str:
    s = (s or "").strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 3] + "..."


def extract_youtube_video_id(url: str) -> Optional[str]:
    if not url:
        return None
    try:
        p = urlparse(url.strip())
        host = (p.netloc or "").lower()
        if host.startswith("www."):
            host = host[4:]
        if host in ("youtu.be",):
            path = (p.path or "").strip("/")
            if len(path) >= 11:
                return path[:11]
        if "youtube.com" in host:
            q = parse_qs(p.query)
            if "v" in q and q["v"]:
                vid = q["v"][0]
                if len(vid) >= 11:
                    return vid[:11]
            m = _YT_VIDEO_RE.search(url)
            if m:
                return m.group(1)
    except Exception:
        pass
    return None


def _fetch_youtube_transcript(video_id: str) -> Tuple[Optional[str], Optional[str]]:
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError as e:
        logger.warning("youtube_transcript_api not installed: %s", e)
        return None, "youtube_transcript_api package not installed"

    try:
        # v1.x: instantiate API per call (not thread-safe to share across threads).
        api = YouTubeTranscriptApi()
        try:
            ft = api.fetch(video_id, languages=("en", "en-US", "en-GB"))
        except Exception:
            ft = api.fetch(video_id, languages=("en",))

        text = " ".join(s.text for s in getattr(ft, "snippets", []) or []).replace("\n", " ").strip()
        if not text:
            return None, "Empty transcript"
        return text, None
    except Exception as e:
        logger.debug("YouTube transcript failed for %s: %s", video_id, e)
        msg = str(e).lower()
        if "disabled" in msg:
            return None, "YouTube transcripts disabled for this video"
        if "unavailable" in msg or "not found" in msg:
            return None, "YouTube transcript not available"
        return None, f"YouTube transcript error: {e!s}"


def _fetch_article_text(url: str) -> Tuple[Optional[str], Optional[str]]:
    try:
        import trafilatura
    except ImportError as e:
        logger.warning("trafilatura not installed: %s", e)
        return None, "trafilatura package not installed"

    try:
        r = requests.get(
            url,
            timeout=FETCH_TIMEOUT_SEC,
            headers={"User-Agent": "Mozilla/5.0 (compatible; CPointBot/1.0; +https://c-point.co)"},
        )
        r.raise_for_status()
        text = trafilatura.extract(
            r.text,
            url=url,
            include_comments=False,
            include_tables=False,
        )
        if not text or len(text.strip()) < 80:
            return None, "Could not extract sufficient article text"
        return text.strip(), None
    except Exception as e:
        logger.debug("Article extract failed for %s: %s", url, e)
        return None, f"Article fetch/extract error: {e!s}"


def _head_content_length(url: str) -> Optional[int]:
    try:
        r = requests.head(
            url,
            timeout=min(10, FETCH_TIMEOUT_SEC),
            allow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; CPointBot/1.0)"},
        )
        cl = r.headers.get("Content-Length")
        if cl and cl.isdigit():
            return int(cl)
    except Exception:
        pass
    return None


def _whisper_direct_audio_url(url: str) -> Tuple[Optional[str], Optional[str]]:
    """Download and transcribe via OpenAI Whisper (lazy-import bodybuilding_app)."""
    size = _head_content_length(url)
    if size is not None and size > MAX_AUDIO_BYTES_WHISPER:
        return None, f"Audio file too large for Whisper ({size} bytes)"

    try:
        from bodybuilding_app import transcribe_audio_file
    except Exception as e:
        return None, f"Whisper unavailable: {e!s}"

    try:
        result = transcribe_audio_file(url)
        if not result:
            return None, "Whisper returned no transcription"
        if isinstance(result, tuple) and len(result) >= 2:
            text, _lang = result[0], result[1]
        elif isinstance(result, tuple) and len(result) == 1:
            text = result[0]
        else:
            text = str(result)
        text = (text or "").strip()
        if not text:
            return None, "Whisper returned empty text"
        return text, None
    except Exception as e:
        logger.debug("Whisper failed for %s: %s", url, e)
        return None, f"Whisper error: {e!s}"


def _classify_url(url: str) -> str:
    try:
        host = (urlparse(url).netloc or "").lower()
        if host.startswith("www."):
            host = host[4:]
    except Exception:
        host = ""

    if extract_youtube_video_id(url):
        return "youtube"
    if host in _SKIP_HTML_HOSTS:
        return "podcast_platform"
    if _AUDIO_EXT_RE.search(url.split("?")[0]):
        return "direct_audio"
    return "article"


def _source_record(
    url: str,
    kind: str,
    post_date: str,
    *,
    success: bool,
    detail: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "url": url,
        "kind": kind,
        "postDate": (post_date or "")[:10],
        "success": success,
        "detail": detail or "",
    }


def _enrich_single_url(
    url: str, user_caption: str, post_date: str
) -> Tuple[str, Optional[Dict[str, str]], Dict[str, Any]]:
    """
    Returns (block_text_for_prompt, error_record_or_none, source_record_for_firestore).
    error_record: {"url", "error"}
    """
    kind = _classify_url(url)
    headline = f"[Shared link — {post_date}] {url}"
    cap = f' User caption: "{user_caption[:300]}"' if user_caption else ""

    if kind == "youtube":
        vid = extract_youtube_video_id(url)
        if not vid:
            return (
                "",
                {"url": url, "error": "Could not parse YouTube video id"},
                _source_record(url, kind, post_date, success=False, detail="Could not parse YouTube video id"),
            )
        text, err = _fetch_youtube_transcript(vid)
        if err or not text:
            return (
                "",
                {"url": url, "error": err or "No transcript"},
                _source_record(url, kind, post_date, success=False, detail=err or "No transcript"),
            )
        body = _truncate(text, MAX_CHARS_PER_SOURCE)
        block = f"{headline}{cap}\n--- YouTube transcript (excerpt) ---\n{body}\n"
        return (
            block,
            None,
            _source_record(url, kind, post_date, success=True, detail="YouTube transcript retrieved"),
        )

    if kind == "podcast_platform":
        msg = "Podcast page — automatic transcript not available for this host (not a direct audio file)"
        return (
            "",
            {"url": url, "error": msg},
            _source_record(url, kind, post_date, success=False, detail=msg),
        )

    if kind == "direct_audio":
        text, err = _whisper_direct_audio_url(url)
        if err or not text:
            return (
                "",
                {"url": url, "error": err or "Whisper failed"},
                _source_record(url, kind, post_date, success=False, detail=err or "Whisper failed"),
            )
        body = _truncate(text, MAX_CHARS_PER_SOURCE)
        block = f"{headline}{cap}\n--- Audio transcription (Whisper excerpt) ---\n{body}\n"
        return (
            block,
            None,
            _source_record(url, kind, post_date, success=True, detail="Audio transcribed (Whisper)"),
        )

    # article / generic HTML
    text, err = _fetch_article_text(url)
    if err or not text:
        return (
            "",
            {"url": url, "error": err or "Article extraction failed"},
            _source_record(url, kind, post_date, success=False, detail=err or "Article extraction failed"),
        )
    body = _truncate(text, MAX_CHARS_PER_SOURCE)
    block = f"{headline}{cap}\n--- Article text (excerpt) ---\n{body}\n"
    return (
        block,
        None,
        _source_record(url, kind, post_date, success=True, detail="Article text retrieved"),
    )


def _collect_urls_from_activity(activity: Dict[str, Any]) -> List[Tuple[str, str, str]]:
    """(url, user_caption, post_date) sorted newest first, deduped by URL."""
    shared = activity.get("shared") or []
    rows: List[Tuple[str, str, str, str]] = []
    for p in shared:
        urls = p.get("urls") or []
        content = (p.get("content") or "")[:500]
        date = (p.get("date") or "")[:10]
        for u in urls[:3]:
            u = (u or "").strip()
            if u.startswith("http"):
                rows.append((u, content, date, date))

    rows.sort(key=lambda x: x[3], reverse=True)
    seen = set()
    out: List[Tuple[str, str, str]] = []
    for u, cap, d, _ in rows:
        if u in seen:
            continue
        seen.add(u)
        out.append((u, cap, d))
        if len(out) >= MAX_URLS_PER_RUN:
            break
    return out


def enrich_shared_activity_for_profile(
    activity: Optional[Dict[str, Any]],
    depth: str,
) -> Tuple[str, List[Dict[str, str]], List[Dict[str, Any]]]:
    """
    Build an extra text block for Grok, ingestion errors, and external source records.

    external_sources: one entry per URL attempted (order = processing order), for UI / Firestore.

    Only standard/deep should call this (caller responsibility).
    """
    if not activity or depth not in ("standard", "deep"):
        return "", [], []

    items = _collect_urls_from_activity(activity)
    if not items:
        return "", [], []

    results_by_url: Dict[str, Tuple[str, Optional[Dict[str, str]], Dict[str, Any]]] = {}
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_FETCHES) as ex:
        fmap = {ex.submit(_enrich_single_url, u, c, d): u for u, c, d in items}
        for fut in as_completed(fmap):
            u = fmap[fut]
            try:
                results_by_url[u] = fut.result()
            except Exception as e:
                results_by_url[u] = (
                    "",
                    {"url": u, "error": f"Unexpected: {e!s}"},
                    _source_record(
                        u,
                        _classify_url(u),
                        "",
                        success=False,
                        detail=f"Unexpected: {e!s}",
                    ),
                )

    ordered_blocks: List[str] = []
    errors: List[Dict[str, str]] = []
    external_sources: List[Dict[str, Any]] = []
    total_chars = 0

    for u, _cap, d in items:
        tup = results_by_url.get(u)
        if not tup:
            errors.append({"url": u, "error": "missing result"})
            external_sources.append(
                _source_record(u, _classify_url(u), d, success=False, detail="missing result")
            )
            continue
        block, err, src = tup
        if err:
            errors.append(err)
            external_sources.append(src)
            continue
        if not block:
            external_sources.append(src)
            continue
        if total_chars + len(block) > MAX_TOTAL_ENRICHMENT_CHARS:
            err_msg = "Skipped: total enrichment size limit reached"
            errors.append({"url": u, "error": err_msg})
            external_sources.append(
                {
                    **src,
                    "success": False,
                    "detail": "Not included in prompt: total enrichment size limit",
                }
            )
            continue
        ordered_blocks.append(block)
        total_chars += len(block)
        external_sources.append(src)

    if not ordered_blocks:
        if errors:
            return "", errors, external_sources
        return "", [], external_sources

    header = (
        "--- ENRICHED SHARED LINKS (full text or transcript excerpts from the last "
        f"{STEVE_ENRICH_MONTHS} months; use with user captions) ---\n"
    )
    body = "\n".join(ordered_blocks)
    return header + body, errors, external_sources
