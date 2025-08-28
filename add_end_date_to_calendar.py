#!/usr/bin/env python3
"""
Migration script to add end_date column to calendar_events table.
Run this after pulling the latest code.
"""

import sqlite3
import os

def add_end_date_column():
    """Add end_date column to calendar_events table."""
    
    db_path = 'users.db'
    
    print(f"Adding end_date column to calendar_events table...")
    print(f"Database path: {os.path.abspath(db_path)}")
    
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        
        # Check if column already exists
        c.execute("PRAGMA table_info(calendar_events)")
        columns = c.fetchall()
        column_names = [col[1] for col in columns]
        
        if 'end_date' in column_names:
            print("✅ Column 'end_date' already exists!")
        else:
            # Add the column
            c.execute("ALTER TABLE calendar_events ADD COLUMN end_date TEXT")
            conn.commit()
            print("✅ Column 'end_date' added successfully!")
        
        # Verify
        c.execute("PRAGMA table_info(calendar_events)")
        columns = c.fetchall()
        print("\nUpdated table structure:")
        for col in columns:
            print(f"  - {col[1]} ({col[2]})")
        
        conn.close()
        print("\n✅ Migration complete!")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        if conn:
            conn.close()

if __name__ == "__main__":
    add_end_date_column()