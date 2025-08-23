#!/usr/bin/env python3
"""
Database initialization script for PythonAnywhere deployment.
This script creates all necessary tables for the C.Point application.
"""

import sqlite3
import os
from datetime import datetime

def init_database():
    """Initialize the database with all required tables."""
    
    # Database file path
    db_path = 'users.db'
    
    print(f"Initializing database at: {os.path.abspath(db_path)}")
    
    try:
        # Connect to database
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        
        # Create users table
        print("Creating users table...")
        c.execute('''CREATE TABLE IF NOT EXISTS users
                     (username TEXT PRIMARY KEY, subscription TEXT, password TEXT,
                      gender TEXT, weight REAL, height REAL, blood_type TEXT, muscle_mass REAL, bmi REAL,
                      nutrition_goal TEXT, nutrition_restrictions TEXT)''')
        
        # Insert admin user
        print("Inserting admin user...")
        c.execute("INSERT OR IGNORE INTO users (username, subscription, password) VALUES (?, ?, ?)",
                  ('admin', 'premium', '12345'))
        
        # Create posts table
        print("Creating posts table...")
        c.execute('''CREATE TABLE IF NOT EXISTS posts
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      username TEXT NOT NULL,
                      content TEXT NOT NULL,
                      image_path TEXT,
                      timestamp TEXT NOT NULL,
                      community_id INTEGER,
                      FOREIGN KEY (username) REFERENCES users(username))''')
        
        # Create replies table
        print("Creating replies table...")
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
        
        # Create reactions table
        print("Creating reactions table...")
        c.execute('''CREATE TABLE IF NOT EXISTS reactions
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      post_id INTEGER NOT NULL,
                      username TEXT NOT NULL,
                      reaction_type TEXT NOT NULL,
                      FOREIGN KEY (post_id) REFERENCES posts(id),
                      FOREIGN KEY (username) REFERENCES users(username),
                      UNIQUE(post_id, username))''')
        
        # Create reply_reactions table
        print("Creating reply_reactions table...")
        c.execute('''CREATE TABLE IF NOT EXISTS reply_reactions
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      reply_id INTEGER NOT NULL,
                      username TEXT NOT NULL,
                      reaction_type TEXT NOT NULL,
                      FOREIGN KEY (reply_id) REFERENCES replies(id),
                      FOREIGN KEY (username) REFERENCES users(username),
                      UNIQUE(reply_id, username))''')
        
        # Create communities table
        print("Creating communities table...")
        c.execute('''CREATE TABLE IF NOT EXISTS communities
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      name TEXT NOT NULL,
                      type TEXT NOT NULL,
                      creator_username TEXT NOT NULL,
                      join_code TEXT UNIQUE NOT NULL,
                      created_at TEXT NOT NULL,
                      FOREIGN KEY (creator_username) REFERENCES users(username))''')
        
        # Create user_communities table
        print("Creating user_communities table...")
        c.execute('''CREATE TABLE IF NOT EXISTS user_communities
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      user_id INTEGER NOT NULL,
                      community_id INTEGER NOT NULL,
                      joined_at TEXT NOT NULL,
                      FOREIGN KEY (user_id) REFERENCES users(id),
                      FOREIGN KEY (community_id) REFERENCES communities(id),
                      UNIQUE(user_id, community_id))''')
        
        # Create api_usage table
        print("Creating api_usage table...")
        c.execute('''CREATE TABLE IF NOT EXISTS api_usage
                     (username TEXT, date TEXT, count INTEGER,
                      PRIMARY KEY (username, date))''')
        
        # Create saved_data table
        print("Creating saved_data table...")
        c.execute('''CREATE TABLE IF NOT EXISTS saved_data
                     (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, type TEXT, data TEXT, timestamp TEXT)''')
        
        # Create messages table
        print("Creating messages table...")
        c.execute('''CREATE TABLE IF NOT EXISTS messages
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      sender TEXT NOT NULL,
                      receiver TEXT NOT NULL,
                      message TEXT NOT NULL,
                      timestamp TEXT NOT NULL,
                      is_read INTEGER DEFAULT 0,
                      FOREIGN KEY (sender) REFERENCES users(username),
                      FOREIGN KEY (receiver) REFERENCES users(username))''')
        
        # Create calendar_events table
        print("Creating calendar_events table...")
        c.execute('''CREATE TABLE IF NOT EXISTS calendar_events
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      username TEXT NOT NULL,
                      title TEXT NOT NULL,
                      date TEXT NOT NULL,
                      time TEXT,
                      description TEXT,
                      created_at TEXT NOT NULL,
                      FOREIGN KEY (username) REFERENCES users(username))''')
        
        # Create index on date for faster queries
        c.execute('''CREATE INDEX IF NOT EXISTS idx_calendar_events_date 
                     ON calendar_events(date)''')
        
        # Commit all changes
        conn.commit()
        
        # Verify tables were created
        print("\nVerifying tables...")
        c.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = c.fetchall()
        table_names = [table[0] for table in tables]
        print(f"Created tables: {table_names}")
        
        # Verify admin user exists
        print("\nVerifying admin user...")
        c.execute("SELECT username, subscription FROM users WHERE username='admin'")
        admin_user = c.fetchone()
        if admin_user:
            print(f"Admin user: {admin_user}")
        else:
            print("ERROR: Admin user not found!")
        
        conn.close()
        print(f"\n✅ Database initialization completed successfully!")
        print(f"Database file: {os.path.abspath(db_path)}")
        
    except Exception as e:
        print(f"❌ Error initializing database: {e}")
        if conn:
            conn.close()
        raise

if __name__ == "__main__":
    init_database()