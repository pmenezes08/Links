#!/usr/bin/env python3
"""
Final fix for MySQL connection - force correct password
"""

import os
import subprocess
import time

def final_fix():
    """Final fix for MySQL connection"""
    print("🔧 FINAL MYSQL CONNECTION FIX")
    print("=" * 50)
    
    # Step 1: Kill all Flask processes
    print("🔧 Step 1: Killing all Flask processes...")
    try:
        subprocess.run(["pkill", "-f", "bodybuilding_app"], check=False)
        subprocess.run(["pkill", "-f", "python.*bodybuilding_app"], check=False)
        time.sleep(3)
        print("✅ All Flask processes killed")
    except Exception as e:
        print(f"⚠️  Error killing processes: {e}")
    
    # Step 2: Clear ALL environment variables
    print("\n🔧 Step 2: Clearing ALL environment variables...")
    mysql_vars = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DB', 'DB_BACKEND']
    for var in mysql_vars:
        if var in os.environ:
            del os.environ[var]
            print(f"🗑️  Cleared {var}")
    
    # Step 3: Remove old .env file
    print("\n🔧 Step 3: Removing old .env file...")
    if os.path.exists('.env'):
        os.remove('.env')
        print("🗑️  Old .env file removed")
    
    # Step 4: Create new .env file with correct password
    print("\n🔧 Step 4: Creating new .env file with correct password...")
    env_content = """# MySQL Environment Variables for Links App
MYSQL_HOST=puntz08.mysql.pythonanywhere-services.com
MYSQL_USER=puntz08
MYSQL_PASSWORD=Trying123456
MYSQL_DB=puntz08$C-Point
DB_BACKEND=mysql
"""
    
    try:
        with open('.env', 'w') as f:
            f.write(env_content)
        print("✅ New .env file created with correct password!")
        
        # Verify the file
        with open('.env', 'r') as f:
            content = f.read()
        print("\n📄 .env file content:")
        print(content)
        
    except Exception as e:
        print(f"❌ Failed to create .env file: {e}")
        return False
    
    # Step 5: Test MySQL connection with explicit values
    print("\n🔧 Step 5: Testing MySQL connection with explicit values...")
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        conn = pymysql.connect(
            host="puntz08.mysql.pythonanywhere-services.com",
            user="puntz08",
            password="Trying123456",
            database="puntz08$C-Point",
            charset='utf8mb4',
            cursorclass=DictCursor,
        )
        
        cursor = conn.cursor()
        cursor.execute("SELECT 1 as test")
        result = cursor.fetchone()
        conn.close()
        
        if result and result['test'] == 1:
            print("✅ MySQL connection successful with explicit values!")
            return True
        else:
            print("❌ MySQL connection failed")
            return False
            
    except Exception as e:
        print(f"❌ MySQL connection error: {e}")
        return False

def start_flask_with_explicit_env():
    """Start Flask with explicit environment variables"""
    print("\n🔧 Step 6: Starting Flask with explicit environment variables...")
    
    # Create a startup script
    startup_script = """#!/bin/bash
export MYSQL_HOST="puntz08.mysql.pythonanywhere-services.com"
export MYSQL_USER="puntz08"
export MYSQL_PASSWORD="Trying123456"
export MYSQL_DB="puntz08$C-Point"
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
        
        print("✅ Flask startup script created: start_flask.sh")
        print("\n📋 To start Flask, run:")
        print("./start_flask.sh")
        
        return True
        
    except Exception as e:
        print(f"❌ Failed to create startup script: {e}")
        return False

def main():
    """Main function"""
    try:
        # Fix MySQL connection
        if not final_fix():
            print("❌ Failed to fix MySQL connection")
            return False
        
        # Create startup script
        if not start_flask_with_explicit_env():
            print("❌ Failed to create startup script")
            return False
        
        print("\n" + "=" * 60)
        print("🎉 FINAL FIX COMPLETE!")
        print("✅ MySQL connection working with correct password!")
        print("✅ Database name is correct!")
        print("🚀 To start Flask, run: ./start_flask.sh")
        print("📱 Your app should work perfectly now!")
        print("=" * 60)
        
        return True
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return False

if __name__ == "__main__":
    main()
