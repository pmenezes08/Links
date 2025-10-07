#!/usr/bin/env python3
"""
Script to fix calendar_events table schema for MySQL.
Run this on PythonAnywhere to add missing columns.
"""

import os
import sys

def fix_calendar_events_table():
    """Add missing columns to calendar_events table"""
    
    print("=" * 60)
    print("Calendar Events Table Fix Script")
    print("=" * 60)
    
    # Check if using MySQL
    use_mysql = os.environ.get('USE_MYSQL', '').lower() == 'true'
    
    if not use_mysql:
        print("\n⚠️  USE_MYSQL is not set to 'true'")
        print("This script is for MySQL databases only.")
        print("For SQLite, the table should already have the correct schema.")
        return False
    
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        # Get MySQL credentials from environment
        host = os.environ.get('MYSQL_HOST')
        user = os.environ.get('MYSQL_USER')
        password = os.environ.get('MYSQL_PASSWORD')
        database = os.environ.get('MYSQL_DB')
        
        if not all([host, user, password, database]):
            print("\n❌ ERROR: Missing MySQL environment variables")
            print("Required: MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB")
            return False
        
        print(f"\n1. Connecting to MySQL database: {database}")
        print(f"   Host: {host}")
        print(f"   User: {user}")
        
        # Connect to database
        conn = pymysql.connect(
            host=host,
            user=user,
            password=password,
            database=database,
            charset='utf8mb4',
            cursorclass=DictCursor
        )
        
        c = conn.cursor()
        print("   ✅ Connected successfully!")
        
        # Check if table exists
        print("\n2. Checking if calendar_events table exists...")
        c.execute("SHOW TABLES LIKE 'calendar_events'")
        if not c.fetchone():
            print("   ⚠️  Table doesn't exist. Creating it...")
            c.execute("""
                CREATE TABLE calendar_events (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    username VARCHAR(191) NOT NULL,
                    title TEXT NOT NULL,
                    date TEXT NOT NULL,
                    end_date TEXT,
                    time TEXT,
                    start_time TEXT,
                    end_time TEXT,
                    description TEXT,
                    location TEXT,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    community_id INTEGER,
                    FOREIGN KEY (username) REFERENCES users(username)
                )
            """)
            conn.commit()
            print("   ✅ Table created successfully!")
            return True
        
        print("   ✅ Table exists")
        
        # Get current columns
        print("\n3. Checking current table structure...")
        c.execute("SHOW COLUMNS FROM calendar_events")
        existing_columns = {row['Field']: row for row in c.fetchall()}
        
        print(f"   Found {len(existing_columns)} existing columns:")
        for col in existing_columns.keys():
            print(f"   - {col}")
        
        # Define required columns
        required_columns = {
            'username': 'VARCHAR(191) NOT NULL DEFAULT ""',
            'date': 'TEXT NOT NULL',
            'end_date': 'TEXT',
            'time': 'TEXT',
            'created_at': 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
            'community_id': 'INTEGER'
        }
        
        # Add missing columns
        print("\n4. Adding missing columns...")
        columns_added = 0
        
        for col_name, col_def in required_columns.items():
            if col_name not in existing_columns:
                try:
                    print(f"   Adding column: {col_name}")
                    c.execute(f"ALTER TABLE calendar_events ADD COLUMN {col_name} {col_def}")
                    conn.commit()
                    print(f"   ✅ Added {col_name}")
                    columns_added += 1
                except Exception as e:
                    print(f"   ⚠️  Could not add {col_name}: {e}")
            else:
                print(f"   ✓ Column {col_name} already exists")
        
        # Verify final structure
        print("\n5. Verifying final table structure...")
        c.execute("SHOW COLUMNS FROM calendar_events")
        final_columns = c.fetchall()
        
        print(f"   Final table has {len(final_columns)} columns:")
        for col in final_columns:
            print(f"   - {col['Field']} ({col['Type']})")
        
        conn.close()
        
        print("\n" + "=" * 60)
        if columns_added > 0:
            print(f"✅ SUCCESS: Added {columns_added} column(s) to calendar_events table!")
        else:
            print("✅ SUCCESS: Table already has all required columns!")
        print("=" * 60)
        print("\nYou can now reload your web app on PythonAnywhere.")
        return True
        
    except ImportError:
        print("\n❌ ERROR: pymysql is not installed")
        print("Install it with: pip install pymysql")
        return False
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = fix_calendar_events_table()
    sys.exit(0 if success else 1)
