"""Unit tests for Steve networking planner helpers."""

import unittest

from backend.services.networking_planner import (
    build_networking_planner_input,
    normalize_networking_query_plan,
)


class TestNetworkingPlanner(unittest.TestCase):
    def _getter(self, row, idx):
        return row[idx] if idx < len(row) else ""

    def test_prompt_contains_dimension_policy_and_fighter_jet_example(self):
        prompt_input = build_networking_planner_input(
            message="I want to fly a fighter jet",
            conversation_history=[],
            member_rows=[("pilot", "Pilot Member", "", "", "", "", "", "", "", "", "", "Pat", "Pilot")],
            member_getter=self._getter,
        )

        system_text = prompt_input[0]["content"]
        user_text = prompt_input[1]["content"]
        self.assertIn("Practitioner / goal-seeking", system_text)
        self.assertIn("commercial pilot", system_text)
        self.assertIn("personally done", system_text)
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
                "named_people": "Pat Pilot",
                "search_rewrite": "pilot gliding flight experience",
            }
        )

        self.assertEqual(plan["facets"], {"experiences": ["Commercial pilot", "Gliding"]})
        self.assertEqual(plan["primary_dimensions"], ["LifeCareer"])
        self.assertEqual(plan["secondary_dimensions"], ["Expertise"])
        self.assertEqual(plan["hard_dimensions"], ["InferredContext"])
        self.assertEqual(plan["named_people"], ["Pat Pilot"])


if __name__ == "__main__":
    unittest.main()
