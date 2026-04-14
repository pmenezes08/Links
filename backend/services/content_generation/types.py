"""Shared types for Steve content generation."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Literal, Optional, Sequence


TargetType = Literal["community", "member"]
DeliveryChannel = Literal["feed_post", "dm"]


@dataclass(frozen=True)
class IdeaField:
    """UI metadata for configurable idea payload fields."""

    name: str
    label: str
    kind: str = "text"
    required: bool = False
    help_text: str = ""
    placeholder: str = ""
    options: Sequence[Dict[str, str]] = field(default_factory=tuple)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "label": self.label,
            "kind": self.kind,
            "required": self.required,
            "help_text": self.help_text,
            "placeholder": self.placeholder,
            "options": list(self.options),
        }


@dataclass(frozen=True)
class IdeaDescriptor:
    """Static metadata about a registered content idea."""

    idea_id: str
    title: str
    description: str
    target_type: TargetType
    delivery_channel: DeliveryChannel
    surfaces: Sequence[str]
    payload_fields: Sequence[IdeaField] = field(default_factory=tuple)
    supports_schedule: bool = True

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["payload_fields"] = [field.to_dict() for field in self.payload_fields]
        return data


@dataclass
class IdeaExecutionResult:
    """Result returned by an idea before delivery persists the content."""

    delivery_channel: DeliveryChannel
    content: str
    source_links: List[str] = field(default_factory=list)
    meta: Dict[str, Any] = field(default_factory=dict)
    target_username: Optional[str] = None

