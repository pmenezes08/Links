"""One-off helper: extract Flask routes and best-effort client references.

Run from repo root: python scripts/generate_route_inventory.py

Writes docs/BACKEND_ROUTES.md (large file).
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLIENT_DIRS = [ROOT / "client" / "src", ROOT / "admin-web" / "src"]


def _build_client_index() -> dict[str, str]:
    """Map relative path -> file text for client/admin TS sources."""
    idx: dict[str, str] = {}
    for base in CLIENT_DIRS:
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if p.suffix not in {".ts", ".tsx", ".js", ".jsx"}:
                continue
            try:
                idx[p.relative_to(ROOT).as_posix()] = p.read_text(
                    encoding="utf-8", errors="ignore"
                )
            except OSError:
                continue
    return idx


def _find_client_hits(index: dict[str, str], pattern: str, max_hits: int = 12) -> list[str]:
    if not pattern or len(pattern) < 4:
        return []
    hits: dict[str, int] = {}
    for rel, text in index.items():
        c = text.count(pattern)
        if c:
            hits[rel] = c
    top = sorted(hits.items(), key=lambda x: -x[1])[:max_hits]
    return [f"`{k}` ({n})" for k, n in top]


def _extract_path_from_route_line(line: str) -> str:
    m = re.search(r"@\w+\.route\(\s*['\"]([^'\"]+)['\"]", line)
    if m:
        return m.group(1)
    m = re.search(r"@app\.route\(\s*['\"]([^'\"]+)['\"]", line)
    if m:
        return m.group(1)
    return ""


def _next_function_name_fix(lines: list[str], start: int) -> str:
    j = start + 1
    while j < len(lines):
        s = lines[j].lstrip()
        if s.startswith("@"):
            j += 1
            continue
        m = re.match(r"def\s+(\w+)\s*\(", lines[j])
        if m:
            return m.group(1)
        j += 1
    return ""


def _decorator_block(lines: list[str], start: int) -> tuple[str, int]:
    """Concatenate @route(...) that may span lines; return (block, end_index)."""
    buf = []
    i = start
    depth = 0
    started = False
    while i < len(lines):
        buf.append(lines[i])
        for ch in lines[i]:
            if ch == "(":
                depth += 1
                started = True
            elif ch == ")" and started:
                depth -= 1
        if started and depth <= 0:
            return "\n".join(buf), i
        i += 1
    return "\n".join(buf), i


def extract_routes_from_file(py_path: Path) -> list[tuple[str, int, str, str, str]]:
    """Rows: (relative_path, line_no, decorator_block, view_function, route_path)."""
    lines = py_path.read_text(encoding="utf-8", errors="replace").splitlines()
    out: list[tuple[str, int, str, str, str]] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if "@app.route(" in line or "_bp.route(" in line:
            block, end_i = _decorator_block(lines, i)
            route_path = _extract_path_from_route_line(block.replace("\n", " "))
            if not route_path:
                m = re.search(r"['\"](/[^'\"]+)['\"]", block)
                route_path = m.group(1) if m else "?"
            fn = _next_function_name_fix(lines, end_i)
            out.append((py_path.relative_to(ROOT).as_posix(), i + 1, block.replace("\n", " ").strip(), fn, route_path))
            i = end_i + 1
            continue
        i += 1
    return out


def main() -> None:
    monolith = extract_routes_from_file(ROOT / "bodybuilding_app.py")
    blueprint_routes: list[tuple[str, int, str, str, str]] = []
    for py in sorted((ROOT / "backend" / "blueprints").glob("*.py")):
        if py.name == "__init__.py":
            continue
        blueprint_routes.extend(extract_routes_from_file(py))

    md: list[str] = []
    md.append("# Backend HTTP routes inventory")
    md.append("")
    md.append("Auto-generated structure; **purpose** is inferred from URL/handler name. **Client usage** is a best-effort grep")
    md.append("in `client/src` and `admin-web/src` for the exact path string (may miss dynamic builds).")
    md.append("")
    md.append("For **monolith** routes, many legacy HTML + JSON surfaces coexist — prefer new work in `backend/blueprints/`.")
    md.append("")

    idx = _build_client_index()

    def section(title: str, rows: list[tuple[str, int, str, str, str]]) -> None:
        md.append(f"## {title}")
        md.append("")
        md.append("| Path | Method(s) | Handler | Source file | Purpose (short) | Where used (TS/TSX hits) |")
        md.append("|------|-----------|---------|-------------|-----------------|---------------------------|")
        for src, lineno, dec, fn, rpath in rows:
            meth = ""
            if "methods=" in dec:
                mm = re.search(r"methods=\[([^\]]+)\]", dec)
                if mm:
                    meth = mm.group(1).replace("'", "").replace('"', "")
            else:
                meth = "GET (default)"
            if not meth:
                meth = "GET (default)"
            purpose = (fn or "?").replace("_", " ")
            hits = _find_client_hits(idx, rpath)
            hit_s = ", ".join(hits[:8]) if hits else "*(no exact string match — may use helpers)*"
            md.append(f"| `{rpath}` | {meth} | `{fn}` | `{src}:{lineno}` | {purpose} | {hit_s} |")
        md.append("")

    section("Blueprints (`backend/blueprints/*.py`)", blueprint_routes)
    md.append("---")
    md.append("")
    # Monolith: too many rows for one table — group by first path component
    by_group: dict[str, list[tuple[str, int, str, str, str]]] = {}
    for row in monolith:
        rpath = row[4]
        if rpath.startswith("/api/"):
            parts = rpath.split("/")
            key = "/api/" + parts[2] if len(parts) > 2 else "/api/other"
        else:
            segs = [s for s in rpath.split("/") if s]
            key = "/" + segs[0] if segs else "root"
        by_group.setdefault(key, []).append(row)

    md.append("## Monolith (`bodybuilding_app.py`)")
    md.append("")
    md.append(f"Total **{len(monolith)}** `@app.route` registrations, grouped below for readability.")
    md.append("")
    for key in sorted(by_group.keys(), key=lambda x: (0 if x.startswith("/api") else 1, x)):
        md.append(f"### `{key}`")
        md.append("")
        md.append("| Path | Method(s) | Handler | Line | Purpose (short) | Where used (TS/TSX) |")
        md.append("|------|-----------|---------|------|-----------------|----------------------|")
        for src, lineno, dec, fn, rpath in sorted(by_group[key], key=lambda x: x[4]):
            meth = "POST" if "methods=" in dec and "POST" in dec else ("GET" if "GET" in dec or "methods=" not in dec else "mixed")
            hits = _find_client_hits(idx, rpath)
            hit_s = ", ".join(hits[:5]) if hits else "—"
            md.append(
                f"| `{rpath}` | {meth} | `{fn}` | {lineno} | {(fn or '?').replace('_', ' ')} | {hit_s} |"
            )
        md.append("")

    out = ROOT / "docs" / "BACKEND_ROUTES.md"
    out.write_text("\n".join(md), encoding="utf-8")
    print(f"Wrote {out} ({len(md)} lines)")


if __name__ == "__main__":
    main()
