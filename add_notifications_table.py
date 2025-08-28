#!/usr/bin/env python3
"""Add notifications table for community post interactions"""

import sqlite3
import os

def add_notifications_table():
    """Add notifications table to track user interactions"""
    
    db_path = os.path.join(os.path.dirname(__file__), 'users.db')
    
    try:
        with sqlite3.connect(db_path) as conn:
            c = conn.cursor()
            
            # Create notifications table
            c.execute('''
                CREATE TABLE IF NOT EXISTS notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    from_user TEXT NOT NULL,
                    type TEXT NOT NULL,
                    post_id INTEGER,
                    community_id INTEGER,
                    message TEXT,
                    is_read INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(username),
                    FOREIGN KEY (from_user) REFERENCES users(username),
                    FOREIGN KEY (post_id) REFERENCES posts(id),
                    FOREIGN KEY (community_id) REFERENCES communities(id)
                )
            ''')
            
            # Create index for faster queries
            c.execute('''
                CREATE INDEX IF NOT EXISTS idx_notifications_user 
                ON notifications(user_id, is_read, created_at DESC)
            ''')
            
            conn.commit()
            print("✅ notifications table created successfully!")
            
            # Verify the table was created
            c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'")
            if c.fetchone():
                print("✅ Table verified in database")
                
                # Show table structure
                c.execute("PRAGMA table_info(notifications)")
                columns = c.fetchall()
                print("\n📋 Table structure:")
                for col in columns:
                    print(f"  - {col[1]} ({col[2]})")
            else:
                print("❌ Table creation failed")
                
    except sqlite3.Error as e:
        print(f"❌ Database error: {e}")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")

if __name__ == "__main__":
    add_notifications_table()