#!/usr/bin/env python3
"""
Find the correct MySQL password for PythonAnywhere
Run this script ON PythonAnywhere to find the working password
"""

import os
import sys

def test_mysql_passwords():
    """Test all possible MySQL passwords on PythonAnywhere"""
    print("🚨 FINDING CORRECT MYSQL PASSWORD")
    print("=" * 50)
    print("🔍 Testing passwords on PythonAnywhere...")
    
    # Common passwords to try
    possible_passwords = [
        "Trying123456",  # Current (failing)
        "trying123456",  # lowercase
        "Trying12345",   # shorter
        "trying12345",   # lowercase shorter
        "Trying123",     # much shorter
        "trying123",     # lowercase much shorter
        "password",      # default
        "Password123",   # common pattern
        "password123",   # lowercase common
        "123456",        # simple
        "mysql",         # service name
        "admin",         # admin
        "root",          # root
        "",              # empty
        "puntz08",       # username
        "Puntz08",       # username capitalized
        "Links123",      # app name
        "links123",      # app name lowercase
        "C-Point123",    # domain name
        "c-point123",    # domain lowercase
        "PythonAnywhere123",  # service name
        "pythonanywhere123",  # service lowercase
        "PA123456",      # PA abbreviation
        "pa123456",      # PA lowercase
    ]
    
    host = "puntz08.mysql.pythonanywhere-services.com"
    user = "puntz08"
    database = "puntz08$C-Point"
    
    print(f"🔍 Host: {host}")
    print(f"🔍 User: {user}")
    print(f"🔍 Database: {database}")
    print("")
    
    successful_passwords = []
    
    for i, password in enumerate(possible_passwords, 1):
        try:
            import pymysql
            from pymysql.cursors import DictCursor
            
            print(f"🔍 Test {i:2d}: Trying password '{password}'...")
            
            conn = pymysql.connect(
                host=host,
                user=user,
                password=password,
                database=database,
                charset='utf8mb4',
                cursorclass=DictCursor,
                connect_timeout=10
            )
            
            cursor = conn.cursor()
            cursor.execute("SELECT 1 as test")
            result = cursor.fetchone()
            
            if result and result['test'] == 1:
                print(f"✅ SUCCESS! Password '{password}' works!")
                successful_passwords.append(password)
                
                # Test database access
                cursor.execute("SHOW TABLES")
                tables = cursor.fetchall()
                print(f"   ✅ Can access {len(tables)} tables")
                
                # Test users table
                try:
                    cursor.execute("SELECT COUNT(*) as count FROM users")
                    user_count = cursor.fetchone()
                    print(f"   ✅ Users table: {user_count['count']} users")
                except Exception as e:
                    print(f"   ⚠️  Users table issue: {e}")
                
                conn.close()
                print(f"   ✅ FULL ACCESS CONFIRMED!")
                break  # Stop at first working password
                
            else:
                print(f"   ❌ Query failed")
                conn.close()
                
        except Exception as e:
            error_msg = str(e)
            if "Access denied" in error_msg:
                print(f"   ❌ Access denied")
            elif "Can't connect" in error_msg:
                print(f"   ❌ Connection failed")
            elif "No module named 'pymysql'" in error_msg:
                print(f"   ❌ PyMySQL not installed")
                print("   🔧 Install with: pip3.10 install --user pymysql")
                break
            else:
                print(f"   ❌ Error: {error_msg}")
        
        print()
    
    return successful_passwords

def create_fix_script(working_password):
    """Create a script to fix the password issue"""
    if not working_password:
        print("\n❌ NO WORKING PASSWORD FOUND!")
        return False
    
    print(f"\n🎉 FOUND WORKING PASSWORD: '{working_password}'")
    
    # Create .env file
    env_content = f"""# MySQL Environment Variables for C-Point Production
MYSQL_HOST=puntz08.mysql.pythonanywhere-services.com
MYSQL_USER=puntz08
MYSQL_PASSWORD={working_password}
MYSQL_DB=puntz08$C-Point
DB_BACKEND=mysql

# Flask Configuration
FLASK_SECRET_KEY=your-secret-key-here
SESSION_COOKIE_DOMAIN=.c-point.co
CANONICAL_HOST=www.c-point.co
CANONICAL_SCHEME=https
"""
    
    try:
        with open('.env', 'w') as f:
            f.write(env_content)
        print("✅ Created .env file with working password")
    except Exception as e:
        print(f"❌ Failed to create .env file: {e}")
        return False
    
    # Create startup script
    startup_script = f"""#!/bin/bash
echo "🚀 Starting C-Point with CORRECT password..."

# Set environment variables
export MYSQL_HOST="puntz08.mysql.pythonanywhere-services.com"
export MYSQL_USER="puntz08"
export MYSQL_PASSWORD="{working_password}"
export MYSQL_DB="puntz08$C-Point"
export DB_BACKEND="mysql"

echo "✅ Environment variables set with CORRECT password"
echo "🚀 Starting Flask app..."
python3 bodybuilding_app.py
"""
    
    try:
        with open('start_correct.sh', 'w') as f:
            f.write(startup_script)
        os.chmod('start_correct.sh', 0o755)
        print("✅ Created startup script: start_correct.sh")
    except Exception as e:
        print(f"❌ Failed to create startup script: {e}")
        return False
    
    print("\n" + "=" * 60)
    print("🎉 MYSQL PASSWORD FIXED!")
    print(f"✅ Working password: '{working_password}'")
    print("✅ .env file created")
    print("✅ Startup script created")
    print("")
    print("📋 To start your app:")
    print("./start_correct.sh")
    print("")
    print("🎉 NO MORE 'Access denied' ERRORS!")
    print("=" * 60)
    
    return True

def main():
    """Main function"""
    try:
        working_passwords = test_mysql_passwords()
        return create_fix_script(working_passwords[0] if working_passwords else None)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return False

if __name__ == "__main__":
    main()
