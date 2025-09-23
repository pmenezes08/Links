#!/usr/bin/env python3
"""
Fix the startup script to use correct database name
"""

import os

def fix_startup_script():
    """Fix the startup script with correct database name"""
    print("🔧 FIXING STARTUP SCRIPT")
    print("=" * 40)
    
    # Create correct startup script
    startup_script = """#!/bin/bash
export MYSQL_HOST="puntz08.mysql.pythonanywhere-services.com"
export MYSQL_USER="puntz08"
export MYSQL_PASSWORD="Trying123456"
export MYSQL_DB="puntz08\\$C-Point"
export DB_BACKEND="mysql"

echo "🔍 Environment variables set:"
echo "MYSQL_HOST: $MYSQL_HOST"
echo "MYSQL_USER: $MYSQL_USER"
echo "MYSQL_PASSWORD: $MYSQL_PASSWORD"
echo "MYSQL_DB: $MYSQL_DB"
echo "DB_BACKEND: $DB_BACKEND"

echo "🚀 Starting Flask app..."
python bodybuilding_app.py
"""
    
    try:
        with open('start_flask.sh', 'w') as f:
            f.write(startup_script)
        
        # Make it executable
        os.chmod('start_flask.sh', 0o755)
        
        print("✅ Fixed startup script with correct database name!")
        print("🔍 Database name: puntz08$C-Point (with $ and C)")
        
        # Show the content
        with open('start_flask.sh', 'r') as f:
            content = f.read()
        print("\n📄 Startup script content:")
        print(content)
        
        return True
        
    except Exception as e:
        print(f"❌ Failed to fix startup script: {e}")
        return False

def test_mysql_connection():
    """Test MySQL connection with correct database name"""
    print("\n🔧 TESTING MYSQL CONNECTION")
    print("=" * 40)
    
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        conn = pymysql.connect(
            host="puntz08.mysql.pythonanywhere-services.com",
            user="puntz08",
            password="Trying123456",
            database="puntz08$C-Point",  # Correct database name
            charset='utf8mb4',
            cursorclass=DictCursor,
        )
        
        cursor = conn.cursor()
        cursor.execute("SELECT 1 as test")
        result = cursor.fetchone()
        conn.close()
        
        if result and result['test'] == 1:
            print("✅ MySQL connection successful with correct database name!")
            return True
        else:
            print("❌ MySQL connection failed")
            return False
            
    except Exception as e:
        print(f"❌ MySQL connection error: {e}")
        return False

def main():
    """Main function"""
    try:
        # Fix startup script
        if not fix_startup_script():
            print("❌ Failed to fix startup script")
            return False
        
        # Test MySQL connection
        if not test_mysql_connection():
            print("❌ MySQL connection test failed")
            return False
        
        print("\n" + "=" * 50)
        print("🎉 STARTUP SCRIPT FIXED!")
        print("✅ Database name corrected to: puntz08$C-Point")
        print("✅ MySQL connection working!")
        print("🚀 Now run: ./start_flask.sh")
        print("📱 Your app should work perfectly!")
        print("=" * 50)
        
        return True
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return False

if __name__ == "__main__":
    main()
