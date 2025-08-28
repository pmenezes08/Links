#!/usr/bin/env python3
"""
Script to add calendar_events table to the existing database.
Run this on PythonAnywhere after pulling the latest code.
"""

import sqlite3
import os
from datetime import datetime

def add_calendar_table():
    """Add calendar_events table to the existing database."""
    
    # Database file path
    db_path = 'users.db'
    
    print(f"Adding calendar_events table to: {os.path.abspath(db_path)}")
    
    try:
        # Connect to database
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        
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
        
        # Commit changes
        conn.commit()
        
        # Verify table was created
        print("\nVerifying table...")
        c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='calendar_events'")
        table = c.fetchone()
        if table:
            print(f"✅ Table 'calendar_events' created successfully!")
            
            # Check columns
            c.execute("PRAGMA table_info(calendar_events)")
            columns = c.fetchall()
            print("\nTable columns:")
            for col in columns:
                print(f"  - {col[1]} ({col[2]})")
        else:
            print("❌ Error: Table was not created!")
        
        conn.close()
        
    except Exception as e:
        print(f"❌ Error adding calendar table: {e}")
        if conn:
            conn.close()
        raise

if __name__ == "__main__":
    add_calendar_table()