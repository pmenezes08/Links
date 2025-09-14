#!/usr/bin/env python3
"""
Fix MySQL Connection and Message Handling Issues
This script fixes the database connection and message handling problems
"""

import os
import sys
from datetime import datetime

def create_env_file():
    """Create .env file with MySQL configuration"""
    print("🔧 Creating .env file for MySQL connection...")
    
    env_content = """# MySQL Environment Variables for Links App
MYSQL_HOST=puntz08.mysql.pythonanywhere-services.com
MYSQL_USER=puntz08
MYSQL_PASSWORD=tHQF#6gTM_XQYbB
MYSQL_DB=puntz08$C-Point
DB_BACKEND=mysql
"""
    
    try:
        with open('.env', 'w') as f:
            f.write(env_content)
        print("✅ .env file created successfully!")
        return True
    except Exception as e:
        print(f"❌ Failed to create .env file: {e}")
        return False

def fix_mysql_queries():
    """Fix MySQL-specific queries to be database-agnostic"""
    print("🔧 Fixing MySQL query syntax issues...")
    
    # Read the current file
    try:
        with open('bodybuilding_app.py', 'r') as f:
            content = f.read()
    except Exception as e:
        print(f"❌ Failed to read bodybuilding_app.py: {e}")
        return False
    
    # Fix MySQL-specific syntax
    fixes = [
        # Fix DATE_SUB syntax for cross-database compatibility
        ('DATE_SUB(NOW(), INTERVAL 5 SECOND)', 
         "datetime('now', '-5 seconds')"),
        ('DATE_SUB(NOW(), INTERVAL 10 SECOND)', 
         "datetime('now', '-10 seconds')"),
        ('NOW()', 'datetime("now")'),
    ]
    
    original_content = content
    for old_syntax, new_syntax in fixes:
        content = content.replace(old_syntax, new_syntax)
    
    # Only write if changes were made
    if content != original_content:
        try:
            with open('bodybuilding_app.py', 'w') as f:
                f.write(content)
            print("✅ Fixed MySQL query syntax issues!")
            return True
        except Exception as e:
            print(f"❌ Failed to write fixed file: {e}")
            return False
    else:
        print("ℹ️  No MySQL syntax issues found")
        return True

def test_mysql_connection():
    """Test MySQL connection"""
    print("🔧 Testing MySQL connection...")
    
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        # Load environment variables
        from dotenv import load_dotenv
        load_dotenv()
        
        host = os.environ.get('MYSQL_HOST')
        user = os.environ.get('MYSQL_USER')
        password = os.environ.get('MYSQL_PASSWORD')
        database = os.environ.get('MYSQL_DB')
        
        if not all([host, user, password, database]):
            print("❌ Missing MySQL environment variables")
            return False
        
        # Test connection
        conn = pymysql.connect(
            host=host,
            user=user,
            password=password,
            database=database,
            charset='utf8mb4',
            cursorclass=DictCursor,
        )
        
        cursor = conn.cursor()
        cursor.execute("SELECT 1 as test")
        result = cursor.fetchone()
        
        conn.close()
        
        if result and result['test'] == 1:
            print("✅ MySQL connection successful!")
            return True
        else:
            print("❌ MySQL connection test failed")
            return False
            
    except Exception as e:
        print(f"❌ MySQL connection error: {e}")
        return False

def check_messages_table():
    """Check if messages table exists and has correct structure"""
    print("🔧 Checking messages table structure...")
    
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        # Load environment variables
        from dotenv import load_dotenv
        load_dotenv()
        
        host = os.environ.get('MYSQL_HOST')
        user = os.environ.get('MYSQL_USER')
        password = os.environ.get('MYSQL_PASSWORD')
        database = os.environ.get('MYSQL_DB')
        
        conn = pymysql.connect(
            host=host,
            user=user,
            password=password,
            database=database,
            charset='utf8mb4',
            cursorclass=DictCursor,
        )
        
        cursor = conn.cursor()
        
        # Check if messages table exists
        cursor.execute("SHOW TABLES LIKE 'messages'")
        if not cursor.fetchone():
            print("❌ Messages table does not exist!")
            conn.close()
            return False
        
        # Check table structure
        cursor.execute("DESCRIBE messages")
        columns = cursor.fetchall()
        
        required_columns = ['id', 'sender', 'receiver', 'message', 'timestamp']
        existing_columns = [col['Field'] for col in columns]
        
        missing_columns = [col for col in required_columns if col not in existing_columns]
        if missing_columns:
            print(f"❌ Missing columns in messages table: {missing_columns}")
            conn.close()
            return False
        
        # Check for recent messages
        cursor.execute("SELECT COUNT(*) as count FROM messages")
        result = cursor.fetchone()
        message_count = result['count']
        
        print(f"✅ Messages table exists with {message_count} messages")
        print(f"✅ Table structure is correct")
        
        conn.close()
        return True
        
    except Exception as e:
        print(f"❌ Error checking messages table: {e}")
        return False

def main():
    """Main function to fix all issues"""
    print("🔧 MySQL Connection and Message Handling Fix")
    print("=" * 50)
    
    success = True
    
    # Step 1: Create .env file
    if not create_env_file():
        success = False
    
    # Step 2: Fix MySQL queries
    if not fix_mysql_queries():
        success = False
    
    # Step 3: Test MySQL connection
    if not test_mysql_connection():
        success = False
    
    # Step 4: Check messages table
    if not check_messages_table():
        success = False
    
    print("\n" + "=" * 50)
    if success:
        print("✅ ALL FIXES APPLIED SUCCESSFULLY!")
        print("\n📋 Next Steps:")
        print("1. Restart your Flask app on PythonAnywhere")
        print("2. Test sending chat messages")
        print("3. Check if messages appear and stay visible")
    else:
        print("❌ SOME FIXES FAILED!")
        print("Please check the error messages above.")
    
    print("=" * 50)
    
    return success

if __name__ == "__main__":
    try:
        success = main()
        if not success:
            sys.exit(1)
    except KeyboardInterrupt:
        print("\n❌ Fix cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        sys.exit(1)
