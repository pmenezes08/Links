"""Vision-judge for the Steve Builder — grades a *rendered* creation.

Given a screenshot of a build (from `render_service`), a vision model judges:
- **render_ok** — does it render as a usable, non-blank, non-broken UI?
- **design_score** — visual craft (0-100), the lever for the design-refine pass.
- **data_verified** — when the build had to display real web-researched data, do
  the on-screen values actually match it? (This is the robust successor to the
  string-level grounding check in `builder._research_landed` — it reads what the
  user sees.)
- **critique** — concrete, actionable design fixes.

This is a **paid AI surface**: every call logs one row to `ai_usage_log` under
`SURFACE_BUILDER_JUDGE` (a distinct surface, so it never counts against the
build-turn cap). It runs only inside an already-gated build on the async path.

Best-effort: returns ``None`` on any failure so the build pipeline degrades to
"unjudged" rather than failing. Never raises.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from backend.services import ai_usage
from backend.services.content_generation import llm

logger = logging.getLogger(__name__)

_JUDGE_MODEL = "claude-opus-4-8"  # vision-capable; never shown to users

_SYSTEM = (
    "You are a meticulous product-design and QA reviewer for small self-contained "
    "web 'creations' (games, quizzes, tools, mini-sites) built to a brief. You are "
    "shown a SCREENSHOT of the rendered creation on a ~420px-wide mobile canvas. "
    "Judge ONLY what is visible. The app may use motion/sound you cannot perceive in "
    "a still image — do not penalise for that. Reply with STRICT JSON ONLY: no prose, "
    "no markdown fence."
)


def _build_user_prompt(brief: str, facts: str, console_errors: List[str]) -> str:
    parts = [f"BRIEF (what the user asked for):\n{brief.strip()[:2000]}"]
    if facts.strip():
        parts.append(
            "REAL DATA THIS APP MUST DISPLAY ACCURATELY (fetched from the web — the "
            "on-screen values must match these):\n" + facts.strip()[:4000]
        )
    if console_errors:
        parts.append("RENDER DIAGNOSTICS — console errors were reported:\n" +
                     "\n".join(console_errors[:10]))
    parts.append(
        "Evaluate and return a JSON object with EXACTLY these keys:\n"
        '- "render_ok": boolean — true if it renders as a usable, non-blank, non-broken, '
        "styled UI; false if blank, an error screen, obviously broken layout, or unstyled.\n"
        '- "design_score": integer 0-100 for visual craft (type hierarchy, spacing rhythm, '
        "color discipline, depth/surfaces, finish & cohesion, real not-placeholder content, "
        "mobile poise). Guide: 0-40 basic/unstyled, 41-70 decent, 71-85 polished, 86-100 exceptional.\n"
        '- "data_verified": "yes" if the REAL DATA above is shown accurately on screen, '
        '"no" if values are missing/wrong/invented, "na" if no real data was provided.\n'
        '- "data_issues": array of short strings, each naming one specific data mismatch (empty if none).\n'
        '- "critique": array of up to 5 short, concrete, actionable design fixes, most impactful first.\n'
        "Return ONLY the JSON object."
    )
    return "\n\n".join(parts)


def _coerce_verdict(raw: Dict[str, Any]) -> Dict[str, Any]:
    try:
        score = int(round(float(raw.get("design_score", 0))))
    except (TypeError, ValueError):
        score = 0
    score = max(0, min(100, score))

    dv = str(raw.get("data_verified", "na")).strip().lower()
    if dv not in ("yes", "no", "na"):
        dv = "na"

    def _str_list(v: Any) -> List[str]:
        if not isinstance(v, list):
            return []
        return [str(x).strip()[:200] for x in v if str(x).strip()][:5]

    return {
        "render_ok": bool(raw.get("render_ok", True)),
        "design_score": score,
        "data_verified": dv,
        "data_issues": _str_list(raw.get("data_issues")),
        "critique": _str_list(raw.get("critique")),
    }


def judge(
    screenshot_b64: str,
    *,
    username: str,
    brief: str = "",
    facts: str = "",
    console_errors: Optional[List[str]] = None,
    community_id: Optional[int] = None,
    model: str = _JUDGE_MODEL,
    timeout: float = 60,
) -> Optional[Dict[str, Any]]:
    """Grade a rendered build screenshot. Returns the normalized verdict dict, or
    ``None`` on any failure. ``timeout`` caps the upstream call so the judge can't
    overrun the build's wall-clock budget. Logs one ``ai_usage_log`` row per call."""
    if not screenshot_b64:
        return None
    started = time.time()
    success = False
    verdict: Optional[Dict[str, Any]] = None
    try:
        raw = llm.vision_json(
            _SYSTEM,
            _build_user_prompt(brief or "", facts or "", list(console_errors or [])),
            screenshot_b64,
            model=model,
            timeout=timeout,
        )
        if isinstance(raw, dict):
            verdict = _coerce_verdict(raw)
            success = True
    except Exception:
        logger.warning("vision_judge: judge call failed", exc_info=True)
        verdict = None
    finally:
        try:
            ai_usage.log_usage(
                username,
                surface=ai_usage.SURFACE_BUILDER_JUDGE,
                request_type="builder_judge",
                community_id=community_id,
                model=model,
                success=success,
                reason_blocked=None if success else "judge_error",
                response_time_ms=int((time.time() - started) * 1000),
            )
        except Exception:
            logger.warning("vision_judge: usage logging failed", exc_info=True)
    return verdict
