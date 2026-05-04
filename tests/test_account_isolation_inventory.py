"""Static account-isolation inventory tests.

PR A deliberately does not change application behavior. These tests pin the
current inventory of browser storage, service-worker API cache lists, and
critical user-scoped endpoints so later hardening PRs have an explicit baseline
to update.
"""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def _js_string_array(source: str, const_name: str) -> list[str]:
    match = re.search(
        rf"const\s+{re.escape(const_name)}(?:\s*:\s*[^=]+)?\s*=\s*\[(.*?)\]",
        source,
        re.S,
    )
    assert match, f"missing JS array {const_name}"
    return re.findall(r"['\"]([^'\"]+)['\"]", match.group(1))


def _sw_set(source: str, const_name: str) -> set[str]:
    match = re.search(
        rf"const\s+{re.escape(const_name)}\s*=\s*new\s+Set\(\[(.*?)\]\)",
        source,
        re.S,
    )
    assert match, f"missing SW set {const_name}"
    return set(re.findall(r"['\"]([^'\"]+)['\"]", match.group(1)))


def test_inventory_doc_lists_required_sections_and_boundaries() -> None:
    doc = _read("docs/ACCOUNT_ISOLATION_INVENTORY.md")

    for heading in (
        "## Browser State",
        "### localStorage",
        "### sessionStorage",
        "### IndexedDB",
        "### Cache Storage / Service Worker",
        "## User-Scoped Endpoints",
        "## Public / Non-User Exceptions",
        "## Follow-Up PR Boundaries",
    ):
        assert heading in doc

    for future_pr in ("PR B", "PR C", "PR D", "PR E", "PR F"):
        assert future_pr in doc


def test_logout_inventory_matches_current_client_cleanup_contract() -> None:
    logout_ts = _read("client/src/utils/logout.ts")
    chat_cache_ts = _read("client/src/utils/chatThreadsCache.ts")

    for key in (
        "signal_device_id",
        "current_username",
        "encryption_keys_generated_at",
        "encryption_needs_sync",
        "encryption_reset_requested",
        "last_community_id",
        "mic_permission_granted",
        "home-timeline",
        "communityManagementShowNested",
        "cached_profile",
    ):
        assert key in logout_ts

    for prefix in (
        "signal_",
        "chat_",
        "community_",
        "cpoint_",
        "onboarding_",
        "signal-store-",
        "dashboard-",
        "community-feed:",
        "group-feed:",
    ):
        assert prefix in logout_ts

    assert "cpoint_processed_deep_links" in logout_ts
    assert "sessionStorage.clear()" in logout_ts

    for db_name in ("cpoint-offline", "chat-encryption", "signal-protocol", "signal-store"):
        assert db_name in logout_ts or db_name in _read("client/src/utils/offlineDb.ts")

    viewer_prefixes = set(_js_string_array(chat_cache_ts, "VIEWER_SCOPED_LOCAL_STORAGE_PREFIXES"))
    assert {
        "chat-threads-list",
        "group-chats-list",
        "chat-communities-tree",
        "chat-messages:",
        "chat-profile:",
    }.issubset(viewer_prefixes)
    assert "...VIEWER_SCOPED_LOCAL_STORAGE_PREFIXES" in logout_ts


def test_offline_db_inventory_pins_current_scoping_baseline() -> None:
    offline_db_ts = _read("client/src/utils/offlineDb.ts")
    chat_cache_ts = _read("client/src/utils/chatThreadsCache.ts")

    assert "const DB_NAME = 'cpoint-offline'" in offline_db_ts
    assert "const DB_VERSION = 3" in offline_db_ts

    for store in ("messages", "conversations", "posts", "feeds", "outbox", "keyval"):
        assert f"createObjectStore('{store}'" in offline_db_ts

    assert "db.createObjectStore('feeds', { keyPath: 'communityId' })" in offline_db_ts
    assert "owner:" not in offline_db_ts
    assert "conversationRowId(viewerUsername: string, peerUsername: string)" in offline_db_ts
    assert "dmConversationOfflineKey(viewerUsername: string, peerUsername: string)" in chat_cache_ts


def test_service_worker_inventory_pins_current_api_cache_baseline() -> None:
    sw_js = _read("client/public/sw.js")

    assert "const SW_VERSION = '2.69.0'" in sw_js
    assert "cp-shell-${SW_VERSION}" in sw_js
    assert "cp-runtime-${SW_VERSION}" in sw_js
    assert "cp-media-${SW_VERSION}" in sw_js

    stale = _sw_set(sw_js, "STALE_API_ENDPOINTS")
    assert {
        "/api/user_communities_hierarchical",
        "/get_user_communities_with_members",
        "/api/premium_dashboard_summary",
        "/api/user_parent_community",
        "/api/chat_threads",
        "/api/group_chat/list",
        "/api/notifications",
        "/api/check_gym_membership",
        "/api/check_admin",
    }.issubset(stale)

    no_cache = _sw_set(sw_js, "NO_CACHE_API_ENDPOINTS")
    assert {
        "/api/profile_me",
        "/api/profile/ai_suggestions",
        "/api/profile/ai_review",
        "/api/profile/steve_analysis",
        "/api/profile/steve_request_refresh",
    }.issubset(no_cache)

    assert "url.pathname.startsWith('/api/')" in sw_js
    assert "event.respondWith(networkFirst(request, RUNTIME_CACHE))" in sw_js


def test_user_scoped_endpoint_inventory_is_backed_by_current_routes() -> None:
    files = {
        "app": _read("bodybuilding_app.py"),
        "communities": _read("backend/blueprints/communities.py"),
        "me": _read("backend/blueprints/me.py"),
        "subscriptions": _read("backend/blueprints/subscriptions.py"),
        "notifications": _read("backend/blueprints/notifications.py"),
        "dm_chats": _read("backend/blueprints/dm_chats.py"),
        "group_chat": _read("backend/blueprints/group_chat.py"),
    }

    route_sources = "\n".join(files.values())
    for endpoint in (
        "/api/profile_me",
        "/api/check_admin",
        "/api/user_communities_hierarchical",
        "/api/user_parent_community",
        "/api/dashboard_unread_feed",
        "/api/chat_threads",
        "/api/group_chat/list",
        "/api/notifications",
        "/api/me/entitlements",
        "/api/me/ai-usage",
        "/api/me/billing",
        "/api/me/billing/portal",
        "/api/me/subscriptions",
        "/api/stripe/config",
        "/api/stripe/checkout_status",
        "/api/stripe/create_checkout_session",
    ):
        assert endpoint in route_sources

    assert "@login_required" in files["app"]
    assert "_session_username()" in files["me"]
    assert "_session_username()" in files["subscriptions"]
    assert "session.get(\"username\")" in files["communities"] or "session.get('username')" in files["communities"]
