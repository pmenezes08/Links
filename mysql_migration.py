#!/usr/bin/env python3
"""
MySQL Migration Script for PythonAnywhere
This script migrates the database from SQLite to MySQL compatibility
"""

import mysql.connector
import os
import sys
from datetime import datetime

def get_db_connection():
    """Get database connection using environment variables or defaults"""
    try:
        # Try to get connection details from environment or use defaults
        host = os.getenv('DB_HOST', 'localhost')
        user = os.getenv('DB_USER', 'root')
        password = os.getenv('DB_PASSWORD', '')
        database = os.getenv('DB_NAME', 'bodybuilding_app')
        
        conn = mysql.connector.connect(
            host=host,
            user=user,
            password=password,
            database=database,
            charset='utf8mb4',
            collation='utf8mb4_unicode_ci',
            autocommit=False
        )
        return conn
    except Exception as e:
        print(f"Error connecting to database: {e}")
        return None

def run_migration():
    """Run the complete database migration"""
    conn = get_db_connection()
    if not conn:
        return False
        
    cursor = conn.cursor()
    
    try:
        print("Starting MySQL migration...")
        
        # 1. Fix users table - ensure it has id column
        print("1. Fixing users table...")
        try:
            cursor.execute("SHOW COLUMNS FROM users LIKE 'id'")
            if not cursor.fetchone():
                print("   Adding id column to users table...")
                cursor.execute("ALTER TABLE users ADD COLUMN id INTEGER PRIMARY KEY AUTO_INCREMENT FIRST")
                conn.commit()
                print("   ✓ Added id column to users table")
        except Exception as e:
            print(f"   Warning: Could not fix users table: {e}")
        
        # 2. Fix user_communities table - ensure it has user_id column
        print("2. Fixing user_communities table...")
        try:
            cursor.execute("SHOW COLUMNS FROM user_communities LIKE 'user_id'")
            if not cursor.fetchone():
                print("   user_id column missing, recreating user_communities table...")
                cursor.execute("DROP TABLE IF EXISTS user_communities")
                cursor.execute('''CREATE TABLE user_communities (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    user_id INTEGER NOT NULL,
                    community_id INTEGER NOT NULL,
                    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (community_id) REFERENCES communities(id),
                    UNIQUE(user_id, community_id)
                )''')
                conn.commit()
                print("   ✓ Recreated user_communities table with user_id column")
        except Exception as e:
            print(f"   Warning: Could not fix user_communities table: {e}")
        
        # 3. Fix notifications table - ensure it has created_at column
        print("3. Fixing notifications table...")
        try:
            cursor.execute("SHOW COLUMNS FROM notifications LIKE 'created_at'")
            if not cursor.fetchone():
                print("   Adding created_at column to notifications table...")
                cursor.execute("ALTER TABLE notifications ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
                conn.commit()
                print("   ✓ Added created_at column to notifications table")
        except Exception as e:
            print(f"   Warning: Could not fix notifications table: {e}")
        
        # 4. Create missing user_login_history table
        print("4. Creating user_login_history table...")
        try:
            cursor.execute('''CREATE TABLE IF NOT EXISTS user_login_history (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                username VARCHAR(255) NOT NULL,
                login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ip_address VARCHAR(45),
                user_agent TEXT,
                FOREIGN KEY (username) REFERENCES users (username)
            )''')
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_login_username ON user_login_history(username)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_login_time ON user_login_history(login_time)")
            conn.commit()
            print("   ✓ Created user_login_history table")
        except Exception as e:
            print(f"   Warning: Could not create user_login_history table: {e}")
        
        # 5. Create other missing tables that might be needed
        print("5. Creating other essential tables...")
        
        # Push subscriptions table
        try:
            cursor.execute('''CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                username VARCHAR(255) NOT NULL,
                endpoint TEXT NOT NULL UNIQUE,
                p256dh TEXT,
                auth TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )''')
            conn.commit()
            print("   ✓ Created push_subscriptions table")
        except Exception as e:
            print(f"   Warning: Could not create push_subscriptions table: {e}")
        
        # Remember tokens table
        try:
            cursor.execute('''CREATE TABLE IF NOT EXISTS remember_tokens (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                username VARCHAR(255) NOT NULL,
                token_hash TEXT NOT NULL,
                created_at TIMESTAMP NOT NULL,
                expires_at TIMESTAMP NOT NULL
            )''')
            conn.commit()
            print("   ✓ Created remember_tokens table")
        except Exception as e:
            print(f"   Warning: Could not create remember_tokens table: {e}")
        
        print("\n✅ Migration completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        conn.rollback()
        return False
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    print("MySQL Migration Script")
    print("=" * 50)
    
    if len(sys.argv) > 1 and sys.argv[1] == "--help":
        print("Usage: python mysql_migration.py")
        print("\nEnvironment variables:")
        print("  DB_HOST     - Database host (default: localhost)")
        print("  DB_USER     - Database user (default: root)")
        print("  DB_PASSWORD - Database password (default: empty)")
        print("  DB_NAME     - Database name (default: bodybuilding_app)")
        sys.exit(0)
    
    success = run_migration()
    sys.exit(0 if success else 1)