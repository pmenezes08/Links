#!/usr/bin/env python3
"""
Standalone script to fix the communities table schema
Adds missing columns: description, location, background_path
"""

import sqlite3
import os
import sys

def fix_communities_table():
    """Add missing columns to communities table"""
    try:
        # Get database path
        script_dir = os.path.dirname(os.path.abspath(__file__))
        db_path = os.path.join(script_dir, 'users.db')
        
        print(f"Database path: {db_path}")
        
        if not os.path.exists(db_path):
            print("ERROR: Database file not found!")
            return False
        
        # Connect to database
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        
        # Check if communities table exists
        c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='communities'")
        if not c.fetchone():
            print("ERROR: Communities table does not exist!")
            conn.close()
            return False
        
        print("Communities table found. Checking for missing columns...")
        
        # Get current columns
        c.execute("PRAGMA table_info(communities)")
        columns = [row[1] for row in c.fetchall()]
        print(f"Current columns: {columns}")
        
        # Columns to add
        columns_to_add = [
            ('description', 'TEXT'),
            ('location', 'TEXT'),
            ('background_path', 'TEXT')
        ]
        
        # Add missing columns
        for column_name, column_type in columns_to_add:
            if column_name not in columns:
                try:
                    c.execute(f"ALTER TABLE communities ADD COLUMN {column_name} {column_type}")
                    print(f"✓ Added column '{column_name}' to communities table")
                except sqlite3.OperationalError as e:
                    if "duplicate column name" in str(e):
                        print(f"⚠ Column '{column_name}' already exists")
                    else:
                        print(f"✗ Error adding column '{column_name}': {e}")
            else:
                print(f"✓ Column '{column_name}' already exists")
        
        # Commit changes
        conn.commit()
        
        # Verify columns were added
        c.execute("PRAGMA table_info(communities)")
        final_columns = [row[1] for row in c.fetchall()]
        print(f"Final columns: {final_columns}")
        
        conn.close()
        print("Database schema update completed successfully!")
        return True
        
    except Exception as e:
        print(f"ERROR: {e}")
        return False

if __name__ == "__main__":
    print("=== Community Database Schema Fix ===")
    success = fix_communities_table()
    if success:
        print("✓ Database fixed successfully!")
        sys.exit(0)
    else:
        print("✗ Database fix failed!")
        sys.exit(1)