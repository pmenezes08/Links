#!/usr/bin/env python3
"""
Fix MySQL Password in .env file
"""

import os

def fix_mysql_password():
    """Fix the MySQL password in .env file"""
    print("🔧 Fixing MySQL password in .env file...")
    
    # Read current .env file
    try:
        with open('.env', 'r') as f:
            content = f.read()
    except Exception as e:
        print(f"❌ Failed to read .env file: {e}")
        return False
    
    # Fix the password
    old_password = "MYSQL_PASSWORD=tHQF#6gTM_XQYbB"
    new_password = "MYSQL_PASSWORD=tHqF#6gTM_XQYbB"
    
    if old_password in content:
        content = content.replace(old_password, new_password)
        print("✅ Found and fixed password in .env file")
    else:
        print("ℹ️  Password not found in .env file")
        return True
    
    # Write fixed content back
    try:
        with open('.env', 'w') as f:
            f.write(content)
        print("✅ .env file updated with correct password!")
        return True
    except Exception as e:
        print(f"❌ Failed to write .env file: {e}")
        return False

def test_mysql_connection():
    """Test MySQL connection with correct password"""
    print("🔧 Testing MySQL connection with correct password...")
    
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
        print(f"🔍 Password: {'*' * len(password) if password else 'NOT SET'}")
        
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

def main():
    """Main function"""
    print("🔧 MySQL Password Fix")
    print("=" * 30)
    
    # Fix password
    if not fix_mysql_password():
        print("❌ Failed to fix password")
        return False
    
    # Test connection
    if not test_mysql_connection():
        print("❌ Connection test failed")
        return False
    
    print("\n✅ MySQL password fixed and connection successful!")
    return True

if __name__ == "__main__":
    try:
        success = main()
        if not success:
            exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        exit(1)
