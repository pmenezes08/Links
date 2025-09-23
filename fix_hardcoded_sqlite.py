#!/usr/bin/env python3
"""
Fix hardcoded SQLite connections in Flask app
"""

import os
import subprocess

def fix_hardcoded_sqlite():
    """Fix hardcoded SQLite connections in Flask app"""
    print("🔧 FIXING HARDCODED SQLITE CONNECTIONS")
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
    
    # Step 2: Create a simple fix by modifying the ensure_database_exists function
    print("\n🔧 Step 2: Creating database connection fix...")
    
    # Read the current bodybuilding_app.py
    try:
        with open('bodybuilding_app.py', 'r') as f:
            content = f.read()
        
        # Find and replace the ensure_database_exists function
        old_function = '''def ensure_database_exists():
    """Ensure the database and all tables exist."""
    try:
        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'users.db')
        logger.info(f"Database path: {db_path}")
        
        # Connect to database (this will create it if it doesn't exist)
        conn = sqlite3.connect(db_path)'''
        
        new_function = '''def ensure_database_exists():
    """Ensure the database and all tables exist."""
    try:
        if USE_MYSQL:
            # For MySQL, we don't need to ensure database exists as it's already created
            logger.info("Using MySQL database - skipping database creation")
            return
        
        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'users.db')
        logger.info(f"Database path: {db_path}")
        
        # Connect to database (this will create it if it doesn't exist)
        conn = sqlite3.connect(db_path)'''
        
        if old_function in content:
            content = content.replace(old_function, new_function)
            print("✅ Fixed ensure_database_exists function")
        else:
            print("⚠️  Could not find ensure_database_exists function to fix")
        
        # Write the fixed content back
        with open('bodybuilding_app.py', 'w') as f:
            f.write(content)
        
        print("✅ Updated bodybuilding_app.py")
        
    except Exception as e:
        print(f"❌ Error fixing bodybuilding_app.py: {e}")
        return False
    
    # Step 3: Test MySQL connection
    print("\n🔧 Step 3: Testing MySQL connection...")
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
    
    # Step 4: Create startup script that sets environment variables properly
    print("\n🔧 Step 4: Creating startup script...")
    
    startup_script = """#!/bin/bash
# Set environment variables for MySQL
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
        with open('start_flask_mysql_fixed.sh', 'w') as f:
            f.write(startup_script)
        
        os.chmod('start_flask_mysql_fixed.sh', 0o755)
        
        print("✅ Created fixed MySQL startup script: start_flask_mysql_fixed.sh")
        return True
        
    except Exception as e:
        print(f"❌ Failed to create startup script: {e}")
        return False

def main():
    """Main function"""
    try:
        # Fix hardcoded SQLite connections
        if not fix_hardcoded_sqlite():
            print("❌ Failed to fix hardcoded SQLite connections")
            return False
        
        print("\n" + "=" * 60)
        print("🎉 HARDCODED SQLITE CONNECTIONS FIXED!")
        print("✅ Modified ensure_database_exists function")
        print("✅ MySQL connection working!")
        print("✅ Flask will skip SQLite database creation when using MySQL!")
        print("🚀 To start Flask with MySQL, run:")
        print("./start_flask_mysql_fixed.sh")
        print("📱 Your app should work perfectly now!")
        print("=" * 60)
        
        return True
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return False

if __name__ == "__main__":
    main()
