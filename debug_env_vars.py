#!/usr/bin/env python3
"""
Debug environment variables to see what Flask app is actually reading
"""

import os

def debug_env_vars():
    """Debug what environment variables are actually set"""
    print("🔍 DEBUGGING ENVIRONMENT VARIABLES")
    print("=" * 50)
    
    # Check current environment variables
    print("📋 Current Environment Variables:")
    mysql_vars = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DB', 'DB_BACKEND']
    for var in mysql_vars:
        value = os.environ.get(var)
        print(f"{var}: {value}")
    
    # Check .env file
    print("\n📄 .env file content:")
    if os.path.exists('.env'):
        with open('.env', 'r') as f:
            content = f.read()
        print(content)
    else:
        print("❌ .env file does not exist")
    
    # Test loading with dotenv
    print("\n🔧 Testing dotenv loading:")
    try:
        from dotenv import load_dotenv
        load_dotenv(override=True)
        print("✅ dotenv loaded successfully")
        
        print("\n📋 Environment variables after dotenv:")
        for var in mysql_vars:
            value = os.environ.get(var)
            print(f"{var}: {value}")
            
    except Exception as e:
        print(f"❌ Error loading dotenv: {e}")
    
    # Test MySQL connection with current environment
    print("\n🔧 Testing MySQL connection with current environment:")
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        host = os.environ.get('MYSQL_HOST')
        user = os.environ.get('MYSQL_USER')
        password = os.environ.get('MYSQL_PASSWORD')
        database = os.environ.get('MYSQL_DB')
        
        print(f"🔍 Using database: '{database}'")
        
        if not all([host, user, password, database]):
            print("❌ Missing environment variables")
            return False
        
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
            print("❌ MySQL connection failed")
            return False
            
    except Exception as e:
        print(f"❌ MySQL connection error: {e}")
        return False

if __name__ == "__main__":
    debug_env_vars()
