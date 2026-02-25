"""Group Chat API endpoints."""

from __future__ import annotations

import logging
import json
import re
import os
import threading
from datetime import datetime
from functools import wraps

from flask import Blueprint, jsonify, request, session
from werkzeug.utils import secure_filename

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.media import save_uploaded_file

# Allowed extensions for chat uploads
# Include HEIC/HEIF for iOS devices
IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif'}
VIDEO_EXTENSIONS = {'mp4', 'webm', 'mov', 'm4v'}

group_chat_bp = Blueprint("group_chat", __name__)
logger = logging.getLogger(__name__)

MAX_GROUP_MEMBERS = 5
AI_USERNAME = 'steve'
XAI_API_KEY = os.getenv('XAI_API_KEY', '')

# Track when Steve is typing (in-memory, per group_id)
# Format: {group_id: timestamp_when_started}
_steve_typing_status: dict[int, float] = {}


def _login_required(view_func):
    """Simple login_required decorator that avoids circular imports."""

    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            return jsonify({"success": False, "error": "Login required"}), 401
        return view_func(*args, **kwargs)

    return wrapper


def _ensure_voice_column(cursor):
    """Ensure voice_path column exists in group_chat_messages."""
    from backend.services.database import USE_MYSQL
    try:
        cursor.execute("SELECT voice_path FROM group_chat_messages LIMIT 1")
    except Exception:
        # Column doesn't exist, add it
        try:
            if USE_MYSQL:
                cursor.execute("ALTER TABLE group_chat_messages ADD COLUMN voice_path VARCHAR(500)")
            else:
                cursor.execute("ALTER TABLE group_chat_messages ADD COLUMN voice_path TEXT")
            logger.info("Added voice_path column to group_chat_messages")
        except Exception as e:
            logger.warning(f"Could not add voice_path column: {e}")


def _ensure_video_column(cursor):
    """Ensure video_path column exists in group_chat_messages."""
    from backend.services.database import USE_MYSQL
    try:
        cursor.execute("SELECT video_path FROM group_chat_messages LIMIT 1")
    except Exception:
        # Column doesn't exist, add it
        try:
            if USE_MYSQL:
                cursor.execute("ALTER TABLE group_chat_messages ADD COLUMN video_path VARCHAR(500)")
            else:
                cursor.execute("ALTER TABLE group_chat_messages ADD COLUMN video_path TEXT")
            logger.info("Added video_path column to group_chat_messages")
        except Exception as e:
            logger.warning(f"Could not add video_path column: {e}")


def _ensure_media_paths_column(cursor):
    """Ensure media_paths column exists in group_chat_messages for grouped media."""
    from backend.services.database import USE_MYSQL
    try:
        cursor.execute("SELECT media_paths FROM group_chat_messages LIMIT 1")
    except Exception:
        # Column doesn't exist, add it
        try:
            if USE_MYSQL:
                cursor.execute("ALTER TABLE group_chat_messages ADD COLUMN media_paths TEXT")
            else:
                cursor.execute("ALTER TABLE group_chat_messages ADD COLUMN media_paths TEXT")
            logger.info("Added media_paths column to group_chat_messages")
        except Exception as e:
            logger.warning(f"Could not add media_paths column: {e}")


def _ensure_is_edited_column(cursor):
    """Ensure is_edited column exists in group_chat_messages."""
    from backend.services.database import USE_MYSQL
    try:
        cursor.execute("SELECT is_edited FROM group_chat_messages LIMIT 1")
    except Exception:
        try:
            if USE_MYSQL:
                cursor.execute("ALTER TABLE group_chat_messages ADD COLUMN is_edited TINYINT DEFAULT 0")
            else:
                cursor.execute("ALTER TABLE group_chat_messages ADD COLUMN is_edited INTEGER DEFAULT 0")
            logger.info("Added is_edited column to group_chat_messages")
        except Exception as e:
            logger.warning(f"Could not add is_edited column: {e}")


def _ensure_audio_summary_column(cursor):
    """Ensure audio_summary column exists in group_chat_messages for voice note transcriptions."""
    from backend.services.database import USE_MYSQL
    try:
        cursor.execute("SELECT audio_summary FROM group_chat_messages LIMIT 1")
    except Exception:
        try:
            if USE_MYSQL:
                cursor.execute("ALTER TABLE group_chat_messages ADD COLUMN audio_summary TEXT")
            else:
                cursor.execute("ALTER TABLE group_chat_messages ADD COLUMN audio_summary TEXT")
            logger.info("Added audio_summary column to group_chat_messages")
        except Exception as e:
            logger.warning(f"Could not add audio_summary column: {e}")


def _ensure_group_message_reactions_table(cursor):
    """Ensure group_message_reactions table exists."""
    from backend.services.database import USE_MYSQL
    try:
        cursor.execute("SELECT 1 FROM group_message_reactions LIMIT 1")
    except Exception:
        try:
            if USE_MYSQL:
                cursor.execute("""
                    CREATE TABLE group_message_reactions (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        message_id INT NOT NULL,
                        username VARCHAR(100) NOT NULL,
                        reaction VARCHAR(10) NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE KEY unique_reaction (message_id, username)
                    )
                """)
            else:
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS group_message_reactions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        message_id INTEGER NOT NULL,
                        username TEXT NOT NULL,
                        reaction TEXT NOT NULL,
                        created_at TEXT,
                        UNIQUE(message_id, username)
                    )
                """)
            logger.info("Created group_message_reactions table")
        except Exception as e:
            logger.warning(f"Could not create group_message_reactions table: {e}")


def _ensure_community_id_column(cursor):
    """Ensure community_id column exists in group_chats table."""
    from backend.services.database import USE_MYSQL
    try:
        cursor.execute("SELECT community_id FROM group_chats LIMIT 1")
    except Exception:
        # Column doesn't exist, add it
        try:
            if USE_MYSQL:
                cursor.execute("ALTER TABLE group_chats ADD COLUMN community_id INT DEFAULT NULL")
            else:
                cursor.execute("ALTER TABLE group_chats ADD COLUMN community_id INTEGER DEFAULT NULL")
            logger.info("Added community_id column to group_chats")
        except Exception as e:
            logger.warning(f"Could not add community_id column: {e}")


def _ensure_group_chat_tables(cursor):
    """Ensure group chat tables exist."""
    from backend.services.database import USE_MYSQL
    
    # Check if table exists
    try:
        cursor.execute("SELECT 1 FROM group_chats LIMIT 1")
        _ensure_voice_column(cursor)  # Ensure voice column exists
        _ensure_video_column(cursor)  # Ensure video column exists
        _ensure_media_paths_column(cursor)  # Ensure media_paths column exists for grouped media
        _ensure_community_id_column(cursor)  # Ensure community_id column exists
        _ensure_is_edited_column(cursor)  # Ensure is_edited column exists
        _ensure_audio_summary_column(cursor)  # Ensure audio_summary column exists for voice transcriptions
        _ensure_group_message_reactions_table(cursor)  # Ensure reactions table exists
        return  # Table exists, no need to create
    except Exception:
        pass  # Table doesn't exist, create it
    
    # Use appropriate syntax for MySQL vs SQLite
    if USE_MYSQL:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS group_chats (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(100) NOT NULL,
                creator_username VARCHAR(100) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                is_active TINYINT DEFAULT 1
            )
        """)
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS group_chat_members (
                id INT PRIMARY KEY AUTO_INCREMENT,
                group_id INT NOT NULL,
                username VARCHAR(100) NOT NULL,
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_admin TINYINT DEFAULT 0,
                UNIQUE KEY unique_member (group_id, username),
                INDEX idx_group (group_id),
                INDEX idx_username (username)
            )
        """)
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS group_chat_messages (
                id INT PRIMARY KEY AUTO_INCREMENT,
                group_id INT NOT NULL,
                sender_username VARCHAR(100) NOT NULL,
                message_text TEXT,
                image_path VARCHAR(500),
                voice_path VARCHAR(500),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_deleted TINYINT DEFAULT 0,
                INDEX idx_group_created (group_id, created_at)
            )
        """)
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS group_chat_read_receipts (
                id INT PRIMARY KEY AUTO_INCREMENT,
                group_id INT NOT NULL,
                username VARCHAR(100) NOT NULL,
                last_read_message_id INT DEFAULT 0,
                last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_receipt (group_id, username)
            )
        """)
    else:
        # SQLite syntax
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS group_chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(100) NOT NULL,
                creator_username VARCHAR(100) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_active INTEGER DEFAULT 1
            )
        """)
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS group_chat_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                username VARCHAR(100) NOT NULL,
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_admin INTEGER DEFAULT 0,
                UNIQUE(group_id, username)
            )
        """)
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS group_chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                sender_username VARCHAR(100) NOT NULL,
                message_text TEXT,
                image_path VARCHAR(500),
                voice_path TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_deleted INTEGER DEFAULT 0
            )
        """)
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS group_chat_read_receipts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                username VARCHAR(100) NOT NULL,
                last_read_message_id INTEGER DEFAULT 0,
                last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(group_id, username)
            )
        """)
    
    # Ensure reactions table exists after creating other tables
    _ensure_group_message_reactions_table(cursor)
    
    logger.info("Created group chat tables")


@group_chat_bp.route("/api/upload_chat_media", methods=["POST"])
@_login_required
def upload_chat_media():
    """Upload an image or video for chat (group or DM). Uses R2 CDN."""
    username = session["username"]
    
    # Check for image or video file
    file = None
    media_type = None
    
    if 'image' in request.files:
        file = request.files['image']
        media_type = 'image'
        allowed_ext = IMAGE_EXTENSIONS
        subfolder = 'message_photos'
    elif 'video' in request.files:
        file = request.files['video']
        media_type = 'video'
        allowed_ext = VIDEO_EXTENSIONS
        subfolder = 'message_videos'
    else:
        return jsonify({"success": False, "error": "No image or video provided"}), 400
    
    if not file or file.filename == '':
        return jsonify({"success": False, "error": "No file selected"}), 400
    
    try:
        # Use save_uploaded_file which handles R2 upload and optimization
        stored_path = save_uploaded_file(
            file,
            subfolder=subfolder,
            allowed_extensions=allowed_ext
        )
        
        if not stored_path:
            return jsonify({"success": False, "error": "File type not allowed or upload failed"}), 400
        
        logger.info(f"Uploaded chat {media_type}: {stored_path} by {username}")
        
        return jsonify({
            "success": True,
            "path": stored_path,
            "media_type": media_type
        })
        
    except Exception as e:
        logger.error(f"Error uploading chat {media_type}: {e}")
        return jsonify({"success": False, "error": f"Failed to upload {media_type}"}), 500


# Keep old endpoint for backward compatibility
@group_chat_bp.route("/api/upload_chat_image", methods=["POST"])
@_login_required
def upload_chat_image():
    """Upload an image for chat - redirects to upload_chat_media."""
    return upload_chat_media()


@group_chat_bp.route("/api/group_chat/create", methods=["POST"])
@_login_required
def create_group_chat():
    """Create a new group chat."""
    username = session["username"]
    data = request.get_json() or {}
    
    name = data.get("name", "").strip()
    members = data.get("members", [])
    community_id = data.get("community_id")
    
    if not name:
        return jsonify({"success": False, "error": "Group name is required"}), 400
    
    if len(name) > 100:
        return jsonify({"success": False, "error": "Group name too long (max 100 characters)"}), 400
    
    if not isinstance(members, list) or len(members) < 1:
        return jsonify({"success": False, "error": "At least 1 other member is required"}), 400
    
    if len(members) > MAX_GROUP_MEMBERS:
        return jsonify({"success": False, "error": f"Maximum {MAX_GROUP_MEMBERS} members allowed"}), 400
    
    # Add creator to members if not already included
    all_members = list(set([username] + [str(m).strip() for m in members if m]))
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            _ensure_group_chat_tables(c)
            
            # If community_id provided, verify all members belong to that community
            if community_id:
                # Verify creator is a member of the community
                c.execute(f"""
                    SELECT 1 FROM user_communities uc
                    JOIN users u ON uc.user_id = u.id
                    WHERE uc.community_id = {ph} AND u.username = {ph}
                """, (community_id, username))
                if not c.fetchone():
                    return jsonify({"success": False, "error": "You are not a member of this community"}), 403
                
                # Verify all other members belong to the community
                for member in all_members:
                    if member == username:
                        continue
                    c.execute(f"""
                        SELECT 1 FROM user_communities uc
                        JOIN users u ON uc.user_id = u.id
                        WHERE uc.community_id = {ph} AND u.username = {ph}
                    """, (community_id, member))
                    if not c.fetchone():
                        return jsonify({"success": False, "error": f"User '{member}' is not a member of this community"}), 400
            else:
                # Verify all members exist
                for member in all_members:
                    if member == username:
                        continue
                    c.execute(f"SELECT 1 FROM users WHERE username = {ph}", (member,))
                    if not c.fetchone():
                        return jsonify({"success": False, "error": f"User '{member}' not found"}), 404
            
            # Create the group chat
            now = datetime.now().isoformat()
            c.execute(f"""
                INSERT INTO group_chats (name, creator_username, community_id, created_at, updated_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph})
            """, (name, username, community_id, now, now))
            
            group_id = c.lastrowid
            
            # Add all members
            for member in all_members:
                is_admin = 1 if member == username else 0
                c.execute(f"""
                    INSERT INTO group_chat_members (group_id, username, joined_at, is_admin)
                    VALUES ({ph}, {ph}, {ph}, {ph})
                """, (group_id, member, now, is_admin))
            
            conn.commit()
            
            logger.info(f"Created group chat '{name}' (ID: {group_id}) by {username} with {len(all_members)} members, community_id={community_id}")
            
            return jsonify({
                "success": True,
                "group_id": group_id,
                "name": name,
                "members": all_members,
                "community_id": community_id,
            })
            
    except Exception as e:
        logger.error(f"Error creating group chat: {e}")
        return jsonify({"success": False, "error": "Failed to create group chat"}), 500


@group_chat_bp.route("/api/group_chat/list", methods=["GET"])
@_login_required
def list_group_chats():
    """List all group chats for the current user."""
    username = session["username"]
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            _ensure_group_chat_tables(c)
            
            # Get all groups the user is a member of
            c.execute(f"""
                SELECT g.id, g.name, g.creator_username, g.created_at, g.updated_at,
                       gcm.is_admin
                FROM group_chats g
                JOIN group_chat_members gcm ON g.id = gcm.group_id
                WHERE gcm.username = {ph} AND g.is_active = 1
                ORDER BY g.updated_at DESC
            """, (username,))
            
            groups = []
            for row in c.fetchall():
                group_id = row["id"] if hasattr(row, "keys") else row[0]
                group_name = row["name"] if hasattr(row, "keys") else row[1]
                creator = row["creator_username"] if hasattr(row, "keys") else row[2]
                created_at = row["created_at"] if hasattr(row, "keys") else row[3]
                updated_at = row["updated_at"] if hasattr(row, "keys") else row[4]
                is_admin = row["is_admin"] if hasattr(row, "keys") else row[5]
                
                # Get member count
                c.execute(f"SELECT COUNT(*) as cnt FROM group_chat_members WHERE group_id = {ph}", (group_id,))
                count_row = c.fetchone()
                member_count = count_row["cnt"] if hasattr(count_row, "keys") else count_row[0]
                
                # Get last message
                c.execute(f"""
                    SELECT sender_username, message_text, created_at
                    FROM group_chat_messages
                    WHERE group_id = {ph} AND is_deleted = 0
                    ORDER BY created_at DESC
                    LIMIT 1
                """, (group_id,))
                last_msg_row = c.fetchone()
                last_message = None
                if last_msg_row:
                    last_message = {
                        "sender": last_msg_row["sender_username"] if hasattr(last_msg_row, "keys") else last_msg_row[0],
                        "text": last_msg_row["message_text"] if hasattr(last_msg_row, "keys") else last_msg_row[1],
                        "time": last_msg_row["created_at"] if hasattr(last_msg_row, "keys") else last_msg_row[2],
                    }
                
                # Get unread count
                c.execute(f"""
                    SELECT last_read_message_id FROM group_chat_read_receipts
                    WHERE group_id = {ph} AND username = {ph}
                """, (group_id, username))
                receipt_row = c.fetchone()
                last_read_id = 0
                if receipt_row:
                    last_read_id = receipt_row["last_read_message_id"] if hasattr(receipt_row, "keys") else receipt_row[0]
                
                c.execute(f"""
                    SELECT COUNT(*) as cnt FROM group_chat_messages
                    WHERE group_id = {ph} AND id > {ph} AND is_deleted = 0 AND sender_username != {ph}
                """, (group_id, last_read_id, username))
                unread_row = c.fetchone()
                unread_count = unread_row["cnt"] if hasattr(unread_row, "keys") else unread_row[0]
                
                groups.append({
                    "id": group_id,
                    "name": group_name,
                    "creator": creator,
                    "created_at": created_at,
                    "updated_at": updated_at,
                    "is_admin": bool(is_admin),
                    "member_count": member_count,
                    "last_message": last_message,
                    "unread_count": unread_count,
                })
            
            return jsonify({"success": True, "groups": groups})
            
    except Exception as e:
        logger.error(f"Error listing group chats: {e}")
        return jsonify({"success": False, "error": "Failed to load group chats"}), 500


@group_chat_bp.route("/api/group_chat/<int:group_id>", methods=["GET"])
@_login_required
def get_group_chat(group_id: int):
    """Get details of a specific group chat."""
    username = session["username"]
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            _ensure_group_chat_tables(c)
            
            # Check if user is a member
            c.execute(f"""
                SELECT g.id, g.name, g.creator_username, g.created_at, g.community_id, gcm.is_admin
                FROM group_chats g
                JOIN group_chat_members gcm ON g.id = gcm.group_id
                WHERE g.id = {ph} AND gcm.username = {ph} AND g.is_active = 1
            """, (group_id, username))
            
            row = c.fetchone()
            if not row:
                return jsonify({"success": False, "error": "Group not found or access denied"}), 404
            
            group_name = row["name"] if hasattr(row, "keys") else row[1]
            creator = row["creator_username"] if hasattr(row, "keys") else row[2]
            created_at = row["created_at"] if hasattr(row, "keys") else row[3]
            community_id = row["community_id"] if hasattr(row, "keys") else row[4]
            is_admin = row["is_admin"] if hasattr(row, "keys") else row[5]
            
            # Get community name if community_id exists
            community_name = None
            if community_id:
                c.execute(f"SELECT name FROM communities WHERE id = {ph}", (community_id,))
                comm_row = c.fetchone()
                if comm_row:
                    community_name = comm_row["name"] if hasattr(comm_row, "keys") else comm_row[0]
            
            # Get all members
            c.execute(f"""
                SELECT gcm.username, gcm.is_admin, gcm.joined_at, up.profile_picture
                FROM group_chat_members gcm
                LEFT JOIN user_profiles up ON gcm.username = up.username
                WHERE gcm.group_id = {ph}
                ORDER BY gcm.is_admin DESC, gcm.joined_at ASC
            """, (group_id,))
            
            members = []
            for m_row in c.fetchall():
                members.append({
                    "username": m_row["username"] if hasattr(m_row, "keys") else m_row[0],
                    "is_admin": bool(m_row["is_admin"] if hasattr(m_row, "keys") else m_row[1]),
                    "joined_at": m_row["joined_at"] if hasattr(m_row, "keys") else m_row[2],
                    "profile_picture": m_row["profile_picture"] if hasattr(m_row, "keys") else m_row[3],
                })
            
            return jsonify({
                "success": True,
                "group": {
                    "id": group_id,
                    "name": group_name,
                    "creator": creator,
                    "created_at": created_at,
                    "community_id": community_id,
                    "community_name": community_name,
                    "is_admin": bool(is_admin),
                    "members": members,
                }
            })
            
    except Exception as e:
        logger.error(f"Error getting group chat {group_id}: {e}")
        return jsonify({"success": False, "error": "Failed to load group chat"}), 500


@group_chat_bp.route("/api/group_chat/<int:group_id>/presence", methods=["POST"])
@_login_required
def update_group_presence(group_id: int):
    """Update user's active presence in a group chat (suppresses notifications while viewing)."""
    username = session["username"]
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            from backend.services.database import USE_MYSQL
            
            # Ensure the table exists
            _ensure_group_presence_table(c)
            
            # Upsert active presence
            now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
            if USE_MYSQL:
                c.execute(f"""
                    INSERT INTO group_chat_presence (username, group_id, updated_at)
                    VALUES ({ph}, {ph}, {ph})
                    ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)
                """, (username, group_id, now))
            else:
                c.execute(f"""
                    INSERT INTO group_chat_presence (username, group_id, updated_at)
                    VALUES ({ph}, {ph}, {ph})
                    ON CONFLICT(username, group_id) DO UPDATE SET updated_at = {ph}
                """, (username, group_id, now, now))
            
            conn.commit()
            return jsonify({"success": True})
            
    except Exception as e:
        logger.warning(f"Error updating group presence: {e}")
        return jsonify({"success": True})  # Don't fail - this is optional


def _ensure_group_presence_table(cursor):
    """Ensure group_chat_presence table exists for active chat tracking."""
    from backend.services.database import USE_MYSQL
    try:
        cursor.execute("SELECT 1 FROM group_chat_presence LIMIT 1")
        return  # Table exists
    except Exception:
        pass  # Table doesn't exist, create it
    
    try:
        if USE_MYSQL:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS group_chat_presence (
                    username VARCHAR(191) NOT NULL,
                    group_id INT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (username, group_id)
                )
            """)
        else:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS group_chat_presence (
                    username TEXT NOT NULL,
                    group_id INTEGER NOT NULL,
                    updated_at TEXT DEFAULT (datetime('now')),
                    PRIMARY KEY (username, group_id)
                )
            """)
        logger.info("Created group_chat_presence table")
    except Exception as e:
        logger.warning(f"Could not create group_chat_presence table: {e}")


@group_chat_bp.route("/api/group_chat/<int:group_id>/messages", methods=["GET"])
@_login_required
def get_group_messages(group_id: int):
    """Get messages for a group chat."""
    username = session["username"]
    before_id = request.args.get("before_id", type=int)
    limit = min(request.args.get("limit", 50, type=int), 100)
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            _ensure_group_chat_tables(c)
            
            # Ensure tables and columns exist
            _ensure_group_chat_tables(c)
            
            # Check if user is a member
            c.execute(f"""
                SELECT 1 FROM group_chat_members
                WHERE group_id = {ph} AND username = {ph}
            """, (group_id, username))
            
            if not c.fetchone():
                return jsonify({"success": False, "error": "Access denied"}), 403
            
            # Get messages
            if before_id:
                c.execute(f"""
                    SELECT m.id, m.sender_username, m.message_text, m.image_path, m.voice_path, m.video_path, m.media_paths, m.created_at,
                           up.profile_picture, m.is_edited, m.audio_summary
                    FROM group_chat_messages m
                    LEFT JOIN user_profiles up ON m.sender_username = up.username
                    WHERE m.group_id = {ph} AND m.id < {ph} AND m.is_deleted = 0
                    ORDER BY m.created_at DESC
                    LIMIT {ph}
                """, (group_id, before_id, limit))
            else:
                c.execute(f"""
                    SELECT m.id, m.sender_username, m.message_text, m.image_path, m.voice_path, m.video_path, m.media_paths, m.created_at,
                           up.profile_picture, m.is_edited, m.audio_summary
                    FROM group_chat_messages m
                    LEFT JOIN user_profiles up ON m.sender_username = up.username
                    WHERE m.group_id = {ph} AND m.is_deleted = 0
                    ORDER BY m.created_at DESC
                    LIMIT {ph}
                """, (group_id, limit))
            
            messages = []
            message_ids = []
            for row in c.fetchall():
                # Parse media_paths JSON if present
                media_paths_raw = row["media_paths"] if hasattr(row, "keys") else row[6]
                media_paths = None
                if media_paths_raw:
                    try:
                        media_paths = json.loads(media_paths_raw)
                        logger.debug(f"Parsed media_paths for message: {media_paths}")
                    except Exception as e:
                        logger.warning(f"Failed to parse media_paths: {media_paths_raw}, error: {e}")
                
                msg_id = row["id"] if hasattr(row, "keys") else row[0]
                is_edited_raw = row["is_edited"] if hasattr(row, "keys") else row[9]
                is_edited = bool(is_edited_raw) if is_edited_raw is not None else False
                audio_summary = row["audio_summary"] if hasattr(row, "keys") else row[10]
                
                msg_data = {
                    "id": msg_id,
                    "sender": row["sender_username"] if hasattr(row, "keys") else row[1],
                    "text": row["message_text"] if hasattr(row, "keys") else row[2],
                    "image": row["image_path"] if hasattr(row, "keys") else row[3],
                    "voice": row["voice_path"] if hasattr(row, "keys") else row[4],
                    "video": row["video_path"] if hasattr(row, "keys") else row[5],
                    "media_paths": media_paths,
                    "created_at": row["created_at"] if hasattr(row, "keys") else row[7],
                    "profile_picture": row["profile_picture"] if hasattr(row, "keys") else row[8],
                    "is_edited": is_edited,
                    "audio_summary": audio_summary,
                    "reaction": None,  # Will be filled below
                }
                messages.append(msg_data)
                message_ids.append(msg_id)
            
            # Fetch reactions for all messages in batch
            if message_ids:
                try:
                    # Get current user's reactions
                    placeholders = ','.join([ph] * len(message_ids))
                    c.execute(f"""
                        SELECT message_id, reaction FROM group_message_reactions
                        WHERE message_id IN ({placeholders}) AND username = {ph}
                    """, (*message_ids, username))
                    user_reactions = {}
                    for r in c.fetchall():
                        # Handle both DictCursor (MySQL) and tuple (SQLite) results
                        msg_id = r["message_id"] if hasattr(r, "keys") else r[0]
                        reaction_emoji = r["reaction"] if hasattr(r, "keys") else r[1]
                        user_reactions[msg_id] = reaction_emoji
                    
                    # Update messages with reactions
                    for msg in messages:
                        msg["reaction"] = user_reactions.get(msg["id"])
                    
                    logger.debug(f"Loaded {len(user_reactions)} reactions for user {username}")
                except Exception as e:
                    logger.warning(f"Could not fetch reactions: {e}")
            
            # Update read receipt
            if messages:
                max_id = max(m["id"] for m in messages)
                now = datetime.now().isoformat()
                try:
                    c.execute(f"""
                        INSERT INTO group_chat_read_receipts (group_id, username, last_read_message_id, last_read_at)
                        VALUES ({ph}, {ph}, {ph}, {ph})
                        ON CONFLICT(group_id, username) DO UPDATE SET
                            last_read_message_id = MAX(last_read_message_id, {ph}),
                            last_read_at = {ph}
                    """, (group_id, username, max_id, now, max_id, now))
                except Exception:
                    # Fallback for MySQL
                    c.execute(f"""
                        INSERT INTO group_chat_read_receipts (group_id, username, last_read_message_id, last_read_at)
                        VALUES ({ph}, {ph}, {ph}, {ph})
                        ON DUPLICATE KEY UPDATE
                            last_read_message_id = GREATEST(last_read_message_id, {ph}),
                            last_read_at = {ph}
                    """, (group_id, username, max_id, now, max_id, now))
                conn.commit()
            
            # Reverse to show oldest first
            messages.reverse()
            
            # Check if Steve is typing (with 30 second timeout)
            import time
            steve_is_typing = False
            if group_id in _steve_typing_status:
                elapsed = time.time() - _steve_typing_status[group_id]
                if elapsed < 30:  # Typing indicator expires after 30 seconds
                    steve_is_typing = True
                else:
                    # Clean up stale typing status
                    del _steve_typing_status[group_id]
            
            return jsonify({
                "success": True, 
                "messages": messages,
                "steve_is_typing": steve_is_typing
            })
            
    except Exception as e:
        logger.error(f"Error getting messages for group {group_id}: {e}")
        return jsonify({"success": False, "error": "Failed to load messages"}), 500


@group_chat_bp.route("/api/group_chat/<int:group_id>/media", methods=["GET"])
@_login_required
def get_group_media(group_id: int):
    """Get all media (images and videos) shared in a group chat."""
    username = session["username"]
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            _ensure_group_chat_tables(c)
            
            # Check if user is a member
            c.execute(f"""
                SELECT 1 FROM group_chat_members
                WHERE group_id = {ph} AND username = {ph}
            """, (group_id, username))
            
            if not c.fetchone():
                return jsonify({"success": False, "error": "Access denied"}), 403
            
            # Get all messages with media
            c.execute(f"""
                SELECT id, sender_username, image_path, video_path, media_paths, created_at
                FROM group_chat_messages
                WHERE group_id = {ph} AND is_deleted = 0 
                  AND (image_path IS NOT NULL OR video_path IS NOT NULL OR media_paths IS NOT NULL)
                ORDER BY created_at DESC
            """, (group_id,))
            
            media_items = []
            item_id = 0
            
            for row in c.fetchall():
                msg_id = row["id"] if hasattr(row, "keys") else row[0]
                sender = row["sender_username"] if hasattr(row, "keys") else row[1]
                image_path = row["image_path"] if hasattr(row, "keys") else row[2]
                video_path = row["video_path"] if hasattr(row, "keys") else row[3]
                media_paths_raw = row["media_paths"] if hasattr(row, "keys") else row[4]
                created_at = row["created_at"] if hasattr(row, "keys") else row[5]
                
                # Handle grouped media (media_paths JSON)
                if media_paths_raw:
                    try:
                        paths = json.loads(media_paths_raw)
                        for path in paths:
                            item_id += 1
                            is_video = any(path.lower().endswith(ext) for ext in ['.mp4', '.mov', '.webm', '.m4v'])
                            media_items.append({
                                "id": item_id,
                                "message_id": msg_id,
                                "sender": sender,
                                "url": path,
                                "type": "video" if is_video else "image",
                                "created_at": created_at
                            })
                    except:
                        pass
                
                # Handle legacy single image
                if image_path:
                    item_id += 1
                    media_items.append({
                        "id": item_id,
                        "message_id": msg_id,
                        "sender": sender,
                        "url": image_path,
                        "type": "image",
                        "created_at": created_at
                    })
                
                # Handle legacy single video
                if video_path:
                    item_id += 1
                    media_items.append({
                        "id": item_id,
                        "message_id": msg_id,
                        "sender": sender,
                        "url": video_path,
                        "type": "video",
                        "created_at": created_at
                    })
            
            return jsonify({"success": True, "media": media_items})
            
    except Exception as e:
        logger.error(f"Error getting media for group {group_id}: {e}")
        return jsonify({"success": False, "error": "Failed to load media"}), 500


@group_chat_bp.route("/api/upload_voice_message", methods=["POST"])
@_login_required
def upload_voice_message():
    """Upload a voice message file and return the path. Used by group chat."""
    username = session["username"]
    
    if 'audio' not in request.files:
        return jsonify({'success': False, 'error': 'No audio uploaded'}), 400
    
    audio = request.files['audio']
    if audio.filename == '':
        return jsonify({'success': False, 'error': 'No audio selected'}), 400
    
    try:
        # Save audio file using media service
        stored_path = save_uploaded_file(
            audio,
            subfolder='voice_messages',
            allowed_extensions={'webm', 'ogg', 'mp3', 'm4a', 'wav', 'opus', 'aac', 'caf', '3gp', '3g2', 'mpeg', 'mp4'}
        )
        
        if not stored_path:
            logger.error(f"Failed to save voice message: filename={audio.filename}, mimetype={audio.mimetype}")
            return jsonify({'success': False, 'error': 'Failed to save audio'}), 400
        
        logger.info(f"Voice message uploaded: {stored_path} by {username}")
        return jsonify({'success': True, 'audio_path': stored_path})
        
    except Exception as e:
        logger.error(f"Error uploading voice message: {e}")
        return jsonify({'success': False, 'error': 'Failed to upload audio'}), 500


@group_chat_bp.route("/api/group_chat/<int:group_id>/send_media", methods=["POST"])
@_login_required
def send_group_media(group_id: int):
    """Upload and send one or more photos/videos to a group chat.
    Supports multiple files - they will be grouped in a single message.
    """
    username = session["username"]
    
    # Collect all files (supports multiple)
    files_to_upload = []
    
    # Check for photos (can be multiple with same key or indexed keys)
    photos = request.files.getlist('photo')
    for photo in photos:
        if photo and photo.filename:
            files_to_upload.append(('photo', photo))
    
    # Check for videos
    videos = request.files.getlist('video')
    for video in videos:
        if video and video.filename:
            files_to_upload.append(('video', video))
    
    # Also check media[] for multi-file uploads
    media_files = request.files.getlist('media')
    for media in media_files:
        if media and media.filename:
            # Determine type from mimetype
            if media.mimetype and media.mimetype.startswith('video/'):
                files_to_upload.append(('video', media))
            else:
                files_to_upload.append(('photo', media))
    
    if not files_to_upload:
        return jsonify({"success": False, "error": "No photo or video provided"}), 400
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            _ensure_group_chat_tables(c)
            
            # Check if user is a member
            c.execute(f"""
                SELECT 1 FROM group_chat_members
                WHERE group_id = {ph} AND username = {ph}
            """, (group_id, username))
            
            if not c.fetchone():
                return jsonify({"success": False, "error": "Access denied"}), 403
            
            # Upload all files
            uploaded_paths = []
            for media_type, file in files_to_upload:
                if media_type == 'photo':
                    allowed_ext = IMAGE_EXTENSIONS
                    subfolder = 'message_photos'
                else:
                    allowed_ext = VIDEO_EXTENSIONS
                    subfolder = 'message_videos'
                
                stored_path = save_uploaded_file(
                    file,
                    subfolder=subfolder,
                    allowed_extensions=allowed_ext
                )
                
                if stored_path:
                    uploaded_paths.append(stored_path)
                    logger.info(f"Uploaded group {media_type}: {stored_path} by {username}")
            
            if not uploaded_paths:
                return jsonify({"success": False, "error": "Failed to upload files"}), 400
            
            # Insert message with grouped media
            now = datetime.now().isoformat()
            
            # Always use media_paths for consistency (stores as JSON array)
            # Legacy image_path/video_path are kept null for new grouped messages
            image_path = None
            video_path = None
            media_paths_json = json.dumps(uploaded_paths)
            
            logger.info(f"Storing {len(uploaded_paths)} media files in media_paths: {media_paths_json}")
            
            c.execute(f"""
                INSERT INTO group_chat_messages (group_id, sender_username, message_text, image_path, voice_path, video_path, media_paths, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """, (group_id, username, None, image_path, None, video_path, media_paths_json, now))
            
            message_id = c.lastrowid
            
            # Update group's updated_at
            c.execute(f"UPDATE group_chats SET updated_at = {ph} WHERE id = {ph}", (now, group_id))
            
            # Update sender's read receipt
            from backend.services.database import USE_MYSQL
            if USE_MYSQL:
                c.execute(f"""
                    INSERT INTO group_chat_read_receipts (group_id, username, last_read_message_id, last_read_at)
                    VALUES ({ph}, {ph}, {ph}, {ph})
                    ON DUPLICATE KEY UPDATE
                        last_read_message_id = VALUES(last_read_message_id),
                        last_read_at = VALUES(last_read_at)
                """, (group_id, username, message_id, now))
            else:
                c.execute(f"""
                    INSERT INTO group_chat_read_receipts (group_id, username, last_read_message_id, last_read_at)
                    VALUES ({ph}, {ph}, {ph}, {ph})
                    ON CONFLICT(group_id, username) DO UPDATE SET
                        last_read_message_id = MAX(last_read_message_id, {ph}),
                        last_read_at = {ph}
                """, (group_id, username, message_id, now, message_id, now))
            
            conn.commit()
            
            # Get sender's profile picture
            c.execute(f"SELECT profile_picture FROM user_profiles WHERE username = {ph}", (username,))
            pp_row = c.fetchone()
            profile_picture = None
            if pp_row:
                profile_picture = pp_row["profile_picture"] if hasattr(pp_row, "keys") else pp_row[0]
            
            # Send notifications to other members
            try:
                c.execute(f"SELECT name FROM group_chats WHERE id = {ph}", (group_id,))
                group_row = c.fetchone()
                group_name = group_row["name"] if hasattr(group_row, "keys") else group_row[0] if group_row else "Group"
                
                c.execute(f"SELECT username FROM group_chat_members WHERE group_id = {ph} AND username != {ph}", (group_id, username))
                other_members = [r["username"] if hasattr(r, "keys") else r[0] for r in c.fetchall()]
                
                # Determine preview text based on content
                if len(uploaded_paths) > 1:
                    preview = f"📷 {len(uploaded_paths)} media files"
                elif video_path:
                    preview = "🎬 Video"
                else:
                    preview = "📷 Photo"
                
                for member in other_members:
                    try:
                        _send_group_message_notification(c, ph, member, username, group_id, group_name, preview, is_mention=False)
                    except Exception as notif_err:
                        logger.warning(f"Failed to send media notification to {member}: {notif_err}")
                
                conn.commit()
            except Exception as notif_batch_err:
                logger.warning(f"Failed to send group media notifications: {notif_batch_err}")
            
            return jsonify({
                "success": True,
                "message": {
                    "id": message_id,
                    "sender": username,
                    "text": None,
                    "image": None,
                    "voice": None,
                    "video": None,
                    "media_paths": uploaded_paths,
                    "created_at": now,
                    "profile_picture": profile_picture,
                }
            })
            
    except Exception as e:
        logger.error(f"Error sending media to group {group_id}: {e}")
        return jsonify({"success": False, "error": "Failed to send media"}), 500


@group_chat_bp.route("/api/group_chat/<int:group_id>/send", methods=["POST"])
@_login_required
def send_group_message(group_id: int):
    """Send a message to a group chat."""
    username = session["username"]
    data = request.get_json() or {}
    
    message_text = data.get("message", "").strip()
    # Support both "image_path" and "image" keys for compatibility
    image_path = data.get("image_path", "").strip() or data.get("image", "").strip() or None
    # Support voice messages
    voice_path = data.get("voice", "").strip() or None
    # Support video messages
    video_path = data.get("video_path", "").strip() or data.get("video", "").strip() or None
    
    if not message_text and not image_path and not voice_path and not video_path:
        return jsonify({"success": False, "error": "Message, image, voice, or video required"}), 400
    
    # Generate audio summary for voice messages
    audio_summary = None
    if voice_path:
        try:
            # Import the audio processing function from main app
            from bodybuilding_app import process_audio_for_summary
            logger.info(f"Generating AI summary for group voice note: {voice_path}")
            audio_summary = process_audio_for_summary(voice_path, username=username)
            if audio_summary:
                logger.info(f"AI summary generated for group chat: {audio_summary[:100]}...")
        except Exception as e:
            logger.warning(f"Could not generate audio summary for group chat: {e}")
            audio_summary = None
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            _ensure_group_chat_tables(c)
            
            # Check if user is a member
            c.execute(f"""
                SELECT 1 FROM group_chat_members
                WHERE group_id = {ph} AND username = {ph}
            """, (group_id, username))
            
            if not c.fetchone():
                return jsonify({"success": False, "error": "Access denied"}), 403
            
            # Insert message with audio_summary
            now = datetime.now().isoformat()
            c.execute(f"""
                INSERT INTO group_chat_messages (group_id, sender_username, message_text, image_path, voice_path, video_path, audio_summary, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """, (group_id, username, message_text or None, image_path, voice_path, video_path, audio_summary, now))
            
            message_id = c.lastrowid
            
            # Update group's updated_at
            c.execute(f"UPDATE group_chats SET updated_at = {ph} WHERE id = {ph}", (now, group_id))
            
            # Update sender's read receipt
            from backend.services.database import USE_MYSQL
            if USE_MYSQL:
                c.execute(f"""
                    INSERT INTO group_chat_read_receipts (group_id, username, last_read_message_id, last_read_at)
                    VALUES ({ph}, {ph}, {ph}, {ph})
                    ON DUPLICATE KEY UPDATE
                        last_read_message_id = VALUES(last_read_message_id),
                        last_read_at = VALUES(last_read_at)
                """, (group_id, username, message_id, now))
            else:
                c.execute(f"""
                    INSERT INTO group_chat_read_receipts (group_id, username, last_read_message_id, last_read_at)
                    VALUES ({ph}, {ph}, {ph}, {ph})
                    ON CONFLICT(group_id, username) DO UPDATE SET
                        last_read_message_id = {ph},
                        last_read_at = {ph}
                """, (group_id, username, message_id, now, message_id, now))
            
            conn.commit()
            
            # Get sender's profile picture
            c.execute(f"SELECT profile_picture FROM user_profiles WHERE username = {ph}", (username,))
            pp_row = c.fetchone()
            profile_picture = None
            if pp_row:
                profile_picture = pp_row["profile_picture"] if hasattr(pp_row, "keys") else pp_row[0]
            
            # Send notifications to other group members
            try:
                # Get group name and other members
                c.execute(f"SELECT name FROM group_chats WHERE id = {ph}", (group_id,))
                group_row = c.fetchone()
                group_name = group_row["name"] if hasattr(group_row, "keys") else group_row[0] if group_row else "Group"
                
                c.execute(f"SELECT username FROM group_chat_members WHERE group_id = {ph} AND username != {ph}", (group_id, username))
                other_members = [r["username"] if hasattr(r, "keys") else r[0] for r in c.fetchall()]
                
                # Determine message preview
                if voice_path:
                    preview = "🎤 Voice message"
                elif video_path:
                    preview = "🎬 Video"
                elif image_path:
                    preview = "📷 Photo"
                else:
                    preview = message_text[:50] + "..." if len(message_text) > 50 else message_text
                
                # Detect @mentions in the message (case-insensitive)
                mentioned_users = set()
                if message_text:
                    # Find all @username patterns
                    mention_pattern = r'@(\w+)'
                    mentions = re.findall(mention_pattern, message_text, re.IGNORECASE)
                    # Check which mentions are actual group members
                    for mention in mentions:
                        mention_lower = mention.lower()
                        for member in other_members:
                            if member.lower() == mention_lower:
                                mentioned_users.add(member)
                                break
                
                for member in other_members:
                    try:
                        is_mention = member in mentioned_users
                        _send_group_message_notification(c, ph, member, username, group_id, group_name, preview, is_mention=is_mention)
                    except Exception as notif_err:
                        logger.warning(f"Failed to send message notification to {member}: {notif_err}")
                
                conn.commit()
            except Exception as notif_batch_err:
                logger.warning(f"Failed to send group message notifications: {notif_batch_err}")
            
            # Check if @Steve is mentioned - trigger AI response in background
            if message_text and re.search(r'@steve\b', message_text, re.IGNORECASE) and username != AI_USERNAME:
                try:
                    # Set Steve typing indicator
                    import time
                    _steve_typing_status[group_id] = time.time()
                    
                    # Run Steve's response in a background thread to not block the request
                    thread = threading.Thread(
                        target=_trigger_steve_group_reply,
                        args=(group_id, group_name, message_text, username, message_id)
                    )
                    thread.daemon = True
                    thread.start()
                    logger.info(f"Triggered Steve reply for group {group_id}")
                except Exception as steve_err:
                    logger.warning(f"Failed to trigger Steve reply: {steve_err}")
            
            return jsonify({
                "success": True,
                "message": {
                    "id": message_id,
                    "sender": username,
                    "text": message_text,
                    "image": image_path,
                    "voice": voice_path,
                    "video": video_path,
                    "audio_summary": audio_summary,
                    "created_at": now,
                    "profile_picture": profile_picture,
                }
            })
            
    except Exception as e:
        logger.error(f"Error sending message to group {group_id}: {e}")
        return jsonify({"success": False, "error": "Failed to send message"})


def _send_group_message_notification(cursor, ph, recipient_username: str, sender_username: str, group_id: int, group_name: str, message_preview: str, is_mention: bool = False):
    """Send push notification for a new group message.
    
    Note: Group chat notifications do NOT go to the notifications table/bell icon.
    They only appear as push notifications and affect the chat icon unread count.
    """
    from backend.services.database import USE_MYSQL
    
    # Determine push content based on whether it's a mention
    if is_mention:
        push_title = f"{group_name} - Mention"
        push_body = f"{sender_username} mentioned you: {message_preview}"
    else:
        push_title = group_name
        push_body = f"{sender_username}: {message_preview}"
    
    # Check if recipient is actively viewing this group chat (suppress push if so)
    should_push = True
    try:
        _ensure_group_presence_table(cursor)
        if USE_MYSQL:
            cursor.execute(f"""
                SELECT 1 FROM group_chat_presence 
                WHERE username = {ph} AND group_id = {ph} 
                AND updated_at > DATE_SUB(NOW(), INTERVAL 20 SECOND)
                LIMIT 1
            """, (recipient_username, group_id))
        else:
            cursor.execute(f"""
                SELECT 1 FROM group_chat_presence 
                WHERE username = {ph} AND group_id = {ph} 
                AND datetime(updated_at) > datetime('now', '-20 seconds')
                LIMIT 1
            """, (recipient_username, group_id))
        
        if cursor.fetchone():
            should_push = False
            logger.debug(f"Suppressing push for {recipient_username} - actively viewing group {group_id}")
    except Exception as presence_err:
        logger.warning(f"Could not check group presence: {presence_err}")
    
    # Send push notification only (no bell icon notification)
    if should_push:
        try:
            from backend.services.notifications import send_push_to_user
            send_push_to_user(
                recipient_username,
                {
                    "title": push_title,
                    "body": push_body,
                    "url": f"/group_chat/{group_id}",
                    "tag": f"group-{group_id}-msg"
                }
            )
        except Exception as push_err:
            logger.warning(f"Push notification failed for group message: {push_err}")


@group_chat_bp.route("/api/group_chat/<int:group_id>/leave", methods=["POST"])
@_login_required
def leave_group_chat(group_id: int):
    """Leave a group chat."""
    username = session["username"]
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            _ensure_group_chat_tables(c)
            
            # Check if user is a member and if they're the creator
            c.execute(f"""
                SELECT g.creator_username, gcm.is_admin
                FROM group_chats g
                JOIN group_chat_members gcm ON g.id = gcm.group_id
                WHERE g.id = {ph} AND gcm.username = {ph}
            """, (group_id, username))
            
            row = c.fetchone()
            if not row:
                return jsonify({"success": False, "error": "Not a member of this group"}), 404
            
            creator = row["creator_username"] if hasattr(row, "keys") else row[0]
            
            # If user is creator, find new admin BEFORE removing them
            new_admin = None
            if username == creator:
                c.execute(f"""
                    SELECT username FROM group_chat_members 
                    WHERE group_id = {ph} AND username != {ph}
                    ORDER BY joined_at ASC LIMIT 1
                """, (group_id, username))
                new_admin_row = c.fetchone()
                if new_admin_row:
                    new_admin = new_admin_row["username"] if hasattr(new_admin_row, "keys") else new_admin_row[0]
            
            # Remove member
            c.execute(f"DELETE FROM group_chat_members WHERE group_id = {ph} AND username = {ph}", (group_id, username))
            
            # Check remaining members
            c.execute(f"SELECT COUNT(*) as cnt FROM group_chat_members WHERE group_id = {ph}", (group_id,))
            count_row = c.fetchone()
            remaining = count_row["cnt"] if hasattr(count_row, "keys") else count_row[0]
            
            if remaining == 0:
                # Deactivate group if no members left
                c.execute(f"UPDATE group_chats SET is_active = 0 WHERE id = {ph}", (group_id,))
            elif new_admin:
                # Transfer admin to another member
                c.execute(f"UPDATE group_chat_members SET is_admin = 1 WHERE group_id = {ph} AND username = {ph}", (group_id, new_admin))
            
            conn.commit()
            
            return jsonify({"success": True})
            
    except Exception as e:
        logger.error(f"Error leaving group {group_id}: {e}")
        return jsonify({"success": False, "error": "Failed to leave group"}), 500


@group_chat_bp.route("/api/group_chat/<int:group_id>/delete", methods=["POST"])
@_login_required
def delete_group_chat(group_id: int):
    """Delete a group chat. Only the creator can delete."""
    username = session["username"]
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            _ensure_group_chat_tables(c)
            
            # Check if user is the creator
            c.execute(f"""
                SELECT creator_username FROM group_chats
                WHERE id = {ph} AND is_active = 1
            """, (group_id,))
            
            row = c.fetchone()
            if not row:
                return jsonify({"success": False, "error": "Group not found"}), 404
            
            creator = row["creator_username"] if hasattr(row, "keys") else row[0]
            
            if creator != username:
                return jsonify({"success": False, "error": "Only the creator can delete this group"}), 403
            
            # Delete all related data
            c.execute(f"DELETE FROM group_chat_read_receipts WHERE group_id = {ph}", (group_id,))
            c.execute(f"DELETE FROM group_chat_messages WHERE group_id = {ph}", (group_id,))
            c.execute(f"DELETE FROM group_chat_members WHERE group_id = {ph}", (group_id,))
            
            # Deactivate the group (soft delete)
            c.execute(f"UPDATE group_chats SET is_active = 0 WHERE id = {ph}", (group_id,))
            
            conn.commit()
            
            return jsonify({"success": True})
            
    except Exception as e:
        logger.error(f"Error deleting group {group_id}: {e}")
        return jsonify({"success": False, "error": "Failed to delete group"}), 500


@group_chat_bp.route("/api/group_chat/<int:group_id>/message/<int:message_id>/delete", methods=["POST"])
@_login_required
def delete_group_message(group_id: int, message_id: int):
    """Delete a specific message in a group chat. Only the sender can delete their own messages."""
    username = session["username"]
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            _ensure_group_chat_tables(c)
            
            # Check if user is a member of the group and owns the message
            c.execute(f"""
                SELECT m.sender_username, gcm.username
                FROM group_chat_messages m
                JOIN group_chat_members gcm ON m.group_id = gcm.group_id
                WHERE m.id = {ph} AND m.group_id = {ph} AND gcm.username = {ph}
            """, (message_id, group_id, username))
            
            row = c.fetchone()
            if not row:
                return jsonify({"success": False, "error": "Message not found or access denied"}), 404
            
            sender = row["sender_username"] if hasattr(row, "keys") else row[0]
            
            # Only allow sender to delete their own messages
            if sender != username:
                return jsonify({"success": False, "error": "You can only delete your own messages"}), 403
            
            # Soft delete the message (mark as deleted)
            c.execute(f"UPDATE group_chat_messages SET is_deleted = 1 WHERE id = {ph}", (message_id,))
            
            conn.commit()
            
            return jsonify({"success": True})
            
    except Exception as e:
        logger.error(f"Error deleting message {message_id} in group {group_id}: {e}")
        return jsonify({"success": False, "error": "Failed to delete message"}), 500


@group_chat_bp.route("/api/group_chat/<int:group_id>/message/<int:message_id>/update_summary", methods=["POST"])
@_login_required
def update_group_audio_summary(group_id: int, message_id: int):
    """Update the AI summary for a voice message. Only the sender can edit."""
    username = session["username"]
    data = request.get_json() or {}
    new_summary = (data.get("summary") or "").strip()
    
    if not new_summary:
        return jsonify({"success": False, "error": "Summary cannot be empty"}), 400
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            c.execute(f"""
                SELECT sender_username FROM group_chat_messages
                WHERE id = {ph} AND group_id = {ph} AND is_deleted = 0
            """, (message_id, group_id))
            
            row = c.fetchone()
            if not row:
                return jsonify({"success": False, "error": "Message not found"}), 404
            
            sender = row["sender_username"] if hasattr(row, "keys") else row[0]
            if sender != username:
                return jsonify({"success": False, "error": "You can only edit your own summaries"}), 403
            
            c.execute(f"UPDATE group_chat_messages SET audio_summary = {ph} WHERE id = {ph}", (new_summary, message_id))
            conn.commit()
            
            return jsonify({"success": True, "summary": new_summary})
            
    except Exception as e:
        logger.error(f"Error updating audio summary for message {message_id}: {e}")
        return jsonify({"success": False, "error": "Failed to update summary"}), 500


@group_chat_bp.route("/api/group_chat/<int:group_id>/messages/bulk_delete", methods=["POST"])
@_login_required
def bulk_delete_group_messages(group_id: int):
    """Delete multiple messages at once. Only the sender can delete their own messages."""
    username = session["username"]
    data = request.get_json() or {}
    message_ids = data.get("message_ids", [])
    
    if not message_ids or not isinstance(message_ids, list):
        return jsonify({"success": False, "error": "message_ids array is required"}), 400
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            _ensure_group_chat_tables(c)
            
            # Check if user is a member
            c.execute(f"""
                SELECT 1 FROM group_chat_members
                WHERE group_id = {ph} AND username = {ph}
            """, (group_id, username))
            
            if not c.fetchone():
                return jsonify({"success": False, "error": "Access denied"}), 403
            
            # Only delete messages owned by the user
            deleted_ids = []
            for msg_id in message_ids:
                # Check ownership
                c.execute(f"""
                    SELECT sender_username FROM group_chat_messages
                    WHERE id = {ph} AND group_id = {ph} AND is_deleted = 0
                """, (msg_id, group_id))
                
                row = c.fetchone()
                if row:
                    sender = row["sender_username"] if hasattr(row, "keys") else row[0]
                    if sender == username:
                        c.execute(f"UPDATE group_chat_messages SET is_deleted = 1 WHERE id = {ph}", (msg_id,))
                        deleted_ids.append(msg_id)
            
            conn.commit()
            
            return jsonify({
                "success": True,
                "deleted_count": len(deleted_ids),
                "deleted_ids": deleted_ids
            })
            
    except Exception as e:
        logger.error(f"Error bulk deleting messages in group {group_id}: {e}")
        return jsonify({"success": False, "error": "Failed to delete messages"}), 500


@group_chat_bp.route("/api/group_chat/<int:group_id>/message/<int:message_id>/edit", methods=["POST"])
@_login_required
def edit_group_message(group_id: int, message_id: int):
    """Edit a specific message in a group chat. Only the sender can edit their own messages."""
    username = session["username"]
    data = request.get_json() or {}
    new_text = data.get("text", "").strip()
    
    if not new_text:
        return jsonify({"success": False, "error": "Message text is required"}), 400
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            _ensure_group_chat_tables(c)
            
            # Check if user is a member of the group and owns the message
            c.execute(f"""
                SELECT m.sender_username, m.message_text
                FROM group_chat_messages m
                JOIN group_chat_members gcm ON m.group_id = gcm.group_id
                WHERE m.id = {ph} AND m.group_id = {ph} AND gcm.username = {ph} AND m.is_deleted = 0
            """, (message_id, group_id, username))
            
            row = c.fetchone()
            if not row:
                return jsonify({"success": False, "error": "Message not found or access denied"}), 404
            
            sender = row["sender_username"] if hasattr(row, "keys") else row[0]
            
            # Only allow sender to edit their own messages
            if sender != username:
                return jsonify({"success": False, "error": "You can only edit your own messages"}), 403
            
            # Update the message and mark as edited
            c.execute(f"UPDATE group_chat_messages SET message_text = {ph}, is_edited = 1 WHERE id = {ph}", (new_text, message_id))
            
            conn.commit()
            
            return jsonify({"success": True, "text": new_text, "is_edited": True})
            
    except Exception as e:
        logger.error(f"Error editing message {message_id} in group {group_id}: {e}")
        return jsonify({"success": False, "error": "Failed to edit message"}), 500


@group_chat_bp.route("/api/group_chat/<int:group_id>/message/<int:message_id>/react", methods=["POST"])
@_login_required
def react_to_group_message(group_id: int, message_id: int):
    """Add or remove a reaction to a group message."""
    username = session["username"]
    data = request.get_json() or {}
    reaction = data.get("reaction", "").strip()
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            _ensure_group_chat_tables(c)
            
            # Check if user is a member
            c.execute(f"""
                SELECT 1 FROM group_chat_members
                WHERE group_id = {ph} AND username = {ph}
            """, (group_id, username))
            
            if not c.fetchone():
                return jsonify({"success": False, "error": "Access denied"}), 403
            
            # Check if message exists
            c.execute(f"""
                SELECT 1 FROM group_chat_messages
                WHERE id = {ph} AND group_id = {ph} AND is_deleted = 0
            """, (message_id, group_id))
            
            if not c.fetchone():
                return jsonify({"success": False, "error": "Message not found"}), 404
            
            if not reaction:
                # Remove reaction
                c.execute(f"""
                    DELETE FROM group_message_reactions
                    WHERE message_id = {ph} AND username = {ph}
                """, (message_id, username))
            else:
                # Add/update reaction
                from backend.services.database import USE_MYSQL
                now = datetime.now().isoformat()
                if USE_MYSQL:
                    c.execute(f"""
                        INSERT INTO group_message_reactions (message_id, username, reaction, created_at)
                        VALUES ({ph}, {ph}, {ph}, {ph})
                        ON DUPLICATE KEY UPDATE reaction = VALUES(reaction), created_at = VALUES(created_at)
                    """, (message_id, username, reaction, now))
                else:
                    c.execute(f"""
                        INSERT INTO group_message_reactions (message_id, username, reaction, created_at)
                        VALUES ({ph}, {ph}, {ph}, {ph})
                        ON CONFLICT(message_id, username) DO UPDATE SET reaction = {ph}, created_at = {ph}
                    """, (message_id, username, reaction, now, reaction, now))
            
            conn.commit()
            
            return jsonify({"success": True, "reaction": reaction if reaction else None})
            
    except Exception as e:
        logger.error(f"Error reacting to message {message_id} in group {group_id}: {e}")
        return jsonify({"success": False, "error": "Failed to save reaction"}), 500


@group_chat_bp.route("/api/group_chat/<int:group_id>/available_members", methods=["GET"])
@_login_required
def get_available_members(group_id: int):
    """Get members from all communities the current user belongs to who can be added to the group."""
    username = session["username"]
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            _ensure_group_chat_tables(c)
            
            # Check if user is a member of the group
            c.execute(f"""
                SELECT 1 FROM group_chat_members
                WHERE group_id = {ph} AND username = {ph}
            """, (group_id, username))
            
            if not c.fetchone():
                return jsonify({"success": False, "error": "Not a member of this group"}), 404
            
            # Get existing group members
            c.execute(f"SELECT username FROM group_chat_members WHERE group_id = {ph}", (group_id,))
            existing_members = {r["username"] if hasattr(r, "keys") else r[0] for r in c.fetchall()}
            
            # Get all members from all communities the current user belongs to
            c.execute(f"""
                SELECT DISTINCT u.username, up.display_name, up.profile_picture, c.name as community_name
                FROM user_communities uc
                JOIN users u ON uc.user_id = u.id
                LEFT JOIN user_profiles up ON u.username = up.username
                JOIN communities c ON uc.community_id = c.id
                WHERE uc.community_id IN (
                    SELECT uc2.community_id 
                    FROM user_communities uc2 
                    JOIN users u2 ON uc2.user_id = u2.id 
                    WHERE u2.username = {ph}
                )
                ORDER BY c.name, u.username
            """, (username,))
            
            available = []
            seen_usernames = set()
            for m_row in c.fetchall():
                member_username = m_row["username"] if hasattr(m_row, "keys") else m_row[0]
                # Skip existing group members and duplicates
                if member_username not in existing_members and member_username not in seen_usernames:
                    seen_usernames.add(member_username)
                    available.append({
                        "username": member_username,
                        "display_name": m_row["display_name"] if hasattr(m_row, "keys") else m_row[1],
                        "profile_picture": m_row["profile_picture"] if hasattr(m_row, "keys") else m_row[2],
                        "community_name": m_row["community_name"] if hasattr(m_row, "keys") else m_row[3],
                    })
            
            return jsonify({"success": True, "members": available})
            
    except Exception as e:
        logger.error(f"Error getting available members for group {group_id}: {e}")
        return jsonify({"success": False, "error": "Failed to load available members"}), 500


@group_chat_bp.route("/api/group_chat/<int:group_id>/add_members", methods=["POST"])
@_login_required
def add_members_to_group(group_id: int):
    """Add members to an existing group chat. Members can be from any community the adder belongs to."""
    username = session["username"]
    
    try:
        data = request.get_json() or {}
        new_members = data.get("members", [])
        
        if not new_members:
            return jsonify({"success": False, "error": "No members specified"}), 400
        
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            _ensure_group_chat_tables(c)
            
            # Check if user is a member of the group
            c.execute(f"""
                SELECT g.name, g.creator_username
                FROM group_chats g
                JOIN group_chat_members gcm ON g.id = gcm.group_id
                WHERE g.id = {ph} AND gcm.username = {ph} AND g.is_active = 1
            """, (group_id, username))
            
            row = c.fetchone()
            if not row:
                return jsonify({"success": False, "error": "Not a member of this group"}), 404
            
            group_name = row["name"] if hasattr(row, "keys") else row[0]
            
            # Get current member count
            c.execute(f"SELECT COUNT(*) as cnt FROM group_chat_members WHERE group_id = {ph}", (group_id,))
            count_row = c.fetchone()
            current_count = count_row["cnt"] if hasattr(count_row, "keys") else count_row[0]
            
            # Check if adding would exceed limit
            if current_count + len(new_members) > MAX_GROUP_MEMBERS:
                return jsonify({
                    "success": False, 
                    "error": f"Group chats are limited to {MAX_GROUP_MEMBERS} members. Consider creating a community for larger groups.",
                    "limit_exceeded": True,
                    "current_count": current_count,
                    "max_members": MAX_GROUP_MEMBERS
                }), 400
            
            # Get existing members to avoid duplicates
            c.execute(f"SELECT username FROM group_chat_members WHERE group_id = {ph}", (group_id,))
            existing_members = {r["username"] if hasattr(r, "keys") else r[0] for r in c.fetchall()}
            
            # Get all communities the current user belongs to
            c.execute(f"""
                SELECT uc.community_id FROM user_communities uc
                JOIN users u ON uc.user_id = u.id
                WHERE u.username = {ph}
            """, (username,))
            user_communities = {r["community_id"] if hasattr(r, "keys") else r[0] for r in c.fetchall()}
            
            # Verify new members belong to at least one of the user's communities
            for member in new_members:
                member = str(member).strip()
                if member and member not in existing_members:
                    c.execute(f"""
                        SELECT uc.community_id FROM user_communities uc
                        JOIN users u ON uc.user_id = u.id
                        WHERE u.username = {ph}
                    """, (member,))
                    member_communities = {r["community_id"] if hasattr(r, "keys") else r[0] for r in c.fetchall()}
                    
                    # Check if there's any overlap between user's communities and member's communities
                    if not user_communities.intersection(member_communities):
                        return jsonify({
                            "success": False, 
                            "error": f"User '{member}' is not in any of your communities"
                        }), 400
            
            now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
            added_members = []
            
            for member in new_members:
                member = str(member).strip()
                if member and member not in existing_members:
                    # Insert new member
                    c.execute(f"""
                        INSERT INTO group_chat_members (group_id, username, joined_at, is_admin)
                        VALUES ({ph}, {ph}, {ph}, 0)
                    """, (group_id, member, now))
                    added_members.append(member)
                    
                    # Send notification to the added user
                    try:
                        _send_group_add_notification(c, ph, member, username, group_id, group_name)
                    except Exception as notif_err:
                        logger.warning(f"Failed to send add notification to {member}: {notif_err}")
            
            conn.commit()
            
            return jsonify({
                "success": True,
                "added_members": added_members,
                "message": f"Added {len(added_members)} member(s) to the group"
            })
            
    except Exception as e:
        logger.error(f"Error adding members to group {group_id}: {e}")
        return jsonify({"success": False, "error": "Failed to add members"}), 500


def _send_group_add_notification(cursor, ph, recipient_username: str, added_by: str, group_id: int, group_name: str):
    """Send push notification when user is added to a group.
    
    Note: Group chat notifications do NOT go to the notifications table/bell icon.
    They only appear as push notifications and affect the chat icon.
    """
    # Send push notification only (no bell icon notification)
    try:
        from backend.services.notifications import send_push_to_user
        send_push_to_user(
            recipient_username,
            {
                "title": "Added to Group Chat",
                "body": f"{added_by} added you to '{group_name}'",
                "url": f"/group_chat/{group_id}",
                "tag": f"group-add-{group_id}"
            }
        )
    except Exception as push_err:
        logger.warning(f"Push notification failed for group add: {push_err}")


def _trigger_steve_group_reply(group_id: int, group_name: str, user_message: str, sender_username: str, reply_to_message_id: int):
    """
    Generate and post Steve's AI reply to a group chat message.
    Runs in a background thread.
    Uses Grok 4.1 Fast with built-in web search capabilities.
    """
    import time
    from datetime import datetime
    
    # Small delay to make it feel more natural
    time.sleep(1.5)
    
    if not XAI_API_KEY:
        logger.warning("XAI_API_KEY not configured, Steve cannot reply")
        return
    
    current_date = datetime.now().strftime('%A, %B %d, %Y at %H:%M UTC')
    
    try:
        # Get recent messages for context
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            # Get messages from the last 7 days for conversation context
            from datetime import timedelta
            seven_days_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d %H:%M:%S')
            c.execute(f"""
                SELECT sender_username, message_text, created_at
                FROM group_chat_messages
                WHERE group_id = {ph} AND message_text IS NOT NULL
                  AND created_at >= {ph}
                ORDER BY created_at DESC
                LIMIT 100
            """, (group_id, seven_days_ago))
            
            recent_messages = []
            for row in c.fetchall():
                sender = row["sender_username"] if hasattr(row, "keys") else row[0]
                text = row["message_text"] if hasattr(row, "keys") else row[1]
                if text:
                    recent_messages.append(f"{sender}: {text}")
            
            recent_messages.reverse()  # Chronological order
            
            # Build context from last 7 days of conversation
            context = f"Group chat: {group_name}\n"
            context += "Recent conversation (last 7 days):\n" + "\n".join(recent_messages)
            context += f"\n\n{sender_username} mentioned you (@Steve)."
            context += f"\n\n[Current date and time: {current_date}]"
            
            # Only collect images if the user's message explicitly references them
            image_keywords = ['image', 'photo', 'picture', 'pic', 'imagem', 'foto', 'see', 'look', 'show', 'what is this', 'what\'s this', 'o que é', 'vê', 'olha']
            msg_lower = user_message.lower()
            wants_images = any(kw in msg_lower for kw in image_keywords)
            
            image_urls = []
            if wants_images:
                def _extract_http_images(val):
                    urls = []
                    if not val:
                        return urls
                    if isinstance(val, str) and val.startswith('http'):
                        if not any(val.lower().endswith(e) for e in ['.mp4', '.mov', '.webm', '.m4v']):
                            urls.append(val)
                    return urls
                
                def _extract_media_paths_images(raw):
                    urls = []
                    if not raw:
                        return urls
                    try:
                        items = json.loads(raw) if isinstance(raw, str) else raw
                        if isinstance(items, list):
                            for item in items:
                                path = item if isinstance(item, str) else ''
                                if path.startswith('http') and not any(path.lower().endswith(e) for e in ['.mp4', '.mov', '.webm', '.m4v']):
                                    urls.append(path)
                    except Exception:
                        pass
                    return urls
                
                try:
                    c.execute(f"""
                        SELECT media_paths FROM group_chat_messages
                        WHERE group_id = {ph} AND media_paths IS NOT NULL AND media_paths != ''
                        ORDER BY created_at DESC LIMIT 3
                    """, (group_id,))
                    for row in c.fetchall():
                        raw = row["media_paths"] if hasattr(row, "keys") else row[0]
                        for url in _extract_media_paths_images(raw):
                            if url not in image_urls and len(image_urls) < 3:
                                image_urls.append(url)
                except Exception:
                    pass
                
                try:
                    if len(image_urls) < 3:
                        c.execute(f"""
                            SELECT image_path FROM group_chat_messages
                            WHERE group_id = {ph} AND image_path IS NOT NULL AND image_path != ''
                            ORDER BY created_at DESC LIMIT 3
                        """, (group_id,))
                        for row in c.fetchall():
                            val = row["image_path"] if hasattr(row, "keys") else row[0]
                            for url in _extract_http_images(val):
                                if url not in image_urls and len(image_urls) < 3:
                                    image_urls.append(url)
                except Exception:
                    pass
                
                if image_urls:
                    context += f"\n\n[{len(image_urls)} image(s) from the conversation are attached for you to see.]"
                    logger.info(f"Steve vision: collected {len(image_urls)} images for group {group_id}")
        
        from openai import OpenAI
        
        system_prompt = f"""You are Steve, a helpful, witty, and intelligent AI assistant in a group chat with real-time knowledge and web search capabilities.

CURRENT DATE AND TIME: {current_date}

LANGUAGE RULES:
- If user writes in Portuguese, respond in EUROPEAN PORTUGUESE (PT-PT, Portugal style).
  Use "tu" not "você", "autocarro" not "ônibus", "telemóvel" not "celular".
- If user writes in English, respond in English.
- If user writes in Spanish, respond in Spanish.
- Match the user's language exactly.

CONVERSATION INTELLIGENCE:
Read the full conversation context carefully. Adapt your response based on what's happening:
1. If someone is asking about news, weather, sports, or current events — search the web and provide real, up-to-date information with source links.
2. If the group is having casual banter or fun — join in naturally. Be witty, use emojis, keep it light.
3. If a problem or challenge is being discussed and NO solution has been proposed — proactively suggest practical, actionable solutions with brief reasoning.
4. If a solution IS already being discussed — briefly analyze it: what's good about it, any risks or blind spots, and suggest improvements or alternatives if relevant.
5. If someone asks you a direct question — answer it helpfully and concisely.
6. If images are attached, you CAN see them. Only analyze or describe images when explicitly asked about them. Do NOT proactively reference or describe images unless the user specifically asks.

RESPONSE STYLE:
- Keep responses concise (2-5 sentences). Don't lecture or over-explain.
- Be conversational, not robotic. This is a casual group chat.
- Use emojis occasionally.
- When citing sources, include the URL — it will be auto-formatted as a readable clickable link."""
        
        ai_response = None
        
        logger.info(f"Steve using Grok 4.1 Fast Reasoning with web+X search for group {group_id}")
        client = OpenAI(
            api_key=XAI_API_KEY,
            base_url="https://api.x.ai/v1"
        )
        
        try:
            # Build user input — attach images if available
            if image_urls:
                user_content = [{"type": "input_text", "text": context}]
                for img_url in image_urls:
                    user_content.append({"type": "input_image", "image_url": img_url})
                effective_system = system_prompt + "\n\nYou can see images shared in this conversation. Describe what you see if asked."
            else:
                user_content = context
                effective_system = system_prompt
            
            response = client.responses.create(
                model="grok-4-1-fast-reasoning",
                input=[
                    {"role": "system", "content": effective_system},
                    {"role": "user", "content": user_content}
                ],
                tools=[
                    {"type": "web_search"},
                    {"type": "x_search"}
                ],
                max_output_tokens=600
            )
            
            ai_response = response.output_text.strip() if hasattr(response, 'output_text') and response.output_text else None
            
            if ai_response:
                logger.info(f"Steve Grok 4.1 Fast successful for group {group_id}")
        except Exception as grok_err:
            logger.error(f"Grok 4.1 Fast failed for group {group_id}: {grok_err}")
        
        if not ai_response:
            logger.warning("Steve got empty response from API")
            return
        
        # Format links for clean rendering
        try:
            from bodybuilding_app import format_steve_response_links
            ai_response = format_steve_response_links(ai_response)
        except Exception as fmt_err:
            logger.warning(f"Could not format Steve response links: {fmt_err}")
        
        # Post Steve's message to the group
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            
            now = datetime.now().isoformat()
            
            c.execute(f"""
                INSERT INTO group_chat_messages (group_id, sender_username, message_text, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph})
            """, (group_id, AI_USERNAME, ai_response, now))
            
            steve_message_id = c.lastrowid
            
            # Update group's updated_at
            c.execute(f"UPDATE group_chats SET updated_at = {ph} WHERE id = {ph}", (now, group_id))
            
            conn.commit()
            
            # Clear typing indicator now that Steve has posted
            if group_id in _steve_typing_status:
                del _steve_typing_status[group_id]
            
            logger.info(f"Steve replied to group {group_id} with message ID {steve_message_id}")
            
            # Note: No notifications for Steve's messages - users see them in the chat
            # without push notifications or bell icon updates
            
            conn.commit()
            
    except Exception as e:
        # Clear typing indicator on error too
        if group_id in _steve_typing_status:
            del _steve_typing_status[group_id]
        logger.error(f"Error in Steve group reply: {e}", exc_info=True)
