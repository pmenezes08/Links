#!/usr/bin/env python3

import sqlite3
import os
from datetime import datetime

def init_community_database():
    """Initialize the database with community tables"""
    try:
        conn = sqlite3.connect('users.db')
        c = conn.cursor()
        
        print("Checking existing tables...")
        
        # Check what tables exist
        c.execute("SELECT name FROM sqlite_master WHERE type='table'")
        existing_tables = [row[0] for row in c.fetchall()]
        print(f"Existing tables: {existing_tables}")
        
        print("\nCreating community tables...")
        
        # Create communities table
        c.execute('''CREATE TABLE IF NOT EXISTS communities
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      name TEXT NOT NULL,
                      type TEXT NOT NULL,
                      creator_username TEXT NOT NULL,
                      join_code TEXT UNIQUE NOT NULL,
                      created_at TEXT NOT NULL)''')
        print("✅ Communities table created")
        
        # Create user_communities table
        c.execute('''CREATE TABLE IF NOT EXISTS user_communities
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      user_id INTEGER NOT NULL,
                      community_id INTEGER NOT NULL,
                      joined_at TEXT NOT NULL,
                      UNIQUE(user_id, community_id))''')
        print("✅ User_communities table created")
        
        # Create posts table if it doesn't exist
        if 'posts' not in existing_tables:
            c.execute('''CREATE TABLE IF NOT EXISTS posts
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
                          username TEXT NOT NULL,
                          content TEXT NOT NULL,
                          image_path TEXT,
                          timestamp TEXT NOT NULL,
                          community_id INTEGER)''')
            print("✅ Posts table created")
        else:
            # Add community_id to posts table if it doesn't exist
            try:
                c.execute("ALTER TABLE posts ADD COLUMN community_id INTEGER")
                print("✅ Added community_id to posts table")
            except sqlite3.OperationalError:
                print("ℹ️  community_id column already exists in posts table")
        
        # Create replies table if it doesn't exist
        if 'replies' not in existing_tables:
            c.execute('''CREATE TABLE IF NOT EXISTS replies
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
                          post_id INTEGER NOT NULL,
                          username TEXT NOT NULL,
                          content TEXT NOT NULL,
                          image_path TEXT,
                          timestamp TEXT NOT NULL,
                          community_id INTEGER,
                          FOREIGN KEY (post_id) REFERENCES posts(id),
                          FOREIGN KEY (username) REFERENCES users(username))''')
            print("✅ Replies table created")
        else:
            # Add community_id to replies table if it doesn't exist
            try:
                c.execute("ALTER TABLE replies ADD COLUMN community_id INTEGER")
                print("✅ Added community_id to replies table")
            except sqlite3.OperationalError:
                print("ℹ️  community_id column already exists in replies table")
        
        # Create reactions table if it doesn't exist
        if 'reactions' not in existing_tables:
            c.execute('''CREATE TABLE IF NOT EXISTS reactions
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
                          post_id INTEGER NOT NULL,
                          username TEXT NOT NULL,
                          reaction_type TEXT NOT NULL,
                          FOREIGN KEY (post_id) REFERENCES posts(id),
                          FOREIGN KEY (username) REFERENCES users(username),
                          UNIQUE(post_id, username))''')
            print("✅ Reactions table created")
        
        # Create reply_reactions table if it doesn't exist
        if 'reply_reactions' not in existing_tables:
            c.execute('''CREATE TABLE IF NOT EXISTS reply_reactions
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
                          reply_id INTEGER NOT NULL,
                          username TEXT NOT NULL,
                          reaction_type TEXT NOT NULL,
                          FOREIGN KEY (reply_id) REFERENCES replies(id),
                          FOREIGN KEY (username) REFERENCES users(username),
                          UNIQUE(reply_id, username))''')
            print("✅ Reply_reactions table created")
        
        # Create indexes
        c.execute("CREATE INDEX IF NOT EXISTS idx_communities_join_code ON communities(join_code)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_communities_creator ON communities(creator_username)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_user_communities_user_id ON user_communities(user_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_user_communities_community_id ON user_communities(community_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_posts_community_id ON posts(community_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_replies_community_id ON replies(community_id)")
        print("✅ Community indexes created")
        
        conn.commit()
        conn.close()
        
        print("🎉 Community database initialization completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Error initializing community database: {e}")
        return False

def verify_tables():
    """Verify that all community tables exist"""
    try:
        conn = sqlite3.connect('users.db')
        c = conn.cursor()
        
        # Check if tables exist
        c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('communities', 'user_communities', 'posts', 'replies')")
        tables = [row[0] for row in c.fetchall()]
        
        print(f"Found required tables: {tables}")
        
        # Check if columns exist
        c.execute("PRAGMA table_info(posts)")
        posts_columns = [row[1] for row in c.fetchall()]
        print(f"Posts table columns: {posts_columns}")
        
        c.execute("PRAGMA table_info(replies)")
        replies_columns = [row[1] for row in c.fetchall()]
        print(f"Replies table columns: {replies_columns}")
        
        conn.close()
        
        required_tables = ['communities', 'user_communities', 'posts', 'replies']
        return all(table in tables for table in required_tables)
        
    except Exception as e:
        print(f"❌ Error verifying tables: {e}")
        return False

if __name__ == "__main__":
    print("Initializing Community Database...")
    print("=" * 50)
    
    success = init_community_database()
    
    if success:
        print("\nVerifying tables...")
        print("=" * 50)
        verified = verify_tables()
        
        if verified:
            print("✅ Community system is ready to use!")
        else:
            print("❌ Table verification failed")
    else:
        print("❌ Database initialization failed")