from __future__ import annotations

from backend.services import useful_links_read


class _FakeCursor:
    def __init__(self, *, include_details: bool = True):
        self.include_details = include_details
        self.calls: list[tuple[str, tuple]] = []

    def execute(self, sql: str, params: tuple = ()):
        self.calls.append((sql, params))
        if "details" in sql and not self.include_details:
            raise Exception("unknown column details")

    def fetchall(self):
        sql = self.calls[-1][0]
        if "FROM useful_links" in sql:
            return []
        if "details" in sql:
            return [
                {
                    "id": 1,
                    "username": "owner",
                    "file_path": "docs/example.pdf",
                    "description": "Required Name",
                    "details": "Optional document description",
                    "created_at": "2026-05-24 12:00:00",
                }
            ]
        return [
            {
                "id": 1,
                "username": "owner",
                "file_path": "docs/example.pdf",
                "description": "Required Name",
                "created_at": "2026-05-24 12:00:00",
            }
        ]


def test_fetch_useful_links_payload_returns_document_details(monkeypatch):
    monkeypatch.setattr(useful_links_read, "is_app_admin", lambda username: False)
    cursor = _FakeCursor(include_details=True)

    payload = useful_links_read.fetch_useful_links_payload(cursor, "owner", "42", None, "%s")

    assert payload["success"] is True
    assert payload["docs"] == [
        {
            "id": 1,
            "username": "owner",
            "file_path": "docs/example.pdf",
            "description": "Required Name",
            "details": "Optional document description",
            "created_at": "2026-05-24 12:00:00",
        }
    ]


def test_fetch_useful_links_payload_falls_back_before_details_column(monkeypatch):
    monkeypatch.setattr(useful_links_read, "is_app_admin", lambda username: False)
    cursor = _FakeCursor(include_details=False)

    payload = useful_links_read.fetch_useful_links_payload(cursor, "owner", "42", None, "%s")

    assert payload["success"] is True
    assert payload["docs"][0]["description"] == "Required Name"
    assert payload["docs"][0]["details"] == ""
