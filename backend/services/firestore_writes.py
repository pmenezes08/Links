"""
Firestore dual-write helpers.

These functions write to Firestore AFTER the MySQL write succeeds.
They are fire-and-forget: if Firestore write fails, MySQL data is
still intact and a warning is logged. The app never breaks.
"""

import os
import logging
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

_fs_client = None
FIRESTORE_DATABASE = os.environ.get('FIRESTORE_DATABASE', 'cpoint')
USE_FIRESTORE_WRITES = os.environ.get('USE_FIRESTORE_WRITES', 'true').lower() == 'true'


def _get_client():
    global _fs_client
    if _fs_client is None:
        from google.cloud import firestore
        project = os.environ.get('GOOGLE_CLOUD_PROJECT') or os.environ.get('GCP_PROJECT')
        _fs_client = firestore.Client(project=project, database=FIRESTORE_DATABASE) if project else firestore.Client(database=FIRESTORE_DATABASE)
    return _fs_client


def _dm_conv_id(user1: str, user2: str) -> str:
    """Consistent conversation ID: lowercase sorted, joined by underscore."""
    a, b = sorted([user1.lower(), user2.lower()])
    return f"{a}_{b}"


def write_dm_message(sender: str, receiver: str, message_id: int, text: str = '',
                     image_path: str = None, video_path: str = None,
                     audio_path: str = None, audio_duration_seconds=None,
                     audio_mime: str = None, audio_summary: str = None,
                     is_encrypted: bool = False, timestamp=None):
    """Write a DM message to Firestore after MySQL insert."""
    if not USE_FIRESTORE_WRITES:
        return
    try:
        fs = _get_client()
        conv_id = _dm_conv_id(sender, receiver)
        ts = timestamp if isinstance(timestamp, datetime) else datetime.utcnow()

        conv_ref = fs.collection('dm_conversations').document(conv_id)
        conv_ref.set({
            'participants': sorted([sender, receiver]),
            'last_message': (text or '')[:200],
            'last_sender': sender,
            'updated_at': ts,
        }, merge=True)

        msg_ref = conv_ref.collection('messages').document(str(message_id))
        msg_ref.set({
            'mysql_id': message_id,
            'sender': sender,
            'receiver': receiver,
            'text': text or '',
            'image_path': image_path,
            'video_path': video_path,
            'audio_path': audio_path,
            'audio_duration_seconds': audio_duration_seconds,
            'audio_mime': audio_mime,
            'audio_summary': audio_summary,
            'is_encrypted': is_encrypted,
            'created_at': ts,
            'edited_at': None,
            'reaction': None,
            'reaction_by': None,
        })
        logger.debug(f"Firestore DM write: msg {message_id} in {conv_id}")
    except Exception as e:
        logger.warning(f"Firestore DM write failed (non-fatal): {e}")


def edit_dm_message(sender: str, receiver: str, message_id: int, new_text: str, edited_at=None):
    """Update a DM message text in Firestore after MySQL edit."""
    if not USE_FIRESTORE_WRITES:
        return
    try:
        fs = _get_client()
        conv_id = _dm_conv_id(sender, receiver)
        ts = edited_at if isinstance(edited_at, datetime) else datetime.utcnow()
        msg_ref = fs.collection('dm_conversations').document(conv_id).collection('messages').document(str(message_id))
        msg_ref.update({
            'text': new_text,
            'edited_at': ts,
            'is_encrypted': False,
        })
        logger.debug(f"Firestore DM edit: msg {message_id} in {conv_id}")
    except Exception as e:
        logger.warning(f"Firestore DM edit failed (non-fatal): {e}")


def write_dm_reaction(sender: str, receiver: str, message_id: int,
                      reaction: str = None, reaction_by: str = None):
    """Update a DM message reaction in Firestore."""
    if not USE_FIRESTORE_WRITES:
        return
    try:
        fs = _get_client()
        conv_id = _dm_conv_id(sender, receiver)
        msg_ref = fs.collection('dm_conversations').document(conv_id).collection('messages').document(str(message_id))
        msg_ref.update({'reaction': reaction, 'reaction_by': reaction_by})
    except Exception as e:
        logger.warning(f"Firestore DM reaction write failed (non-fatal): {e}")


def write_group_chat_message(group_id: int, message_id: int, sender: str,
                             text: str = None, image_path: str = None,
                             voice_path: str = None, video_path: str = None,
                             audio_summary: str = None, media_paths=None, timestamp=None):
    """Write a group chat message to Firestore after MySQL insert."""
    if not USE_FIRESTORE_WRITES:
        return
    try:
        fs = _get_client()
        ts = timestamp if isinstance(timestamp, datetime) else datetime.utcnow()

        group_ref = fs.collection('group_chats').document(str(group_id))
        group_ref.set({'updated_at': ts}, merge=True)

        msg_ref = group_ref.collection('messages').document(str(message_id))
        msg_ref.set({
            'mysql_id': message_id,
            'sender': sender,
            'text': text or '',
            'image_path': image_path,
            'voice_path': voice_path,
            'video_path': video_path,
            'audio_summary': audio_summary,
            'media_paths': media_paths,
            'created_at': ts,
        })
        logger.debug(f"Firestore group chat write: msg {message_id} in group {group_id}")
    except Exception as e:
        logger.warning(f"Firestore group chat write failed (non-fatal): {e}")


def delete_group_chat_message(group_id: int, message_id: int):
    """Delete a group chat message from Firestore."""
    if not USE_FIRESTORE_WRITES:
        return
    try:
        fs = _get_client()
        fs.collection('group_chats').document(str(group_id)).collection('messages').document(str(message_id)).delete()
    except Exception as e:
        logger.warning(f"Firestore group chat delete failed (non-fatal): {e}")


def edit_group_chat_message(group_id: int, message_id: int, new_text: str):
    """Update a group chat message text in Firestore."""
    if not USE_FIRESTORE_WRITES:
        return
    try:
        fs = _get_client()
        fs.collection('group_chats').document(str(group_id)).collection('messages').document(str(message_id)).update({
            'text': new_text,
        })
    except Exception as e:
        logger.warning(f"Firestore group chat edit failed (non-fatal): {e}")


def delete_group_chat_message(group_id: int, message_id: int):
    """Delete a group chat message from Firestore."""
    if not USE_FIRESTORE_WRITES:
        return
    try:
        fs = _get_client()
        fs.collection('group_chats').document(str(group_id)).collection('messages').document(str(message_id)).delete()
    except Exception as e:
        logger.warning(f"Firestore group msg delete failed (non-fatal): {e}")


def edit_group_chat_message(group_id: int, message_id: int, new_text: str):
    """Update a group chat message text in Firestore."""
    if not USE_FIRESTORE_WRITES:
        return
    try:
        fs = _get_client()
        fs.collection('group_chats').document(str(group_id)).collection('messages').document(str(message_id)).update({
            'text': new_text,
        })
    except Exception as e:
        logger.warning(f"Firestore group msg edit failed (non-fatal): {e}")


def write_post(post_id: int, username: str, content: str = '', community_id=None,
               group_id=None, image_path: str = None, video_path: str = None,
               audio_path: str = None, audio_summary: str = None,
               post_type: str = 'community', timestamp=None, media_paths=None):
    """Write a post to Firestore after MySQL insert."""
    if not USE_FIRESTORE_WRITES:
        return
    try:
        fs = _get_client()
        doc_id = f"gp_{post_id}" if post_type == 'group' else str(post_id)
        ts = timestamp if isinstance(timestamp, datetime) else datetime.utcnow()
        fs.collection('posts').document(doc_id).set({
            'mysql_id': post_id,
            'type': post_type,
            'username': username,
            'content': content or '',
            'community_id': community_id,
            'group_id': group_id,
            'image_path': image_path,
            'video_path': video_path,
            'audio_path': audio_path,
            'audio_summary': audio_summary,
            'media_paths': media_paths,
            'created_at': ts,
        })
    except Exception as e:
        logger.warning(f"Firestore post write failed (non-fatal): {e}")


def update_post(post_id: int, content: str = None, image_path: str = None,
                video_path: str = None, remove_media: bool = False,
                post_type: str = 'community'):
    """Update an existing post in Firestore after MySQL edit."""
    if not USE_FIRESTORE_WRITES:
        return
    try:
        fs = _get_client()
        doc_id = f"gp_{post_id}" if post_type == 'group' else str(post_id)
        updates = {}
        if content is not None:
            updates['content'] = content
        if image_path is not None:
            updates['image_path'] = image_path
            updates['video_path'] = None
        elif video_path is not None:
            updates['video_path'] = video_path
            updates['image_path'] = None
        elif remove_media:
            updates['image_path'] = None
            updates['video_path'] = None
        if updates:
            fs.collection('posts').document(doc_id).update(updates)
            logger.debug(f"Firestore post update: {doc_id}")
    except Exception as e:
        logger.warning(f"Firestore post update failed (non-fatal): {e}")


def write_reply(post_id: int, reply_id: int, username: str, content: str = '',
                parent_reply_id: int = None, image_path: str = None,
                post_type: str = 'community', timestamp=None):
    """Write a reply to Firestore after MySQL insert."""
    if not USE_FIRESTORE_WRITES:
        return
    try:
        fs = _get_client()
        doc_id = f"gp_{post_id}" if post_type == 'group' else str(post_id)
        ts = timestamp if isinstance(timestamp, datetime) else datetime.utcnow()
        fs.collection('posts').document(doc_id).collection('replies').document(str(reply_id)).set({
            'mysql_id': reply_id,
            'username': username,
            'content': content or '',
            'parent_reply_id': parent_reply_id,
            'image_path': image_path,
            'created_at': ts,
        })
    except Exception as e:
        logger.warning(f"Firestore reply write failed (non-fatal): {e}")


def write_reaction(post_id: int, username: str, reaction_type: str,
                   post_type: str = 'community'):
    """Write/update a reaction in Firestore."""
    if not USE_FIRESTORE_WRITES:
        return
    try:
        fs = _get_client()
        doc_id = f"gp_{post_id}" if post_type == 'group' else str(post_id)
        if reaction_type:
            fs.collection('posts').document(doc_id).collection('reactions').document(username).set({
                'type': reaction_type, 'username': username
            })
        else:
            fs.collection('posts').document(doc_id).collection('reactions').document(username).delete()
    except Exception as e:
        logger.warning(f"Firestore reaction write failed (non-fatal): {e}")


def merge_steve_user_profiling_fields(
    username: str,
    platform_activity: dict = None,
    shared_externals: dict = None,
):
    """Merge Steve profiling snapshot fields into Firestore."""
    if not USE_FIRESTORE_WRITES:
        return
    try:
        fs = _get_client()
        now = datetime.utcnow()
        profile_data = {
            'username': username,
            'profilingPlatformActivity': platform_activity or {
                'updatedAt': now,
                'authoredPosts': [],
                'replies': [],
                'starredPosts': [],
            },
            'profilingSharedExternals': shared_externals or {
                'updatedAt': now,
                'note': '',
                'items': [],
            },
            'profilingContextUpdatedAt': now,
        }
        fs.collection('steve_user_profiles').document(username).set(profile_data, merge=True)
        logger.debug(f"Firestore Steve profiling fields written for {username}")
    except Exception as e:
        logger.warning(f"Firestore Steve profiling merge failed (non-fatal): {e}")


def merge_onboarding_identity_to_steve_profile(username: str, collected: Optional[dict]):
    """Merge verbatim onboarding answers onto steve_user_profiles for Steve (networking, context).

    Keys match OnboardingChat collected: journey, talkAllDay, reachOut, recommend.
    """
    if not USE_FIRESTORE_WRITES or not username:
        return
    if not isinstance(collected, dict):
        return
    try:
        fs = _get_client()
        now = datetime.utcnow()
        payload = {
            'username': username,
            'onboardingIdentity': {
                'journey': (collected.get('journey') or '').strip(),
                'talkAllDay': (collected.get('talkAllDay') or '').strip(),
                'reachOut': (collected.get('reachOut') or '').strip(),
                'recommend': (collected.get('recommend') or '').strip(),
                'updatedAt': now,
            },
        }
        fs.collection('steve_user_profiles').document(username).set(payload, merge=True)
        logger.debug(f"Firestore onboardingIdentity merged for {username}")

        _invalidate_and_reembed(username)
    except Exception as e:
        logger.warning(f"Firestore onboardingIdentity merge failed for {username}: {e}")


def write_steve_user_profile(
    username: str,
    analysis: dict = None,
    profiling_platform_activity: dict = None,
    profiling_shared_externals: dict = None,
    profiling_external_sources: dict = None,
):
    """Write a Grok-analyzed user profile to Firestore.
    Also invalidates the cached context string and triggers a background
    embedding recomputation.

    profiling_external_sources: { updatedAt: iso, items: [{ url, kind, postDate, success, detail }] }
    Set when standard/deep enrichment runs; omit (None) to leave previous value on merge.
    """
    if not USE_FIRESTORE_WRITES:
        return
    try:
        fs = _get_client()
        now = datetime.utcnow()

        profile_data = {
            'username': username,
            'analysis': analysis or {},
            'lastUpdated': now,
        }
        if profiling_platform_activity is not None:
            profile_data['profilingPlatformActivity'] = profiling_platform_activity
            profile_data['profilingContextUpdatedAt'] = now
        if profiling_shared_externals is not None:
            profile_data['profilingSharedExternals'] = profiling_shared_externals
            profile_data['profilingContextUpdatedAt'] = now
        if profiling_external_sources is not None:
            profile_data['profilingExternalSources'] = profiling_external_sources

        fs.collection('steve_user_profiles').document(username).set(profile_data, merge=True)
        logger.debug(f"Firestore Steve profile written for {username}")

        _invalidate_and_reembed(username)
    except Exception as e:
        logger.warning(f"Firestore steve profile write failed (non-fatal): {e}")


def record_steve_recommendations(
    recommended_usernames: list,
    requested_by: str,
    community_id,
    context: str = '',
):
    """Append recommendation events to each recommended user's steve_user_profiles.

    Stores a rolling list of recent recommendations capped at 50 entries.
    Each entry: {by, communityId, context (first 120 chars), date}.
    Also maintains a fast-read counter ``recommendationCount30d``.
    Uses a Firestore batch for atomic writes.
    """
    if not USE_FIRESTORE_WRITES or not recommended_usernames:
        return
    try:
        fs = _get_client()
        now = datetime.utcnow()
        cutoff_30d = now - timedelta(days=30)
        refs = [fs.collection('steve_user_profiles').document(u) for u in recommended_usernames]
        docs = {doc.id: doc.to_dict() or {} for doc in fs.get_all(refs) if doc.exists}

        batch = fs.batch()
        for uname in recommended_usernames:
            existing = docs.get(uname, {}).get('recentRecommendations', [])
            fresh = [r for r in existing if r.get('date') and r['date'] > cutoff_30d]
            fresh.append({
                'by': requested_by,
                'communityId': community_id,
                'context': (context or '')[:120],
                'date': now,
            })
            fresh = fresh[-50:]
            ref = fs.collection('steve_user_profiles').document(uname)
            batch.set(ref, {
                'recentRecommendations': fresh,
                'recommendationCount30d': len(fresh),
            }, merge=True)
        batch.commit()
        logger.debug(f"Recorded {len(recommended_usernames)} recommendation(s) by {requested_by}")
    except Exception as e:
        logger.warning(f"record_steve_recommendations failed (non-fatal): {e}")


def _invalidate_and_reembed(username: str, chunk_types: list = None):
    """Invalidate cached context and recompute chunked embeddings in background.

    If *chunk_types* is provided, only those chunks are recomputed (e.g.
    ['social'] after a new post).  Otherwise all chunks are rebuilt.
    """
    try:
        from bodybuilding_app import invalidate_steve_context_cache
        invalidate_steve_context_cache(username)
    except Exception:
        pass
    try:
        from backend.services.embedding_service import compute_and_store_embeddings_background
        compute_and_store_embeddings_background(username, chunk_types=chunk_types)
    except Exception as e:
        logger.debug(f"Background embedding trigger skipped for {username}: {e}")
