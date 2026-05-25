"""Exact-scope document memory for Steve community/group resources.

MySQL ``useful_docs`` remains the source of truth for authorization and
ownership. This service builds a Firestore memory/index layer so Steve can
reuse PDF summaries/chunks without reparsing full documents on every turn.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import hashlib
import io
import logging
import math
import os
import re
import unicodedata
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import requests

from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

COLLECTION = "steve_doc_memory"
MAX_PDF_BYTES = int(os.environ.get("STEVE_DOC_MEMORY_MAX_PDF_BYTES", str(50 * 1024 * 1024)))
CHUNK_TARGET_CHARS = int(os.environ.get("STEVE_DOC_MEMORY_CHUNK_CHARS", "3200"))
CHUNK_OVERLAP_CHARS = int(os.environ.get("STEVE_DOC_MEMORY_CHUNK_OVERLAP_CHARS", "350"))
MAX_CHUNKS_TO_STORE = int(os.environ.get("STEVE_DOC_MEMORY_MAX_CHUNKS", "500"))
MANIFEST_LIMIT_DEFAULT = 8
RETRIEVAL_CHUNKS_DEFAULT = 5

TEXT_STATUS_READABLE = "readable"
TEXT_STATUS_EMPTY = "empty"
TEXT_STATUS_SCANNED = "scanned_pdf"
TEXT_STATUS_FAILED = "extraction_failed"
TEXT_STATUS_PENDING = "pending"

_DOC_EXPLICIT_RE = re.compile(
    r"\b(document|documents|doc|docs|file|files|pdf|attachment|attachments|upload|uploaded|"
    r"paper|report|deck|brief|whitepaper|proposal|section|chapter|page|pages)\b",
    re.IGNORECASE,
)
_DOC_FOLLOWUP_RE = re.compile(
    r"\b(summary|summarize|summarise|feedback|review|critique|evaluate|analyse|analyze|assess|"
    r"structure|recommendation|recommend|what does it say|what is it about|key points|takeaways|"
    r"the new one|latest|that one|this one|read it|explain it)\b",
    re.IGNORECASE,
)
_HEADING_RE = re.compile(r"^\s*(?:\d+(?:\.\d+)*\.?\s+)?([A-Z][A-Za-z0-9][^\n]{4,120})\s*$")
_IDENTITY_STOP_TOKENS = {
    "attachment",
    "attachments",
    "document",
    "documents",
    "file",
    "files",
    "page",
    "pages",
    "pdf",
    "upload",
    "uploaded",
}


@dataclass
class IndexedDocument:
    doc_id: int
    status: str
    scope_key: str
    title: str
    chunk_count: int = 0
    page_count: int = 0
    error: Optional[str] = None


def utcnow_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def scope_key_for_doc(community_id: Optional[int] = None, group_id: Optional[int] = None) -> str:
    if group_id is not None:
        return f"group:{int(group_id)}"
    if community_id is not None:
        return f"community:{int(community_id)}"
    return "global"


def _row_value(row: Any, key: str, index: int, default: Any = None) -> Any:
    if row is None:
        return default
    try:
        if hasattr(row, "keys") and key in row.keys():
            return row[key]
    except Exception:
        pass
    try:
        return row[index]
    except Exception:
        return default


def _get_firestore_client():
    from backend.services.firestore_reads import USE_FIRESTORE_READS, _get_client

    if not USE_FIRESTORE_READS:
        return None
    return _get_client()


def _hash_text(value: str) -> str:
    return hashlib.sha256((value or "").encode("utf-8")).hexdigest()


def _normalize_identity_text(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _identity_tokens(value: Any) -> List[str]:
    normalized = _normalize_identity_text(value)
    return [
        token
        for token in normalized.split()
        if len(token) >= 3 and token not in _IDENTITY_STOP_TOKENS
    ]


def _doc_identity_blob(doc: Dict[str, Any]) -> str:
    outline = doc.get("outline") or []
    topics = doc.get("topics") or []
    if isinstance(outline, list):
        outline_text = " ".join(str(item) for item in outline[:20])
    else:
        outline_text = str(outline)
    if isinstance(topics, list):
        topics_text = " ".join(str(item) for item in topics[:20])
    else:
        topics_text = str(topics)
    return " ".join(
        str(part or "")
        for part in (
            doc.get("title"),
            doc.get("details"),
            doc.get("description"),
            doc.get("file_name"),
            doc.get("source_file_name"),
            topics_text,
            outline_text,
        )
    )


def document_identity_score(query: str, doc: Dict[str, Any]) -> float:
    """Score whether a user ask names or describes this manifest.

    This is intentionally language-agnostic: it matches normalized terms from
    document identity fields and lets the LLM handle multilingual semantics once
    the right document context is present.
    """
    query_norm = _normalize_identity_text(query)
    if not query_norm:
        return 0.0
    query_tokens = set(_identity_tokens(query_norm))
    if not query_tokens:
        return 0.0

    title_norm = _normalize_identity_text(doc.get("title"))
    score = 0.0
    if title_norm and len(title_norm) >= 5:
        if title_norm in query_norm or query_norm in title_norm:
            score += 1.2

    title_tokens = set(_identity_tokens(doc.get("title")))
    if title_tokens:
        overlap = query_tokens & title_tokens
        score += len(overlap) / max(1, min(len(title_tokens), 4))
        if overlap and any(len(token) >= 5 for token in overlap):
            score += 0.2

    identity_tokens = set(_identity_tokens(_doc_identity_blob(doc)))
    if identity_tokens:
        overlap = query_tokens & identity_tokens
        score += min(0.6, len(overlap) * 0.12)
        if overlap and any(len(token) >= 5 for token in overlap):
            score += 0.18
    return score


def matched_document_ids(query: str, manifest: Sequence[Dict[str, Any]], *, threshold: float = 0.3) -> List[int]:
    scored: List[Tuple[float, int]] = []
    for doc in manifest or []:
        doc_id = int(doc.get("doc_id") or 0)
        if not doc_id:
            continue
        score = document_identity_score(query, doc)
        if score >= threshold:
            scored.append((score, doc_id))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [doc_id for _, doc_id in scored]


def _normalize_local_candidates(file_path: str) -> List[str]:
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    raw = str(file_path or "").strip()
    stripped = raw.lstrip("/")
    if stripped.startswith("uploads/"):
        inside_uploads = stripped.split("uploads/", 1)[1]
    else:
        inside_uploads = stripped
    return [
        os.path.join(base_dir, "uploads", inside_uploads),
        os.path.join(base_dir, "static", "uploads", inside_uploads),
        os.path.join(base_dir, stripped),
        os.path.join(base_dir, "uploads", os.path.basename(stripped)),
    ]


def load_pdf_bytes(file_path: str) -> Tuple[Optional[bytes], Optional[str]]:
    """Load PDF bytes from R2/public URL or local upload fallback."""
    if not file_path:
        return None, "missing_file_path"
    value = str(file_path).strip()
    try:
        if value.startswith("http://") or value.startswith("https://"):
            resp = requests.get(
                value,
                timeout=45,
                headers={"User-Agent": "Mozilla/5.0 (compatible; CPointSteveDocIndexer/1.0)"},
            )
            resp.raise_for_status()
            data = resp.content
            if len(data) > MAX_PDF_BYTES:
                return None, "pdf_too_large"
            return data, None
        for path in _normalize_local_candidates(value):
            if os.path.exists(path):
                if os.path.getsize(path) > MAX_PDF_BYTES:
                    return None, "pdf_too_large"
                with open(path, "rb") as fh:
                    return fh.read(), None
        return None, "file_not_found"
    except Exception as exc:
        return None, f"load_failed:{exc!s}"[:180]


def extract_pdf_pages(file_path: str) -> Tuple[List[Dict[str, Any]], str, Optional[str], int]:
    """Return page text records, status, error, page_count."""
    data, err = load_pdf_bytes(file_path)
    if not data:
        return [], TEXT_STATUS_FAILED, err, 0
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        pages: List[Dict[str, Any]] = []
        page_count = len(reader.pages)
        non_empty = 0
        for idx, page in enumerate(reader.pages):
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""
            clean = " ".join(text.split())
            if clean:
                non_empty += 1
            pages.append({"page": idx + 1, "text": clean})
        if non_empty == 0:
            return pages, TEXT_STATUS_SCANNED if page_count else TEXT_STATUS_EMPTY, None, page_count
        return pages, TEXT_STATUS_READABLE, None, page_count
    except Exception as exc:
        return [], TEXT_STATUS_FAILED, f"extract_failed:{exc!s}"[:180], 0


def _estimate_tokens(text: str) -> int:
    return max(1, math.ceil(len(text or "") / 4))


def _first_heading(text: str) -> str:
    for line in (text or "").splitlines()[:12]:
        stripped = line.strip()
        if not stripped or len(stripped) > 140:
            continue
        m = _HEADING_RE.match(stripped)
        if m:
            return m.group(1).strip()
    return ""


def chunk_pages(pages: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    chunks: List[Dict[str, Any]] = []
    current: List[str] = []
    start_page: Optional[int] = None
    end_page: Optional[int] = None

    def flush() -> None:
        nonlocal current, start_page, end_page
        text = "\n".join(part for part in current if part).strip()
        if not text:
            current = []
            start_page = None
            end_page = None
            return
        chunk_idx = len(chunks) + 1
        heading = _first_heading(text)
        chunks.append(
            {
                "chunk_id": f"c{chunk_idx:04d}",
                "page_start": start_page or end_page or 1,
                "page_end": end_page or start_page or 1,
                "heading": heading,
                "section_path": [heading] if heading else [],
                "text": text,
                "summary": _summarize_text(text, max_chars=420),
                "tokens_estimate": _estimate_tokens(text),
            }
        )
        overlap = text[-CHUNK_OVERLAP_CHARS:] if CHUNK_OVERLAP_CHARS > 0 else ""
        current = [overlap] if overlap else []
        start_page = end_page

    for page in pages:
        text = (page.get("text") or "").strip()
        if not text:
            continue
        page_no = int(page.get("page") or 1)
        if start_page is None:
            start_page = page_no
        end_page = page_no
        current.append(f"[Page {page_no}]\n{text}")
        if sum(len(part) for part in current) >= CHUNK_TARGET_CHARS:
            flush()
        if len(chunks) >= MAX_CHUNKS_TO_STORE:
            break
    if len(chunks) < MAX_CHUNKS_TO_STORE:
        flush()
    return chunks[:MAX_CHUNKS_TO_STORE]


def _summarize_text(text: str, max_chars: int = 900) -> str:
    clean = " ".join((text or "").split())
    if len(clean) <= max_chars:
        return clean
    sentences = re.split(r"(?<=[.!?])\s+", clean)
    out = ""
    for sentence in sentences:
        if not sentence:
            continue
        if len(out) + len(sentence) + 1 > max_chars:
            break
        out = f"{out} {sentence}".strip()
    return out or clean[:max_chars]


def build_manifest_summary(title: str, chunks: Sequence[Dict[str, Any]], page_count: int) -> Tuple[str, List[str], List[str]]:
    headings: List[str] = []
    for chunk in chunks:
        heading = str(chunk.get("heading") or "").strip()
        if heading and heading not in headings:
            headings.append(heading)
        if len(headings) >= 12:
            break
    combined = " ".join(str(chunk.get("summary") or "") for chunk in chunks[:8])
    summary = _summarize_text(combined, max_chars=1100)
    topics = _keyword_topics(combined or title)
    outline = headings or [f"Pages 1-{page_count}" if page_count else "Document text"]
    return summary, outline, topics


def _keyword_topics(text: str, limit: int = 10) -> List[str]:
    words = re.findall(r"[A-Za-z][A-Za-z\-]{4,}", (text or "").lower())
    stop = {
        "about", "after", "again", "because", "before", "between", "could", "document",
        "first", "their", "there", "these", "those", "through", "using", "where", "which",
        "would", "should", "pages", "project", "section",
    }
    counts: Dict[str, int] = {}
    for word in words:
        if word in stop:
            continue
        counts[word] = counts.get(word, 0) + 1
    return [word for word, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]]


def _compute_embedding_safe(text: str) -> Optional[List[float]]:
    try:
        from backend.services.embedding_service import compute_embedding

        return compute_embedding(text)
    except Exception as exc:
        logger.debug("Steve doc embedding skipped: %s", exc)
        return None


def fetch_useful_doc_row(cursor: Any, ph: str, doc_id: int) -> Optional[Dict[str, Any]]:
    has_details = True
    try:
        cursor.execute(
            f"""
            SELECT id, community_id, group_id, username, file_path, description, details, created_at
            FROM useful_docs
            WHERE id = {ph}
            """,
            (doc_id,),
        )
    except Exception:
        has_details = False
        cursor.execute(
            f"""
            SELECT id, community_id, group_id, username, file_path, description, created_at
            FROM useful_docs
            WHERE id = {ph}
            """,
            (doc_id,),
        )
    row = cursor.fetchone()
    if not row:
        return None
    return {
        "id": int(_row_value(row, "id", 0)),
        "community_id": _row_value(row, "community_id", 1),
        "group_id": _row_value(row, "group_id", 2),
        "username": _row_value(row, "username", 3),
        "file_path": _row_value(row, "file_path", 4),
        "description": _row_value(row, "description", 5),
        "details": _row_value(row, "details", 6, "") if has_details else "",
        "created_at": _row_value(row, "created_at", 7 if has_details else 6),
    }


def index_useful_doc(doc_row: Dict[str, Any], *, force: bool = False, compute_embeddings: bool = True) -> IndexedDocument:
    """Index one authorized ``useful_docs`` row into Firestore memory."""
    doc_id = int(doc_row["id"])
    community_id = doc_row.get("community_id")
    group_id = doc_row.get("group_id")
    scope_key = scope_key_for_doc(community_id, group_id)
    title = str(doc_row.get("description") or os.path.basename(str(doc_row.get("file_path") or "")) or f"Document {doc_id}")
    file_path = str(doc_row.get("file_path") or "")
    file_name = os.path.basename(file_path.split("?", 1)[0].rstrip("/"))
    fs = _get_firestore_client()
    if not fs:
        return IndexedDocument(doc_id=doc_id, status=TEXT_STATUS_FAILED, scope_key=scope_key, title=title, error="firestore_disabled")

    doc_ref = fs.collection(COLLECTION).document(scope_key).collection("docs").document(str(doc_id))
    source_hash = _hash_text(f"{file_path}|{doc_row.get('created_at') or ''}|{title}|{doc_row.get('details') or ''}")
    if not force:
        snap = doc_ref.get()
        if snap.exists:
            existing = snap.to_dict() or {}
            if existing.get("source_hash") == source_hash and existing.get("text_status") in {
                TEXT_STATUS_READABLE,
                TEXT_STATUS_EMPTY,
                TEXT_STATUS_SCANNED,
            }:
                return IndexedDocument(
                    doc_id=doc_id,
                    status=str(existing.get("text_status")),
                    scope_key=scope_key,
                    title=title,
                    chunk_count=int(existing.get("chunk_count") or 0),
                    page_count=int(existing.get("page_count") or 0),
                )

    pages, status, error, page_count = extract_pdf_pages(file_path)
    chunks = chunk_pages(pages) if status == TEXT_STATUS_READABLE else []
    summary_short, outline, topics = build_manifest_summary(title, chunks, page_count) if chunks else ("", [], [])
    now = utcnow_iso()
    manifest = {
        "doc_id": doc_id,
        "community_id": int(community_id) if community_id is not None else None,
        "group_id": int(group_id) if group_id is not None else None,
        "title": title,
        "file_name": file_name,
        "details": str(doc_row.get("details") or ""),
        "uploader": doc_row.get("username"),
        "file_path_hash": _hash_text(file_path),
        "source_hash": source_hash,
        "source_updated_at": str(doc_row.get("created_at") or ""),
        "indexed_at": now,
        "text_status": status,
        "error_reason": error or "",
        "summary_short": summary_short,
        "summary_structured": summary_short,
        "outline": outline,
        "topics": topics,
        "page_count": page_count,
        "chunk_count": len(chunks),
        "token_count_estimate": sum(int(c.get("tokens_estimate") or 0) for c in chunks),
    }
    doc_ref.set(manifest, merge=True)

    for chunk in chunks:
        chunk_text = str(chunk.get("text") or "")
        payload = dict(chunk)
        payload["created_at"] = now
        payload["embedding"] = _compute_embedding_safe(chunk_text[:8000]) if compute_embeddings else None
        doc_ref.collection("chunks").document(str(chunk["chunk_id"])).set(payload)

    logger.info(
        "Steve doc indexed doc_id=%s scope=%s status=%s chunks=%s pages=%s",
        doc_id,
        scope_key,
        status,
        len(chunks),
        page_count,
    )
    return IndexedDocument(
        doc_id=doc_id,
        status=status,
        scope_key=scope_key,
        title=title,
        chunk_count=len(chunks),
        page_count=page_count,
        error=error,
    )


def index_useful_doc_by_id(doc_id: int, *, force: bool = False, compute_embeddings: bool = True) -> IndexedDocument:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        row = fetch_useful_doc_row(cursor, ph, int(doc_id))
        if not row:
            return IndexedDocument(doc_id=int(doc_id), status=TEXT_STATUS_FAILED, scope_key="unknown", title="", error="doc_not_found")
        return index_useful_doc(row, force=force, compute_embeddings=compute_embeddings)


def purge_useful_doc(
    doc_id: int,
    *,
    community_id: Optional[int] = None,
    group_id: Optional[int] = None,
) -> bool:
    """Best-effort delete of Firestore manifest + chunks for one useful doc."""
    fs = _get_firestore_client()
    if not fs:
        return False
    scope_key = scope_key_for_doc(community_id, group_id)
    doc_ref = fs.collection(COLLECTION).document(scope_key).collection("docs").document(str(int(doc_id)))
    try:
        chunks_ref = doc_ref.collection("chunks")
        for chunk_snap in chunks_ref.stream():
            chunk_snap.reference.delete()
        doc_ref.delete()
        logger.info("Purged Steve doc memory doc_id=%s scope=%s", doc_id, scope_key)
        return True
    except Exception as exc:
        logger.warning("Steve doc memory purge failed doc_id=%s scope=%s: %s", doc_id, scope_key, exc)
        return False


def backfill_existing_docs(*, limit: int = 100, force: bool = False, compute_embeddings: bool = True) -> Dict[str, Any]:
    out: Dict[str, Any] = {"indexed": 0, "failed": 0, "skipped": 0, "results": []}
    with get_db_connection() as conn:
        cursor = conn.cursor()
        has_details = True
        try:
            cursor.execute(
                f"""
                SELECT id, community_id, group_id, username, file_path, description, details, created_at
                FROM useful_docs
                ORDER BY created_at DESC
                LIMIT {int(limit)}
                """
            )
            rows = cursor.fetchall() or []
        except Exception:
            try:
                has_details = False
                cursor.execute(
                    f"""
                    SELECT id, community_id, group_id, username, file_path, description, created_at
                    FROM useful_docs
                    ORDER BY created_at DESC
                    LIMIT {int(limit)}
                    """
                )
                rows = cursor.fetchall() or []
            except Exception as fallback_exc:
                out["failed"] = 1
                out["error"] = f"useful_docs_unavailable:{fallback_exc!s}"[:220]
                return out
    for row in rows:
        doc_row = {
            "id": int(_row_value(row, "id", 0)),
            "community_id": _row_value(row, "community_id", 1),
            "group_id": _row_value(row, "group_id", 2),
            "username": _row_value(row, "username", 3),
            "file_path": _row_value(row, "file_path", 4),
            "description": _row_value(row, "description", 5),
            "details": _row_value(row, "details", 6, "") if has_details else "",
            "created_at": _row_value(row, "created_at", 7 if has_details else 6),
        }
        result = index_useful_doc(doc_row, force=force, compute_embeddings=compute_embeddings)
        out["results"].append(result.__dict__)
        if result.status == TEXT_STATUS_FAILED:
            out["failed"] += 1
        elif result.chunk_count == 0 and result.status in {TEXT_STATUS_EMPTY, TEXT_STATUS_SCANNED}:
            out["skipped"] += 1
        else:
            out["indexed"] += 1
    return out


def load_doc_manifest(
    *,
    community_id: Optional[int] = None,
    group_id: Optional[int] = None,
    limit: int = MANIFEST_LIMIT_DEFAULT,
) -> List[Dict[str, Any]]:
    fs = _get_firestore_client()
    if not fs:
        return []
    try:
        scope_key = scope_key_for_doc(community_id, group_id)
        query = (
            fs.collection(COLLECTION)
            .document(scope_key)
            .collection("docs")
            .order_by("source_updated_at", direction="DESCENDING")
            .limit(max(1, int(limit)))
        )
        out: List[Dict[str, Any]] = []
        for snap in query.stream():
            data = snap.to_dict() or {}
            data["doc_id"] = int(data.get("doc_id") or snap.id)
            out.append(data)
        return out
    except Exception as exc:
        logger.debug("Steve doc manifest load failed: %s", exc)
        return []


def format_doc_manifest(manifest: Sequence[Dict[str, Any]], *, max_docs: int = 5) -> str:
    lines = []
    for doc in list(manifest)[:max_docs]:
        title = doc.get("title") or f"Document {doc.get('doc_id')}"
        status = doc.get("text_status") or TEXT_STATUS_PENDING
        pages = doc.get("page_count") or "?"
        chunks = doc.get("chunk_count") or 0
        topics = ", ".join((doc.get("topics") or [])[:5])
        line = f"- Doc {doc.get('doc_id')}: {title} | status={status} | pages={pages} | chunks={chunks}"
        if topics:
            line += f" | topics: {topics}"
        lines.append(line)
    if not lines:
        return ""
    return "Documents available in this exact scope:\n" + "\n".join(lines)


def should_retrieve_docs_from_thread(
    *,
    user_message: str = "",
    original_post: str = "",
    recent_comments: Optional[Iterable[str]] = None,
    manifest: Optional[Sequence[Dict[str, Any]]] = None,
) -> bool:
    texts = [user_message or "", original_post or ""]
    texts.extend(list(recent_comments or [])[-8:])
    joined = "\n".join(texts)
    matched_ids = matched_document_ids(joined, manifest or [])
    if matched_ids:
        return True
    if _DOC_EXPLICIT_RE.search(joined):
        return True
    has_readable_doc = any((doc.get("text_status") == TEXT_STATUS_READABLE and int(doc.get("chunk_count") or 0) > 0) for doc in (manifest or []))
    if not has_readable_doc:
        return False
    if _DOC_FOLLOWUP_RE.search(joined):
        return True
    if len(manifest or []) == 1 and (user_message or "").strip():
        return bool(re.search(r"\b(it|this|that|summary|feedback|review|explain|structure)\b", user_message, re.IGNORECASE))
    return False


def _cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(float(x) * float(y) for x, y in zip(a, b))
    na = math.sqrt(sum(float(x) * float(x) for x in a))
    nb = math.sqrt(sum(float(y) * float(y) for y in b))
    if not na or not nb:
        return 0.0
    return dot / (na * nb)


def retrieve_doc_chunks(
    query: str,
    *,
    community_id: Optional[int] = None,
    group_id: Optional[int] = None,
    manifest: Optional[Sequence[Dict[str, Any]]] = None,
    limit: int = RETRIEVAL_CHUNKS_DEFAULT,
) -> List[Dict[str, Any]]:
    fs = _get_firestore_client()
    if not fs:
        return []
    scope_key = scope_key_for_doc(community_id, group_id)
    docs = list(manifest if manifest is not None else load_doc_manifest(community_id=community_id, group_id=group_id))
    query_vec = _compute_embedding_safe(query or "")
    scored: List[Tuple[float, Dict[str, Any]]] = []
    query_lower = (query or "").lower()
    matched_ids = set(matched_document_ids(query or "", docs))
    try:
        for doc in docs[:MANIFEST_LIMIT_DEFAULT]:
            doc_id = int(doc.get("doc_id") or 0)
            if not doc_id or doc.get("text_status") != TEXT_STATUS_READABLE:
                continue
            doc_identity_boost = document_identity_score(query or "", doc)
            chunks_ref = fs.collection(COLLECTION).document(scope_key).collection("docs").document(str(doc_id)).collection("chunks")
            for snap in chunks_ref.limit(80).stream():
                chunk = snap.to_dict() or {}
                chunk["doc_id"] = doc_id
                chunk["doc_title"] = doc.get("title") or f"Document {doc_id}"
                score = 0.0
                if doc_id in matched_ids:
                    score += 1.0
                score += min(0.5, doc_identity_boost)
                emb = chunk.get("embedding")
                if query_vec and isinstance(emb, list):
                    score += _cosine_similarity(query_vec, emb)
                text = f"{chunk.get('heading') or ''} {chunk.get('summary') or ''} {chunk.get('text') or ''}".lower()
                lexical_hits = sum(1 for word in set(re.findall(r"[a-zA-Z]{4,}", query_lower)) if word in text)
                score += min(0.25, lexical_hits * 0.03)
                scored.append((score, chunk))
        scored.sort(key=lambda item: item[0], reverse=True)
        max_results = max(1, int(limit))
        if any(score > 0 for score, _ in scored):
            return [chunk for score, chunk in scored if score > 0][:max_results]
        return [chunk for _, chunk in scored[:max_results]] if not query_vec else []
    except Exception as exc:
        logger.debug("Steve doc chunk retrieval failed: %s", exc)
        return []


def format_retrieved_doc_context(chunks: Sequence[Dict[str, Any]], *, max_chars: int = 6500) -> str:
    if not chunks:
        return ""
    parts: List[str] = []
    remaining = max_chars
    for chunk in chunks:
        title = chunk.get("doc_title") or f"Document {chunk.get('doc_id')}"
        page_start = chunk.get("page_start")
        page_end = chunk.get("page_end")
        page_label = f"pages {page_start}-{page_end}" if page_start != page_end else f"page {page_start}"
        heading = chunk.get("heading") or ""
        text = str(chunk.get("text") or chunk.get("summary") or "").strip()
        if not text:
            continue
        block = f"Document: {title} ({page_label})"
        if heading:
            block += f"\nSection: {heading}"
        block += f"\nExcerpt:\n{text[:remaining]}"
        parts.append(block)
        remaining -= len(block)
        if remaining <= 0:
            break
    return "Relevant document excerpts from this exact scope:\n\n" + "\n\n---\n\n".join(parts)


def build_doc_memory_context(
    query: str,
    *,
    community_id: Optional[int] = None,
    group_id: Optional[int] = None,
    original_post: str = "",
    recent_comments: Optional[Iterable[str]] = None,
    manifest_limit: int = MANIFEST_LIMIT_DEFAULT,
    chunk_limit: int = RETRIEVAL_CHUNKS_DEFAULT,
    max_chars: int = 6500,
) -> Tuple[str, Dict[str, Any]]:
    manifest = load_doc_manifest(community_id=community_id, group_id=group_id, limit=manifest_limit)
    manifest_text = format_doc_manifest(manifest)
    include_chunks = should_retrieve_docs_from_thread(
        user_message=query,
        original_post=original_post,
        recent_comments=recent_comments,
        manifest=manifest,
    )
    chunks: List[Dict[str, Any]] = []
    chunk_text = ""
    if include_chunks:
        chunks = retrieve_doc_chunks(
            query or original_post,
            community_id=community_id,
            group_id=group_id,
            manifest=manifest,
            limit=chunk_limit,
        )
        chunk_text = format_retrieved_doc_context(chunks, max_chars=max_chars)
    context = "\n\n".join(part for part in (manifest_text, chunk_text) if part.strip())
    return context, {
        "manifest_count": len(manifest),
        "chunk_count": len(chunks),
        "include_chunks": include_chunks,
    }
