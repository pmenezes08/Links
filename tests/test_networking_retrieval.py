"""Unit tests for Steve networking retrieval helpers."""

import sys
import types
import unittest
from unittest.mock import patch

from backend.services.networking_retrieval import (
    build_dimension_plan,
    build_retrieval_query,
    fuse_roster,
    load_dimension_metadata_scores,
    networking_policy_for_size,
    resolve_named_people,
    semantic_match_details,
    semantic_candidates,
    structured_match_details,
    structured_candidates,
    should_use_reasoning_planner,
    tiered_roster,
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

    def test_should_use_reasoning_planner_for_complex_and_follow_up_queries(self):
        history = [{"role": "user", "content": "I want to meet people with experience across Southern Europe"}]
        self.assertTrue(
            should_use_reasoning_planner(
                "What about @member123?",
                history,
            )
        )
        self.assertTrue(
            should_use_reasoning_planner(
                "Looking for people with swimming, volunteering, and writing interests",
                [],
            )
        )
        self.assertFalse(should_use_reasoning_planner("Who is in Austin?", []))

    def test_build_retrieval_query_merges_prior_user_context_for_follow_ups(self):
        history = [
            {"role": "user", "content": "I want to meet people with long experience in Southern Europe"},
            {"role": "assistant", "content": "Here are a couple region-adjacent people."},
        ]
        query = build_retrieval_query("What about @member123?", history)
        self.assertIn("experience in Southern Europe", query)
        self.assertIn("@member123", query)

    def test_build_dimension_plan_maps_legacy_facets_to_kb_dimensions(self):
        plan = build_dimension_plan(
            {
                "facets": {
                    "geography": ["southern europe"],
                    "traits": ["collaborative"],
                    "company_builder": ["founder"],
                },
                "hard_constraints": ["geography"],
                "search_rewrite": "founders in southern europe with collaborative traits",
            }
        )

        self.assertIn("GeographyCulture", plan["primary_dimensions"])
        self.assertIn("Identity", plan["primary_dimensions"] + plan["secondary_dimensions"])
        self.assertIn("LifeCareer", plan["primary_dimensions"] + plan["secondary_dimensions"])
        self.assertIn("GeographyCulture", plan["hard_dimensions"])
        self.assertIn("southern europe", plan["dimension_terms"]["GeographyCulture"])

    def test_resolve_named_people_supports_mentions_and_display_names(self):
        rows = [
            ("hugosdurao", "Hugo Silva-Durao", "", "", "", "", "", "", "", "", ""),
            ("jh1987", "Jonas H", "", "", "", "", "", "", "", "", ""),
        ]

        resolved = resolve_named_people(rows, self._getter, message="What about @hugosdurao?")
        self.assertEqual(resolved, ["hugosdurao"])

        resolved_from_plan = resolve_named_people(
            rows,
            self._getter,
            query_plan={"named_people": ["Hugo Silva Durao"]},
        )
        self.assertEqual(resolved_from_plan, ["hugosdurao"])

    def test_fuse_roster_force_includes_named_usernames(self):
        fused = fuse_roster(
            ["amy", "bob"],
            ["cara", "bob", "zoe"],
            cap=4,
            forced_usernames=["hugosdurao"],
        )
        self.assertEqual(fused[0], "hugosdurao")
        self.assertIn("bob", fused)

    def test_semantic_match_details_preserve_source_dimensions(self):
        fake_module = types.ModuleType("backend.services.embedding_service")
        fake_module.AGGREGATE_DIMENSION_MAP = {
            "professional": ("Index", "LifeCareer", "Expertise", "CompanyIntel"),
            "experiences": ("GeographyCulture", "UniqueFingerprint", "InferredContext", "LifeCareer"),
        }
        fake_module.search_similar_profiles_ranked_detailed = lambda *args, **kwargs: [
            {"username": "hugo", "score": 0.92, "chunk_type": "GeographyCulture"},
            {"username": "alex", "score": 0.88, "chunk_type": "professional"},
        ]

        with patch.dict(sys.modules, {"backend.services.embedding_service": fake_module}):
            details = semantic_match_details(
                "people with deep southern europe experience",
                ["hugo", "alex"],
                retrieval_plan={
                    "facets": {"geography": ["southern europe"]},
                    "search_rewrite": "southern europe experience",
                },
                k_recall=20,
                k_final=10,
            )

        self.assertIn("GeographyCulture", details["hugo"]["matched_dimensions"])
        self.assertIn("Expertise", details["alex"]["matched_dimensions"])

    def test_structured_candidates_support_query_plan_and_sensitive_explicit_only(self):
        rows = [
            (
                "founder_parent",
                "Founder Parent",
                "Goal-driven operator and parent of two.",
                "Austin",
                "USA",
                "Technology",
                "Founder",
                "BuildCo",
                "golf, climbing",
                "Austin, Texas",
                "Founded a startup after years in software.",
            ),
            (
                "founder_not_parent",
                "Founder Not Parent",
                "Goal-driven founder who loves golf and climbing.",
                "Austin",
                "USA",
                "Technology",
                "Founder",
                "StartCo",
                "golf, climbing",
                "Austin, Texas",
                "Built and sold a software company.",
            ),
            (
                "parent_no_founder",
                "Parent No Founder",
                "Parent and golfer in the US.",
                "Denver",
                "USA",
                "Finance",
                "Investor",
                "FundCo",
                "golf",
                "Denver, Colorado",
                "Climbs on weekends.",
            ),
        ]
        plan = {
            "facets": {
                "geography": ["US"],
                "company_builder": ["founder"],
                "traits": ["goal-driven"],
                "interests": ["golf"],
                "experiences": ["climbing"],
                "identity_life_stage": ["parent"],
            },
            "hard_constraints": ["geography", "company_builder", "identity_life_stage"],
        }

        ranked = structured_candidates(
            rows,
            "goal-driven founders in the US who golf, climb, and are parents",
            self._getter,
            retrieval_plan=plan,
        )

        self.assertEqual(ranked[0], "founder_parent")
        self.assertNotEqual(ranked[0], "founder_not_parent")

    def test_tiered_roster_separates_direct_and_broader_matches(self):
        rows = [
            (
                "direct_match",
                "Direct Match",
                "Parent founder based in Austin who golfs.",
                "Austin",
                "USA",
                "Technology",
                "Founder",
                "BuildCo",
                "golf",
                "Austin, Texas",
                "Founder and parent building software products.",
            ),
            (
                "broader_match",
                "Broader Match",
                "Founder based in Austin who golfs.",
                "Austin",
                "USA",
                "Technology",
                "Founder",
                "BuildCo",
                "golf",
                "Austin, Texas",
                "Founder building software products.",
            ),
            (
                "semantic_only",
                "Semantic Only",
                "Operator in Austin.",
                "Austin",
                "USA",
                "Consumer",
                "COO",
                "OpsCo",
                "",
                "Austin, Texas",
                "Experienced operator.",
            ),
        ]
        plan = {
            "facets": {
                "geography": ["US"],
                "company_builder": ["founder"],
                "identity_life_stage": ["parent"],
            },
            "hard_constraints": ["geography", "company_builder", "identity_life_stage"],
        }
        details = structured_match_details(rows, self._getter, retrieval_plan=plan)
        ordered, tiers = tiered_roster(
            ["direct_match", "broader_match"],
            ["semantic_only", "broader_match", "direct_match"],
            structured_details=details,
            cap=3,
        )

        self.assertEqual(ordered[0], "direct_match")
        self.assertEqual(tiers["direct_match"], "direct")
        self.assertEqual(tiers["broader_match"], "broader")
        self.assertEqual(tiers["semantic_only"], "broader")

    def test_load_dimension_metadata_scores_uses_feedback_and_confidence(self):
        fake_docs = {
            "GeographyCulture": {
                "updatedAt": "2026-04-15T10:00:00Z",
                "content": {},
                "adminFeedback": {"status": "needs_correction", "at": "2026-04-16T10:00:00Z"},
            },
            "InferredContext": {
                "updatedAt": "2026-04-15T10:00:00Z",
                "content": {"confidence": 0.2},
            },
        }

        with patch("backend.services.steve_knowledge_base.get_member_knowledge", return_value=fake_docs):
            scores = load_dimension_metadata_scores(
                ["hugo"],
                dimension_plan={
                    "primary_dimensions": ["GeographyCulture", "InferredContext"],
                    "secondary_dimensions": [],
                    "hard_dimensions": [],
                },
            )

        self.assertLess(scores["hugo"]["total_adjustment"], 0.0)
        self.assertIn("GeographyCulture", scores["hugo"]["dimension_adjustments"])
        self.assertIn("InferredContext", scores["hugo"]["dimension_adjustments"])

    def test_load_dimension_metadata_scores_applies_negative_user_feedback_weighting(self):
        """Test new contextual feedback system: negative scores reduce ranking (weighted)."""
        fake_docs = {
            "ExpertiseDepth": {
                "updatedAt": "2026-04-15T10:00:00Z",
                "content": {"confidence": 0.8},
            },
        }
        negative_feedback_scores = {"hugo": -2}  # e.g. 2 thumbs-downs

        with patch("backend.services.steve_knowledge_base.get_member_knowledge", return_value=fake_docs):
            scores = load_dimension_metadata_scores(
                ["hugo"],
                dimension_plan={"primary_dimensions": ["ExpertiseDepth"]},
                feedback_scores=negative_feedback_scores,
            )

        self.assertIn("hugo", scores)
        self.assertLess(scores["hugo"]["total_adjustment"], 0.0)  # negative weighting applied
        self.assertIn("ExpertiseDepth", scores["hugo"]["dimension_adjustments"])

    def test_networking_policy_for_size_varies_caps(self):
        small = networking_policy_for_size(20)
        medium = networking_policy_for_size(80)
        large = networking_policy_for_size(500)

        self.assertEqual(small["prompt_member_cap"], 20)
        self.assertGreaterEqual(medium["prompt_member_cap"], 40)
        self.assertEqual(large["prompt_member_cap"], 40)
        self.assertGreater(large["ann_recall_cap"], medium["ann_recall_cap"])


if __name__ == "__main__":
    unittest.main()
