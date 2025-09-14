#!/usr/bin/env python3
"""
Fix the database name issue
The database name should be puntz08$C-Point not puntz08-Point
"""

import os
import subprocess
import time

def fix_database_name():
    """Fix the database name in .env file"""
    print("🔧 FIXING DATABASE NAME")
    print("=" * 40)
    
    # Kill any running Flask processes
    print("🔧 Step 1: Killing Flask processes...")
    try:
        subprocess.run(["pkill", "-f", "bodybuilding_app"], check=False)
        time.sleep(2)
        print("✅ Flask processes killed")
    except Exception as e:
        print(f"⚠️  Error killing processes: {e}")
    
    # Fix the .env file with correct database name
    print("\n🔧 Step 2: Fixing .env file with correct database name...")
    
    # Remove old .env file
    if os.path.exists('.env'):
        os.remove('.env')
        print("🗑️  Old .env file removed")
    
    # Create new .env file with correct database name
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
        print("✅ New .env file created with correct database name!")
        
        # Verify the file
        with open('.env', 'r') as f:
            content = f.read()
        print("\n📄 .env file content:")
        print(content)
        
    except Exception as e:
        print(f"❌ Failed to create .env file: {e}")
        return False
    
    # Test MySQL connection with correct database name
    print("\n🔧 Step 3: Testing MySQL connection with correct database name...")
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

def start_flask_app():
    """Start Flask app with correct environment variables"""
    print("\n🔧 Step 4: Starting Flask app...")
    
    # Set environment variables
    os.environ['MYSQL_HOST'] = "puntz08.mysql.pythonanywhere-services.com"
    os.environ['MYSQL_USER'] = "puntz08"
    os.environ['MYSQL_PASSWORD'] = "Trying123456"
    os.environ['MYSQL_DB'] = "puntz08$C-Point"  # Correct database name
    os.environ['DB_BACKEND'] = "mysql"
    
    print("✅ Environment variables set")
    
    # Export commands for manual execution
    print("\n📋 Run these commands to start Flask:")
    print('export MYSQL_HOST="puntz08.mysql.pythonanywhere-services.com"')
    print('export MYSQL_USER="puntz08"')
    print('export MYSQL_PASSWORD="Trying123456"')
    print('export MYSQL_DB="puntz08$C-Point"')
    print('export DB_BACKEND="mysql"')
    print('python bodybuilding_app.py')
    
    return True

def main():
    """Main function"""
    print("🔧 DATABASE NAME FIX")
    print("=" * 50)
    
    try:
        # Fix database name
        if not fix_database_name():
            print("❌ Failed to fix database name")
            return False
        
        # Start Flask app
        if not start_flask_app():
            print("❌ Failed to start Flask app")
            return False
        
        print("\n" + "=" * 50)
        print("🎉 DATABASE NAME FIX COMPLETE!")
        print("✅ MySQL connection working with correct database name!")
        print("🚀 Run the export commands above to start Flask")
        print("📱 Your app should work perfectly now!")
        print("=" * 50)
        
        return True
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return False

if __name__ == "__main__":
    main()
