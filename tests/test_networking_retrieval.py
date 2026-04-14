"""Unit tests for Steve networking retrieval helpers."""

import sys
import types
import unittest
from unittest.mock import patch

from backend.services.networking_retrieval import (
    fuse_roster,
    semantic_candidates,
    structured_candidates,
)


class TestNetworkingRetrieval(unittest.TestCase):
    def _getter(self, row, idx):
        return row[idx]

    def test_structured_candidates_prioritize_members_matching_both_facets(self):
        rows = [
            (
                "malamorjaria",
                "Mala Morjaria",
                "Enterprise AI leader in Chicago.",
                "Chicago",
                "USA",
                "Technology",
                "Managing Director",
                "66degrees",
                "AI, data modernization",
                "Chicago, Illinois",
                "Leads enterprise AI and cloud transformation work.",
            ),
            (
                "chicago_only",
                "Chicago Only",
                "Operator based in Chicago.",
                "Chicago",
                "USA",
                "Consumer",
                "COO",
                "RetailCo",
                "",
                "Chicago, Illinois",
                "Built retail operations.",
            ),
            (
                "tech_only",
                "Tech Only",
                "Tech executive on the west coast.",
                "San Francisco",
                "USA",
                "Technology",
                "VP Product",
                "CloudCo",
                "SaaS, product",
                "San Francisco, California",
                "Runs product for a software platform.",
            ),
        ]

        ranked = structured_candidates(
            rows,
            "How many people live in Chicago that have experience in the tech industry?",
            self._getter,
        )

        self.assertGreaterEqual(len(ranked), 3)
        self.assertEqual(ranked[0], "malamorjaria")
        self.assertLess(ranked.index("chicago_only"), ranked.index("tech_only"))

    def test_structured_candidates_skip_unstructured_story_queries(self):
        rows = [
            (
                "runner",
                "Runner",
                "Mentioned the Boston Marathon once.",
                "Boston",
                "USA",
                "Finance",
                "Investor",
                "FundCo",
                "",
                "Boston, Massachusetts",
                "Long-distance runner.",
            ),
        ]

        ranked = structured_candidates(
            rows,
            "Who ran the Boston marathon three years ago?",
            self._getter,
        )

        self.assertEqual(ranked, [])

    def test_fuse_roster_biases_structured_hits_without_dropping_semantic(self):
        fused = fuse_roster(
            ["malamorjaria", "amy"],
            ["bob", "malamorjaria", "zoe"],
            cap=4,
        )

        self.assertEqual(fused[0], "malamorjaria")
        self.assertLess(fused.index("amy"), fused.index("bob"))
        self.assertIn("zoe", fused)

    def test_semantic_candidates_uses_recall_cap(self):
        fake_module = types.ModuleType("backend.services.embedding_service")
        mock_ranked = lambda *args, **kwargs: [("u3", 0.9), ("u1", 0.8), ("u2", 0.7)]
        fake_module.search_similar_profiles_ranked = mock_ranked

        with patch.dict(sys.modules, {"backend.services.embedding_service": fake_module}):
            ranked = semantic_candidates(
                "Chicago tech",
                ["u1", "u2", "u3"],
                k_recall=200,
                k_final=40,
            )

            self.assertEqual(ranked, ["u3", "u1", "u2"])


if __name__ == "__main__":
    unittest.main()
