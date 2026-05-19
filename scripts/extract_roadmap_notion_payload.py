"""Parse product-roadmap `roadmap_items` from knowledge_base.py for Notion table sync.

Outputs scripts/roadmap_notion_payload.json (title → summary/description/status lines).
Use Cursor Notion MCP to apply alongside scripts/notion_product_roadmap_page_ids.json."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
lines = (ROOT / "backend" / "services" / "knowledge_base.py").read_text(encoding="utf-8").splitlines()

roadmap_line_start = roadmap_line_end = None
for i, raw in enumerate(lines):
    if '"Admin-web: Knowledge Base (this system)"' in raw:
        roadmap_line_start = i
    if roadmap_line_start is not None and '"Subscriptions — Steve blocked UX (modal CTA' in raw:
        roadmap_line_end = i
        break
if roadmap_line_start is None or roadmap_line_end is None:
    raise RuntimeError("Could not isolate product-roadmap roadmap_items titles in knowledge_base.py")

items: list[dict] = []
for line in lines[roadmap_line_start : roadmap_line_end + 1]:
    s = line.strip()
    if not s.startswith('{"title":'):
        continue
    if s.endswith(","):
        s = s[:-1]
    items.append(json.loads(s))


def notion_status(it: dict) -> str:
    if it.get("status") == "completed":
        return "Done"
    if it.get("status") == "ongoing":
        return "In progress"
    if it.get("status") == "not_started" and it.get("phase") == "exploring":
        return "Idea"
    return "Planned"


def summary_line(it: dict) -> str:
    parts = [
        f"Phase: {it.get('phase')}",
        f"Effort: {it.get('effort')}",
        f"Target: {it.get('target_quarter')}",
    ]
    if it.get("test"):
        suffix = it.get("test_status") or "not_run"
        ts = {"successful": "passed", "unsuccessful": "failed", "not_run": "not run"}.get(
            suffix, suffix
        )
        parts.append(f"KB test: {it['test']} ({ts})")
    return " | ".join(parts)


def plain_description(notes: str) -> str:
    if not notes or not notes.strip():
        return "Details to be filled in; see in-app KB roadmap (slug product-roadmap)."
    # Plain text for Notion properties (avoid markdown noise)
    t = notes.replace("**", "").replace("`", "")
    return " ".join(t.split())


out = []
for it in items:
    out.append(
        {
            "title": it["title"],
            "summary": summary_line(it),
            "description": plain_description(it.get("notes") or ""),
            "notion_status": notion_status(it),
        }
    )

if __name__ == "__main__":
    out_path = ROOT / "scripts" / "roadmap_notion_payload.json"
    if len(sys.argv) > 1 and sys.argv[1] == "--titles":
        for o in out:
            print(o["title"])
        sys.exit(0)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(out_path.as_posix(), len(out))
