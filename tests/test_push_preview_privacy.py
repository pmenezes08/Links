"""Push notifications respect users.notification_show_previews via summary_body."""

from __future__ import annotations

from backend.services import notifications


class TestPushPreviewPrivacy:
    def test_resolve_push_uses_summary_when_previews_off(self, monkeypatch):
        monkeypatch.setattr(
            notifications,
            "user_wants_notification_content_previews",
            lambda _username: False,
        )
        resolved = notifications._resolve_push_payload_for_user(
            "alice",
            {
                "title": "New message",
                "body": "Bob: secret text here",
                "summary_body": "Bob sent you a message",
            },
        )
        assert resolved["body"] == "Bob sent you a message"

    def test_resolve_push_uses_body_when_previews_on(self, monkeypatch):
        monkeypatch.setattr(
            notifications,
            "user_wants_notification_content_previews",
            lambda _username: True,
        )
        resolved = notifications._resolve_push_payload_for_user(
            "alice",
            {
                "title": "New message",
                "body": "Bob: secret text here",
                "summary_body": "Bob sent you a message",
            },
        )
        assert resolved["body"] == "Bob: secret text here"

    def test_resolve_push_without_summary_body_unchanged(self, monkeypatch):
        monkeypatch.setattr(
            notifications,
            "user_wants_notification_content_previews",
            lambda _username: False,
        )
        resolved = notifications._resolve_push_payload_for_user(
            "alice",
            {"title": "Invite", "body": "You were invited"},
        )
        assert resolved["body"] == "You were invited"

    def test_send_push_to_user_applies_privacy_before_native(self, monkeypatch):
        captured = {}

        def fake_native(username, title, body, data=None):
            captured["username"] = username
            captured["title"] = title
            captured["body"] = body
            captured["data"] = data

        monkeypatch.setattr(notifications, "user_wants_notification_content_previews", lambda _u: False)
        monkeypatch.setattr(notifications, "send_native_push", fake_native)
        monkeypatch.setattr(notifications, "VAPID_PUBLIC_KEY", "")
        monkeypatch.setattr(notifications, "VAPID_PRIVATE_KEY", "")

        notifications.send_push_to_user(
            "recipient",
            {
                "title": "Message from sender",
                "body": "sender: hello world",
                "summary_body": "sender sent you a message",
                "url": "/user_chat/chat/sender",
                "tag": "dm-1",
            },
        )

        assert captured["body"] == "sender sent you a message"
        assert captured["data"]["body"] == "sender sent you a message"

    def test_push_privacy_summary_english(self):
        text = notifications.push_privacy_summary("someone", "dm_message", author="Alice")
        assert "Alice" in text
        assert "message" in text.lower()
