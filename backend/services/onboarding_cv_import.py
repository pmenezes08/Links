"""Extract professional fields from onboarding CV PDFs (text extract + structured parse)."""

from __future__ import annotations

import json
import logging
import re
from io import BytesIO
from typing import Any, Dict, List, Tuple

from backend.services.profile_structured_fields import (
    MAX_COMPANY_LEN,
    MAX_ENTRY_DESCRIPTION_LEN,
    MAX_TITLE_LEN,
    _clip,
    normalize_yyyy_mm,
    parse_work_history_for_storage,
)

logger = logging.getLogger(__name__)

MAX_CV_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 24
MAX_CV_TEXT_CHARS = 100_000

_CV_JSON_SYSTEM = """You extract structured professional data from CV/resume plain text for a networking app.
Rules:
- current_role: job title for the MOST RECENT / CURRENT position only (short phrase).
- current_company: employer org name for that current position (empty if self-employed or unknown).
- current_role_start_ym: start month as YYYY-MM only if clearly stated or safely inferable from dates; otherwise "".
- prior_roles: list of PREVIOUS employment only (not the current role). Newest previous job first. Each object:
  {"title","company","location","start","end","description"} — use "" for unknown fields.
  Dates as YYYY-MM when month known, else YYYY for year-only, else "".
  "end" can be "" for roles with no clear end.
- current_role_description: 1-3 sentences summarizing what they do in the CURRENT role (scope, impact, focus), taken or lightly edited from the CV bullets for that role only. If there is no substantive text, use "".
- Do NOT duplicate the current position in prior_roles.
- If text is ambiguous, prefer empty strings over guessing.
Return ONLY valid JSON with exactly these keys: current_role, current_company, current_role_start_ym, current_role_description, prior_roles
"""


def _extract_json_object(raw: str) -> Dict[str, Any]:
    text = (raw or "").strip()
    if not text:
        raise ValueError("Empty model response")
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object in model response")
    data = json.loads(text[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("JSON root must be an object")
    return data


def extract_pdf_text_from_bytes(data: bytes) -> str:
    """Extract plain text from PDF bytes; cap pages and total length."""
    if not data or not isinstance(data, (bytes, bytearray)):
        return ""
    if len(data) > MAX_CV_UPLOAD_BYTES:
        raise ValueError("file_too_large")

    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("pypdf_missing") from exc

    reader = PdfReader(BytesIO(data))
    parts: List[str] = []
    n_pages = min(len(reader.pages), MAX_PDF_PAGES)
    for i in range(n_pages):
        try:
            page = reader.pages[i]
            t = page.extract_text() or ""
            if t.strip():
                parts.append(t)
        except Exception as page_err:
            logger.debug("pdf page %s extract failed: %s", i, page_err)
    full = "\n\n".join(parts).strip()
    if len(full) > MAX_CV_TEXT_CHARS:
        full = full[:MAX_CV_TEXT_CHARS]
    # Normalize excessive whitespace for token efficiency
    full = re.sub(r"[ \t]+", " ", full)
    full = re.sub(r"\n{3,}", "\n\n", full)
    return full.strip()


def _norm_key_role(d: Dict[str, Any]) -> str:
    for k in ("current_role", "role", "title"):
        v = d.get(k)
        if v is not None and str(v).strip():
            return _clip(str(v), MAX_TITLE_LEN)
    return ""


def _norm_key_company(d: Dict[str, Any]) -> str:
    for k in ("current_company", "company", "employer"):
        v = d.get(k)
        if v is not None and str(v).strip():
            return _clip(str(v), MAX_COMPANY_LEN)
    return ""


def _as_prior_list(raw: Any) -> List[dict]:
    if not isinstance(raw, list):
        return []
    out: List[dict] = []
    for item in raw:
        if isinstance(item, dict):
            out.append(item)
    return out


def normalize_llm_cv_payload(parsed: Dict[str, Any]) -> Dict[str, Any]:
    """Turn raw LLM JSON into API/db-shaped dict: role, company, current_role_start_ym, work_history."""
    role = _norm_key_role(parsed)
    company = _norm_key_company(parsed)
    start_raw = parsed.get("current_role_start_ym")
    if start_raw is None:
        start_raw = parsed.get("current_start")
    current_role_start_ym = normalize_yyyy_mm(str(start_raw) if start_raw is not None else "")

    desc_raw = parsed.get("current_role_description")
    if desc_raw is None:
        desc_raw = parsed.get("current_role_summary") or parsed.get("role_description")
    current_role_description = _clip(str(desc_raw) if desc_raw is not None else "", MAX_ENTRY_DESCRIPTION_LEN)

    prior = parsed.get("prior_roles")
    if prior is None:
        prior = parsed.get("work_history") or parsed.get("previous_roles")
    prior_list = _as_prior_list(prior)

    work_json, work_list = parse_work_history_for_storage(json.dumps(prior_list, ensure_ascii=False))

    def _key_tu(item: Dict[str, str]) -> Tuple[str, str]:
        return (item.get("title", "").strip().lower(), item.get("company", "").strip().lower())

    cur_key = (role.strip().lower(), company.strip().lower())
    if cur_key[0] or cur_key[1]:
        work_list = [it for it in work_list if _key_tu(it) != cur_key]

    # Re-serialize after dedupe
    work_json, work_list = parse_work_history_for_storage(json.dumps(work_list, ensure_ascii=False))

    return {
        "role": role,
        "company": company,
        "current_role_start_ym": current_role_start_ym or "",
        "current_role_description": current_role_description,
        "work_history": work_list,
        "professional_work_history_json": work_json,
    }


def parse_cv_text_with_onboarding_fallback(
    cv_text: str,
    *,
    primary_model: str,
) -> Tuple[Dict[str, Any], Any, str]:
    """Parse CV text via chat completions: xAI primary, OpenAI gpt-4o fallback."""
    from backend.services.onboarding_llm import run_onboarding_chat_completion

    trimmed = (cv_text or "").strip()
    if not trimmed:
        raise ValueError("empty_cv_text")

    user_prompt = (
        "CV / resume text follows. Extract JSON per instructions.\n\n---\n" + trimmed[:MAX_CV_TEXT_CHARS]
    )
    response, model_used = run_onboarding_chat_completion(
        [
            {"role": "system", "content": _CV_JSON_SYSTEM},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=2000,
        temperature=0.2,
        primary_model=primary_model,
    )
    raw_msg = (response.choices[0].message.content or "").strip() if response.choices else ""
    parsed = _extract_json_object(raw_msg)
    normalized = normalize_llm_cv_payload(parsed)
    return normalized, response, model_used


def parse_cv_text_with_chat_completion(
    cv_text: str,
    *,
    client: Any,
    model: str,
) -> Tuple[Dict[str, Any], Any]:
    """Call chat completions; return (normalized_payload, response_object)."""
    trimmed = (cv_text or "").strip()
    if not trimmed:
        raise ValueError("empty_cv_text")

    user_prompt = (
        "CV / resume text follows. Extract JSON per instructions.\n\n---\n" + trimmed[:MAX_CV_TEXT_CHARS]
    )

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _CV_JSON_SYSTEM},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=2000,
        temperature=0.2,
    )
    raw_msg = (response.choices[0].message.content or "").strip() if response.choices else ""
    parsed = _extract_json_object(raw_msg)
    normalized = normalize_llm_cv_payload(parsed)
    return normalized, response
