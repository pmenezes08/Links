"""Write helpers for useful PDF documents."""

from __future__ import annotations

import logging
import os
import threading
from datetime import datetime
from typing import Any, Optional, Tuple

from werkzeug.utils import secure_filename

from backend.services.community import is_app_admin
from backend.services.community_access import check_useful_resource_mutation_access
from backend.services.useful_resources_notify import notify_community_new_resource

logger = logging.getLogger(__name__)


def _r2_key_from_file_path(file_path: str) -> Optional[str]:
    if not file_path:
        return None
    if file_path.startswith("http"):
        from backend.services.r2_storage import R2_PUBLIC_URL

        if R2_PUBLIC_URL and file_path.startswith(R2_PUBLIC_URL):
            return file_path[len(R2_PUBLIC_URL) :].lstrip("/")
        if "/docs/" in file_path:
            return "docs/" + file_path.split("/docs/", 1)[1].split("?", 1)[0]
        return None
    return file_path.lstrip("/")


def _delete_doc_file_best_effort(file_path: str) -> None:
    if not file_path:
        return
    if file_path.startswith("http"):
        key = _r2_key_from_file_path(file_path)
        if key:
            try:
                from backend.services.r2_storage import delete_from_r2

                delete_from_r2(key)
            except Exception as r2_err:
                logger.warning("Could not delete doc from R2 %s: %s", file_path, r2_err)
        return
    try:
        base_dir = os.path.dirname(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
        disk_path = os.path.join(base_dir, "uploads", file_path.lstrip("/"))
        if os.path.exists(disk_path):
            os.remove(disk_path)
    except Exception as fe:
        logger.warning("Could not remove doc file %s: %s", file_path, fe)


def _index_uploaded_doc_async(doc_id: int, payload: dict) -> None:
    try:
        from backend.services.steve_document_memory import index_useful_doc

        index_useful_doc(payload)
    except Exception as index_err:
        logger.warning("Steve document memory indexing failed doc_id=%s: %s", doc_id, index_err)


def _reindex_doc_metadata_async(doc_id: int) -> None:
    try:
        from backend.services.steve_document_memory import index_useful_doc_by_id

        index_useful_doc_by_id(int(doc_id), force=True)
    except Exception as index_err:
        logger.warning("Steve document memory metadata reindex failed doc_id=%s: %s", doc_id, index_err)


def upload_useful_doc(
    conn: Any,
    cursor: Any,
    ph: str,
    *,
    username: str,
    community_id_raw: str | None,
    group_id_int: int | None,
    name: str,
    details: str,
    file_storage: Any,
) -> Tuple[bool, dict, int]:
    from backend.services.r2_storage import R2_ENABLED, upload_file_to_r2

    name = (name or "").strip()
    details = (details or "").strip()
    if not name:
        return False, {"success": False, "error": "Document name required"}, 400
    if len(name) > 200:
        return False, {"success": False, "error": "Name too long (max 200 characters)"}, 400
    if not file_storage or not getattr(file_storage, "filename", ""):
        return False, {"success": False, "error": "No file selected"}, 200

    ok, err = check_useful_resource_mutation_access(
        cursor,
        ph,
        username,
        community_id_raw=community_id_raw,
        group_id_int=group_id_int,
    )
    if not ok:
        return False, {"success": False, "error": err or "Forbidden"}, 403

    orig = secure_filename(file_storage.filename)
    ext = orig.rsplit(".", 1)[-1].lower() if "." in orig else ""
    if ext != "pdf":
        return False, {"success": False, "error": "Only PDF files are allowed"}, 200

    safe_name = f"doc_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{username}.pdf"
    r2_key = f"docs/{safe_name}"

    if R2_ENABLED:
        success, r2_url = upload_file_to_r2(file_storage, r2_key, "application/pdf")
        if success and r2_url:
            file_path = r2_url
            logger.info("Document uploaded to R2: %s", r2_url)
        else:
            logger.warning("R2 upload failed, falling back to local storage")
            base_dir = os.path.dirname(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
            upload_dir = os.path.join(base_dir, "uploads", "docs")
            os.makedirs(upload_dir, exist_ok=True)
            local_path = os.path.join(upload_dir, safe_name)
            file_storage.seek(0)
            file_storage.save(local_path)
            file_path = f"docs/{safe_name}"
    else:
        base_dir = os.path.dirname(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
        upload_dir = os.path.join(base_dir, "uploads", "docs")
        os.makedirs(upload_dir, exist_ok=True)
        local_path = os.path.join(upload_dir, safe_name)
        try:
            file_storage.save(local_path)
        except Exception as se:
            logger.error("upload save error: %s", se)
            return False, {"success": False, "error": "Could not save file on server"}, 200
        file_path = f"docs/{safe_name}"

    community_id = (community_id_raw or "").strip() or None
    cursor.execute(
        f"""
        INSERT INTO useful_docs (community_id, group_id, username, file_path, description, details, created_at)
        VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
        """,
        (
            community_id if community_id else None,
            group_id_int,
            username,
            file_path,
            name,
            details,
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        ),
    )
    doc_id = int(getattr(cursor, "lastrowid", 0) or 0)

    if community_id and group_id_int is None:
        notify_community_new_resource(int(community_id), username, "doc", name or orig, conn)

    conn.commit()

    if doc_id:
        payload = {
            "id": doc_id,
            "community_id": int(community_id) if community_id else None,
            "group_id": group_id_int,
            "username": username,
            "file_path": file_path,
            "description": name,
            "details": details,
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        try:
            threading.Thread(target=_index_uploaded_doc_async, args=(doc_id, payload), daemon=True).start()
        except Exception as start_err:
            logger.warning("Could not start Steve document memory indexing doc_id=%s: %s", doc_id, start_err)

    response = {
        "success": True,
        "message": "Document uploaded to CDN" if file_path.startswith("http") else "Document uploaded",
        "path": file_path if file_path.startswith("http") else f"/uploads/{file_path}",
        "doc_id": doc_id,
        "steve_indexing": "queued" if doc_id else "not_queued",
    }
    return True, response, 200


def delete_useful_doc(
    conn: Any,
    cursor: Any,
    ph: str,
    *,
    username: str,
    doc_id_raw: str | None,
) -> Tuple[bool, dict]:
    if not doc_id_raw:
        return False, {"success": False, "error": "doc_id required"}

    cursor.execute(
        f"""
        SELECT username, file_path, community_id, group_id
        FROM useful_docs
        WHERE id = {ph}
        """,
        (doc_id_raw,),
    )
    row = cursor.fetchone()
    if not row:
        return False, {"success": False, "error": "Document not found"}

    owner = row["username"] if hasattr(row, "keys") else row[0]
    path = row["file_path"] if hasattr(row, "keys") else row[1]
    community_id = row["community_id"] if hasattr(row, "keys") else row[2]
    group_id = row["group_id"] if hasattr(row, "keys") else row[3]

    if username != owner and not is_app_admin(username):
        return False, {"success": False, "error": "Forbidden"}

    cursor.execute(f"DELETE FROM useful_docs WHERE id = {ph}", (doc_id_raw,))
    conn.commit()

    _delete_doc_file_best_effort(str(path or ""))
    try:
        from backend.services.steve_document_memory import purge_useful_doc

        purge_useful_doc(int(doc_id_raw), community_id=community_id, group_id=group_id)
    except Exception as purge_err:
        logger.warning("Steve document memory purge failed doc_id=%s: %s", doc_id_raw, purge_err)

    return True, {"success": True}


def rename_useful_doc(
    conn: Any,
    cursor: Any,
    ph: str,
    *,
    username: str,
    doc_id_raw: str | None,
    new_name: str,
    details: str,
) -> Tuple[bool, dict]:
    new_name = (new_name or "").strip()
    details = (details or "").strip()
    if not doc_id_raw:
        return False, {"success": False, "error": "doc_id required"}
    if not new_name:
        return False, {"success": False, "error": "new_name required"}
    if len(new_name) > 200:
        return False, {"success": False, "error": "Name too long (max 200 characters)"}

    cursor.execute(f"SELECT username FROM useful_docs WHERE id = {ph}", (doc_id_raw,))
    row = cursor.fetchone()
    if not row:
        return False, {"success": False, "error": "Document not found"}

    owner = row["username"] if hasattr(row, "keys") else row[0]
    if username != owner and not is_app_admin(username):
        return False, {"success": False, "error": "Only the uploader can edit this document"}

    cursor.execute(
        f"UPDATE useful_docs SET description = {ph}, details = {ph} WHERE id = {ph}",
        (new_name, details, doc_id_raw),
    )
    conn.commit()

    try:
        threading.Thread(target=_reindex_doc_metadata_async, args=(int(doc_id_raw),), daemon=True).start()
    except Exception as start_err:
        logger.warning("Could not start Steve document metadata reindex doc_id=%s: %s", doc_id_raw, start_err)

    return True, {"success": True, "message": "Document updated", "name": new_name, "details": details}
