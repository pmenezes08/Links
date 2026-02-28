"""
Firestore dual-write helpers.

These functions write to Firestore AFTER the MySQL write succeeds.
They are fire-and-forget: if Firestore write fails, MySQL data is
still intact and a warning is logged. The app never breaks.
"""

import os
import logging
from datetime import datetime

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
                             audio_summary: str = None, timestamp=None):
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
            'created_at': ts,
        })
        logger.debug(f"Firestore group chat write: msg {message_id} in group {group_id}")
    except Exception as e:
        logger.warning(f"Firestore group chat write failed (non-fatal): {e}")


def write_post(post_id: int, username: str, content: str = '', community_id=None,
               group_id=None, image_path: str = None, video_path: str = None,
               audio_path: str = None, audio_summary: str = None,
               post_type: str = 'community', timestamp=None):
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
            'created_at': ts,
        })
    except Exception as e:
        logger.warning(f"Firestore post write failed (non-fatal): {e}")


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
