#!/usr/bin/env python3
"""
Emergency fix for Flask app MySQL connection
This will fix the password issue immediately
"""

import os
import subprocess
import time

def emergency_fix():
    """Emergency fix for the MySQL password issue"""
    print("🚨 EMERGENCY MYSQL PASSWORD FIX")
    print("=" * 50)
    
    # Step 1: Kill all Flask processes
    print("🔧 Step 1: Killing all Flask processes...")
    try:
        subprocess.run(["pkill", "-f", "bodybuilding_app"], check=False)
        subprocess.run(["pkill", "-f", "python.*bodybuilding_app"], check=False)
        time.sleep(2)
        print("✅ Flask processes killed")
    except Exception as e:
        print(f"⚠️  Error killing processes: {e}")
    
    # Step 2: Clear all MySQL environment variables
    print("\n🔧 Step 2: Clearing MySQL environment variables...")
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
        print("✅ New .env file created with correct password!")
        print(f"🔍 Password set to: {correct_password}")
        
        # Verify the file
        with open('.env', 'r') as f:
            content = f.read()
        print("\n📄 .env file content:")
        print(content)
        
    except Exception as e:
        print(f"❌ Failed to create .env file: {e}")
        return False
    
    # Step 5: Test MySQL connection
    print("\n🔧 Step 5: Testing MySQL connection...")
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
            print("✅ MySQL connection successful!")
        else:
            print("❌ MySQL connection failed")
            return False
            
    except Exception as e:
        print(f"❌ MySQL connection error: {e}")
        return False
    
    # Step 6: Set environment variables for current session
    print("\n🔧 Step 6: Setting environment variables...")
    os.environ['MYSQL_HOST'] = "puntz08.mysql.pythonanywhere-services.com"
    os.environ['MYSQL_USER'] = "puntz08"
    os.environ['MYSQL_PASSWORD'] = "Trying123456"
    os.environ['MYSQL_DB'] = "puntz08$C-Point"
    os.environ['DB_BACKEND'] = "mysql"
    
    print("✅ Environment variables set for current session")
    
    # Step 7: Start Flask app with correct environment
    print("\n🔧 Step 7: Starting Flask app with correct environment...")
    
    # Export environment variables for the Flask app
    env_export = """
export MYSQL_HOST="puntz08.mysql.pythonanywhere-services.com"
export MYSQL_USER="puntz08"
export MYSQL_PASSWORD="Trying123456"
export MYSQL_DB="puntz08$C-Point"
export DB_BACKEND="mysql"
"""
    
    print("📋 Run these commands to start Flask with correct environment:")
    print(env_export)
    print("python bodybuilding_app.py")
    
    return True

def main():
    """Main function"""
    try:
        success = emergency_fix()
        if success:
            print("\n" + "=" * 50)
            print("🎉 EMERGENCY FIX COMPLETE!")
            print("🚀 Now run the export commands above")
            print("📱 Then start Flask with: python bodybuilding_app.py")
            print("=" * 50)
        else:
            print("\n❌ Emergency fix failed!")
        return success
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return False

if __name__ == "__main__":
    main()
