import unittest

from backend.services.content_generation.delivery import _append_sources


class TestContentDelivery(unittest.TestCase):
    def test_append_sources_can_be_disabled(self):
        content = "Welcome to this opinion roundup, brought to you by Steve.\n\n**Leave a comment:** Where do you land on this?"
        result = _append_sources(
            content,
            ["https://www.technologyreview.com/example"],
            enabled=False,
        )

        self.assertEqual(result, content)
        self.assertNotIn("\n\nSources\n", result)


if __name__ == "__main__":
    unittest.main()
