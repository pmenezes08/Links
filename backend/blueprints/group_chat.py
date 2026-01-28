"""Group Chat API endpoints."""

from __future__ import annotations

import logging
import json
from datetime import datetime
from functools import wraps

from flask import Blueprint, jsonify, request, session

from backend.services.database import get_db_connection, get_sql_placeholder

group_chat_bp = Blueprint("group_chat", __name__)
logger = logging.getLogger(__name__)

MAX_GROUP_MEMBERS = 5


def _login_required(view_func):
    """Simple login_required decorator that avoids circular imports."""

    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            return jsonify({"success": False, "error": "Login required"}), 401
        return view_func(*args, **kwargs)

    return wrapper


def _ensure_group_chat_tables(cursor):
    """Ensure group chat tables exist."""
    from backend.services.database import USE_MYSQL
    
    # Check if table exists
    try:
        cursor.execute("SELECT 1 FROM group_chats LIMIT 1")
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
    
    logger.info("Created group chat tables")


@group_chat_bp.route("/api/group_chat/create", methods=["POST"])
@_login_required
def create_group_chat():
    """Create a new group chat."""
    username = session["username"]
    data = request.get_json() or {}
    
    name = data.get("name", "").strip()
    members = data.get("members", [])
    
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
                INSERT INTO group_chats (name, creator_username, created_at, updated_at)
                VALUES ({ph}, {ph}, {ph}, {ph})
            """, (name, username, now, now))
            
            group_id = c.lastrowid
            
            # Add all members
            for member in all_members:
                is_admin = 1 if member == username else 0
                c.execute(f"""
                    INSERT INTO group_chat_members (group_id, username, joined_at, is_admin)
                    VALUES ({ph}, {ph}, {ph}, {ph})
                """, (group_id, member, now, is_admin))
            
            conn.commit()
            
            logger.info(f"Created group chat '{name}' (ID: {group_id}) by {username} with {len(all_members)} members")
            
            return jsonify({
                "success": True,
                "group_id": group_id,
                "name": name,
                "members": all_members,
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
                SELECT g.id, g.name, g.creator_username, g.created_at, gcm.is_admin
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
            is_admin = row["is_admin"] if hasattr(row, "keys") else row[4]
            
            # Get all members
            c.execute(f"""
                SELECT gcm.username, gcm.is_admin, gcm.joined_at, u.profile_picture
                FROM group_chat_members gcm
                LEFT JOIN users u ON gcm.username = u.username
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
                    "is_admin": bool(is_admin),
                    "members": members,
                }
            })
            
    except Exception as e:
        logger.error(f"Error getting group chat {group_id}: {e}")
        return jsonify({"success": False, "error": "Failed to load group chat"}), 500


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
                    SELECT m.id, m.sender_username, m.message_text, m.image_path, m.created_at,
                           u.profile_picture
                    FROM group_chat_messages m
                    LEFT JOIN users u ON m.sender_username = u.username
                    WHERE m.group_id = {ph} AND m.id < {ph} AND m.is_deleted = 0
                    ORDER BY m.created_at DESC
                    LIMIT {ph}
                """, (group_id, before_id, limit))
            else:
                c.execute(f"""
                    SELECT m.id, m.sender_username, m.message_text, m.image_path, m.created_at,
                           u.profile_picture
                    FROM group_chat_messages m
                    LEFT JOIN users u ON m.sender_username = u.username
                    WHERE m.group_id = {ph} AND m.is_deleted = 0
                    ORDER BY m.created_at DESC
                    LIMIT {ph}
                """, (group_id, limit))
            
            messages = []
            for row in c.fetchall():
                messages.append({
                    "id": row["id"] if hasattr(row, "keys") else row[0],
                    "sender": row["sender_username"] if hasattr(row, "keys") else row[1],
                    "text": row["message_text"] if hasattr(row, "keys") else row[2],
                    "image": row["image_path"] if hasattr(row, "keys") else row[3],
                    "created_at": row["created_at"] if hasattr(row, "keys") else row[4],
                    "profile_picture": row["profile_picture"] if hasattr(row, "keys") else row[5],
                })
            
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
            
            return jsonify({"success": True, "messages": messages})
            
    except Exception as e:
        logger.error(f"Error getting messages for group {group_id}: {e}")
        return jsonify({"success": False, "error": "Failed to load messages"}), 500


@group_chat_bp.route("/api/group_chat/<int:group_id>/send", methods=["POST"])
@_login_required
def send_group_message(group_id: int):
    """Send a message to a group chat."""
    username = session["username"]
    data = request.get_json() or {}
    
    message_text = data.get("message", "").strip()
    image_path = data.get("image_path", "").strip() or None
    
    if not message_text and not image_path:
        return jsonify({"success": False, "error": "Message or image required"}), 400
    
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
            
            # Insert message
            now = datetime.now().isoformat()
            c.execute(f"""
                INSERT INTO group_chat_messages (group_id, sender_username, message_text, image_path, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph})
            """, (group_id, username, message_text or None, image_path, now))
            
            message_id = c.lastrowid
            
            # Update group's updated_at
            c.execute(f"UPDATE group_chats SET updated_at = {ph} WHERE id = {ph}", (now, group_id))
            
            # Update sender's read receipt
            c.execute(f"""
                INSERT INTO group_chat_read_receipts (group_id, username, last_read_message_id, last_read_at)
                VALUES ({ph}, {ph}, {ph}, {ph})
                ON CONFLICT(group_id, username) DO UPDATE SET
                    last_read_message_id = {ph},
                    last_read_at = {ph}
            """, (group_id, username, message_id, now, message_id, now))
            
            conn.commit()
            
            # Get sender's profile picture
            c.execute(f"SELECT profile_picture FROM users WHERE username = {ph}", (username,))
            pp_row = c.fetchone()
            profile_picture = None
            if pp_row:
                profile_picture = pp_row["profile_picture"] if hasattr(pp_row, "keys") else pp_row[0]
            
            return jsonify({
                "success": True,
                "message": {
                    "id": message_id,
                    "sender": username,
                    "text": message_text,
                    "image": image_path,
                    "created_at": now,
                    "profile_picture": profile_picture,
                }
            })
            
    except Exception as e:
        logger.error(f"Error sending message to group {group_id}: {e}")
        return jsonify({"success": False, "error": "Failed to send message"}), 500


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
            
            # Remove member
            c.execute(f"DELETE FROM group_chat_members WHERE group_id = {ph} AND username = {ph}", (group_id, username))
            
            # Check remaining members
            c.execute(f"SELECT COUNT(*) as cnt FROM group_chat_members WHERE group_id = {ph}", (group_id,))
            count_row = c.fetchone()
            remaining = count_row["cnt"] if hasattr(count_row, "keys") else count_row[0]
            
            if remaining == 0:
                # Deactivate group if no members left
                c.execute(f"UPDATE group_chats SET is_active = 0 WHERE id = {ph}", (group_id,))
            elif username == creator:
                # Transfer admin to another member
                c.execute(f"""
                    UPDATE group_chat_members SET is_admin = 1
                    WHERE group_id = {ph} AND username = (
                        SELECT username FROM group_chat_members WHERE group_id = {ph} ORDER BY joined_at ASC LIMIT 1
                    )
                """, (group_id, group_id))
            
            conn.commit()
            
            return jsonify({"success": True})
            
    except Exception as e:
        logger.error(f"Error leaving group {group_id}: {e}")
        return jsonify({"success": False, "error": "Failed to leave group"}), 500
