#!/usr/bin/env python3
"""
Script to check all calendar events in the database and their IDs.
Run this to see what events actually exist.
"""

import sqlite3
import os
from datetime import datetime

def check_calendar_events():
    """Check all calendar events and their details."""
    
    db_path = 'users.db'
    
    print("=" * 60)
    print("Calendar Events Database Check")
    print("=" * 60)
    print(f"Database path: {os.path.abspath(db_path)}")
    
    if not os.path.exists(db_path):
        print("\n❌ ERROR: Database file not found!")
        return
    
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        
        # Check if table exists
        c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='calendar_events'")
        if not c.fetchone():
            print("\n❌ Table 'calendar_events' does not exist!")
            print("Run: python3 check_and_fix_calendar_db.py")
            return
        
        # Get all events
        print("\n📅 All Calendar Events:")
        print("-" * 60)
        
        c.execute("""
            SELECT id, username, title, date, end_date, time, description, created_at 
            FROM calendar_events 
            ORDER BY id
        """)
        events = c.fetchall()
        
        if not events:
            print("No events found in the database.")
        else:
            print(f"Found {len(events)} event(s):\n")
            for event in events:
                print(f"ID: {event['id']}")
                print(f"  Title: {event['title']}")
                print(f"  User: {event['username']}")
                print(f"  Date: {event['date']}")
                if event['end_date']:
                    print(f"  End Date: {event['end_date']}")
                if event['time']:
                    print(f"  Time: {event['time']}")
                if event['description']:
                    print(f"  Description: {event['description'][:50]}...")
                print(f"  Created: {event['created_at']}")
                print("-" * 40)
        
        # Check for gaps in IDs
        print("\n🔍 ID Analysis:")
        if events:
            ids = [event['id'] for event in events]
            print(f"Event IDs in database: {ids}")
            
            # Check for gaps
            min_id = min(ids)
            max_id = max(ids)
            expected_ids = set(range(min_id, max_id + 1))
            actual_ids = set(ids)
            missing_ids = expected_ids - actual_ids
            
            if missing_ids:
                print(f"⚠️  Missing IDs (deleted events): {sorted(missing_ids)}")
            else:
                print("✅ No gaps in event IDs")
            
            # Get next ID that will be assigned
            c.execute("SELECT seq FROM sqlite_sequence WHERE name='calendar_events'")
            seq_result = c.fetchone()
            if seq_result:
                next_id = seq_result['seq'] + 1
                print(f"Next event will have ID: {next_id}")
        
        conn.close()
        print("\n" + "=" * 60)
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        if conn:
            conn.close()

if __name__ == "__main__":
    check_calendar_events()