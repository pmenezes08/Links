#!/usr/bin/env python3
"""Test notification creation"""

import sqlite3
import os
from datetime import datetime

def create_test_notification():
    """Create a test notification"""
    
    db_path = os.path.join(os.path.dirname(__file__), 'users.db')
    
    try:
        with sqlite3.connect(db_path) as conn:
            c = conn.cursor()
            
            # Create a test notification for migmac from admin
            c.execute("""
                INSERT INTO notifications (user_id, from_user, type, post_id, community_id, message, is_read, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, ('migmac', 'admin', 'reaction', 1, 1, 'admin reacted to your post', 0, datetime.now().isoformat()))
            
            conn.commit()
            print("✅ Test notification created for migmac from admin")
            
            # Verify it was created
            c.execute("SELECT * FROM notifications WHERE user_id = 'migmac' ORDER BY created_at DESC LIMIT 1")
            notif = c.fetchone()
            if notif:
                print(f"Notification ID: {notif[0]}")
                print(f"To: {notif[1]}")
                print(f"From: {notif[2]}")
                print(f"Message: {notif[6]}")
            
    except sqlite3.Error as e:
        print(f"❌ Database error: {e}")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")

if __name__ == "__main__":
    create_test_notification()