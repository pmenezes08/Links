#!/usr/bin/env python3
"""Compare i18n catalogs and report drift.

For every locale we ship, fail when:

* a key exists in ``en`` (the source of truth) but is missing from the
  locale, or
* the locale defines a key that does not exist in ``en`` (likely a
  copy/paste mistake or stale translation).

The script handles both the backend (``backend/locales/*.json``) and
client (``client/src/locales/*.json``) catalogs in a single pass.

Exit code is 0 when every locale is in sync with ``en``, 1 otherwise.

CI usage::

    python scripts/i18n_check_catalogs.py

The script is import-light (stdlib only) so it can run in the same job
that lints route inventory.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple


SOURCE_LOCALE = "en"
CATALOG_DIRS = [
    Path("backend") / "locales",
    Path("client") / "src" / "locales",
]


def _flatten(prefix: str, value: Any, acc: Dict[str, Any]) -> None:
    """Flatten a nested JSON object into ``dotted.key.path -> leaf``.

    Lists count as a single leaf so translators can keep the array
    structure (e.g. ``onboarding.welcome.carousel``); we still emit a
    warning if the lengths drift.
    """
    if isinstance(value, dict):
        for key, sub in value.items():
            if key.startswith("_"):
                continue
            child = f"{prefix}.{key}" if prefix else key
            _flatten(child, sub, acc)
        return
    acc[prefix] = value


def _load(catalog: Path) -> Dict[str, Any]:
    with catalog.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _diff_locale(en_keys: Dict[str, Any], locale_keys: Dict[str, Any]) -> Tuple[List[str], List[str], List[str]]:
    missing: List[str] = []
    extra: List[str] = []
    list_drift: List[str] = []

    for key, value in en_keys.items():
        if key not in locale_keys:
            missing.append(key)
            continue
        if isinstance(value, list) and isinstance(locale_keys[key], list):
            if len(value) != len(locale_keys[key]):
                list_drift.append(f"{key} (en={len(value)}, locale={len(locale_keys[key])})")

    for key in locale_keys:
        if key not in en_keys:
            extra.append(key)

    return missing, extra, list_drift


def _scan_dir(directory: Path) -> int:
    if not directory.is_dir():
        print(f"[skip] {directory} (not a directory)")
        return 0

    en_path = directory / f"{SOURCE_LOCALE}.json"
    if not en_path.exists():
        print(f"[error] {en_path} missing; cannot diff locales in {directory}")
        return 1

    en_flat: Dict[str, Any] = {}
    _flatten("", _load(en_path), en_flat)

    failed = 0
    locale_files = sorted(p for p in directory.glob("*.json") if p.name != en_path.name)
    if not locale_files:
        print(f"[skip] {directory} (only source locale present)")
        return 0

    for path in locale_files:
        try:
            data = _load(path)
        except json.JSONDecodeError as exc:
            print(f"[error] {path} is not valid JSON: {exc}")
            failed += 1
            continue

        loc_flat: Dict[str, Any] = {}
        _flatten("", data, loc_flat)

        missing, extra, list_drift = _diff_locale(en_flat, loc_flat)
        locale = path.stem
        if not missing and not extra and not list_drift:
            print(f"[ok]   {directory.as_posix()} {locale}: {len(loc_flat)} keys in sync")
            continue

        failed += 1
        print(f"[fail] {directory.as_posix()} {locale}: {len(missing)} missing, {len(extra)} extra, {len(list_drift)} list drift")
        if missing:
            print("   missing keys:")
            for key in missing:
                print(f"     - {key}")
        if extra:
            print("   extra keys:")
            for key in extra:
                print(f"     - {key}")
        if list_drift:
            print("   list length drift:")
            for entry in list_drift:
                print(f"     - {entry}")

    return failed


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        default=".",
        help="Repo root to scan for catalog directories (default: cwd).",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    root = Path(args.root).resolve()
    failed = 0
    for rel in CATALOG_DIRS:
        failed += _scan_dir(root / rel)

    if failed:
        print(f"\ni18n catalog check FAILED ({failed} drift)")
        return 1

    print("\ni18n catalog check OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
