"""i18n core service.

Single entrypoint for user-facing copy in the backend. Blueprints and
domain services call :func:`t` (translate) with a stable key plus the
caller's resolved locale; the catalogs live in
``backend/locales/<locale>.json``.

Design notes
------------

* **Stable keys.** Tests and clients switch on the key, never the
  English text. Adding a new locale never requires touching call sites.

* **Locale fallback chain.** ``pt-PT`` falls back to ``pt`` (if a file
  exists), then to ``en``. Missing keys log a warning and return the
  ``en`` value (or the key itself if it is missing in ``en`` too) so
  pages never break in production.

* **Interpolation.** Parameters use Python ``str.format`` syntax
  (``"{n} chamadas"``). Curly braces in the source text must be
  escaped as ``{{`` / ``}}`` exactly like ``str.format``.

* **Hot-reload.** Catalogs load once at process start and again
  whenever ``I18N_HOT_RELOAD`` is truthy. Production keeps a single
  cached copy; tests can call :func:`reload_catalogs` explicitly.

See :doc:`docs/I18N_ROADMAP.md` for the namespace convention and PR
sequence.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

logger = logging.getLogger(__name__)


DEFAULT_LOCALE = "en"

# Locales the product currently ships. Adding a locale = adding a JSON
# file and an entry here.
SUPPORTED_LOCALES: tuple[str, ...] = ("en", "pt-PT")

# Mapping from common request hints (``Accept-Language`` tags) to the
# locale we actually have a catalog for. Lower-case keys.
_LOCALE_ALIASES: Dict[str, str] = {
    "en": "en",
    "en-us": "en",
    "en-gb": "en",
    "en-au": "en",
    "en-ca": "en",
    "en-nz": "en",
    "en-ie": "en",
    "pt": "pt-PT",
    "pt-pt": "pt-PT",
    "pt-br": "pt-PT",   # v1: Portugal-first; pt-BR users get PT-PT until
                         # we ship a dedicated pt-BR catalog.
}


# Where catalog JSON files live. Importable so tests can monkeypatch.
LOCALES_DIR: Path = Path(__file__).resolve().parents[2] / "backend" / "locales"

# In-memory cache. ``_catalogs[locale] -> dict``. Loaded lazily.
_catalogs: Dict[str, Dict[str, Any]] = {}
_load_lock = threading.Lock()


# ── Locale normalisation ───────────────────────────────────────────────


def match_locale(raw: Optional[str]) -> Optional[str]:
    """Return a supported locale for ``raw`` or ``None`` when unrecognised.

    Unlike :func:`normalize_locale` this distinguishes "unrecognised input
    that fell back to English" from "the input is genuinely ``en``".
    Useful when a caller needs to honour the next link in a chain (e.g.
    ``Accept-Language`` after an unknown ``X-CPoint-Locale``).
    """
    if not raw:
        return None
    tag = str(raw).strip().replace("_", "-").lower()
    if not tag:
        return None
    if tag in _LOCALE_ALIASES:
        return _LOCALE_ALIASES[tag]
    primary = tag.split("-", 1)[0]
    if primary in _LOCALE_ALIASES:
        return _LOCALE_ALIASES[primary]
    return None


def normalize_locale(raw: Optional[str]) -> str:
    """Map an arbitrary tag to a supported locale, or :data:`DEFAULT_LOCALE`.

    >>> normalize_locale("pt-PT")
    'pt-PT'
    >>> normalize_locale("PT_BR")
    'pt-PT'
    >>> normalize_locale("klingon")
    'en'
    >>> normalize_locale(None)
    'en'
    """
    matched = match_locale(raw)
    return matched if matched is not None else DEFAULT_LOCALE


def parse_accept_language(header: Optional[str]) -> str:
    """Return the best-supported locale for an ``Accept-Language`` header.

    Quality weights (``;q=``) are honoured. Unknown tags fall through to
    :data:`DEFAULT_LOCALE`. The empty string and ``None`` are safe.
    """
    if not header:
        return DEFAULT_LOCALE
    candidates: list[tuple[float, int, str]] = []
    for idx, part in enumerate(str(header).split(",")):
        token = part.strip()
        if not token:
            continue
        quality = 1.0
        if ";" in token:
            tag, _, params = token.partition(";")
            tag = tag.strip()
            for param in params.split(";"):
                p = param.strip()
                if p.startswith("q="):
                    try:
                        quality = float(p[2:])
                    except ValueError:
                        quality = 0.0
        else:
            tag = token
        if not tag or quality <= 0.0:
            continue
        # Use original-order index to break ties stably.
        candidates.append((-quality, idx, tag))
    candidates.sort()
    for _q, _idx, tag in candidates:
        loc = match_locale(tag)
        if loc is not None:
            return loc
    return DEFAULT_LOCALE


# ── Catalog loading ────────────────────────────────────────────────────


def _hot_reload_enabled() -> bool:
    return str(os.environ.get("I18N_HOT_RELOAD", "")).strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _load_locale(locale: str) -> Dict[str, Any]:
    """Read ``<LOCALES_DIR>/<locale>.json``. Returns ``{}`` on failure."""
    path = LOCALES_DIR / f"{locale}.json"
    if not path.exists():
        logger.warning("i18n catalog missing for locale=%s path=%s", locale, path)
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            logger.error(
                "i18n catalog for %s is not an object (got %s)", locale, type(data)
            )
            return {}
        return data
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("i18n catalog load failed locale=%s: %s", locale, exc)
        return {}


def reload_catalogs() -> None:
    """Drop the in-memory cache so the next lookup re-reads from disk."""
    with _load_lock:
        _catalogs.clear()


def _get_catalog(locale: str) -> Dict[str, Any]:
    if _hot_reload_enabled():
        reload_catalogs()
    if locale in _catalogs:
        return _catalogs[locale]
    with _load_lock:
        if locale not in _catalogs:
            _catalogs[locale] = _load_locale(locale)
        return _catalogs[locale]


# ── Key lookup ─────────────────────────────────────────────────────────


def _walk_key(catalog: Dict[str, Any], key: str) -> Optional[Any]:
    """Walk a dotted key (``foo.bar.baz``) through nested dicts."""
    node: Any = catalog
    for part in key.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def _fallback_chain(locale: str) -> Iterable[str]:
    """Yield locales to try, in order.

    ``pt-PT`` → ``pt`` (if file exists) → ``en``. ``en`` only tries
    itself.
    """
    seen: set[str] = set()
    for candidate in (locale, locale.split("-", 1)[0], DEFAULT_LOCALE):
        if candidate and candidate not in seen:
            seen.add(candidate)
            yield candidate


def t(key: str, locale: Optional[str] = None, /, **params: Any) -> str:
    """Translate a stable key to a user-facing string.

    Parameters
    ----------
    key:
        Dotted namespace key, e.g. ``"auth.login_required"``.
    locale:
        Locale tag. Normalised internally. ``None`` / unknown → ``en``.
    **params:
        Optional ``str.format`` parameters interpolated into the
        resolved template.
    """
    resolved = normalize_locale(locale) if locale else DEFAULT_LOCALE
    template: Optional[str] = None
    used_locale: Optional[str] = None

    for candidate in _fallback_chain(resolved):
        catalog = _get_catalog(candidate)
        if not catalog:
            continue
        raw = _walk_key(catalog, key)
        if isinstance(raw, str):
            template = raw
            used_locale = candidate
            break

    if template is None:
        logger.warning(
            "i18n missing key=%s locale=%s (fallback exhausted)", key, resolved
        )
        return key

    if used_locale != resolved:
        # Quiet hint: the requested locale didn't have this key. Not an
        # error — that's the point of the fallback chain.
        logger.debug(
            "i18n key=%s missing in locale=%s, served %s",
            key,
            resolved,
            used_locale,
        )

    # Short-circuit when the template has no placeholders. Avoids the
    # surprise of ``"Free {{token}}".format()`` collapsing escapes when
    # the caller never asked for interpolation.
    if "{" not in template:
        return template
    try:
        return template.format(**params)
    except (KeyError, IndexError, ValueError) as exc:
        logger.warning(
            "i18n format failed key=%s locale=%s params=%s: %s",
            key,
            used_locale,
            sorted(params),
            exc,
        )
        return template


def has_key(key: str, locale: str = DEFAULT_LOCALE) -> bool:
    """Return True when ``key`` exists in the given locale's catalog."""
    catalog = _get_catalog(normalize_locale(locale))
    return isinstance(_walk_key(catalog, key), str)


def available_locales() -> tuple[str, ...]:
    """Return the locales the product currently supports."""
    return SUPPORTED_LOCALES
