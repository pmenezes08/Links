"""Regression tests for the LifeInterests KB dimension."""

import unittest

from backend.services import steve_knowledge_base
from backend.services.embedding_service import AGGREGATE_DIMENSION_MAP, DIMENSION_CHUNK_TYPES


class TestLifeInterestsDimension(unittest.TestCase):
    def test_life_interests_is_first_class_kb_dimension(self):
        self.assertIn("LifeInterests", steve_knowledge_base.SYNTHESIS_NOTE_TYPES)
        self.assertIn("LifeInterests", steve_knowledge_base.SYNTHESIS_SCHEMAS)
        schema = steve_knowledge_base.SYNTHESIS_SCHEMAS["LifeInterests"]
        self.assertIn("rituals", schema)
        self.assertIn("capabilitySignals", schema)
        self.assertIn("LifeInterests", steve_knowledge_base._MID_DIMENSIONS)

    def test_life_interests_is_embedded_for_semantic_search(self):
        self.assertIn("LifeInterests", DIMENSION_CHUNK_TYPES)
        self.assertIn("LifeInterests", AGGREGATE_DIMENSION_MAP["personality"])
        self.assertIn("LifeInterests", AGGREGATE_DIMENSION_MAP["experiences"])


if __name__ == "__main__":
    unittest.main()
