from __future__ import annotations

from typing import Any, Dict, List, Tuple

from backend.services import steve_document_memory as docmem


class _Snap:
    def __init__(self, doc_id: str, data: Dict[str, Any] | None):
        self.id = doc_id
        self._data = data
        self.exists = data is not None

    def to_dict(self) -> Dict[str, Any]:
        return dict(self._data or {})


class _Query:
    def __init__(self, fs: "_FakeFirestore", path: Tuple[str, ...], *, order: str | None = None, desc: bool = False, limit_n: int | None = None):
        self.fs = fs
        self.path = path
        self.order = order
        self.desc = desc
        self.limit_n = limit_n

    def order_by(self, field: str, direction: str | None = None):
        return _Query(self.fs, self.path, order=field, desc=(direction == "DESCENDING"), limit_n=self.limit_n)

    def limit(self, n: int):
        return _Query(self.fs, self.path, order=self.order, desc=self.desc, limit_n=n)

    def stream(self):
        rows = []
        expected_len = len(self.path) + 1
        for key, value in self.fs.docs.items():
            if len(key) == expected_len and key[: len(self.path)] == self.path:
                rows.append(_Snap(key[-1], value))
        if self.order:
            rows.sort(key=lambda snap: str((snap.to_dict() or {}).get(self.order) or ""), reverse=self.desc)
        if self.limit_n is not None:
            rows = rows[: self.limit_n]
        return rows


class _Collection(_Query):
    def document(self, doc_id: str):
        return _Doc(self.fs, self.path + (str(doc_id),))


class _Doc:
    def __init__(self, fs: "_FakeFirestore", path: Tuple[str, ...]):
        self.fs = fs
        self.path = path

    def collection(self, name: str):
        return _Collection(self.fs, self.path + (name,))

    def get(self):
        return _Snap(self.path[-1], self.fs.docs.get(self.path))

    def set(self, payload: Dict[str, Any], merge: bool = False):
        if merge and self.path in self.fs.docs:
            current = dict(self.fs.docs[self.path])
            current.update(payload)
            self.fs.docs[self.path] = current
        else:
            self.fs.docs[self.path] = dict(payload)


class _FakeFirestore:
    def __init__(self):
        self.docs: Dict[Tuple[str, ...], Dict[str, Any]] = {}

    def collection(self, name: str):
        return _Collection(self, (name,))


def _row(doc_id: int, scope: int, title: str, *, group_id: int | None = None) -> Dict[str, Any]:
    return {
        "id": doc_id,
        "community_id": scope,
        "group_id": group_id,
        "username": "owner",
        "file_path": f"docs/{title}.pdf",
        "description": title,
        "created_at": f"2026-01-{doc_id:02d} 10:00:00",
    }


def test_document_memory_indexes_and_retrieves_exact_community_scope(monkeypatch):
    fs = _FakeFirestore()
    monkeypatch.setattr(docmem, "_get_firestore_client", lambda: fs)
    monkeypatch.setattr(docmem, "_compute_embedding_safe", lambda text: None)

    def fake_pages(file_path: str):
        text = "Executive summary. Growth plan for visible community. Risk controls and launch milestones."
        if "hidden" in file_path:
            text = "Hidden sibling community acquisition document."
        return [{"page": 1, "text": text}], docmem.TEXT_STATUS_READABLE, None, 1

    monkeypatch.setattr(docmem, "extract_pdf_pages", fake_pages)
    docmem.index_useful_doc(_row(1, 10, "visible-plan"), compute_embeddings=False)
    docmem.index_useful_doc(_row(2, 11, "hidden-plan"), compute_embeddings=False)

    context, meta = docmem.build_doc_memory_context(
        "Give feedback on the uploaded PDF risk controls",
        community_id=10,
        original_post="I uploaded a PDF for review",
    )

    assert meta["manifest_count"] == 1
    assert meta["include_chunks"] is True
    assert "visible-plan" in context
    assert "Risk controls" in context
    assert "hidden-plan" not in context
    assert "Hidden sibling" not in context


def test_document_memory_group_scope_does_not_leak_to_parent_community(monkeypatch):
    fs = _FakeFirestore()
    monkeypatch.setattr(docmem, "_get_firestore_client", lambda: fs)
    monkeypatch.setattr(docmem, "_compute_embedding_safe", lambda text: None)
    monkeypatch.setattr(
        docmem,
        "extract_pdf_pages",
        lambda file_path: ([{"page": 1, "text": "Private group-only document text."}], docmem.TEXT_STATUS_READABLE, None, 1),
    )

    docmem.index_useful_doc(_row(3, 20, "group-doc", group_id=7), compute_embeddings=False)

    group_context, _ = docmem.build_doc_memory_context("summarize the document", group_id=7, original_post="PDF uploaded")
    community_context, community_meta = docmem.build_doc_memory_context("summarize the document", community_id=20, original_post="PDF uploaded")

    assert "group-doc" in group_context
    assert "Private group-only" in group_context
    assert community_meta["manifest_count"] == 0
    assert "group-doc" not in community_context


def test_scanned_pdf_manifest_is_honest_and_has_no_fake_chunks(monkeypatch):
    fs = _FakeFirestore()
    monkeypatch.setattr(docmem, "_get_firestore_client", lambda: fs)
    monkeypatch.setattr(docmem, "extract_pdf_pages", lambda file_path: ([{"page": 1, "text": ""}], docmem.TEXT_STATUS_SCANNED, None, 1))

    result = docmem.index_useful_doc(_row(4, 30, "scanned-only"), compute_embeddings=False)
    context, meta = docmem.build_doc_memory_context("what does the pdf say", community_id=30, original_post="PDF uploaded")

    assert result.status == docmem.TEXT_STATUS_SCANNED
    assert "status=scanned_pdf" in context
    assert meta["chunk_count"] == 0
    assert "Relevant document excerpts" not in context


def test_large_pdf_section_retrieval_stays_within_budget(monkeypatch):
    fs = _FakeFirestore()
    monkeypatch.setattr(docmem, "_get_firestore_client", lambda: fs)
    monkeypatch.setattr(docmem, "_compute_embedding_safe", lambda text: None)

    pages: List[Dict[str, Any]] = []
    for page in range(1, 501):
        body = f"Background page {page}. General operational details."
        if page == 347:
            body = "Risk Controls. This section explains SOC2 controls, audit owners, and mitigation actions."
        pages.append({"page": page, "text": body})
    monkeypatch.setattr(docmem, "extract_pdf_pages", lambda file_path: (pages, docmem.TEXT_STATUS_READABLE, None, len(pages)))

    result = docmem.index_useful_doc(_row(5, 40, "five-hundred-page-doc"), compute_embeddings=False)
    context, meta = docmem.build_doc_memory_context(
        "What does the Risk Controls section say?",
        community_id=40,
        original_post="Here is the PDF",
        max_chars=1200,
    )

    assert result.page_count == 500
    assert meta["chunk_count"] <= 5
    assert len(context) < 2600
    assert "Risk Controls" in context
    assert "five-hundred-page-doc" in context


def test_thread_aware_doc_followup_activates_without_pdf_keyword():
    manifest = [{"text_status": docmem.TEXT_STATUS_READABLE, "chunk_count": 3}]

    assert docmem.should_retrieve_docs_from_thread(
        user_message="Dá-nos um resumo e feedback",
        original_post="I uploaded a PDF above",
        recent_comments=["Steve: I can review the document."],
        manifest=manifest,
    )
