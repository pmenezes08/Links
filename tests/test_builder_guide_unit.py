from backend.services import builder


def test_build_guide_teaches_multiplayer_state_machine():
    guide = builder._SYSTEM_PROMPT
    for anchor in (
        "turnBasedGame",
        "initialState",
        "applyMove",
        "phase",
        "canMove",
        "pending_sent",
        "pending_received",
        "opponent turn",
        "stale_version",
        "sent invites",
        "received invites",
        "matchController",
        "live-feeling",
        "onOpponentMove",
        "lastMove",
        "from,to,piece",
        "pollMs",
    ):
        assert anchor.lower() in guide.lower()


def test_build_guide_teaches_creation_data_runtime():
    guide = builder._SYSTEM_PROMPT
    for anchor in (
        "sharedState",
        "CPoint.collection",
        "CPoint.forms.submit",
        "Websites",
        "Apps",
        "server/database",
        "localStorage",
    ):
        assert anchor.lower() in guide.lower()


def test_build_guide_teaches_public_publish_scope():
    guide = builder._SYSTEM_PROMPT
    for anchor in (
        "Public web publishing",
        "websites/apps",
        "Built with C-Point",
        "games stay inside C-Point",
        "public domains",
    ):
        assert anchor.lower() in guide.lower()


def test_converse_agent_mode_turns_explicit_fix_into_ready_brief(monkeypatch):
    captured = {}

    def fake_generate(system, user, **kwargs):
        captured["system"] = system
        captured["user"] = user
        return (
            '{"reply":"Got it. I will fix the reconnect flashes, invite buttons, '
            'and turn colours now.","ready":true,'
            '"brief":"Fix the existing chess build: stop reconnect flashing, show decline on all pending invites, '
            'and reload authoritative match state so turns and colours are correct."}'
        )

    monkeypatch.setattr(builder.llm, "generate_text", fake_generate)
    out = builder.converse(
        [{"role": "assistant", "text": "Which one should we explore first?"}],
        "I want you to fix the 3 of them",
        agent_mode=True,
        has_creation=True,
        current_html="<!doctype html><html><body>Chess</body></html>",
    )

    assert out["ready"] is True
    assert "reconnect" in out["brief"].lower()
    system = captured["system"].lower()
    assert "do not ask which direction to explore" in system
    assert "return ready=true" in system
    assert "fix all listed issues" in system

