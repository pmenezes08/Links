from __future__ import annotations

from datetime import datetime, timezone

from backend.services import subscription_billing_ledger as ledger
from tests.fixtures import make_user


def _invoice(invoice_id: str, username: str, amount: int, paid_at: datetime) -> dict:
    ts = int(paid_at.replace(tzinfo=timezone.utc).timestamp())
    return {
        "id": invoice_id,
        "amount_paid": amount,
        "currency": "eur",
        "created": ts,
        "status_transitions": {"paid_at": ts},
        "metadata": {"sku": "premium", "username": username},
        "lines": {"data": [{"period": {"start": ts - 3600, "end": ts + 2_592_000}}]},
    }


def test_invoice_payment_is_idempotent_and_totals_ytd(mysql_dsn):
    make_user("mary", subscription="premium")
    ledger.ensure_tables()

    paid_at = datetime(datetime.utcnow().year, 2, 1)
    assert ledger.record_invoice_payment(_invoice("in_123", "mary", 2500, paid_at)) is True
    assert ledger.record_invoice_payment(_invoice("in_123", "mary", 2500, paid_at)) is False

    totals = ledger.totals_for_user("mary")
    assert totals["spent_total_cents"] == 2500
    assert totals["spent_ytd_cents"] == 2500
