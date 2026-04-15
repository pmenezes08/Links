import unittest

from backend.services.content_generation.ideas.opinion_roundup import (
    _legacy_opinion_body,
    _strip_opinion_cta_noise,
)


class TestOpinionRoundup(unittest.TestCase):
    def test_strip_opinion_cta_noise_removes_sources_footer(self):
        cleaned = _strip_opinion_cta_noise(
            "How might this change your view?\n\nSources\n- technologyreview.com"
        )
        self.assertEqual(cleaned, "How might this change your view?")

    def test_legacy_opinion_body_ends_cleanly_without_sources_section(self):
        body = _legacy_opinion_body(
            "AI",
            {
                "intro": "One recent take worth reading.",
                "closing": "Where do you land on this?",
                "bullets": [],
            },
            {},
            featured_video_url="https://www.youtube.com/watch?v=abcdefghijk",
            featured_video_title="A strong discussion",
            featured_video_summary="A recent conversation about the topic.",
        )

        self.assertNotIn("\nSources", body)
        self.assertIn("**Leave a comment:**", body)
        self.assertIn("Where do you land on this?", body)

    def test_legacy_opinion_body_includes_welcome_with_cadence(self):
        body = _legacy_opinion_body(
            "AI",
            {"intro": "A take.", "closing": "Thoughts?", "bullets": []},
            {"schedule": {"cadence": "weekly"}},
            featured_video_url="",
            featured_video_title="",
            featured_video_summary="",
        )
        self.assertTrue(body.startswith("Welcome to your weekly opinion roundup"))

    def test_legacy_opinion_body_welcome_without_cadence(self):
        body = _legacy_opinion_body(
            "AI",
            {"intro": "A take.", "closing": "Thoughts?", "bullets": []},
            {},
            featured_video_url="",
            featured_video_title="",
            featured_video_summary="",
        )
        self.assertTrue(body.startswith("Welcome to this opinion roundup"))


if __name__ == "__main__":
    unittest.main()
