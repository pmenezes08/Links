#!/usr/bin/env python3
"""Check notifications in the database"""

import sqlite3
import os

def check_notifications():
    """Check all notifications in the database"""
    
    db_path = os.path.join(os.path.dirname(__file__), 'users.db')
    
    try:
        with sqlite3.connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            
            # Get all notifications
            c.execute("""
                SELECT * FROM notifications 
                ORDER BY created_at DESC 
                LIMIT 10
            """)
            
            notifications = c.fetchall()
            
            if notifications:
                print("\n📬 Recent Notifications:")
                print("-" * 80)
                for notif in notifications:
                    print(f"ID: {notif['id']}")
                    print(f"To: @{notif['user_id']}")
                    print(f"From: @{notif['from_user']}")
                    print(f"Type: {notif['type']}")
                    print(f"Message: {notif['message']}")
                    print(f"Read: {'Yes' if notif['is_read'] else 'No'}")
                    print(f"Time: {notif['created_at']}")
                    print("-" * 80)
            else:
                print("No notifications found")
                
    except sqlite3.Error as e:
        print(f"❌ Database error: {e}")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")

if __name__ == "__main__":
    check_notifications()