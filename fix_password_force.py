#!/usr/bin/env python3
"""
Force fix the password by clearing environment and reloading
"""

import os

def fix_password_force():
    """Force fix the password by clearing environment variables"""
    print("🔧 FORCE FIXING PASSWORD")
    print("=" * 40)
    
    # Clear existing MySQL environment variables
    mysql_vars = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DB', 'DB_BACKEND']
    for var in mysql_vars:
        if var in os.environ:
            del os.environ[var]
            print(f"🗑️  Cleared {var}")
    
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

def test_mysql_connection_direct():
    """Test MySQL connection directly without environment variables"""
    print("\n🔧 TESTING MYSQL CONNECTION DIRECTLY")
    print("=" * 50)
    
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        # Use direct values instead of environment variables
        host = "puntz08.mysql.pythonanywhere-services.com"
        user = "puntz08"
        password = "Trying123456"  # Direct password
        database = "puntz08$C-Point"
        
        print(f"🔍 Testing connection to: {host}")
        print(f"🔍 Database: {database}")
        print(f"🔍 User: {user}")
        print(f"🔍 Password: {password}")
        
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

def test_mysql_connection_from_env():
    """Test MySQL connection from environment variables"""
    print("\n🔧 TESTING MYSQL CONNECTION FROM ENV")
    print("=" * 50)
    
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        # Load environment variables fresh
        from dotenv import load_dotenv
        load_dotenv(override=True)  # Force override existing variables
        
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
        
        # Use direct connection
        conn = pymysql.connect(
            host="puntz08.mysql.pythonanywhere-services.com",
            user="puntz08",
            password="Trying123456",
            database="puntz08$C-Point",
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
    print("🔧 FORCE PASSWORD FIX")
    print("=" * 60)
    
    # Fix password
    if not fix_password_force():
        print("❌ Failed to fix password")
        return False
    
    # Test connection directly
    if not test_mysql_connection_direct():
        print("❌ Direct connection test failed")
        return False
    
    # Test connection from environment
    if not test_mysql_connection_from_env():
        print("❌ Environment connection test failed")
        return False
    
    # Check messages table
    if not check_messages_table():
        print("❌ Messages table check failed")
        return False
    
    print("\n" + "=" * 60)
    print("🎉 SUCCESS! MySQL connection is working!")
    print("✅ Both direct and environment connections work!")
    print("🚀 Now restart your Flask app on PythonAnywhere!")
    print("📱 Test your chat messages - the infinite loop should be fixed!")
    print("=" * 60)
    
    return True

if __name__ == "__main__":
    try:
        success = main()
        if not success:
            exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        exit(1)
