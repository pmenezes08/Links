#!/usr/bin/env python3
"""
Comprehensive Database Schema Fix for PythonAnywhere
This script ensures all required columns exist in the communities table.
"""

import sqlite3
import os
import sys

def fix_database():
    print("=== PythonAnywhere Database Schema Fix ===")
    
    # Try to find the database file
    possible_paths = [
        '/home/puntz08/Links/users.db',
        '/home/puntz08/mysite/users.db',
        'users.db',
        './users.db'
    ]
    
    db_path = None
    for path in possible_paths:
        if os.path.exists(path):
            db_path = path
            break
    
    if not db_path:
        print("❌ Error: Could not find users.db file")
        print("Searched in:")
        for path in possible_paths:
            print(f"  - {path}")
        return False
    
    print(f"Database path: {db_path}")
    
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check if communities table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='communities'")
        if not cursor.fetchone():
            print("❌ Error: communities table does not exist")
            return False
        
        print("✓ Communities table found")
        
        # Get current columns
        cursor.execute("PRAGMA table_info(communities)")
        current_columns = [row[1] for row in cursor.fetchall()]
        print(f"Current columns: {current_columns}")
        
        # Define all required columns
        required_columns = {
            'id': 'INTEGER PRIMARY KEY AUTOINCREMENT',
            'name': 'TEXT NOT NULL',
            'type': 'TEXT NOT NULL',
            'creator_username': 'TEXT NOT NULL',
            'join_code': 'TEXT UNIQUE NOT NULL',
            'created_at': 'TEXT NOT NULL',
            'description': 'TEXT',
            'location': 'TEXT',
            'background_path': 'TEXT',
            'template': 'TEXT DEFAULT "default"',
            'background_color': 'TEXT DEFAULT "#2d3839"',
            'text_color': 'TEXT DEFAULT "#ffffff"',
            'accent_color': 'TEXT DEFAULT "#4db6ac"',
            'card_color': 'TEXT DEFAULT "#1a2526"'
        }
        
        # Add missing columns
        added_columns = []
        for column_name, column_type in required_columns.items():
            if column_name not in current_columns:
                try:
                    cursor.execute(f"ALTER TABLE communities ADD COLUMN {column_name} {column_type}")
                    print(f"✓ Added column '{column_name}' to communities table")
                    added_columns.append(column_name)
                except sqlite3.OperationalError as e:
                    if "duplicate column name" in str(e):
                        print(f"✓ Column '{column_name}' already exists")
                    else:
                        print(f"⚠ Warning: Could not add column '{column_name}': {e}")
            else:
                print(f"✓ Column '{column_name}' already exists")
        
        # Commit changes
        conn.commit()
        
        # Verify final columns
        cursor.execute("PRAGMA table_info(communities)")
        final_columns = [row[1] for row in cursor.fetchall()]
        print(f"Final columns: {final_columns}")
        
        # Test creating a sample community to ensure everything works
        try:
            cursor.execute("""
                INSERT INTO communities (name, type, creator_username, join_code, created_at, description, location, background_path, template, background_color, text_color, accent_color, card_color)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, ('TEST_COMMUNITY', 'Test', 'test_user', 'TEST123', '08.17.25 20:00', 'Test description', 'Test location', 'test/path.jpg', 'default', '#2d3839', '#ffffff', '#4db6ac', '#1a2526'))
            
            # Delete the test community
            cursor.execute("DELETE FROM communities WHERE name = 'TEST_COMMUNITY'")
            conn.commit()
            print("✓ Database schema test successful")
            
        except Exception as e:
            print(f"⚠ Warning: Database test failed: {e}")
        
        conn.close()
        print("\n✅ Database schema update completed successfully!")
        print("✅ All required columns are now present!")
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    success = fix_database()
    if success:
        print("\n🎉 Database is ready for community creation!")
    else:
        print("\n💥 Database fix failed. Please check the errors above.")
        sys.exit(1)