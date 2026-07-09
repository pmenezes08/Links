"""merge_onboarding_identity_to_steve_profile — verbatim persistence rules.

Locks that professionalAssociations / professionalStrengths now persist into
steve_user_profiles.onboardingIdentity (they were compose-time-only before),
and that empty values never erase previously saved answers (the section-only
builder boots with the sibling section blanked locally).
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from backend.services import firestore_writes


@pytest.fixture
def fake_firestore(monkeypatch):
    """A minimal Firestore double capturing the merged payload."""
    monkeypatch.setattr(firestore_writes, "USE_FIRESTORE_WRITES", True)
    state = {"existing": {}, "written": None}

    doc_ref = MagicMock()
    snap = MagicMock()
    snap.to_dict.side_effect = lambda: {"onboardingIdentity": dict(state["existing"])}
    doc_ref.get.return_value = snap

    def capture_set(payload, merge=False):
        assert merge is True
        state["written"] = payload

    doc_ref.set.side_effect = capture_set
    fs = MagicMock()
    fs.collection.return_value.document.return_value = doc_ref
    monkeypatch.setattr(firestore_writes, "_get_client", lambda: fs)
    monkeypatch.setattr(firestore_writes, "_invalidate_and_reembed", lambda u: None)
    return state


def test_associations_and_strengths_persist_verbatim(fake_firestore):
    firestore_writes.merge_onboarding_identity_to_steve_profile(
        "ana",
        {
            "journey": "moved to Lisbon",
            "professionalAssociations": "early-stage ventures, ML in health",
            "professionalStrengths": "turning research into products",
        },
    )
    ob = fake_firestore["written"]["onboardingIdentity"]
    assert ob["professionalAssociations"] == "early-stage ventures, ML in health"
    assert ob["professionalStrengths"] == "turning research into products"
    assert ob["journey"] == "moved to Lisbon"


def test_empty_value_never_erases_saved_answer(fake_firestore):
    fake_firestore["existing"] = {
        "professionalAssociations": "already saved",
        "talkAllDay": "olives",
    }
    firestore_writes.merge_onboarding_identity_to_steve_profile(
        "ana",
        {"professionalAssociations": "", "talkAllDay": "", "professionalStrengths": ""},
    )
    ob = fake_firestore["written"]["onboardingIdentity"]
    assert ob["professionalAssociations"] == "already saved"
    assert ob["talkAllDay"] == "olives"
    # A key with no prior value may write empty (first-run semantics).
    assert ob["professionalStrengths"] == ""


def test_no_write_when_flag_disabled(fake_firestore, monkeypatch):
    monkeypatch.setattr(firestore_writes, "USE_FIRESTORE_WRITES", False)
    firestore_writes.merge_onboarding_identity_to_steve_profile(
        "ana", {"professionalAssociations": "x"}
    )
    assert fake_firestore["written"] is None
