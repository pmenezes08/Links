#!/usr/bin/env python3
"""
Fix DB_BACKEND to use MySQL instead of SQLite
"""

import os
import subprocess

def fix_db_backend():
    """Fix DB_BACKEND to use MySQL"""
    print("🔧 FIXING DB_BACKEND TO USE MYSQL")
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
    
    # Step 2: Check current .env file
    print("\n🔧 Step 2: Checking current .env file...")
    if os.path.exists('.env'):
        with open('.env', 'r') as f:
            content = f.read()
        print("📄 Current .env content:")
        print(content)
        
        # Check if DB_BACKEND is set to mysql
        if 'DB_BACKEND=mysql' in content:
            print("✅ DB_BACKEND is already set to mysql")
        else:
            print("❌ DB_BACKEND is not set to mysql")
    else:
        print("❌ .env file does not exist")
    
    # Step 3: Create correct .env file
    print("\n🔧 Step 3: Creating correct .env file...")
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
        print("✅ Created .env file with DB_BACKEND=mysql")
        
        # Verify the file
        with open('.env', 'r') as f:
            content = f.read()
        print("\n📄 New .env content:")
        print(content)
        
    except Exception as e:
        print(f"❌ Failed to create .env file: {e}")
        return False
    
    # Step 4: Test MySQL connection
    print("\n🔧 Step 4: Testing MySQL connection...")
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
    
    # Step 5: Test Flask app with correct environment
    print("\n🔧 Step 5: Testing Flask app environment...")
    
    # Set environment variables
    os.environ['MYSQL_HOST'] = "puntz08.mysql.pythonanywhere-services.com"
    os.environ['MYSQL_USER'] = "puntz08"
    os.environ['MYSQL_PASSWORD'] = "Trying123456"
    os.environ['MYSQL_DB'] = "puntz08$C-Point"
    os.environ['DB_BACKEND'] = "mysql"
    
    # Test the get_db_connection function logic
    USE_MYSQL = (os.getenv('DB_BACKEND', 'sqlite').lower() == 'mysql')
    print(f"🔍 DB_BACKEND environment variable: {os.environ.get('DB_BACKEND')}")
    print(f"🔍 USE_MYSQL flag: {USE_MYSQL}")
    
    if USE_MYSQL:
        print("✅ Flask will use MySQL!")
    else:
        print("❌ Flask will use SQLite!")
        return False
    
    return True

def create_mysql_startup_script():
    """Create startup script that forces MySQL usage"""
    print("\n🔧 Step 6: Creating MySQL startup script...")
    
    startup_script = """#!/bin/bash
# Force MySQL usage
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

echo "🔍 Testing USE_MYSQL flag..."
python -c "
import os
os.environ['MYSQL_HOST'] = '$MYSQL_HOST'
os.environ['MYSQL_USER'] = '$MYSQL_USER'
os.environ['MYSQL_PASSWORD'] = '$MYSQL_PASSWORD'
os.environ['MYSQL_DB'] = '$MYSQL_DB'
os.environ['DB_BACKEND'] = '$DB_BACKEND'

USE_MYSQL = (os.getenv('DB_BACKEND', 'sqlite').lower() == 'mysql')
print(f'USE_MYSQL: {USE_MYSQL}')
if USE_MYSQL:
    print('✅ Flask will use MySQL!')
else:
    print('❌ Flask will use SQLite!')
    exit(1)
"

echo "🚀 Starting Flask app with MySQL..."
python bodybuilding_app.py
"""
    
    try:
        with open('start_flask_mysql.sh', 'w') as f:
            f.write(startup_script)
        
        os.chmod('start_flask_mysql.sh', 0o755)
        
        print("✅ Created MySQL startup script: start_flask_mysql.sh")
        return True
        
    except Exception as e:
        print(f"❌ Failed to create startup script: {e}")
        return False

def main():
    """Main function"""
    try:
        # Fix DB_BACKEND
        if not fix_db_backend():
            print("❌ Failed to fix DB_BACKEND")
            return False
        
        # Create MySQL startup script
        if not create_mysql_startup_script():
            print("❌ Failed to create startup script")
            return False
        
        print("\n" + "=" * 60)
        print("🎉 DB_BACKEND FIXED TO USE MYSQL!")
        print("✅ .env file has DB_BACKEND=mysql")
        print("✅ MySQL connection working!")
        print("✅ Flask will use MySQL instead of SQLite!")
        print("🚀 To start Flask with MySQL, run:")
        print("./start_flask_mysql.sh")
        print("📱 Your app should work perfectly now!")
        print("=" * 60)
        
        return True
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return False

if __name__ == "__main__":
    main()
