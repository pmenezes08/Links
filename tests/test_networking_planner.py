"""Unit tests for Steve networking planner helpers."""

import unittest

from backend.services.networking_planner import (
    build_networking_planner_input,
    normalize_networking_query_plan,
)


class TestNetworkingPlanner(unittest.TestCase):
    def _getter(self, row, idx):
        return row[idx] if idx < len(row) else ""

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


if __name__ == "__main__":
    unittest.main()
