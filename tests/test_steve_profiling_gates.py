"""Unit tests for Steve profiling URL allowlist and gated social host logic."""

import unittest

from backend.services.steve_profiling_gates import (
    collect_social_links_for_profiling,
    host_is_gated_social,
    load_gated_social_hosts,
    normalize_url_for_allowlist,
    url_allowed_for_activity_prefetch,
)


class TestSteveProfilingGates(unittest.TestCase):
    def test_normalize_url_for_allowlist_stable_keys(self):
        self.assertEqual(
            normalize_url_for_allowlist("https://www.Instagram.com/foo/bar/"),
            "instagram.com/foo/bar",
        )
        self.assertEqual(normalize_url_for_allowlist("instagram.com/foo"), "instagram.com/foo")
        self.assertEqual(normalize_url_for_allowlist(""), "")

    def test_host_is_gated_social_defaults(self):
        gh = load_gated_social_hosts()
        self.assertTrue(host_is_gated_social("https://linkedin.com/in/me", gh))
        self.assertTrue(host_is_gated_social("https://www.instagram.com/x/", gh))
        self.assertFalse(host_is_gated_social("https://x.com/user", gh))
        self.assertFalse(host_is_gated_social("https://twitter.com/user", gh))
        self.assertFalse(host_is_gated_social("https://example.com/blog", gh))

    def test_url_allowed_for_activity_prefetch(self):
        gh = load_gated_social_hosts()
        allow = {normalize_url_for_allowlist("https://instagram.com/u")}
        self.assertTrue(url_allowed_for_activity_prefetch("https://example.com/post", allow, gh))
        self.assertFalse(url_allowed_for_activity_prefetch("https://instagram.com/other", allow, gh))
        self.assertTrue(url_allowed_for_activity_prefetch("https://instagram.com/u", allow, gh))

    def test_collect_social_links_merges_sources(self):
        norm, rows = collect_social_links_for_profiling(
            linkedin_sql="https://www.linkedin.com/in/janedoe",
            firestore_profile={
                "onboardingIdentity": {
                    "socialProvidedLinks": [
                        {"platform": "Instagram", "url": "https://instagram.com/jane"},
                    ]
                }
            },
            existing_analysis={
                "personal": {
                    "verifiedLinks": [
                        {"platform": "TikTok", "url": "https://tiktok.com/@jane"},
                    ]
                }
            },
        )
        self.assertIn("linkedin.com/in/janedoe", norm)
        self.assertIn("instagram.com/jane", norm)
        self.assertIn("tiktok.com/@jane", norm)
        platforms = {r[0] for r in rows}
        self.assertIn("LinkedIn", platforms)
        self.assertIn("Instagram", platforms)
        self.assertIn("TikTok", platforms)


if __name__ == "__main__":
    unittest.main()
