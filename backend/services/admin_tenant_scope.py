"""Tenant SQL fragments for admin list endpoints.

Mirrors ``bodybuilding_app._tenant_filter`` so blueprint routes see the same
tenant boundary as the monolith admin dashboard when ``g.tenant_id`` is set
(landlord / unset tenant → no extra predicate).
"""

from __future__ import annotations

from typing import Tuple

from flask import g

from backend.services.database import get_sql_placeholder


def communities_table_tenant_sql(column: str = "tenant_id") -> Tuple[str, tuple]:
    tid = getattr(g, "tenant_id", None)
    if tid is not None:
        ph = get_sql_placeholder()
        return f" AND c.{column} = {ph}", (tid,)
    return "", ()
