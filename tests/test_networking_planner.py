"""Unit tests for Steve networking planner helpers."""

import unittest

from backend.services.networking_planner import (
    PLANNER_MAX_OUTPUT_TOKENS,
    build_networking_planner_input,
    normalize_networking_query_plan,
    plan_networking_query,
)


class TestNetworkingPlanner(unittest.TestCase):
    def _getter(self, row, idx):
        return row[idx] if idx < len(row) else ""

    class _FakeResponses:
        def __init__(self, output_text):
            self.output_text = output_text
            self.kwargs = None

        def create(self, **kwargs):
            self.kwargs = kwargs
            return type("Response", (), {"output_text": self.output_text, "usage": {}})()

    class _FakeClient:
        def __init__(self, output_text):
            self.responses = TestNetworkingPlanner._FakeResponses(output_text)

    def test_prompt_contains_generic_dimension_policy_and_life_interests_example(self):
        prompt_input = build_networking_planner_input(
            message="I want people who know how to cook",
            conversation_history=[],
            member_rows=[("pilot", "Pilot Member", "", "", "", "", "", "", "", "", "", "Pat", "Pilot")],
            member_getter=self._getter,
        )

        system_text = prompt_input[0]["content"]
        user_text = prompt_input[1]["content"]
        self.assertIn("dimension_analysis", system_text)
        self.assertIn("direct_evidence_query", system_text)
        self.assertIn("LifeInterests", system_text)
        self.assertIn("cooking", system_text)
        self.assertIn("Even when the ask is simple", system_text)
        self.assertIn("@pilot", user_text)

    def test_normalize_keeps_only_allowed_facets_and_dimensions(self):
        plan = normalize_networking_query_plan(
            {
                "facets": {
                    "experiences": ["Commercial pilot", "Gliding"],
                    "unsupported": ["drop me"],
                },
                "primary_dimensions": ["LifeCareer", "Nope"],
                "secondary_dimensions": "Expertise",
                "hard_dimensions": ["InferredContext"],
                "dimension_analysis": {
                    "LifeInterests": {
                        "priority": "primary",
                        "reason": "The user wants a non-professional personal capability.",
                    },
                    "Nope": {"priority": "primary", "reason": "drop me"},
                },
                "named_people": "Pat Pilot",
                "search_rewrite": "pilot gliding flight experience",
                "direct_evidence_query": "commercial pilot gliding",
                "adjacent_evidence_query": "aviation industry",
                "deprioritized_evidence_query": "generic aviation investor",
                "search_state_action": "retrieve",
            }
        )

        self.assertEqual(plan["facets"], {"experiences": ["Commercial pilot", "Gliding"]})
        self.assertEqual(plan["primary_dimensions"], ["LifeCareer"])
        self.assertEqual(plan["secondary_dimensions"], ["Expertise"])
        self.assertEqual(plan["hard_dimensions"], ["InferredContext"])
        self.assertEqual(plan["dimension_analysis"]["LifeInterests"]["priority"], "primary")
        self.assertEqual(plan["direct_evidence_query"], "commercial pilot gliding")
        self.assertEqual(plan["search_state_action"], "retrieve")
        self.assertEqual(plan["named_people"], ["Pat Pilot"])

    def test_normalize_derives_dimensions_from_dimension_analysis(self):
        plan = normalize_networking_query_plan(
            {
                "intent_summary": "User wants people with direct cooking capability.",
                "target": "cooking",
                "relationship_to_target": "direct personal capability",
                "dimension_analysis": {
                    "LifeInterests": {"priority": "primary", "reason": "Recurring non-professional cooking belongs here."},
                    "InferredContext": {"priority": "primary", "reason": "Posts may imply habits and rituals."},
                    "UniqueFingerprint": {"priority": "secondary", "reason": "May be distinctive if socially connective."},
                    "LifeCareer": {"priority": "ignored", "reason": "Only relevant if cooking is professional."},
                },
                "direct_evidence_query": "personally cooks recipes weekly cooking",
            }
        )

        self.assertEqual(plan["primary_dimensions"], ["LifeInterests", "InferredContext"])
        self.assertEqual(plan["secondary_dimensions"], ["UniqueFingerprint"])
        self.assertEqual(plan["hard_dimensions"], [])

    def test_plan_networking_query_records_success_diagnostics(self):
        diagnostics = {}
        client = self._FakeClient(
            """{
                "intent_summary": "User wants analytical healthcare people.",
                "target": "analytical healthcare people",
                "relationship_to_target": "trait plus domain relevance",
                "dimension_analysis": {
                    "Identity": {"priority": "primary", "reason": "Analytical is a trait."},
                    "Expertise": {"priority": "primary", "reason": "Healthcare domain evidence."}
                },
                "direct_evidence_query": "analytical healthcare medical health care"
            }"""
        )
        plan = plan_networking_query(
            client,
            message="I want to meet people that are analytical and work in healthcare",
            conversation_history=[],
            member_rows=[],
            member_getter=self._getter,
            diagnostics=diagnostics,
        )

        self.assertIsNotNone(plan)
        self.assertTrue(diagnostics["attempted"])
        self.assertTrue(diagnostics["succeeded"])
        self.assertTrue(diagnostics["json_extracted"])
        self.assertTrue(diagnostics["normalized"])
        self.assertEqual(diagnostics["failure_reason"], "")
        self.assertIn("analytical healthcare", diagnostics["raw_preview"])
        self.assertEqual(client.responses.kwargs["max_output_tokens"], PLANNER_MAX_OUTPUT_TOKENS)
        self.assertEqual(PLANNER_MAX_OUTPUT_TOKENS, 1200)

    def test_plan_networking_query_records_empty_normalization_diagnostics(self):
        diagnostics = {}
        plan = plan_networking_query(
            self._FakeClient("{}"),
            message="gardening",
            conversation_history=[],
            member_rows=[],
            member_getter=self._getter,
            diagnostics=diagnostics,
        )

        self.assertIsNone(plan)
        self.assertTrue(diagnostics["attempted"])
        self.assertFalse(diagnostics["succeeded"])
        self.assertTrue(diagnostics["json_extracted"] is False or diagnostics["normalized"] is False)
        self.assertEqual(diagnostics["failure_reason"], "json_extract_empty")


if __name__ == "__main__":
    unittest.main()
