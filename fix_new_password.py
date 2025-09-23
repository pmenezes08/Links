#!/usr/bin/env python3
"""
Fix MySQL password with the new password: Trying123456
Run this script on PythonAnywhere to fix the password issue
"""

import os

def fix_new_password():
    """Fix the MySQL password with the new password"""
    print("🔧 Fixing MySQL password with new password...")
    
    # The new password
    new_password = "Trying123456"
    
    # Create .env file with new password
    env_content = f"""# MySQL Environment Variables for Links App
MYSQL_HOST=puntz08.mysql.pythonanywhere-services.com
MYSQL_USER=puntz08
MYSQL_PASSWORD={new_password}
MYSQL_DB=puntz08$C-Point
DB_BACKEND=mysql
"""
    
    try:
        with open('.env', 'w') as f:
            f.write(env_content)
        print("✅ .env file created with new password!")
        print(f"🔍 New password set to: {new_password}")
        return True
    except Exception as e:
        print(f"❌ Failed to create .env file: {e}")
        return False

def test_mysql_connection():
    """Test MySQL connection with new password"""
    print("🔧 Testing MySQL connection with new password...")
    
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
        
        print(f"🔍 Testing connection to: {host}")
        print(f"🔍 Database: {database}")
        print(f"🔍 User: {user}")
        print(f"🔍 Password: {password}")
        
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
    """Main function"""
    print("🔧 PythonAnywhere MySQL New Password Fix")
    print("=" * 45)
    
    # Fix password
    if not fix_new_password():
        print("❌ Failed to fix password")
        return False
    
    # Test connection
    if not test_mysql_connection():
        print("❌ Connection test failed")
        return False
    
    # Check messages table
    if not check_messages_table():
        print("❌ Messages table check failed")
        return False
    
    print("\n✅ MySQL password fixed and connection successful!")
    print("✅ Messages table is ready!")
    print("🚀 Now restart your Flask app on PythonAnywhere!")
    print("📱 Test your chat messages - the infinite loop should be fixed!")
    return True

if __name__ == "__main__":
    try:
        success = main()
        if not success:
            exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        exit(1)
