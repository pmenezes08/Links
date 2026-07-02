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
from typing import Any, Dict, List, Optional, Union

from backend.services import ai_usage
from backend.services.content_generation import llm

logger = logging.getLogger(__name__)

_JUDGE_MODEL = "claude-opus-4-8"  # vision-capable; never shown to users

_SYSTEM = (
    "You are a meticulous product-design and QA reviewer for small self-contained "
    "web 'creations' (websites, apps, games) built to a brief. You are shown one or "
    "more SCREENSHOTS of the rendered creation (each labelled in the prompt). "
    "Judge ONLY what is visible. The app may use motion/sound you cannot perceive in "
    "a still image — do not penalise for that. Reply with STRICT JSON ONLY: no prose, "
    "no markdown fence."
)

# Per-kind rubric the design_score is judged against. Keyed by the normalized
# public kind (builder._public_kind); unknown/missing kind falls back to the
# generic prompt. Content authored with platform-designer (2026-07-02).
_KIND_RUBRICS: Dict[str, str] = {
    "website": (
        "This creation is a public WEBSITE. Judge it as a marketing page a business would "
        "put its name on: hero impact; art direction that FITS the subject (a warm/light "
        "canvas for a local business or editorial subject is correct — penalise generic "
        "dark-tech applied to a non-tech subject); distinct section rhythm rather than a "
        "stack of equal cards; imagery quality and text-over-image legibility; presence of "
        "a nav and a real footer; overall: would a stranger trust this business?"
    ),
    "app": (
        "This creation is an APP / product tool. Judge it as a product: a clear shell "
        "(header, content, one obvious primary action); information hierarchy; fully styled "
        "controls with comfortable tap targets; visible designed empty/loading states; not "
        "a poster with buttons."
    ),
    "game": (
        "This creation is a GAME. Judge the start screen as the game's poster frame: title "
        "art, readable how-to-play, an inviting Start."
    ),
}


def _build_user_prompt(brief: str, facts: str, console_errors: List[str],
                       kind: str = "", image_labels: Optional[List[str]] = None) -> str:
    parts = [f"BRIEF (what the user asked for):\n{brief.strip()[:2000]}"]
    labels = [str(l) for l in (image_labels or []) if str(l).strip()]
    if labels:
        parts.append("IMAGES (in order):\n" +
                     "\n".join(f"IMAGE {i + 1}: {label}" for i, label in enumerate(labels)))
    rubric = _KIND_RUBRICS.get((kind or "").strip().lower())
    if rubric:
        parts.append(f"KIND: {kind}\nJudge design_score against this rubric:\n{rubric}")
    if facts.strip():
        parts.append(
            "REAL DATA THIS APP MUST DISPLAY ACCURATELY (fetched from the web — the "
            "on-screen values must match these):\n" + facts.strip()[:4000]
        )
    if console_errors:
        parts.append("RENDER DIAGNOSTICS — console errors were reported:\n" +
                     "\n".join(console_errors[:10]))
    has_desktop = any("desktop" in label.lower() for label in labels)
    keys = (
        "Evaluate and return a JSON object with EXACTLY these keys:\n"
        '- "render_ok": boolean — true if it renders as a usable, non-blank, non-broken, '
        "styled UI; false if blank, an error screen, obviously broken layout, or unstyled.\n"
        '- "design_score": integer 0-100 for visual craft (type hierarchy, spacing rhythm, '
        "color discipline, depth/surfaces, finish & cohesion, real not-placeholder content, "
        "poise at every width shown). Guide: 0-40 basic/unstyled, 41-70 decent, 71-85 polished, 86-100 exceptional.\n"
        '- "data_verified": "yes" if the REAL DATA above is shown accurately on screen, '
        '"no" if values are missing/wrong/invented, "na" if no real data was provided.\n'
        '- "data_issues": array of short strings, each naming one specific data mismatch (empty if none).\n'
        '- "critique": array of up to 5 short, concrete, actionable design fixes, most impactful first.\n'
    )
    if has_desktop:
        keys += (
            '- "responsive_ok": boolean — false if the DESKTOP image shows a stretched single '
            "phone column between empty gutters, unconstrained 120ch+ text lines, tiny hero type, "
            "a grid that never reflows, or a missing/broken desktop nav; true otherwise.\n"
        )
    keys += "Return ONLY the JSON object."
    parts.append(keys)
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

    responsive = raw.get("responsive_ok", True)
    return {
        "render_ok": bool(raw.get("render_ok", True)),
        "design_score": score,
        "data_verified": dv,
        "data_issues": _str_list(raw.get("data_issues")),
        "critique": _str_list(raw.get("critique")),
        # Defaults True: absent (no desktop shot attached) or garbage must never
        # trigger a desktop-fix repair on its own.
        "responsive_ok": bool(responsive) if isinstance(responsive, bool) else True,
    }


def judge(
    screenshot_b64: Union[str, List[Dict[str, str]]],
    *,
    username: str,
    brief: str = "",
    facts: str = "",
    console_errors: Optional[List[str]] = None,
    community_id: Optional[int] = None,
    kind: str = "",
    model: str = _JUDGE_MODEL,
    timeout: float = 60,
) -> Optional[Dict[str, Any]]:
    """Grade a rendered build. ``screenshot_b64`` is either a single base64 PNG
    (back-compat) or a list of ``{"label": ..., "b64": ...}`` dicts — all images
    go in ONE vision call, so this stays exactly one ``ai_usage_log`` row
    (``SURFACE_BUILDER_JUDGE``) per pass regardless of image count. ``kind``
    (website/app/game) selects the rubric; unknown kinds fall back to the
    generic prompt. ``timeout`` caps the upstream call so the judge can't
    overrun the build's wall-clock budget."""
    if isinstance(screenshot_b64, str):
        shots = [{"label": "mobile (~420px)", "b64": screenshot_b64}] if screenshot_b64 else []
    else:
        shots = [s for s in (screenshot_b64 or []) if isinstance(s, dict) and s.get("b64")]
    if not shots:
        return None
    started = time.time()
    success = False
    verdict: Optional[Dict[str, Any]] = None
    try:
        raw = llm.vision_json(
            _SYSTEM,
            _build_user_prompt(brief or "", facts or "", list(console_errors or []),
                               kind=kind, image_labels=[s.get("label", "") for s in shots]),
            [s["b64"] for s in shots],
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
