"""DM message read path (full + delta fetch). Extracted from bodybuilding_app monolith."""

from __future__ import annotations

import json
import logging

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from redis_cache import cache, invalidate_message_cache

logger = logging.getLogger(__name__)


def _payload(data: dict) -> dict:
    return data


def fetch_dm_messages(
    viewer_username: str,
    other_user_id_param: str | None,
    *,
    since_id_param: str | None = None,
    before_id_param: str | None = None,
) -> dict:
    username = viewer_username
    other_user_id = other_user_id_param
    since_id = since_id_param
    before_id = before_id_param
    # PERFORMANCE: Delta fetching - only get messages newer than this ID
    since_id_int = None
    if since_id:
        try:
            since_id_int = int(since_id)
        except (ValueError, TypeError):
            pass
    # Backward pagination - get messages older than this ID
    before_id = before_id_param
    before_id_int = None
    if before_id:
        try:
            before_id_int = int(before_id)
        except (ValueError, TypeError):
            pass
    
    if not other_user_id:
        return _payload({'success': False, 'error': 'Other user ID required'})

    def _steve_dm_typing_for(peer_username):
        try:
            from backend.services.steve_dm_typing import is_dm_typing
            return is_dm_typing(username, peer_username)
        except Exception:
            return False
    
    # Short-lived cache to reduce DB latency (viewer-specific; invalidated on write)
    # PERFORMANCE: Skip cache for delta fetches - they need fresh data
    cache_key = None
    if not since_id_int:  # Only use cache for full fetches
        try:
            # Resolve other username for stable key
            with get_db_connection() as _conn:
                _c = _conn.cursor()
                _c.execute("SELECT username FROM users WHERE id = ?", (other_user_id,))
                _row = _c.fetchone()
                if _row:
                    other_username_for_key = _row['username'] if hasattr(_row, 'keys') else _row[0]
                    from redis_cache import messages_view_cache_key
                    cache_key = messages_view_cache_key(username, other_username_for_key)
        except Exception:
            cache_key = None
        if cache_key:
            cached_messages = cache.get(cache_key)
            if cached_messages:
                for msg in cached_messages:
                    if msg.get('is_encrypted') and not msg.get('encrypted_body'):
                        msg['signal_protocol'] = True
                # WhatsApp-style delete: filter cached messages by deleted_at
                try:
                    with get_db_connection() as _dc:
                        _dcc = _dc.cursor()
                        _dcc.execute("SELECT deleted_at FROM deleted_chat_threads WHERE username = ? AND other_username = ?", (username, other_username_for_key))
                        _dr = _dcc.fetchone()
                        if _dr:
                            _da = str(_dr['deleted_at'] if hasattr(_dr, 'keys') else _dr[0])
                            if _da:
                                from datetime import datetime as _dt
                                _del_dt = _dt.strptime(_da[:19].replace('T',' '), '%Y-%m-%d %H:%M:%S')
                                cached_messages = [m for m in cached_messages if m.get('time') and _dt.strptime(str(m['time'])[:19].replace('T',' '), '%Y-%m-%d %H:%M:%S') > _del_dt]
                except Exception:
                    pass
                try:
                    from backend.services.chat_message_document_merge import enrich_messages_with_mysql_documents
                    with get_db_connection() as _doc_cache_conn:
                        _doc_cache_c = _doc_cache_conn.cursor()
                        cached_messages = enrich_messages_with_mysql_documents(
                            _doc_cache_c,
                            cached_messages,
                            dm_pair=(username, other_username_for_key),
                        )
                except Exception as _doc_cache_err:
                    logger.warning("DM document merge on cache read failed: %s", _doc_cache_err)
                return _payload({
                    'success': True,
                    'messages': cached_messages,
                    'has_more': False,
                    'steve_is_typing': _steve_dm_typing_for(other_username_for_key),
                })
    
    # --- Firestore dual-read (feature flag) ---
    try:
        from backend.services.firestore_reads import USE_FIRESTORE_READS
        if USE_FIRESTORE_READS:
            # Resolve other_user_id to username first (still need MySQL for user lookup)
            with get_db_connection() as _fconn:
                _fc = _fconn.cursor()
                _fc.execute("SELECT username FROM users WHERE id = ?", (other_user_id,))
                _frow = _fc.fetchone()
                if _frow:
                    peer_username = _frow['username'] if hasattr(_frow, 'keys') else _frow[0]
                    from backend.services.firestore_reads import get_dm_messages as fs_get_dm
                    messages, is_delta, has_more = fs_get_dm(username, peer_username, since_id=since_id_int, before_id=before_id_int)
                    logger.info(f"Firestore DM read: {len(messages)} msgs for {username}<->{peer_username} (delta={is_delta}, more={has_more})")
                    fs_initial_empty = (
                        not since_id_int
                        and not before_id_int
                        and not messages
                    )
                    if fs_initial_empty:
                        logger.info(
                            "Firestore DM empty on initial load for %s<->%s; falling back to MySQL",
                            username,
                            peer_username,
                        )
                    else:
                        # Mark messages as read in MySQL (badges/unread counts come from MySQL)
                        dm_marked_read = 0
                        if not before_id_int:
                            try:
                                with get_db_connection() as _mr_conn:
                                    _mr_c = _mr_conn.cursor()
                                    _mr_c.execute("UPDATE messages SET is_read=1 WHERE sender=%s AND receiver=%s AND is_read=0" if USE_MYSQL else "UPDATE messages SET is_read=1 WHERE sender=? AND receiver=? AND is_read=0", (peer_username, username))
                                    dm_marked_read = _mr_c.rowcount or 0
                                    _mr_conn.commit()
                                    if dm_marked_read > 0:
                                        try:
                                            from backend.services.firebase_notifications import send_fcm_to_user_badge_only, get_total_badge_count
                                            badge_count = get_total_badge_count(username)
                                            send_fcm_to_user_badge_only(username, badge_count=badge_count)
                                        except Exception:
                                            pass
                                        try:
                                            invalidate_message_cache(username, peer_username)
                                        except Exception:
                                            pass
                            except Exception as mr_err:
                                logger.warning(f"Failed to mark DM messages as read: {mr_err}")
                        # WhatsApp-style delete: filter Firestore messages by deleted_at
                        try:
                            with get_db_connection() as _dc2:
                                _dcc2 = _dc2.cursor()
                                _dcc2.execute("SELECT deleted_at FROM deleted_chat_threads WHERE username = ? AND other_username = ?", (username, peer_username))
                                _dr2 = _dcc2.fetchone()
                                if _dr2:
                                    _da2 = str(_dr2['deleted_at'] if hasattr(_dr2, 'keys') else _dr2[0])
                                    if _da2:
                                        from datetime import datetime as _dt
                                        _del_dt2 = _dt.strptime(_da2[:19].replace('T',' '), '%Y-%m-%d %H:%M:%S')
                                        messages = [m for m in messages if m.get('time') and _dt.strptime(str(m['time'])[:19].replace('T',' '), '%Y-%m-%d %H:%M:%S') > _del_dt2]
                        except Exception:
                            pass
                        try:
                            from backend.services.chat_message_document_merge import enrich_messages_with_mysql_documents
                            with get_db_connection() as _doc_conn:
                                _doc_c = _doc_conn.cursor()
                                messages = enrich_messages_with_mysql_documents(
                                    _doc_c, messages, dm_pair=(username, peer_username)
                                )
                        except Exception as _doc_merge_err:
                            logger.warning("DM document merge failed: %s", _doc_merge_err)
                        if not messages:
                            has_more = False
                        return _payload({
                            'success': True,
                            'messages': messages,
                            'is_delta': is_delta,
                            'has_more': has_more,
                            'steve_is_typing': _steve_dm_typing_for(peer_username),
                        })
    except Exception as fs_err:
        logger.warning(f"Firestore DM read failed, falling back to MySQL: {fs_err}")

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            # Get current user ID
            c.execute("SELECT id FROM users WHERE LOWER(username) = LOWER(?)", (username,))
            user = c.fetchone()
            if not user:
                return _payload({'success': False, 'error': 'User not found'})
            
            user_id = user['id'] if hasattr(user, 'keys') else user[0]
            
            # Get other user's username
            c.execute("SELECT username FROM users WHERE id = ?", (other_user_id,))
            other_user = c.fetchone()
            if not other_user:
                return _payload({'success': False, 'error': 'Other user not found'})
            
            other_username = other_user['username'] if hasattr(other_user, 'keys') else other_user[0]
            
            # WhatsApp-style delete: only show messages after deleted_at for the deleter
            deleted_at_filter = None
            try:
                c.execute("SELECT deleted_at FROM deleted_chat_threads WHERE username = ? AND other_username = ?", (username, other_username))
                del_row = c.fetchone()
                if del_row:
                    deleted_at_filter = str(del_row['deleted_at'] if hasattr(del_row, 'keys') else del_row[0])
            except Exception:
                pass
            deleted_at_clause = f" AND timestamp > {ph}" if deleted_at_filter else ""
            deleted_at_params = (deleted_at_filter,) if deleted_at_filter else ()
            since_clause = f" AND id > {ph}" if since_id_int else ""

            try:
                from backend.services.dm_human_thread import (
                    dm_messages_where_clause,
                    ensure_human_dm_thread_column,
                    human_pair_thread_key,
                )

                ensure_human_dm_thread_column(c)
            except Exception as _htc_err:
                logger.debug(f"human_dm_thread column ensure: {_htc_err}")
            thr_key_peer = human_pair_thread_key(username, other_username)

            where_pair_dm, base_params = dm_messages_where_clause(
                ph,
                viewer=username,
                peer=other_username,
                thr_key=thr_key_peer,
            )
            query_params = base_params + ((since_id_int,) if since_id_int else ()) + deleted_at_params

            # Get messages between users (compat: edited_at and encryption fields may not exist yet)
            # PERFORMANCE: Delta fetch support - only get messages newer than since_id
            with_edited = True
            with_encryption = True
            has_audio_summary = True
            has_reactions = True
            has_media_paths = True
            try:
                c.execute(
                    f"""
                    SELECT id, sender, receiver, message, image_path, video_path, audio_path, audio_duration_seconds, audio_mime, 
                           is_encrypted, encrypted_body, encrypted_body_for_sender, timestamp, edited_at, audio_summary, reaction, reaction_by, media_paths,
                           file_path, file_name
                    FROM messages
                    WHERE {where_pair_dm}{since_clause}{deleted_at_clause}
                    ORDER BY timestamp ASC
                    """,
                    query_params,
                )
            except Exception:
                has_media_paths = False
                # Fallback without reaction fields
                has_reactions = False
                try:
                    c.execute(
                        f"""
                        SELECT id, sender, receiver, message, image_path, video_path, audio_path, audio_duration_seconds, audio_mime, 
                               is_encrypted, encrypted_body, encrypted_body_for_sender, timestamp, edited_at, audio_summary
                        FROM messages
                        WHERE {where_pair_dm}{since_clause}{deleted_at_clause}
                        ORDER BY timestamp ASC
                        """,
                        query_params,
                    )
                except Exception:
                    # Fallback without encryption fields
                    with_encryption = False
                    try:
                        c.execute(
                            f"""
                            SELECT id, sender, receiver, message, image_path, video_path, audio_path, audio_duration_seconds, audio_mime, timestamp, edited_at, audio_summary
                            FROM messages
                            WHERE {where_pair_dm}{since_clause}{deleted_at_clause}
                            ORDER BY timestamp ASC
                            """,
                            query_params,
                        )
                    except Exception:
                        # Fallback without audio_summary column
                        has_audio_summary = False
                        try:
                            c.execute(
                                f"""
                                SELECT id, sender, receiver, message, image_path, video_path, audio_path, audio_duration_seconds, audio_mime, timestamp, edited_at
                                FROM messages
                                WHERE {where_pair_dm}{since_clause}{deleted_at_clause}
                                ORDER BY timestamp ASC
                                """,
                                query_params,
                            )
                        except Exception:
                            with_edited = False
                            c.execute(
                                f"""
                                SELECT id, sender, receiver, message, image_path, video_path, audio_path, audio_duration_seconds, audio_mime, timestamp
                                FROM messages
                                WHERE {where_pair_dm}{since_clause}{deleted_at_clause}
                                ORDER BY timestamp ASC
                                """,
                                query_params,
                            )
            
            messages = []
            for msg in c.fetchall():
                if hasattr(msg, 'keys'):
                    image_path_val = msg.get('image_path')
                    video_path_val = msg.get('video_path')
                    audio_path_val = msg.get('audio_path')
                    audio_duration_val = msg.get('audio_duration_seconds')
                    audio_mime_val = msg.get('audio_mime')
                    audio_summary_val = msg.get('audio_summary') if has_audio_summary else None
                else:
                    image_path_val = msg[4] if len(msg) > 4 else None
                    video_path_val = msg[5] if len(msg) > 5 else None
                    audio_path_val = msg[6] if len(msg) > 6 else None
                    audio_duration_val = msg[7] if len(msg) > 7 else None
                    audio_mime_val = msg[8] if len(msg) > 8 else None
                    audio_summary_val = None
                edited_at_val = None
                if with_edited:
                    if hasattr(msg, 'get'):
                        edited_at_val = msg.get('edited_at')
                        if has_audio_summary:
                            audio_summary_val = msg.get('audio_summary')
                    elif len(msg):
                        edited_at_val = msg[-1] if not has_audio_summary else (msg[-2] if len(msg) > 1 else None)
                        if has_audio_summary:
                            audio_summary_val = msg[-1] if len(msg) > 0 else None
                # Get reaction fields if available
                reaction_val = None
                reaction_by_val = None
                if has_reactions:
                    if hasattr(msg, 'get'):
                        reaction_val = msg.get('reaction')
                        reaction_by_val = msg.get('reaction_by')
                    # For tuple results, reactions are at the end of the query
                
                # Format timestamp as UTC with Z suffix
                raw_time = msg['timestamp']
                if raw_time and isinstance(raw_time, str) and not raw_time.endswith('Z') and '+' not in raw_time[-6:]:
                    utc_time = raw_time.replace(' ', 'T')
                    if not utc_time.endswith('Z'):
                        utc_time += 'Z'
                else:
                    utc_time = str(raw_time) if raw_time else None
                
                media_paths_val = None
                if has_media_paths:
                    raw_mp = msg.get('media_paths') if hasattr(msg, 'get') else None
                    if raw_mp:
                        try:
                            media_paths_val = json.loads(raw_mp) if isinstance(raw_mp, str) else raw_mp
                        except (json.JSONDecodeError, TypeError):
                            media_paths_val = None

                msg_dict = {
                    'id': msg['id'],
                    'text': msg['message'],
                    'image_path': image_path_val,
                    'video_path': video_path_val,
                    'audio_path': audio_path_val,
                    'audio_duration_seconds': audio_duration_val,
                    'audio_mime': audio_mime_val,
                    'audio_summary': audio_summary_val,
                    'sent': msg['sender'] == username,
                    'time': utc_time,
                    'edited_at': edited_at_val,
                    'reaction': reaction_val,
                    'reaction_by': reaction_by_val,
                    'media_paths': media_paths_val,
                    'file_path': msg.get('file_path') if hasattr(msg, 'get') else None,
                    'file_name': msg.get('file_name') if hasattr(msg, 'get') else None,
                }
                
                # Add encryption fields if available
                if with_encryption:
                    is_encrypted_val = msg.get('is_encrypted') if hasattr(msg, 'get') else msg[9] if len(msg) > 9 else 0
                    encrypted_body_val = msg.get('encrypted_body') if hasattr(msg, 'get') else msg[10] if len(msg) > 10 else None
                    encrypted_body_for_sender_val = msg.get('encrypted_body_for_sender') if hasattr(msg, 'get') else msg[11] if len(msg) > 11 else None
                    
                    msg_dict['is_encrypted'] = is_encrypted_val
                    msg_dict['encrypted_body'] = encrypted_body_val
                    msg_dict['encrypted_body_for_sender'] = encrypted_body_for_sender_val
                    
                    # Signal Protocol: if encrypted but no traditional encrypted_body, it's Signal Protocol
                    # The ciphertexts are stored separately in message_ciphertexts table
                    if is_encrypted_val and not encrypted_body_val:
                        msg_dict['signal_protocol'] = True
                
                messages.append(msg_dict)
            
            if deleted_at_filter:
                try:
                    from datetime import datetime as _dt
                    del_dt = _dt.strptime(deleted_at_filter[:19].replace('T',' '), '%Y-%m-%d %H:%M:%S')
                    messages = [m for m in messages if m.get('time') and _dt.strptime(str(m['time'])[:19].replace('T',' '), '%Y-%m-%d %H:%M:%S') > del_dt]
                except Exception:
                    pass
            
            # Mark messages from other user as read
            c.execute("UPDATE messages SET is_read=1 WHERE sender=? AND receiver=? AND is_read=0", (other_username, username))
            marked_read = c.rowcount
            conn.commit()
            
            # Update badge if any messages were marked as read
            if marked_read > 0:
                try:
                    from backend.services.firebase_notifications import send_fcm_to_user_badge_only, get_total_badge_count
                    badge_count = get_total_badge_count(username)
                    send_fcm_to_user_badge_only(username, badge_count=badge_count)
                    logger.debug(f"Updated badge to {badge_count} for {username} after reading {marked_read} messages")
                except Exception as badge_err:
                    logger.debug(f"Could not update badge: {badge_err}")
                try:
                    invalidate_message_cache(username, other_username)
                except Exception:
                    pass
            
            # Write-through cache for fast subsequent polls
            # PERFORMANCE: Only cache full fetches, not delta fetches
            try:
                from redis_cache import MESSAGE_CACHE_TTL
                if cache_key and not since_id_int:
                    cache.set(cache_key, messages, MESSAGE_CACHE_TTL)
            except Exception:
                pass
            
            # Include delta indicator and pagination hint (MySQL path loads full thread; older pages use Firestore)
            return _payload({
                'success': True,
                'messages': messages,
                'is_delta': bool(since_id_int),
                'has_more': False,
                'steve_is_typing': _steve_dm_typing_for(other_username),
            })
            
    except Exception as e:
        logger.error(f"Error fetching messages: {str(e)}")
        return _payload({'success': False, 'error': 'Failed to fetch messages'})