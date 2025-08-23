#!/usr/bin/env python3
import sqlite3
import os

def add_links_table():
    """Add useful_links table to the database"""
    db_path = os.path.join(os.path.dirname(__file__), 'users.db')
    
    try:
        with sqlite3.connect(db_path) as conn:
            c = conn.cursor()
            
            # Create useful_links table
            c.execute('''
                CREATE TABLE IF NOT EXISTS useful_links (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    community_id INTEGER,
                    username TEXT NOT NULL,
                    url TEXT NOT NULL,
                    description TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (username) REFERENCES users(username),
                    FOREIGN KEY (community_id) REFERENCES communities(id)
                )
            ''')
            
            conn.commit()
            print("✅ useful_links table created successfully!")
            
            # Verify the table was created
            c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='useful_links'")
            if c.fetchone():
                print("✅ Table verified in database")
                
                # Show table structure
                c.execute("PRAGMA table_info(useful_links)")
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
    add_links_table()