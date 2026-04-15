"""Idea registry and execution entry points."""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from backend.services.content_generation.delivery import create_steve_feed_post, send_steve_dm
from backend.services.content_generation.storage import create_run, finish_run
from backend.services.content_generation.types import IdeaDescriptor, IdeaExecutionResult

from .ideas.daily_motivation_dm import DESCRIPTOR as DAILY_MOTIVATION_DESCRIPTOR, execute as execute_daily_motivation
from .ideas.member_compliment_feed import DESCRIPTOR as COMPLIMENT_DESCRIPTOR, execute as execute_member_compliment
from .ideas.news_roundup import DESCRIPTOR as NEWS_DESCRIPTOR, execute as execute_news_roundup
from .ideas.opinion_roundup import DESCRIPTOR as OPINION_DESCRIPTOR, execute as execute_opinion_roundup


IDEAS: Dict[str, Dict[str, Any]] = {
    NEWS_DESCRIPTOR.idea_id: {"descriptor": NEWS_DESCRIPTOR, "execute": execute_news_roundup},
    OPINION_DESCRIPTOR.idea_id: {"descriptor": OPINION_DESCRIPTOR, "execute": execute_opinion_roundup},
    COMPLIMENT_DESCRIPTOR.idea_id: {"descriptor": COMPLIMENT_DESCRIPTOR, "execute": execute_member_compliment},
    DAILY_MOTIVATION_DESCRIPTOR.idea_id: {"descriptor": DAILY_MOTIVATION_DESCRIPTOR, "execute": execute_daily_motivation},
}


def list_ideas(*, surface: Optional[str] = None, target_type: Optional[str] = None) -> List[Dict[str, Any]]:
    ideas: List[Dict[str, Any]] = []
    for idea in IDEAS.values():
        descriptor: IdeaDescriptor = idea["descriptor"]
        if surface and surface not in descriptor.surfaces:
            continue
        if target_type and descriptor.target_type != target_type:
            continue
        ideas.append(descriptor.to_dict())
    return ideas


def get_descriptor(idea_id: str) -> IdeaDescriptor:
    entry = IDEAS.get(idea_id)
    if not entry:
        raise ValueError(f"Unknown content generation idea: {idea_id}")
    return entry["descriptor"]


def execute_job(job: Dict[str, Any], *, triggered_by_username: str) -> Dict[str, Any]:
    entry = IDEAS.get(job["idea_id"])
    if not entry:
        raise ValueError(f"Unknown content generation idea: {job['idea_id']}")

    run_id = create_run(job, triggered_by_username)
    try:
        result: IdeaExecutionResult = entry["execute"](job)
        output_post_id = None
        output_message_id = None
        if result.delivery_channel == "feed_post":
            output_post_id = create_steve_feed_post(
                community_id=int(job["community_id"]),
                content=result.content,
                source_links=result.source_links,
                append_sources=result.append_sources,
            )
        else:
            target_username = result.target_username or job.get("target_username")
            if not target_username:
                raise ValueError("Missing target member for DM delivery")
            output_message_id = send_steve_dm(receiver_username=target_username, content=result.content)
        finish_run(
            run_id,
            job_id=job["id"],
            status="succeeded",
            output_post_id=output_post_id,
            output_message_id=output_message_id,
            source_links=result.source_links,
            meta=result.meta,
        )
        return {
            "success": True,
            "run_id": run_id,
            "output_post_id": output_post_id,
            "output_message_id": output_message_id,
            "source_links": result.source_links,
            "meta": result.meta,
        }
    except Exception as exc:
        finish_run(
            run_id,
            job_id=job["id"],
            status="failed",
            error=str(exc),
        )
        raise

