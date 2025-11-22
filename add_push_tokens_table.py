#!/usr/bin/env python3
"""
Add push_tokens table to store native iOS/Android push notification tokens
"""

import os
import sys

# Add project to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.services.database import USE_MYSQL, get_db_connection

def add_push_tokens_table():
    """Create push_tokens table for native push notifications"""
    print("=" * 60)
    print("Creating push_tokens table...")
    print("=" * 60)
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        if USE_MYSQL:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS push_tokens (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(150) NOT NULL,
                    token TEXT NOT NULL,
                    platform VARCHAR(20) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    is_active BOOLEAN DEFAULT TRUE,
                    INDEX idx_push_tokens_username (username),
                    INDEX idx_push_tokens_platform (platform),
                    INDEX idx_push_tokens_active (is_active),
                    UNIQUE KEY unique_user_platform (username, platform)
                )
            """)
        else:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS push_tokens (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    token TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    is_active INTEGER DEFAULT 1
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_push_tokens_username ON push_tokens(username)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_push_tokens_platform ON push_tokens(platform)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_push_tokens_active ON push_tokens(is_active)")
            cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS unique_user_platform ON push_tokens(username, platform)")
        
        conn.commit()
        print("✅ push_tokens table created successfully!")
        
        # Show table structure
        if USE_MYSQL:
            cursor.execute("DESCRIBE push_tokens")
        else:
            cursor.execute("PRAGMA table_info(push_tokens)")
        
        print("\n📊 Table structure:")
        for row in cursor.fetchall():
            print(f"   {row}")
        
    except Exception as e:
        print(f"❌ Error creating push_tokens table: {e}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()
    
    print("=" * 60)

if __name__ == '__main__':
    add_push_tokens_table()
