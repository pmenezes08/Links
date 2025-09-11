#!/usr/bin/env python3
"""
Check MySQL Configuration
Verifies that the Flask app will use MySQL instead of SQLite
"""

import os
import sys

def check_mysql_config():
    """Check if MySQL configuration is properly set"""
    
    print("MySQL Configuration Check")
    print("=" * 30)
    
    # Check environment variables
    db_backend = os.getenv('DB_BACKEND', 'sqlite')
    mysql_host = os.getenv('MYSQL_HOST', 'not set')
    mysql_user = os.getenv('MYSQL_USER', 'not set')
    mysql_password = os.getenv('MYSQL_PASSWORD', 'not set')
    mysql_database = os.getenv('MYSQL_DATABASE', 'not set')
    
    print(f"DB_BACKEND: {db_backend}")
    print(f"MYSQL_HOST: {mysql_host}")
    print(f"MYSQL_USER: {mysql_user}")
    print(f"MYSQL_PASSWORD: {'SET' if mysql_password != 'not set' else 'NOT SET'}")
    print(f"MYSQL_DATABASE: {mysql_database}")
    
    # Check if Flask app will use MySQL
    use_mysql = (db_backend.lower() == 'mysql')
    print(f"\nWill Flask app use MySQL? {'✅ YES' if use_mysql else '❌ NO (will use SQLite)'}")
    
    if not use_mysql:
        print("\n🔧 To fix this, run:")
        print("export DB_BACKEND=mysql")
        return False
    
    # Check MySQL connection
    if mysql_password == 'not set':
        print("\n❌ MYSQL_PASSWORD is not set!")
        print("🔧 To fix this, run:")
        print("export MYSQL_PASSWORD='your_actual_mysql_password'")
        return False
    
    # Test MySQL connection
    print("\n🔍 Testing MySQL connection...")
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        conn = pymysql.connect(
            host=mysql_host,
            user=mysql_user,
            password=mysql_password,
            database=mysql_database,
            charset='utf8mb4',
            cursorclass=DictCursor,
            autocommit=False
        )
        
        cursor = conn.cursor()
        cursor.execute("SELECT 1 as test")
        result = cursor.fetchone()
        
        cursor.close()
        conn.close()
        
        print("✅ MySQL connection successful!")
        return True
        
    except ImportError as e:
        print(f"❌ PyMySQL not available: {e}")
        return False
    except Exception as e:
        print(f"❌ MySQL connection failed: {e}")
        return False

if __name__ == "__main__":
    success = check_mysql_config()
    
    if success:
        print("\n🎉 Configuration looks good!")
        print("Your Flask app should use MySQL properly.")
    else:
        print("\n⚠️  Configuration issues found.")
        print("Fix the issues above, then restart your Flask app.")
    
    sys.exit(0 if success else 1)