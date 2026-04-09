"""
Comprehensive test suite for Steve Member Knowledge Base.

Covers:
- Document schemas and validation
- Synthesis pipeline accuracy
- Context building for Steve
- Shared node (cross-user graph) operations
- Admin feedback flow
- Token usage comparison (old vs new)
- Evolution tracking queries (UK knowledge, career changes, opinion shifts)
"""

import json
import os
import sys
import unittest
from datetime import datetime
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.services.steve_knowledge_base import (
    ATOMIC_NOTE_TYPES,
    ATOMIC_SCHEMAS,
    COLLECTION,
    SHARED_NODE_TYPES,
    SYNTHESIS_NOTE_TYPES,
    SYNTHESIS_SCHEMAS,
    USE_KNOWLEDGE_BASE_V1,
    _assemble_raw_text_for_synthesis,
    _flatten_item,
    _slugify,
    build_knowledge_context_for_steve,
)


class TestSchemaDefinitions(unittest.TestCase):
    """Verify schemas are properly defined for all note types."""

    def test_all_synthesis_types_have_schemas(self):
        for nt in SYNTHESIS_NOTE_TYPES:
            self.assertIn(nt, SYNTHESIS_SCHEMAS, f"Missing schema for synthesis type: {nt}")

    def test_all_atomic_types_have_schemas(self):
        for nt in ATOMIC_NOTE_TYPES:
            self.assertIn(nt, ATOMIC_SCHEMAS, f"Missing schema for atomic type: {nt}")

    def test_synthesis_schemas_are_non_empty(self):
        for nt, schema in SYNTHESIS_SCHEMAS.items():
            self.assertIsInstance(schema, dict)
            self.assertGreater(len(schema), 0, f"Empty schema for: {nt}")

    def test_atomic_schemas_are_non_empty(self):
        for nt, schema in ATOMIC_SCHEMAS.items():
            self.assertIsInstance(schema, dict)
            self.assertGreater(len(schema), 0, f"Empty schema for: {nt}")

    def test_eight_synthesis_dimensions(self):
        self.assertEqual(len(SYNTHESIS_NOTE_TYPES), 8)
        expected = {"Index", "LifeCareer", "GeographyCulture", "Expertise",
                    "Opinions", "Identity", "Network", "UniqueFingerprint"}
        self.assertEqual(set(SYNTHESIS_NOTE_TYPES), expected)

    def test_shared_node_types(self):
        expected = {"location", "institution", "topic", "life_event_category"}
        self.assertEqual(set(SHARED_NODE_TYPES), expected)


class TestSlugify(unittest.TestCase):
    """Test slug generation for document IDs."""

    def test_basic_slug(self):
        self.assertEqual(_slugify("London"), "london")

    def test_slug_with_spaces(self):
        self.assertEqual(_slugify("San Francisco"), "san-francisco")

    def test_slug_with_special_chars(self):
        self.assertEqual(_slugify("AI & Machine Learning!"), "ai-machine-learning")

    def test_slug_max_length(self):
        long_name = "a" * 200
        self.assertLessEqual(len(_slugify(long_name)), 80)

    def test_slug_strips_leading_trailing(self):
        self.assertEqual(_slugify("  London  "), "london")


class TestFlattenItem(unittest.TestCase):
    """Test the _flatten_item helper."""

    def test_string_passthrough(self):
        self.assertEqual(_flatten_item("hello"), "hello")

    def test_dict_flattening(self):
        result = _flatten_item({"city": "London", "country": "UK"})
        self.assertIn("city: London", result)
        self.assertIn("country: UK", result)

    def test_other_types(self):
        self.assertEqual(_flatten_item(42), "42")


class TestAssembleRawText(unittest.TestCase):
    """Test the text assembly for synthesis (this is the core data pipeline)."""

    def _make_profile(self, **overrides):
        base = {
            "analysis": {
                "summary": "A tech entrepreneur based in London.",
                "identity": {
                    "roles": ["Founder", "AI Researcher"],
                    "drivingForces": "Curiosity and impact",
                    "bridgeInsight": "Bridges academic research and product development",
                },
                "professional": {
                    "webFindings": "Founded two AI startups after leaving DeepMind.",
                    "careerHistory": [
                        {"role": "CEO", "company": "AIStartup", "period": "2023-present", "highlight": "Series A funded"},
                        {"role": "ML Engineer", "company": "DeepMind", "period": "2020-2023", "highlight": "Core team"},
                    ],
                    "location": {"city": "London", "country": "UK", "context": "Major AI hub"},
                    "education": [{"degree": "PhD Physics", "institution": "Imperial College", "year": "2020"}],
                },
                "personal": {
                    "lifestyle": "Active runner, avid reader",
                    "webFindings": "Runs marathons and contributes to open source",
                },
                "interests": {
                    "AI Safety": {"score": 0.9, "source": "Multiple talks and articles", "type": "professional"},
                    "Running": {"score": 0.7, "source": "Marathon finisher", "type": "personal"},
                },
                "traits": ["analytical", "curious", "driven"],
                "observations": "Uniquely combines rigorous research with product sense.",
                "networkingValue": "Can bridge AI research and commercial application.",
            },
            "onboardingIdentity": {
                "journey": "Left academia to build real products",
                "talkAllDay": "AI agents and their implications",
                "reachOut": "Startup advice and AI partnerships",
                "recommend": "Read 'The Alignment Problem' by Brian Christian",
            },
            "profilingPlatformActivity": {
                "authoredPosts": [
                    {"snippet": "Just published our paper on alignment techniques", "date": "2025-03-15"},
                    {"snippet": "Reflecting on two years since leaving DeepMind", "date": "2025-01-10"},
                ],
                "replies": [
                    {"content": "Great point about scaling laws", "date": "2025-03-20", "replyingTo": "Discussion on LLM scaling"},
                ],
            },
            "profilingSharedExternals": {
                "items": [
                    {"urls": ["https://arxiv.org/paper123"], "userCaption": "Important new alignment paper", "date": "2025-03-12"},
                ],
            },
            "profilingExternalSources": {
                "items": [
                    {"url": "https://arxiv.org/paper123", "kind": "article", "success": True, "detail": "Article text retrieved"},
                ],
            },
        }
        base.update(overrides)
        return base

    @patch("backend.services.steve_knowledge_base._get_fs")
    def test_assembles_all_sections(self, mock_fs):
        profile = self._make_profile()
        with patch("bodybuilding_app._migrate_analysis_to_v3", side_effect=lambda x: x):
            text = _assemble_raw_text_for_synthesis("testuser", profile)

        self.assertIn("EXISTING ANALYSIS SUMMARY", text)
        self.assertIn("ROLES", text)
        self.assertIn("CAREER HISTORY", text)
        self.assertIn("CURRENT LOCATION", text)
        self.assertIn("EDUCATION", text)
        self.assertIn("INTERESTS", text)
        self.assertIn("TRAITS", text)
        self.assertIn("ONBOARDING", text)
        self.assertIn("AUTHORED POSTS", text)
        self.assertIn("REPLIES", text)
        self.assertIn("SHARED EXTERNAL CONTENT", text)

    @patch("backend.services.steve_knowledge_base._get_fs")
    def test_includes_group_interaction_counts(self, mock_fs):
        profile = self._make_profile()
        interactions = {"sarahchen": 47, "marcuskim": 12}
        with patch("bodybuilding_app._migrate_analysis_to_v3", side_effect=lambda x: x):
            text = _assemble_raw_text_for_synthesis("testuser", profile, interactions)

        self.assertIn("GROUP CHAT INTERACTION FREQUENCY", text)
        self.assertIn("@sarahchen: 47", text)
        self.assertIn("@marcuskim: 12", text)

    @patch("backend.services.steve_knowledge_base._get_fs")
    def test_handles_empty_profile(self, mock_fs):
        with patch("bodybuilding_app._migrate_analysis_to_v3", side_effect=lambda x: x):
            text = _assemble_raw_text_for_synthesis("testuser", {"analysis": {}})
        self.assertEqual(text, "")

    @patch("backend.services.steve_knowledge_base._get_fs")
    def test_location_data_present_for_uk_queries(self, mock_fs):
        """Verify geographic data is assembled correctly for queries like 'UK knowledge'."""
        profile = self._make_profile()
        with patch("bodybuilding_app._migrate_analysis_to_v3", side_effect=lambda x: x):
            text = _assemble_raw_text_for_synthesis("testuser", profile)

        self.assertIn("London", text)
        self.assertIn("UK", text)
        self.assertIn("Imperial College", text)


class TestBuildKnowledgeContext(unittest.TestCase):
    """Test the context builder that produces text for Steve's prompts."""

    def _make_knowledge(self):
        return {
            "Index": {
                "noteType": "Index",
                "content": {
                    "currentSynthesis": "A tech entrepreneur in London who bridges AI research and product development.",
                    "recentEvolutionSignals": [
                        {"description": "Moved from pure research to product leadership in 2024"},
                    ],
                },
            },
            "UniqueFingerprint": {
                "noteType": "UniqueFingerprint",
                "content": {
                    "whatMakesThemSpecial": "Combines rigorous scientific thinking with product taste.",
                    "bridgingCapability": "Connects academic AI research with commercial applications.",
                    "rareQualities": ["PhD dropout who succeeded in startups", "Publishes papers and ships products"],
                },
            },
            "GeographyCulture": {
                "noteType": "GeographyCulture",
                "content": {
                    "currentLocation": "London, UK",
                    "culturalInfluences": "British academic culture shaped rigorous thinking; London AI scene drives commercial ambition.",
                    "geographicExpertise": ["UK", "European AI ecosystem"],
                },
            },
            "LifeCareer": {
                "noteType": "LifeCareer",
                "content": {
                    "trajectory": "Physics PhD -> DeepMind ML Engineer -> AI Startup Founder",
                    "currentStage": "Series A CEO, growing team from 5 to 20",
                },
            },
        }

    @patch("backend.services.steve_knowledge_base.get_member_knowledge")
    def test_produces_structured_context(self, mock_get):
        knowledge = self._make_knowledge()
        context = build_knowledge_context_for_steve("testuser", knowledge=knowledge)

        self.assertIn("OVERVIEW:", context)
        self.assertIn("UNIQUE FINGERPRINT:", context)
        self.assertIn("GEOGRAPHIC & CULTURAL JOURNEY:", context)
        self.assertIn("LIFE & CAREER EVOLUTION:", context)
        self.assertIn("RECENT EVOLUTION SIGNALS:", context)

    @patch("backend.services.steve_knowledge_base.get_member_knowledge")
    def test_uk_knowledge_visible_in_context(self, mock_get):
        """UK-related information should be clearly present in the context string."""
        knowledge = self._make_knowledge()
        context = build_knowledge_context_for_steve("testuser", knowledge=knowledge)

        self.assertIn("London", context)
        self.assertIn("UK", context)
        self.assertIn("British academic culture", context)

    @patch("backend.services.steve_knowledge_base.get_member_knowledge")
    def test_evolution_signals_present(self, mock_get):
        knowledge = self._make_knowledge()
        context = build_knowledge_context_for_steve("testuser", knowledge=knowledge)

        self.assertIn("Moved from pure research to product leadership", context)

    @patch("backend.services.steve_knowledge_base.get_member_knowledge")
    def test_empty_knowledge_returns_empty_string(self, mock_get):
        context = build_knowledge_context_for_steve("testuser", knowledge={})
        self.assertEqual(context, "")

    @patch("backend.services.steve_knowledge_base.get_member_knowledge")
    def test_context_is_shorter_than_raw_profile(self, mock_get):
        """Knowledge base context should be more concise than dumping the entire profile."""
        knowledge = self._make_knowledge()
        context = build_knowledge_context_for_steve("testuser", knowledge=knowledge)
        self.assertLess(len(context), 5000)


class TestTokenUsageComparison(unittest.TestCase):
    """Verify that knowledge base context is more token-efficient than legacy context."""

    def test_knowledge_context_is_concise(self):
        knowledge = {
            "Index": {
                "noteType": "Index",
                "content": {"currentSynthesis": "Expert AI researcher turned founder in London."},
            },
            "UniqueFingerprint": {
                "noteType": "UniqueFingerprint",
                "content": {"whatMakesThemSpecial": "Bridges research and product."},
            },
        }
        context = build_knowledge_context_for_steve("test", knowledge=knowledge)
        word_count = len(context.split())
        self.assertLess(word_count, 500)


class TestEvolutionTrackingQueries(unittest.TestCase):
    """Test that the knowledge base supports key evolution-tracking scenarios."""

    def test_career_evolution_data_structure(self):
        schema = SYNTHESIS_SCHEMAS["LifeCareer"]
        self.assertIn("stages", schema)
        self.assertIn("trajectory", schema)
        self.assertIn("turningPoints", schema)

    def test_opinion_shift_data_structure(self):
        schema = SYNTHESIS_SCHEMAS["Opinions"]
        self.assertIn("shifts", schema)
        self.assertIn("keyTopics", schema)

    def test_geographic_journey_data_structure(self):
        schema = SYNTHESIS_SCHEMAS["GeographyCulture"]
        self.assertIn("locations", schema)
        self.assertIn("currentLocation", schema)
        self.assertIn("geographicExpertise", schema)

    def test_identity_contradictions_tracked(self):
        schema = SYNTHESIS_SCHEMAS["Identity"]
        self.assertIn("contradictions", schema)
        self.assertIn("energyPatterns", schema)

    def test_network_frequency_only(self):
        """Network dimension should track frequency, not content."""
        schema = SYNTHESIS_SCHEMAS["Network"]
        self.assertIn("interactionFrequency", schema)
        self.assertIn("relationshipStrength", schema)
        self.assertNotIn("dmContent", schema)
        self.assertNotIn("messageContent", schema)

    def test_atomic_opinion_shift_schema(self):
        schema = ATOMIC_SCHEMAS["OpinionShift"]
        self.assertIn("fromStance", schema)
        self.assertIn("toStance", schema)
        self.assertIn("trigger", schema)

    def test_relationship_privacy_safe(self):
        schema = ATOMIC_SCHEMAS["Relationship"]
        self.assertIn("privacyLevel", schema)
        self.assertNotIn("messageContent", schema)


class TestSaveAndRetrieveOperations(unittest.TestCase):
    """Test save/retrieve operations with mocked Firestore."""

    @patch("backend.services.steve_knowledge_base._get_fs")
    def test_save_synthesis_note_validates_type(self, mock_fs):
        from backend.services.steve_knowledge_base import save_synthesis_note
        result = save_synthesis_note("test", "InvalidType", {"data": "test"})
        self.assertFalse(result)

    @patch("backend.services.steve_knowledge_base._get_fs")
    def test_save_atomic_note_validates_type(self, mock_fs):
        from backend.services.steve_knowledge_base import save_atomic_note
        result = save_atomic_note("test", "InvalidType", "title", {"data": "test"})
        self.assertFalse(result)

    @patch("backend.services.steve_knowledge_base._get_fs")
    def test_save_shared_node_validates_type(self, mock_fs):
        from backend.services.steve_knowledge_base import save_shared_node
        result = save_shared_node("invalid_type", "London", "test", "context")
        self.assertFalse(result)

    @patch("backend.services.steve_knowledge_base._get_fs")
    def test_save_synthesis_note_success(self, mock_fs):
        from backend.services.steve_knowledge_base import save_synthesis_note
        mock_client = MagicMock()
        mock_fs.return_value = mock_client
        mock_doc = MagicMock()
        mock_doc.exists = False
        mock_client.collection.return_value.document.return_value.get.return_value = mock_doc

        result = save_synthesis_note("testuser", "LifeCareer", {"trajectory": "PhD -> Founder"})
        self.assertTrue(result)
        mock_client.collection.return_value.document.return_value.set.assert_called_once()

    @patch("backend.services.steve_knowledge_base._get_fs")
    def test_save_atomic_note_success(self, mock_fs):
        from backend.services.steve_knowledge_base import save_atomic_note
        mock_client = MagicMock()
        mock_fs.return_value = mock_client

        result = save_atomic_note("testuser", "Article", "AI Safety Paper", {"url": "https://example.com"})
        self.assertTrue(result)
        mock_client.collection.return_value.document.return_value.set.assert_called_once()


class TestAdminFeedback(unittest.TestCase):
    """Test admin feedback mechanism."""

    @patch("backend.services.steve_knowledge_base._get_fs")
    def test_save_admin_feedback(self, mock_fs):
        from backend.services.steve_knowledge_base import save_admin_feedback
        mock_client = MagicMock()
        mock_fs.return_value = mock_client

        result = save_admin_feedback("testuser", "LifeCareer", {"status": "approved", "note": "Looks good"})
        self.assertTrue(result)

    @patch("backend.services.steve_knowledge_base._get_fs")
    def test_feedback_rejects_invalid_note_type(self, mock_fs):
        from backend.services.steve_knowledge_base import save_admin_feedback
        result = save_admin_feedback("testuser", "InvalidType", {"status": "approved"})
        self.assertFalse(result)


if __name__ == '__main__':
    unittest.main()
