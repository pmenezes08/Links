#!/usr/bin/env python3
"""
Migrate DM chats, group chats, and posts from MySQL to Firestore.

Run this on a machine that has:
  1. MySQL env vars set (MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB)
  2. Google Cloud credentials (either GOOGLE_APPLICATION_CREDENTIALS env var
     pointing to a service account JSON, or running on GCP with default creds)

Usage:
  # Dry run (count records, don't write):
  python migrate_to_firestore.py --dry-run

  # Migrate everything:
  python migrate_to_firestore.py

  # Migrate only DMs:
  python migrate_to_firestore.py --only dm

  # Migrate only group chats:
  python migrate_to_firestore.py --only groupchat

  # Migrate only posts:
  python migrate_to_firestore.py --only posts
"""

import argparse
import os
import sys
import time
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)


def get_mysql_connection():
    import pymysql
    from pymysql.cursors import DictCursor
    host = os.environ.get("MYSQL_HOST")
    user = os.environ.get("MYSQL_USER")
    password = os.environ.get("MYSQL_PASSWORD")
    database = os.environ.get("MYSQL_DB")
    if not all([host, user, password, database]):
        raise RuntimeError("Missing MySQL env vars: MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB")
    return pymysql.connect(host=host, user=user, password=password, database=database,
                           cursorclass=DictCursor, charset='utf8mb4', autocommit=True,
                           connect_timeout=30, read_timeout=60)


def get_firestore_client():
    from google.cloud import firestore
    project = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GCP_PROJECT")
    database = os.environ.get("FIRESTORE_DATABASE", "cpoint")
    if project:
        return firestore.Client(project=project, database=database)
    return firestore.Client(database=database)


def parse_timestamp(val):
    """Convert a MySQL timestamp/datetime value to a Python datetime."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    try:
        return datetime.fromisoformat(str(val).replace('Z', '+00:00'))
    except Exception:
        try:
            return datetime.strptime(str(val), '%Y-%m-%d %H:%M:%S')
        except Exception:
            return None


def migrate_dm_messages(mysql_conn, fs_client, dry_run=False):
    """Migrate DM messages to Firestore."""
    logger.info("=== Migrating DM Messages ===")
    cursor = mysql_conn.cursor()

    # Count total
    cursor.execute("SELECT COUNT(*) as cnt FROM messages")
    total = cursor.fetchone()['cnt']
    logger.info(f"Total DM messages to migrate: {total}")
    if dry_run:
        return total

    # Get all unique conversations
    cursor.execute("""
        SELECT DISTINCT LEAST(sender, receiver) as user1, GREATEST(sender, receiver) as user2
        FROM messages
    """)
    conversations = cursor.fetchall()
    logger.info(f"Found {len(conversations)} unique DM conversations")

    migrated = 0
    for conv in conversations:
        user1, user2 = conv['user1'], conv['user2']
        conv_id = f"{user1}_{user2}"

        # Get messages for this conversation
        cursor.execute("""
            SELECT id, sender, receiver, message, image_path, video_path,
                   audio_path, audio_duration_seconds, audio_mime, audio_summary,
                   is_encrypted, timestamp, edited_at, reaction, reaction_by
            FROM messages
            WHERE (sender = %s AND receiver = %s) OR (sender = %s AND receiver = %s)
            ORDER BY timestamp ASC
        """, (user1, user2, user2, user1))
        messages = cursor.fetchall()

        if not messages:
            continue

        # Create conversation document
        last_msg = messages[-1]
        conv_ref = fs_client.collection('dm_conversations').document(conv_id)
        conv_ref.set({
            'participants': [user1, user2],
            'last_message': (last_msg.get('message') or '')[:200],
            'last_sender': last_msg['sender'],
            'updated_at': parse_timestamp(last_msg['timestamp']),
            'message_count': len(messages),
        })

        # Batch write messages (500 per batch)
        batch = fs_client.batch()
        batch_count = 0

        for msg in messages:
            msg_ref = conv_ref.collection('messages').document(str(msg['id']))
            doc = {
                'mysql_id': msg['id'],
                'sender': msg['sender'],
                'receiver': msg['receiver'],
                'text': msg.get('message') or '',
                'image_path': msg.get('image_path'),
                'video_path': msg.get('video_path'),
                'audio_path': msg.get('audio_path'),
                'audio_duration_seconds': msg.get('audio_duration_seconds'),
                'audio_mime': msg.get('audio_mime'),
                'audio_summary': msg.get('audio_summary'),
                'is_encrypted': bool(msg.get('is_encrypted')),
                'created_at': parse_timestamp(msg['timestamp']),
                'edited_at': parse_timestamp(msg.get('edited_at')),
                'reaction': msg.get('reaction'),
                'reaction_by': msg.get('reaction_by'),
            }
            batch.set(msg_ref, doc)
            batch_count += 1

            if batch_count >= 450:
                batch.commit()
                batch = fs_client.batch()
                batch_count = 0
                migrated += 450

        if batch_count > 0:
            batch.commit()
            migrated += batch_count

        if len(conversations) > 20 and (conversations.index(conv) + 1) % 10 == 0:
            logger.info(f"  Progress: {conversations.index(conv) + 1}/{len(conversations)} conversations")

    logger.info(f"DM migration complete: {migrated} messages across {len(conversations)} conversations")
    return migrated


def migrate_group_chat_messages(mysql_conn, fs_client, dry_run=False):
    """Migrate group chat messages to Firestore."""
    logger.info("=== Migrating Group Chat Messages ===")
    cursor = mysql_conn.cursor()

    # Count
    cursor.execute("SELECT COUNT(*) as cnt FROM group_chat_messages")
    total = cursor.fetchone()['cnt']
    logger.info(f"Total group chat messages to migrate: {total}")
    if dry_run:
        # Also count groups and members
        cursor.execute("SELECT COUNT(*) as cnt FROM group_chats WHERE is_active = 1")
        groups = cursor.fetchone()['cnt']
        cursor.execute("SELECT COUNT(*) as cnt FROM group_chat_members")
        members = cursor.fetchone()['cnt']
        logger.info(f"Active group chats: {groups}, Total memberships: {members}")
        return total

    # Get all active group chats
    cursor.execute("""
        SELECT id, name, creator_username, created_at, updated_at, community_id
        FROM group_chats WHERE is_active = 1
    """)
    groups = cursor.fetchall()
    logger.info(f"Found {len(groups)} active group chats")

    migrated = 0
    for group in groups:
        gid = group['id']
        group_ref = fs_client.collection('group_chats').document(str(gid))

        # Group document
        group_ref.set({
            'mysql_id': gid,
            'name': group['name'],
            'creator': group['creator_username'],
            'community_id': group.get('community_id'),
            'created_at': parse_timestamp(group['created_at']),
            'updated_at': parse_timestamp(group['updated_at']),
            'is_active': True,
        })

        # Members
        cursor.execute("""
            SELECT username, is_admin, joined_at
            FROM group_chat_members WHERE group_id = %s
        """, (gid,))
        members = cursor.fetchall()
        for mem in members:
            mem_ref = group_ref.collection('members').document(mem['username'])
            mem_ref.set({
                'username': mem['username'],
                'is_admin': bool(mem['is_admin']),
                'joined_at': parse_timestamp(mem['joined_at']),
            })

        # Messages
        cursor.execute("""
            SELECT id, sender_username, message_text, image_path, voice_path,
                   video_path, audio_summary, created_at, reply_to_message_id
            FROM group_chat_messages
            WHERE group_id = %s
            ORDER BY created_at ASC
        """, (gid,))
        messages = cursor.fetchall()

        batch = fs_client.batch()
        batch_count = 0

        for msg in messages:
            msg_ref = group_ref.collection('messages').document(str(msg['id']))
            doc = {
                'mysql_id': msg['id'],
                'sender': msg['sender_username'],
                'text': msg.get('message_text') or '',
                'image_path': msg.get('image_path'),
                'voice_path': msg.get('voice_path'),
                'video_path': msg.get('video_path'),
                'audio_summary': msg.get('audio_summary'),
                'created_at': parse_timestamp(msg['created_at']),
                'reply_to_message_id': msg.get('reply_to_message_id'),
            }
            batch.set(msg_ref, doc)
            batch_count += 1

            if batch_count >= 450:
                batch.commit()
                batch = fs_client.batch()
                batch_count = 0
                migrated += 450

        if batch_count > 0:
            batch.commit()
            migrated += batch_count

    logger.info(f"Group chat migration complete: {migrated} messages across {len(groups)} groups")
    return migrated


def migrate_posts(mysql_conn, fs_client, dry_run=False):
    """Migrate community posts + group posts to Firestore."""
    logger.info("=== Migrating Posts ===")
    cursor = mysql_conn.cursor()

    # Count community posts
    cursor.execute("SELECT COUNT(*) as cnt FROM posts")
    comm_total = cursor.fetchone()['cnt']

    # Count group posts
    gp_total = 0
    try:
        cursor.execute("SELECT COUNT(*) as cnt FROM group_posts")
        gp_total = cursor.fetchone()['cnt']
    except Exception:
        logger.info("No group_posts table found")

    logger.info(f"Community posts: {comm_total}, Group posts: {gp_total}")
    if dry_run:
        cursor.execute("SELECT COUNT(*) as cnt FROM replies")
        replies = cursor.fetchone()['cnt']
        cursor.execute("SELECT COUNT(*) as cnt FROM reactions")
        reactions = cursor.fetchone()['cnt']
        logger.info(f"Replies: {replies}, Reactions: {reactions}")
        return comm_total + gp_total

    # --- Community posts ---
    logger.info("Migrating community posts...")
    cursor.execute("""
        SELECT id, username, content, image_path, video_path, audio_path,
               audio_summary, timestamp, community_id, view_count
        FROM posts ORDER BY id ASC
    """)
    posts = cursor.fetchall()
    migrated = 0

    batch = fs_client.batch()
    batch_count = 0

    for post in posts:
        pid = post['id']
        post_ref = fs_client.collection('posts').document(str(pid))
        doc = {
            'mysql_id': pid,
            'type': 'community',
            'username': post['username'],
            'content': post.get('content') or '',
            'image_path': post.get('image_path'),
            'video_path': post.get('video_path'),
            'audio_path': post.get('audio_path'),
            'audio_summary': post.get('audio_summary'),
            'community_id': post.get('community_id'),
            'group_id': None,
            'created_at': parse_timestamp(post['timestamp']),
            'view_count': post.get('view_count') or 0,
        }
        batch.set(post_ref, doc)
        batch_count += 1

        if batch_count >= 450:
            batch.commit()
            batch = fs_client.batch()
            batch_count = 0
            migrated += 450

    if batch_count > 0:
        batch.commit()
        migrated += batch_count

    logger.info(f"Community posts written: {migrated}")

    # --- Reactions for community posts ---
    logger.info("Migrating post reactions...")
    cursor.execute("SELECT post_id, username, reaction_type FROM reactions")
    reactions = cursor.fetchall()
    batch = fs_client.batch()
    batch_count = 0
    for rx in reactions:
        rx_ref = fs_client.collection('posts').document(str(rx['post_id'])).collection('reactions').document(rx['username'])
        batch.set(rx_ref, {'type': rx['reaction_type'], 'username': rx['username']})
        batch_count += 1
        if batch_count >= 450:
            batch.commit()
            batch = fs_client.batch()
            batch_count = 0
    if batch_count > 0:
        batch.commit()
    logger.info(f"Post reactions written: {len(reactions)}")

    # --- Replies for community posts ---
    logger.info("Migrating post replies...")
    cursor.execute("""
        SELECT id, post_id, username, content, image_path, timestamp, parent_reply_id
        FROM replies ORDER BY id ASC
    """)
    replies = cursor.fetchall()
    batch = fs_client.batch()
    batch_count = 0
    for reply in replies:
        reply_ref = fs_client.collection('posts').document(str(reply['post_id'])).collection('replies').document(str(reply['id']))
        doc = {
            'mysql_id': reply['id'],
            'username': reply['username'],
            'content': reply.get('content') or '',
            'image_path': reply.get('image_path'),
            'parent_reply_id': reply.get('parent_reply_id'),
            'created_at': parse_timestamp(reply['timestamp']),
        }
        batch.set(reply_ref, doc)
        batch_count += 1
        if batch_count >= 450:
            batch.commit()
            batch = fs_client.batch()
            batch_count = 0
    if batch_count > 0:
        batch.commit()
    logger.info(f"Post replies written: {len(replies)}")

    # --- Group posts ---
    if gp_total > 0:
        logger.info("Migrating group posts...")
        cursor.execute("""
            SELECT id, group_id, username, content, image_path, created_at
            FROM group_posts ORDER BY id ASC
        """)
        gposts = cursor.fetchall()
        batch = fs_client.batch()
        batch_count = 0
        gp_migrated = 0
        for gp in gposts:
            gpid = gp['id']
            gp_ref = fs_client.collection('posts').document(f"gp_{gpid}")
            doc = {
                'mysql_id': gpid,
                'type': 'group',
                'username': gp['username'],
                'content': gp.get('content') or '',
                'image_path': gp.get('image_path'),
                'group_id': gp['group_id'],
                'community_id': None,
                'created_at': parse_timestamp(gp['created_at']),
            }
            batch.set(gp_ref, doc)
            batch_count += 1
            if batch_count >= 450:
                batch.commit()
                batch = fs_client.batch()
                batch_count = 0
                gp_migrated += 450
        if batch_count > 0:
            batch.commit()
            gp_migrated += batch_count
        logger.info(f"Group posts written: {gp_migrated}")
        migrated += gp_migrated

    logger.info(f"Posts migration complete: {migrated} total")
    return migrated


def main():
    parser = argparse.ArgumentParser(description='Migrate MySQL data to Firestore')
    parser.add_argument('--dry-run', action='store_true', help='Count records without writing')
    parser.add_argument('--only', choices=['dm', 'groupchat', 'posts'], help='Migrate only this section')
    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("MySQL → Firestore Migration")
    logger.info("=" * 60)

    if args.dry_run:
        logger.info("DRY RUN MODE - no data will be written")

    # Connect to MySQL
    logger.info("Connecting to MySQL...")
    mysql_conn = get_mysql_connection()
    logger.info("MySQL connected")

    # Connect to Firestore
    if not args.dry_run:
        logger.info("Connecting to Firestore...")
        fs_client = get_firestore_client()
        logger.info("Firestore connected")
    else:
        fs_client = None

    start = time.time()
    totals = {}

    if args.only is None or args.only == 'dm':
        totals['dm'] = migrate_dm_messages(mysql_conn, fs_client, dry_run=args.dry_run)

    if args.only is None or args.only == 'groupchat':
        totals['groupchat'] = migrate_group_chat_messages(mysql_conn, fs_client, dry_run=args.dry_run)

    if args.only is None or args.only == 'posts':
        totals['posts'] = migrate_posts(mysql_conn, fs_client, dry_run=args.dry_run)

    elapsed = time.time() - start
    logger.info("=" * 60)
    logger.info(f"Migration {'DRY RUN ' if args.dry_run else ''}complete in {elapsed:.1f}s")
    for k, v in totals.items():
        logger.info(f"  {k}: {v} records")
    logger.info("=" * 60)

    mysql_conn.close()


if __name__ == '__main__':
    main()
