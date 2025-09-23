#!/usr/bin/env python3
"""
Quick fix to add community_id column to replies table
"""

import os
import sys

def fix_replies_table():
    """Add community_id column to replies table if missing"""
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        # Get MySQL credentials
        host = os.environ.get('MYSQL_HOST', 'puntz08.mysql.pythonanywhere-services.com')
        user = os.environ.get('MYSQL_USER', 'puntz08')
        password = os.environ.get('MYSQL_PASSWORD')
        database = os.environ.get('MYSQL_DATABASE', 'puntz08$C-Point')
        
        if not password:
            print("❌ Error: MYSQL_PASSWORD environment variable is required!")
            return False
        
        # Connect to MySQL
        conn = pymysql.connect(
            host=host,
            user=user,
            password=password,
            database=database,
            charset='utf8mb4',
            cursorclass=DictCursor,
            autocommit=False
        )
        
        cursor = conn.cursor()
        print("✅ Connected to MySQL successfully!")
        
        # Check if replies table has community_id column
        print("Checking replies table structure...")
        cursor.execute("SHOW COLUMNS FROM replies LIKE 'community_id'")
        if cursor.fetchone():
            print("✅ replies table already has community_id column")
            return True
        
        print("Adding community_id column to replies table...")
        cursor.execute("ALTER TABLE replies ADD COLUMN community_id INTEGER")
        conn.commit()
        
        print("✅ Successfully added community_id column to replies table")
        
        cursor.close()
        conn.close()
        
        return True
        
    except Exception as e:
        print(f"❌ Error fixing replies table: {e}")
        return False

if __name__ == "__main__":
    print("Fix Replies Table Script")
    print("=" * 30)
    
    success = fix_replies_table()
    if success:
        print("\n🎉 Fix completed! You can now run the migration script again.")
    sys.exit(0 if success else 1)