"""
Firestore read helpers for dual-read migration.

When USE_FIRESTORE_READS is True, these functions read from Firestore.
Each function matches the response format of the corresponding MySQL endpoint
so the API response is identical regardless of source.

Feature flag: set USE_FIRESTORE_READS=true in environment.
"""

import os
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

USE_FIRESTORE_READS = os.environ.get('USE_FIRESTORE_READS', 'true').lower() == 'true'

_fs_client = None
FIRESTORE_DATABASE = os.environ.get('FIRESTORE_DATABASE', 'cpoint')


def _get_client():
    global _fs_client
    if _fs_client is None:
        from google.cloud import firestore
        project = os.environ.get('GOOGLE_CLOUD_PROJECT') or os.environ.get('GCP_PROJECT')
        _fs_client = firestore.Client(project=project, database=FIRESTORE_DATABASE) if project else firestore.Client(database=FIRESTORE_DATABASE)
    return _fs_client


def _ts_to_str(val):
    """Convert Firestore timestamp to ISO string."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.strftime('%Y-%m-%d %H:%M:%S')
    return str(val)


def _find_dm_conv_id(fs, username: str, peer: str):
    """Find the Firestore conversation document ID, trying canonical + legacy formats."""
    a, b = sorted([username.lower(), peer.lower()])
    conv_id = f"{a}_{b}"
    conv_doc = fs.collection('dm_conversations').document(conv_id).get()
    if conv_doc.exists:
        return conv_id
    user1_ci, user2_ci = sorted([username, peer], key=str.lower)
    legacy_id = f"{user1_ci}_{user2_ci}"
    if legacy_id != conv_id:
        conv_doc = fs.collection('dm_conversations').document(legacy_id).get()
        if conv_doc.exists:
            return legacy_id
    return None


def _format_dm_message(doc, username: str) -> dict:
    """Convert a Firestore message doc to the /get_messages response format."""
    d = doc.to_dict()
    mid = int(doc.id) if doc.id.isdigit() else d.get('mysql_id', 0)
    return {
        'id': mid,
        'text': d.get('text') or '',
        'image_path': d.get('image_path'),
        'video_path': d.get('video_path'),
        'audio_path': d.get('audio_path'),
        'audio_duration_seconds': d.get('audio_duration_seconds'),
        'audio_mime': d.get('audio_mime'),
        'audio_summary': d.get('audio_summary'),
        'sent': d.get('sender') == username,
        'time': _ts_to_str(d.get('created_at')),
        'edited_at': _ts_to_str(d.get('edited_at')),
        'reaction': d.get('reaction'),
        'reaction_by': d.get('reaction_by'),
        'is_encrypted': d.get('is_encrypted', False),
        'encrypted_body': d.get('encrypted_body'),
        'encrypted_body_for_sender': d.get('encrypted_body_for_sender'),
    }


# Default page size for DM messages
DM_PAGE_SIZE = 50


def get_dm_messages(username: str, peer: str, since_id: int = None, before_id: int = None, limit: int = DM_PAGE_SIZE):
    """
    Read DM messages from Firestore with pagination.
    
    - Initial load: returns the most recent `limit` messages
    - Delta fetch (since_id): returns messages newer than since_id
    - Backward pagination (before_id): returns messages older than before_id
    
    Returns (messages_list, is_delta, has_more)
    """
    try:
        fs = _get_client()
        conv_id = _find_dm_conv_id(fs, username, peer)
        if not conv_id:
            logger.info(f"Firestore DM: no conversation found for {username}<->{peer}")
            return [], False, False

        msgs_ref = fs.collection('dm_conversations').document(conv_id).collection('messages')

        if since_id:
            since_doc = msgs_ref.document(str(since_id)).get()
            if since_doc.exists:
                since_ts = since_doc.to_dict().get('created_at')
                if since_ts:
                    query = msgs_ref.where('created_at', '>', since_ts).order_by('created_at')
                    docs = list(query.stream())
                    messages = [_format_dm_message(d, username) for d in docs]
                    return messages, True, False
            return [], True, False

        if before_id:
            before_doc = msgs_ref.document(str(before_id)).get()
            if before_doc.exists:
                before_ts = before_doc.to_dict().get('created_at')
                if before_ts:
                    query = msgs_ref.where('created_at', '<', before_ts).order_by('created_at', direction='DESCENDING').limit(limit)
                    docs = list(query.stream())
                    docs.reverse()
                    messages = [_format_dm_message(d, username) for d in docs]
                    return messages, False, len(docs) == limit
            return [], False, False

        # Initial load: most recent messages
        query = msgs_ref.order_by('created_at', direction='DESCENDING').limit(limit)
        docs = list(query.stream())
        docs.reverse()
        messages = [_format_dm_message(d, username) for d in docs]
        has_more = len(docs) == limit
        return messages, False, has_more

    except Exception as e:
        logger.error(f"Firestore get_dm_messages failed: {e}", exc_info=True)
        raise


def get_group_chat_messages(group_id: int, username: str, before_id: int = None, limit: int = 50):
    """
    Read group chat messages from Firestore with pagination.
    Returns messages list matching /api/group_chat/{id}/messages response format.
    """
    try:
        fs = _get_client()
        msgs_ref = fs.collection('group_chats').document(str(group_id)).collection('messages')

        if before_id:
            before_doc = msgs_ref.document(str(before_id)).get()
            if before_doc.exists:
                before_ts = before_doc.to_dict().get('created_at')
                if before_ts:
                    query = msgs_ref.where('created_at', '<', before_ts).order_by('created_at', direction='DESCENDING').limit(limit)
                    docs = list(query.stream())
                    docs.reverse()
                else:
                    return []
            else:
                return []
        else:
            query = msgs_ref.order_by('created_at', direction='DESCENDING').limit(limit)
            docs = list(query.stream())
            docs.reverse()

        messages = []
        for doc in docs:
            d = doc.to_dict()
            mid = int(doc.id) if doc.id.isdigit() else d.get('mysql_id', 0)
            messages.append({
                'id': mid,
                'sender': d.get('sender', ''),
                'text': d.get('text'),
                'image': d.get('image_path'),
                'voice': d.get('voice_path'),
                'video': d.get('video_path'),
                'media_paths': None,
                'created_at': _ts_to_str(d.get('created_at')),
                'profile_picture': None,
                'is_edited': False,
                'audio_summary': d.get('audio_summary'),
                'audio_duration_seconds': None,
                'reaction': None,
            })
        return messages
    except Exception as e:
        logger.error(f"Firestore get_group_chat_messages failed: {e}", exc_info=True)
        raise


def get_post_detail(post_id: int, username: str):
    """
    Read a community post from Firestore with reactions and nested replies.
    Returns post dict matching /get_post response format, or None if not found.
    """
    try:
        fs = _get_client()
        doc = fs.collection('posts').document(str(post_id)).get()
        if not doc.exists:
            return None

        d = doc.to_dict()

        # Reactions
        reactions_ref = fs.collection('posts').document(str(post_id)).collection('reactions')
        reactions = {}
        user_reaction = None
        for rx_doc in reactions_ref.stream():
            rx = rx_doc.to_dict()
            rtype = rx.get('type', '')
            reactions[rtype] = reactions.get(rtype, 0) + 1
            if rx_doc.id == username:
                user_reaction = rtype

        # Replies
        replies_ref = fs.collection('posts').document(str(post_id)).collection('replies')
        all_replies = []
        for rep_doc in replies_ref.order_by('created_at').stream():
            rd = rep_doc.to_dict()
            rid = int(rep_doc.id) if rep_doc.id.isdigit() else rd.get('mysql_id', 0)
            all_replies.append({
                'id': rid,
                'username': rd.get('username', ''),
                'content': rd.get('content', ''),
                'image_path': rd.get('image_path'),
                'timestamp': _ts_to_str(rd.get('created_at')),
                'parent_reply_id': rd.get('parent_reply_id'),
                'profile_picture': None,
                'reactions': {},
                'user_reaction': None,
                'reply_count': 0,
                'children': [],
            })

        # Build nested tree
        reply_map = {r['id']: r for r in all_replies}
        root_replies = []
        for r in all_replies:
            pid = r.get('parent_reply_id')
            if pid and pid in reply_map:
                reply_map[pid]['children'].append(r)
                reply_map[pid]['reply_count'] += 1
            else:
                root_replies.append(r)
        root_replies.reverse()

        post = {
            'id': post_id,
            'username': d.get('username', ''),
            'content': d.get('content', ''),
            'image_path': d.get('image_path'),
            'video_path': d.get('video_path'),
            'audio_path': d.get('audio_path'),
            'audio_summary': d.get('audio_summary'),
            'timestamp': _ts_to_str(d.get('created_at')),
            'community_id': d.get('community_id'),
            'reactions': reactions,
            'user_reaction': user_reaction,
            'replies': root_replies,
            'profile_picture': None,
            'ai_videos': [],
            'view_count': 0,
        }
        return post
    except Exception as e:
        logger.error(f"Firestore get_post_detail failed: {e}", exc_info=True)
        raise


def get_group_post_detail(post_id: int, username: str):
    """
    Read a group post from Firestore.
    Returns post dict matching /api/group_post response format, or None if not found.
    """
    try:
        fs = _get_client()
        doc_id = f"gp_{post_id}"
        doc = fs.collection('posts').document(doc_id).get()
        if not doc.exists:
            return None

        d = doc.to_dict()
        post = {
            'id': post_id,
            'username': d.get('username', ''),
            'content': d.get('content', ''),
            'image_path': d.get('image_path'),
            'timestamp': _ts_to_str(d.get('created_at')),
            'group_id': d.get('group_id'),
            'reactions': {},
            'user_reaction': None,
            'replies': [],
            'is_group_post': True,
            'can_edit': False,
            'can_delete': False,
        }
        return post
    except Exception as e:
        logger.error(f"Firestore get_group_post_detail failed: {e}", exc_info=True)
        raise
