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
        "opponent turn",
        "stale_version",
        "matchController",
        "onOpponentMove",
        "lastMove",
        "from,to,piece",
        "pollMs",
    ):
        assert anchor.lower() in guide.lower()


def test_build_guide_teaches_host_owned_lobby():
    """The HOST renders the multiplayer lobby; generated games must not build
    their own opponents/invites UI and instead open the host lobby via
    actions.refreshLobby()."""
    guide = builder._SYSTEM_PROMPT
    for anchor in (
        "hostLobby",
        "HOST owns the lobby",
        "do NOT build one",
        "actions.refreshLobby()",
        "pre-match/idle screen",
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


def test_build_guide_teaches_static_idle_screen_and_guarded_multiplayer():
    """The host never calls render() at idle, so the pre-match screen must be
    static HTML and the turnBasedGame example must demonstrate the feature-detect
    guard (models copy the example, not the prose)."""
    guide = builder._SYSTEM_PROMPT
    for anchor in (
        "never called at idle",
        "static html",
        "non-blank resting state",
        "if (window.CPoint && window.CPoint.hasTurnBasedGame)",
        "startHotSeat",
        "hot-seat",
    ):
        assert anchor.lower() in guide.lower(), f"guide missing anchor: {anchor}"


def test_build_guide_teaches_chess_library_and_start_screen():
    guide = builder._SYSTEM_PROMPT
    for anchor in (
        "chess.js",
        "never hand-roll chess legality",
        "start screen",
        "poster frame",
    ):
        assert anchor.lower() in guide.lower(), f"guide missing anchor: {anchor}"


def test_build_guide_forbids_meta_text_in_the_artifact():
    """§6.7: chat commentary and the artifact are strictly separated — the
    rendered UI carries zero build commentary."""
    guide = builder._SYSTEM_PROMPT
    for anchor in (
        "the document is the product, not a message",
        "zero meta-text",
        "belongs in chat",
        "change summaries",
    ):
        assert anchor.lower() in guide.lower(), f"guide missing anchor: {anchor}"


def test_converse_brief_contract_is_third_person_spec():
    """Chat-Steve's brief becomes the literal build spec — first-person plan
    prose ('I'll add a how-to-play intro…') renders as UI copy downstream."""
    spec = builder._CONVERSE_JSON.lower()
    assert "third-person product requirements" in spec
    assert "never first-person" in spec
    assert "what the app must be and do" in spec


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

