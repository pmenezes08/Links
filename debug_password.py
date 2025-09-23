#!/usr/bin/env python3
"""
Debug password issue - check what password is actually being used
"""

import os

def debug_password():
    """Debug what password is actually being used"""
    print("🔍 DEBUGGING PASSWORD ISSUE")
    print("=" * 40)
    
    # Check if .env file exists
    if os.path.exists('.env'):
        print("✅ .env file exists")
        with open('.env', 'r') as f:
            content = f.read()
        print("📄 .env file content:")
        print(content)
    else:
        print("❌ .env file does not exist")
    
    # Try to load environment variables
    try:
        from dotenv import load_dotenv
        load_dotenv()
        print("✅ dotenv loaded successfully")
    except Exception as e:
        print(f"❌ Failed to load dotenv: {e}")
    
    # Check environment variables
    print("\n🔍 Environment Variables:")
    host = os.environ.get('MYSQL_HOST')
    user = os.environ.get('MYSQL_USER')
    password = os.environ.get('MYSQL_PASSWORD')
    database = os.environ.get('MYSQL_DB')
    
    print(f"MYSQL_HOST: {host}")
    print(f"MYSQL_USER: {user}")
    print(f"MYSQL_PASSWORD: '{password}' (length: {len(password) if password else 'None'})")
    print(f"MYSQL_DB: {database}")
    
    # Check if password is literally "YES"
    if password == "YES":
        print("🚨 PROBLEM FOUND: Password is literally 'YES'!")
        print("🔧 This is why the connection is failing!")
    elif password == "Trying123456":
        print("✅ Password is correct: Trying123456")
    else:
        print(f"⚠️  Password is unexpected: '{password}'")
    
    # Test connection with explicit password
    print("\n🔧 Testing with explicit password...")
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        conn = pymysql.connect(
            host="puntz08.mysql.pythonanywhere-services.com",
            user="puntz08",
            password="Trying123456",  # Explicit password
            database="puntz08$C-Point",
            charset='utf8mb4',
            cursorclass=DictCursor,
        )
        
        cursor = conn.cursor()
        cursor.execute("SELECT 1 as test")
        result = cursor.fetchone()
        conn.close()
        
        if result and result['test'] == 1:
            print("✅ Connection works with explicit password!")
            return True
        else:
            print("❌ Connection failed even with explicit password")
            return False
            
    except Exception as e:
        print(f"❌ Connection error with explicit password: {e}")
        return False

if __name__ == "__main__":
    debug_password()
