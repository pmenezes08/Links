#!/usr/bin/env python3
"""Add user_profiles table for public profile information"""

import sqlite3
import os

def add_user_profiles_table():
    """Add user_profiles table to the database"""
    
    db_path = os.path.join(os.path.dirname(__file__), 'users.db')
    
    try:
        with sqlite3.connect(db_path) as conn:
            c = conn.cursor()
            
            # Create user_profiles table
            c.execute('''
                CREATE TABLE IF NOT EXISTS user_profiles (
                    username TEXT PRIMARY KEY,
                    display_name TEXT,
                    bio TEXT,
                    location TEXT,
                    website TEXT,
                    instagram TEXT,
                    twitter TEXT,
                    profile_picture TEXT,
                    cover_photo TEXT,
                    is_public INTEGER DEFAULT 1,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (username) REFERENCES users(username)
                )
            ''')
            
            conn.commit()
            print("✅ user_profiles table created successfully!")
            
            # Verify the table was created
            c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user_profiles'")
            if c.fetchone():
                print("✅ Table verified in database")
                
                # Show table structure
                c.execute("PRAGMA table_info(user_profiles)")
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
    add_user_profiles_table()