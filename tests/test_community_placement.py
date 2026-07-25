"""Guided placement — Enterprise-only deterministic sub-community allocation.

Founder rules (July 2026):
* Owner authors questions; every option maps to sub-communities of the
  Enterprise root. Allocation is the union of the picked options' targets —
  pure lookup, zero AI spend.
* The questionnaire is mandatory but post-accept: membership in the root is
  created by the normal accept path, then a pending placement opens and the
  member answers on next app open. No skip.
* Members must never see target ids/names before allocation (sub-communities
  are private); the gate dissolves silently if the community stops being
  Enterprise or the questions go away.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.usefixtures("mysql_dsn")


from backend.services import community_placement as cp
from backend.services.database import get_db_connection, get_sql_placeholder

from tests.fixtures import make_community, make_user


OWNER = "plc_owner"


@pytest.fixture(autouse=True)
def _fake_legacy_helpers(monkeypatch):
    """Manage-permission = creator only; membership write = plain insert.

    Mirrors tests/test_community_join_requests.py, which monkeypatches the
    membership writer instead of importing the monolith chokepoint.
    """

    def _add(cursor, user_id, community_id, role="member", username=None, **_kwargs):
        ph = get_sql_placeholder()
        cursor.execute(
            f"INSERT INTO user_communities (user_id, community_id, role) VALUES ({ph}, {ph}, 'member')",
            (int(user_id), int(community_id)),
        )

    monkeypatch.setattr(
        cp,
        "_legacy_helpers",
        lambda: {
            "add_user_to_community": _add,
            "has_community_management_permission": lambda username, community_id: str(
                username
            ).startswith("plc_owner"),
        },
    )


def _member_rows(user_id: int) -> set[int]:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT community_id FROM user_communities WHERE user_id = {ph}", (int(user_id),)
        )
        return {
            int(r["community_id"] if hasattr(r, "keys") else r[0]) for r in (c.fetchall() or [])
        }


def _config(subs: list[int], *, multi_targets: dict[str, list[int]] | None = None) -> dict:
    """Two questions: single-choice mapping to subs[0], multi mapping per label."""
    multi_targets = multi_targets or {}
    return {
        "questions": [
            {
                "prompt": "Which area do you work in?",
                "allow_multi": False,
                "options": [
                    {"label": "Engineering", "target_community_ids": [subs[0]]},
                    {"label": "Corporate", "target_community_ids": []},
                ],
            },
            {
                "prompt": "Anything you'd like to join?",
                "allow_multi": True,
                "options": [
                    {"label": label, "target_community_ids": targets}
                    for label, targets in (multi_targets or {"Running": []}).items()
                ]
                + [{"label": "Nothing", "target_community_ids": []}],
            },
        ]
    }


def _open_pending(root: int, username: str, inviter: str = "someone") -> bool:
    with get_db_connection() as conn:
        c = conn.cursor()
        opened = cp.open_pending_placement_if_active(c, root, username, inviter)
        conn.commit()
        return opened


def _make_tree(prefix: str, *, tier: str = "enterprise") -> tuple[int, int, int, int]:
    root = make_community(f"{prefix}-root", tier=tier, creator_username=OWNER)
    sub1 = make_community(f"{prefix}-sub1", parent_community_id=root)
    sub2 = make_community(f"{prefix}-sub2", parent_community_id=root)
    nested = make_community(f"{prefix}-nested", parent_community_id=sub1)
    return root, sub1, sub2, nested


class TestOwnerConfig:
    def test_non_enterprise_root_is_rejected(self):
        cp.ensure_tables()
        root = make_community("plc-free-root", tier="free", creator_username=OWNER)
        payload, status = cp.save_config(OWNER, root, {"questions": []})
        assert status == 403
        assert payload["reason"] == "enterprise_required"

    def test_sub_community_is_rejected(self):
        root, sub1, _sub2, _n = _make_tree("plc-subcfg")
        payload, status = cp.save_config(OWNER, sub1, {"questions": []})
        assert status == 400
        assert payload["reason"] == "root_only"

    def test_non_manager_is_forbidden(self):
        root, *_ = _make_tree("plc-authz")
        payload, status = cp.get_config("plc_rando", root)
        assert status == 403

    def test_target_outside_tree_is_rejected(self):
        root, sub1, _sub2, _n = _make_tree("plc-foreign")
        foreign = make_community("plc-foreign-elsewhere", tier="free")
        cfg = _config([sub1], multi_targets={"Elsewhere": [foreign]})
        payload, status = cp.save_config(OWNER, root, cfg)
        assert status == 400
        assert payload["reason"] == "invalid_target"

    def test_roundtrip_and_descendant_picker(self):
        root, sub1, sub2, nested = _make_tree("plc-round")
        payload, status = cp.save_config(
            OWNER, root, _config([sub1], multi_targets={"Running": [sub2, nested]})
        )
        assert status == 200 and payload["success"]
        assert payload["enabled"] is True
        assert len(payload["questions"]) == 2
        assert payload["questions"][0]["options"][0]["target_community_ids"] == [sub1]
        picker_ids = {s["id"] for s in payload["sub_communities"]}
        assert picker_ids == {sub1, sub2, nested}  # root itself never a target

    def test_limits_enforced(self):
        root, sub1, *_ = _make_tree("plc-limits")
        too_many = {"questions": [_config([sub1])["questions"][0]] * (cp.MAX_QUESTIONS + 1)}
        assert cp.save_config(OWNER, root, too_many)[1] == 400
        one_option = {
            "questions": [
                {"prompt": "Only one?", "options": [{"label": "Solo", "target_community_ids": []}]}
            ]
        }
        payload, status = cp.save_config(OWNER, root, one_option)
        assert status == 400
        assert payload["reason"] == "invalid_options"


class TestPendingLifecycle:
    def test_accept_hook_opens_pending_only_when_gate_active(self):
        root, sub1, *_ = _make_tree("plc-open")
        make_user("plc_new_a")
        # No questions yet -> no pending row.
        assert _open_pending(root, "plc_new_a") is False
        cp.save_config(OWNER, root, _config([sub1]))
        assert _open_pending(root, "plc_new_a", inviter="plc_inviter") is True
        # Idempotent.
        assert _open_pending(root, "plc_new_a") is False

    def test_free_tier_never_opens_pending(self):
        root = make_community("plc-free2", tier="free", creator_username=OWNER)
        make_user("plc_new_b")
        assert _open_pending(root, "plc_new_b") is False

    def test_pending_payload_strips_targets(self):
        root, sub1, sub2, _n = _make_tree("plc-strip")
        cp.save_config(OWNER, root, _config([sub1], multi_targets={"Running": [sub2]}))
        make_user("plc_new_c")
        _open_pending(root, "plc_new_c", inviter="plc_inviter")

        payload, status = cp.list_pending_for_user("plc_new_c")
        assert status == 200
        assert len(payload["pending"]) == 1
        entry = payload["pending"][0]
        assert entry["community_id"] == root
        assert entry["inviter_username"] == "plc_inviter"
        assert "target_community_ids" not in str(payload)
        for question in entry["questions"]:
            for option in question["options"]:
                assert set(option.keys()) == {"id", "label"}

    def test_pending_hidden_after_downgrade(self):
        root, sub1, *_ = _make_tree("plc-downgrade")
        cp.save_config(OWNER, root, _config([sub1]))
        make_user("plc_new_d")
        _open_pending(root, "plc_new_d")
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(f"UPDATE communities SET tier = 'free' WHERE id = {ph}", (root,))
            conn.commit()
        payload, _ = cp.list_pending_for_user("plc_new_d")
        assert payload["pending"] == []


class TestRespond:
    def _seed(self, prefix: str) -> tuple[int, int, int, int, dict]:
        root, sub1, sub2, nested = _make_tree(prefix)
        cp.save_config(OWNER, root, _config([sub1], multi_targets={"Running": [sub2, nested]}))
        payload, _ = cp.get_config(OWNER, root)
        q = payload["questions"]
        return root, sub1, sub2, nested, {
            "q1": q[0]["id"],
            "q1_eng": q[0]["options"][0]["id"],
            "q1_corp": q[0]["options"][1]["id"],
            "q2": q[1]["id"],
            "q2_run": q[1]["options"][0]["id"],
            "q2_none": q[1]["options"][1]["id"],
        }

    def test_union_allocation_is_deterministic(self):
        root, sub1, sub2, nested, ids = self._seed("plc-alloc")
        u = make_user("plc_resp_a")
        _open_pending(root, "plc_resp_a")

        payload, status = cp.respond(
            "plc_resp_a",
            root,
            {str(ids["q1"]): [ids["q1_eng"]], str(ids["q2"]): [ids["q2_run"]]},
        )
        assert status == 200 and payload["success"]
        assert {a["id"] for a in payload["allocated"]} == {sub1, sub2, nested}
        assert _member_rows(int(u["id"])) == {sub1, sub2, nested}

        again, status_again = cp.respond("plc_resp_a", root, {str(ids["q1"]): [ids["q1_eng"]]})
        assert status_again == 400
        assert again["reason"] == "already_completed"

    def test_empty_multi_choice_is_valid(self):
        root, sub1, _s2, _n, ids = self._seed("plc-empty")
        u = make_user("plc_resp_b")
        _open_pending(root, "plc_resp_b")
        payload, status = cp.respond(
            "plc_resp_b", root, {str(ids["q1"]): [ids["q1_corp"]], str(ids["q2"]): []}
        )
        assert status == 200
        assert payload["allocated"] == []
        assert _member_rows(int(u["id"])) == set()

    def test_missing_single_choice_answer_is_rejected(self):
        root, _s1, _s2, _n, ids = self._seed("plc-missing")
        make_user("plc_resp_c")
        _open_pending(root, "plc_resp_c")
        payload, status = cp.respond("plc_resp_c", root, {str(ids["q2"]): []})
        assert status == 400
        assert payload["reason"] == "answers_incomplete"

    def test_unknown_option_is_rejected(self):
        root, _s1, _s2, _n, ids = self._seed("plc-badopt")
        make_user("plc_resp_d")
        _open_pending(root, "plc_resp_d")
        payload, status = cp.respond(
            "plc_resp_d", root, {str(ids["q1"]): [999], str(ids["q2"]): []}
        )
        assert status == 400
        assert payload["reason"] == "invalid_option"

    def test_gate_inactive_dissolves_quietly(self):
        root, _s1, _s2, _n, ids = self._seed("plc-dark")
        u = make_user("plc_resp_e")
        _open_pending(root, "plc_resp_e")
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(f"UPDATE communities SET tier = 'free' WHERE id = {ph}", (root,))
            conn.commit()
        payload, status = cp.respond("plc_resp_e", root, {})
        assert status == 200
        assert payload.get("gate_inactive") is True
        assert payload["allocated"] == []
        assert _member_rows(int(u["id"])) == set()
        # Completed, not stuck pending.
        assert cp.respond("plc_resp_e", root, {})[1] == 400

    def test_deleted_target_is_skipped_not_fatal(self):
        root, sub1, sub2, nested, ids = self._seed("plc-stale")
        u = make_user("plc_resp_f")
        _open_pending(root, "plc_resp_f")
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(f"DELETE FROM communities WHERE id = {ph}", (nested,))
            conn.commit()
        payload, status = cp.respond(
            "plc_resp_f",
            root,
            {str(ids["q1"]): [ids["q1_eng"]], str(ids["q2"]): [ids["q2_run"]]},
        )
        assert status == 200
        assert {a["id"] for a in payload["allocated"]} == {sub1, sub2}
        assert _member_rows(int(u["id"])) == {sub1, sub2}
