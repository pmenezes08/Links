"""Heuristic inventory of unmapped user-facing English strings.

Run from repo root::

    python scripts/i18n_inventory.py            # markdown report
    python scripts/i18n_inventory.py --json     # machine output
    python scripts/i18n_inventory.py --strict auth common  # fail on regressions

The script is intentionally a heuristic, not a parser. It surfaces
candidates for migration; the engineer reviewing the report decides
which strings are genuinely user-facing.

Scanned by default:

* ``backend/blueprints/`` (Python)
* ``backend/services/`` (Python)
* ``client/src/`` (TS / TSX)
* ``templates/`` (HTML)

Skipped:

* Tests, migrations, scripts, generated assets, ``dist/`` builds
* Lines containing ``# i18n: ignore`` or ``// i18n: ignore``
* Files listed in ``I18N_INVENTORY_SKIPFILES`` below

See ``docs/I18N_ROADMAP.md`` for the namespace convention and how to
treat the report.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Iterable

# Windows consoles default to cp1252 and choke on non-ASCII source content.
# Force UTF-8 on stdout/stderr so the report always prints cleanly.
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
if hasattr(sys.stderr, "buffer"):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]

# Roots scanned for user-facing strings.
PY_SCAN_DIRS = [
    ROOT / "backend" / "blueprints",
    ROOT / "backend" / "services",
]
TS_SCAN_DIRS = [
    ROOT / "client" / "src",
]
HTML_SCAN_DIRS = [
    ROOT / "templates",
]

# Always skip these (generated, vendored, or non-user-facing).
SKIP_DIRS = {
    "dist",
    "build",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    "ios",
    "android",
}

# Per-file skips for known non-user-facing modules.
I18N_INVENTORY_SKIPFILES = {
    "backend/services/database.py",
    "backend/services/r2_storage.py",
    "backend/services/feature_flags.py",
}

# Heuristic: a literal is "probably user-facing" if it
#   - is at least MIN_LEN chars,
#   - contains a space (rules out identifiers / SQL fragments mostly),
#   - starts with a letter,
#   - contains lower-case letters somewhere (rules out CONSTANT_NAMES),
#   - does not look like a SQL keyword block, JSON key, URL, MIME type,
#     SDK identifier, or log message marker.
MIN_LEN = 12

# String literal regexes.
#   Python: "..." or '...' (no triple-quoted to avoid docstrings)
#   TS/TSX: "..." or '...' or `...` (template literals only without ${} interpolation)
#   HTML: text inside tags (very loose)
RE_PY = re.compile(r"""(?<!\w)(?:"([^"\\\n]{1,400})"|'([^'\\\n]{1,400})')""")
RE_TS = re.compile(
    r"""(?<!\w)(?:"([^"\\\n]{1,400})"|'([^'\\\n]{1,400})'|`([^`\\\n${]{1,400})`)"""
)

# Lines we ignore.
LINE_IGNORE_TOKENS = (
    "# i18n: ignore",
    "// i18n: ignore",
    "/* i18n: ignore */",
)

# Substrings that suggest the literal is internal, not user-facing.
INTERNAL_SUBSTRINGS = (
    "SELECT ",
    "INSERT ",
    "UPDATE ",
    "DELETE ",
    "CREATE TABLE",
    "ALTER TABLE",
    "FROM ",
    "WHERE ",
    "LEFT JOIN",
    "INNER JOIN",
    "application/json",
    "text/html",
    "image/",
    "video/",
    "audio/",
    "Content-Type",
    "Authorization",
    "Accept-Language",
    "Cache-Control",
    "no-store",
    "no-cache",
    "https://",
    "http://",
    "/api/",
    "X-CPoint",
    "X-CSRF",
    "X-Cron",
    "Bearer ",
)

# Patterns that should not match (URLs, file paths, regex, etc.).
RE_LOOKS_LIKE_PATH = re.compile(r"^[/\\.][\w./\\-]+$")
RE_LOOKS_LIKE_URL = re.compile(r"^https?://")
RE_LOOKS_LIKE_IDENT = re.compile(r"^[A-Z][A-Z0-9_\-:.]+$")
RE_HAS_LOWER = re.compile(r"[a-z]")
RE_HAS_SPACE = re.compile(r"\s")
RE_HAS_FORMAT = re.compile(r"\{[\w]+\}|\{\w*\}|\%[sd]")

# Files allowed to have unmigrated strings without flagging --strict.
# This is updated as namespaces get migrated.
COMPLETED_NAMESPACES: dict[str, set[str]] = {
    # Example, once PR 3 lands:
    # "auth": {"backend/blueprints/auth.py", "backend/services/auth_session.py"},
}


def _under(path: Path, roots: Iterable[Path]) -> bool:
    try:
        rel = path.resolve()
    except OSError:
        return False
    for root in roots:
        try:
            rel.relative_to(root.resolve())
            return True
        except ValueError:
            continue
    return False


def _walk_files(roots: Iterable[Path], suffixes: set[str]) -> Iterable[Path]:
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix not in suffixes:
                continue
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            rel = path.relative_to(ROOT).as_posix()
            if rel in I18N_INVENTORY_SKIPFILES:
                continue
            if rel.endswith((".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx")):
                continue
            if rel.startswith("tests/"):
                continue
            yield path


def _looks_user_facing(literal: str) -> bool:
    s = literal.strip()
    if len(s) < MIN_LEN:
        return False
    if not RE_HAS_LOWER.search(s):
        return False
    if not RE_HAS_SPACE.search(s) and not RE_HAS_FORMAT.search(s):
        return False
    if RE_LOOKS_LIKE_URL.match(s):
        return False
    if RE_LOOKS_LIKE_PATH.match(s):
        return False
    if RE_LOOKS_LIKE_IDENT.match(s):
        return False
    for needle in INTERNAL_SUBSTRINGS:
        if needle in s:
            return False
    # JSON-y blobs and dotted module paths.
    if s.startswith("{") and s.endswith("}"):
        return False
    if "::" in s and " " not in s:
        return False
    return True


def _scan_python(path: Path) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return out
    for lineno, raw in enumerate(text.splitlines(), start=1):
        if any(token in raw for token in LINE_IGNORE_TOKENS):
            continue
        # Skip obvious log lines to reduce noise.
        stripped = raw.lstrip()
        if stripped.startswith(("logger.", "logging.", "print(", "#")):
            continue
        for match in RE_PY.finditer(raw):
            literal = match.group(1) or match.group(2) or ""
            if _looks_user_facing(literal):
                out.append((lineno, literal))
    return out


def _scan_ts(path: Path) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return out
    for lineno, raw in enumerate(text.splitlines(), start=1):
        if any(token in raw for token in LINE_IGNORE_TOKENS):
            continue
        stripped = raw.lstrip()
        if stripped.startswith(("//", "/*", "*", "import ", "export type")):
            continue
        for match in RE_TS.finditer(raw):
            literal = match.group(1) or match.group(2) or match.group(3) or ""
            if _looks_user_facing(literal):
                out.append((lineno, literal))
    return out


def _scan_html(path: Path) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return out
    # Very loose: grab tag bodies. Good enough for ops scan.
    body_re = re.compile(r">([^<>]{12,400})<")
    for lineno, raw in enumerate(text.splitlines(), start=1):
        for match in body_re.finditer(raw):
            literal = match.group(1).strip()
            if _looks_user_facing(literal):
                out.append((lineno, literal))
    return out


def _classify_namespace(rel_path: str) -> str:
    """Best-effort domain from file path."""
    p = rel_path.lower()
    if "auth" in p:
        return "auth"
    if "onboard" in p:
        return "onboarding"
    if "communit" in p:
        return "communities"
    if "group_chat" in p or "dm_chat" in p or "messages" in p or "chat" in p:
        return "chat"
    if "notification" in p:
        return "notifications"
    if "email" in p:
        return "email"
    if "entitlement" in p or "subscription" in p or "billing" in p or "iap" in p:
        return "billing"
    if "calendar" in p or "event" in p:
        return "calendar"
    if "media" in p or "story" in p or "stories" in p:
        return "media"
    if "steve" in p or "summaries" in p:
        return "steve"
    if "content_generation" in p:
        return "content_generation"
    if "account" in p or "settings" in p or "profile" in p:
        return "account"
    if "feed" in p or "post" in p:
        return "feed"
    return "other"


def build_report() -> dict:
    """Walk all configured roots and return a structured report."""
    by_namespace: dict[str, list[dict]] = defaultdict(list)
    file_counts: dict[str, int] = defaultdict(int)

    def _emit(rel: str, lineno: int, literal: str) -> None:
        ns = _classify_namespace(rel)
        by_namespace[ns].append(
            {"file": rel, "line": lineno, "text": literal[:200]}
        )
        file_counts[rel] += 1

    for path in _walk_files(PY_SCAN_DIRS, {".py"}):
        rel = path.relative_to(ROOT).as_posix()
        for lineno, literal in _scan_python(path):
            _emit(rel, lineno, literal)

    for path in _walk_files(TS_SCAN_DIRS, {".ts", ".tsx"}):
        rel = path.relative_to(ROOT).as_posix()
        for lineno, literal in _scan_ts(path):
            _emit(rel, lineno, literal)

    for path in _walk_files(HTML_SCAN_DIRS, {".html"}):
        rel = path.relative_to(ROOT).as_posix()
        for lineno, literal in _scan_html(path):
            _emit(rel, lineno, literal)

    total = sum(len(v) for v in by_namespace.values())
    return {
        "total_candidates": total,
        "by_namespace": {
            ns: sorted(items, key=lambda item: (item["file"], item["line"]))
            for ns, items in sorted(by_namespace.items())
        },
        "top_files": sorted(
            file_counts.items(), key=lambda kv: kv[1], reverse=True
        )[:25],
    }


def _markdown(report: dict) -> str:
    out: list[str] = []
    out.append("# i18n inventory (heuristic)")
    out.append("")
    out.append(f"Total candidate strings: **{report['total_candidates']}**")
    out.append("")
    out.append("## Top files by candidate count")
    out.append("")
    out.append("| File | Candidates |")
    out.append("|------|------------|")
    for rel, count in report["top_files"]:
        out.append(f"| `{rel}` | {count} |")
    out.append("")
    out.append("## By namespace")
    out.append("")
    for ns, items in report["by_namespace"].items():
        out.append(f"### `{ns}` ({len(items)})")
        out.append("")
        # Show only the first 25 per namespace to keep the report readable.
        for item in items[:25]:
            text = item["text"].replace("|", "\\|")
            out.append(f"- `{item['file']}:{item['line']}` — {text}")
        if len(items) > 25:
            out.append(f"- _… {len(items) - 25} more in this namespace_")
        out.append("")
    out.append("---")
    out.append("")
    out.append(
        "Heuristic only — review before treating any namespace as complete. "
        "See `docs/I18N_ROADMAP.md`."
    )
    return "\n".join(out)


def _check_strict(report: dict, namespaces: list[str]) -> int:
    """Return non-zero exit code when a 'completed' namespace still has hits."""
    fail = 0
    for ns in namespaces:
        completed_files = COMPLETED_NAMESPACES.get(ns)
        if completed_files is None:
            print(
                f"[strict] namespace '{ns}' is not marked complete in "
                "scripts/i18n_inventory.py (COMPLETED_NAMESPACES).",
                file=sys.stderr,
            )
            fail = 1
            continue
        offenders = [
            item
            for item in report["by_namespace"].get(ns, [])
            if item["file"] in completed_files
        ]
        if offenders:
            print(
                f"[strict] namespace '{ns}' has {len(offenders)} unmigrated "
                "strings:",
                file=sys.stderr,
            )
            for item in offenders[:10]:
                print(
                    f"  {item['file']}:{item['line']} — {item['text']}",
                    file=sys.stderr,
                )
            fail = 1
    return fail


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="emit JSON")
    parser.add_argument(
        "--strict",
        nargs="+",
        default=[],
        metavar="NAMESPACE",
        help="fail if a completed namespace still has unmigrated strings",
    )
    args = parser.parse_args()

    report = build_report()

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(_markdown(report))

    if args.strict:
        return _check_strict(report, args.strict)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
