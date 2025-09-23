#!/usr/bin/env python3
"""
Migration script to add end_time column and rename time to start_time in calendar_events table.
Run this after pulling the latest code.
"""

import sqlite3
import os

def add_time_columns():
    """Add end_time column and rename time to start_time."""
    
    db_path = 'users.db'
    
    print(f"Updating time columns in calendar_events table...")
    print(f"Database path: {os.path.abspath(db_path)}")
    
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        
        # Check current columns
        c.execute("PRAGMA table_info(calendar_events)")
        columns = c.fetchall()
        column_names = [col[1] for col in columns]
        
        # Add end_time if it doesn't exist
        if 'end_time' not in column_names:
            c.execute("ALTER TABLE calendar_events ADD COLUMN end_time TEXT")
            print("✅ Column 'end_time' added successfully!")
        else:
            print("✅ Column 'end_time' already exists!")
        
        # Add start_time if it doesn't exist (we'll keep both for compatibility)
        if 'start_time' not in column_names:
            c.execute("ALTER TABLE calendar_events ADD COLUMN start_time TEXT")
            # Copy existing time values to start_time
            c.execute("UPDATE calendar_events SET start_time = time WHERE time IS NOT NULL")
            print("✅ Column 'start_time' added and populated from 'time' column!")
        else:
            print("✅ Column 'start_time' already exists!")
        
        conn.commit()
        
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
    add_time_columns()