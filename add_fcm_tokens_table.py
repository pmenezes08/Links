#!/usr/bin/env python3
"""Create fcm_tokens table for Firebase Cloud Messaging."""

import os
import sys

# Add project to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.services.database import get_db_connection, USE_MYSQL

def create_fcm_tokens_table():
    """Create fcm_tokens table."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if USE_MYSQL:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS fcm_tokens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                token VARCHAR(255) UNIQUE NOT NULL,
                username VARCHAR(100),
                platform VARCHAR(20) DEFAULT 'ios',
                device_name VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                is_active TINYINT(1) DEFAULT 1,
                INDEX idx_username (username),
                INDEX idx_active (is_active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)
    else:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS fcm_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT UNIQUE NOT NULL,
                username TEXT,
                platform TEXT DEFAULT 'ios',
                device_name TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active INTEGER DEFAULT 1
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_fcm_username ON fcm_tokens(username)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_fcm_active ON fcm_tokens(is_active)")
    
    conn.commit()
    cursor.close()
    conn.close()
    
    print("✅ fcm_tokens table created successfully")


if __name__ == '__main__':
    create_fcm_tokens_table()
