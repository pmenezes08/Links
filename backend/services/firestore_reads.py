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

# Reads always go to MySQL (source of truth). Firestore is kept in sync
# via dual-writes for Steve AI context and future real-time migration.
USE_FIRESTORE_READS = False

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


def get_dm_messages(username: str, peer: str, since_id: int = None):
    """
    Read DM messages — always from MySQL (source of truth).
    Firestore is kept in sync via dual-write for Steve context and future use.
    """
    raise NotImplementedError("DM reads use MySQL — Firestore sync is write-side only")


def get_group_chat_messages(group_id: int, username: str, before_id: int = None, limit: int = 50):
    """
    Group chat reads use MySQL — Firestore is kept in sync via dual-write
    for Steve context and future real-time features.
    """
    raise NotImplementedError("Group chat reads use MySQL")


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
