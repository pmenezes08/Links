#!/usr/bin/env python3
"""
Script to check and fix calendar_events table in the database.
Run this on PythonAnywhere to diagnose and fix the issue.
"""

import sqlite3
import os
import sys

def check_and_fix_calendar_table():
    """Check for calendar_events table and create if missing."""
    
    # Database file path
    db_path = 'users.db'
    
    print("=" * 60)
    print("Calendar Database Check and Fix Script")
    print("=" * 60)
    print(f"\n1. Database path: {os.path.abspath(db_path)}")
    print(f"2. Database exists: {os.path.exists(db_path)}")
    
    if not os.path.exists(db_path):
        print("\n❌ ERROR: Database file not found!")
        print("Please ensure you're running this script in the correct directory.")
        return False
    
    try:
        # Connect to database
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        
        # Check existing tables
        print("\n3. Checking existing tables...")
        c.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = c.fetchall()
        table_names = [table[0] for table in tables]
        
        print(f"   Found {len(table_names)} tables:")
        for table in table_names:
            print(f"   - {table}")
        
        # Check if calendar_events exists
        if 'calendar_events' in table_names:
            print("\n✅ Table 'calendar_events' already exists!")
            
            # Show table structure
            c.execute("PRAGMA table_info(calendar_events)")
            columns = c.fetchall()
            print("\n   Table structure:")
            for col in columns:
                print(f"   - {col[1]} ({col[2]})")
                
            # Count existing events
            c.execute("SELECT COUNT(*) FROM calendar_events")
            count = c.fetchone()[0]
            print(f"\n   Number of events in table: {count}")
            
        else:
            print("\n⚠️  Table 'calendar_events' does not exist!")
            print("\n4. Creating calendar_events table...")
            
            # Create the table
            c.execute('''CREATE TABLE calendar_events
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
                          username TEXT NOT NULL,
                          title TEXT NOT NULL,
                          date TEXT NOT NULL,
                          time TEXT,
                          description TEXT,
                          created_at TEXT NOT NULL,
                          FOREIGN KEY (username) REFERENCES users(username))''')
            
            # Create index
            c.execute('''CREATE INDEX IF NOT EXISTS idx_calendar_events_date 
                         ON calendar_events(date)''')
            
            conn.commit()
            print("   ✅ Table created successfully!")
            
            # Verify creation
            c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='calendar_events'")
            if c.fetchone():
                print("   ✅ Table verified in database!")
                
                # Show the new table structure
                c.execute("PRAGMA table_info(calendar_events)")
                columns = c.fetchall()
                print("\n   New table structure:")
                for col in columns:
                    print(f"   - {col[1]} ({col[2]})")
            else:
                print("   ❌ ERROR: Table creation failed!")
                return False
        
        # Test the table with a query
        print("\n5. Testing table with SELECT query...")
        try:
            c.execute("SELECT * FROM calendar_events LIMIT 1")
            print("   ✅ Table is accessible and working!")
        except sqlite3.Error as e:
            print(f"   ❌ ERROR accessing table: {e}")
            return False
        
        conn.close()
        
        print("\n" + "=" * 60)
        print("✅ Database check complete! Calendar table is ready.")
        print("=" * 60)
        return True
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        if conn:
            conn.close()
        return False

if __name__ == "__main__":
    success = check_and_fix_calendar_table()
    
    if success:
        print("\n✅ SUCCESS: Your calendar feature should now work!")
        print("Please reload your web app on PythonAnywhere.")
    else:
        print("\n❌ FAILED: Please check the error messages above.")
        print("You may need to check your database path or permissions.")
        sys.exit(1)