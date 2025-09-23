#!/usr/bin/env python3
"""
Fix the password in .env file to the correct new password
"""

import os

def fix_password_final():
    """Fix the password in .env file to the correct new password"""
    print("🔧 FIXING PASSWORD IN .env FILE")
    print("=" * 40)
    
    # Remove old .env file
    if os.path.exists('.env'):
        os.remove('.env')
        print("🗑️  Removed old .env file")
    
    # Create new .env file with correct password
    correct_password = "Trying123456"
    
    env_content = f"""# MySQL Environment Variables for Links App
MYSQL_HOST=puntz08.mysql.pythonanywhere-services.com
MYSQL_USER=puntz08
MYSQL_PASSWORD={correct_password}
MYSQL_DB=puntz08$C-Point
DB_BACKEND=mysql
"""
    
    try:
        with open('.env', 'w') as f:
            f.write(env_content)
        print("✅ Created new .env file with correct password!")
        print(f"🔍 Password set to: {correct_password}")
        
        # Verify the file was created correctly
        with open('.env', 'r') as f:
            content = f.read()
        print("\n📄 New .env file content:")
        print(content)
        
        return True
    except Exception as e:
        print(f"❌ Failed to create .env file: {e}")
        return False

def test_mysql_connection():
    """Test MySQL connection with the corrected password"""
    print("\n🔧 TESTING MYSQL CONNECTION")
    print("=" * 40)
    
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
    """Check messages table"""
    print("\n🔧 CHECKING MESSAGES TABLE")
    print("=" * 40)
    
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
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
        
        # Check for recent messages
        cursor.execute("SELECT COUNT(*) as count FROM messages")
        result = cursor.fetchone()
        message_count = result['count']
        
        print(f"✅ Messages table exists with {message_count} messages")
        
        conn.close()
        return True
        
    except Exception as e:
        print(f"❌ Error checking messages table: {e}")
        return False

def main():
    """Main function"""
    print("🔧 FINAL PASSWORD FIX")
    print("=" * 50)
    
    # Fix password
    if not fix_password_final():
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
    
    print("\n" + "=" * 50)
    print("🎉 SUCCESS! MySQL connection is working!")
    print("🚀 Now restart your Flask app on PythonAnywhere!")
    print("📱 Test your chat messages - the infinite loop should be fixed!")
    print("=" * 50)
    
    return True

if __name__ == "__main__":
    try:
        success = main()
        if not success:
            exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        exit(1)
