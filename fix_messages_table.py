#!/usr/bin/env python3
"""
Fix Messages Table for Photo Messaging
Ensures image_path column exists in messages table
"""

import os
import sys

def fix_messages_table():
    """Add image_path column to messages table if missing"""
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
        
        print("Fix Messages Table for Photo Messaging")
        print("=" * 45)
        
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
        
        # Check current messages table structure
        print("\n1. Checking messages table structure...")
        cursor.execute("SHOW COLUMNS FROM messages")
        columns = cursor.fetchall()
        column_names = [col['Field'] for col in columns]
        
        print(f"   Current columns: {column_names}")
        
        # Check if image_path column exists
        if 'image_path' in column_names:
            print("   ✅ image_path column already exists")
        else:
            print("   ❌ image_path column missing, adding it...")
            cursor.execute("ALTER TABLE messages ADD COLUMN image_path TEXT")
            conn.commit()
            print("   ✅ Added image_path column to messages table")
        
        # Verify the fix
        print("\n2. Verifying messages table structure...")
        cursor.execute("SHOW COLUMNS FROM messages")
        final_columns = cursor.fetchall()
        final_column_names = [col['Field'] for col in final_columns]
        
        print(f"   Final columns: {final_column_names}")
        
        if 'image_path' in final_column_names:
            print("   ✅ image_path column confirmed present")
        else:
            print("   ❌ image_path column still missing")
            return False
        
        # Test a query with image_path
        print("\n3. Testing image_path query...")
        try:
            cursor.execute("SELECT id, sender, receiver, message, image_path, timestamp FROM messages LIMIT 1")
            print("   ✅ Query with image_path works")
        except Exception as e:
            print(f"   ❌ Query with image_path fails: {e}")
            return False
        
        # Create uploads directory if it doesn't exist
        print("\n4. Ensuring uploads directory exists...")
        try:
            uploads_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads', 'message_photos')
            os.makedirs(uploads_dir, exist_ok=True)
            print(f"   ✅ Created/verified uploads directory: {uploads_dir}")
        except Exception as e:
            print(f"   ⚠️  Could not create uploads directory: {e}")
        
        cursor.close()
        conn.close()
        
        print("\n🎉 Messages table fix completed!")
        print("\nPhoto messaging should now work properly.")
        print("Restart your Flask application to apply changes.")
        
        return True
        
    except Exception as e:
        print(f"❌ Fix failed: {e}")
        return False

if __name__ == "__main__":
    success = fix_messages_table()
    sys.exit(0 if success else 1)