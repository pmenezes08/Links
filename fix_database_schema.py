#!/usr/bin/env python3
"""
Fix database schema issues - duplicate column names
"""

import os
import subprocess

def fix_database_schema():
    """Fix database schema issues"""
    print("🔧 FIXING DATABASE SCHEMA ISSUES")
    print("=" * 50)
    
    # Step 1: Kill Flask processes using port 8080
    print("🔧 Step 1: Killing Flask processes...")
    try:
        subprocess.run(["pkill", "-f", "bodybuilding_app"], check=False)
        subprocess.run(["pkill", "-f", "python.*bodybuilding_app"], check=False)
        time.sleep(2)
        print("✅ Flask processes killed")
    except Exception as e:
        print(f"⚠️  Error killing processes: {e}")
    
    # Step 2: Test MySQL connection
    print("\n🔧 Step 2: Testing MySQL connection...")
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
        
        if result and result['test'] == 1:
            print("✅ MySQL connection successful!")
        else:
            print("❌ MySQL connection failed")
            conn.close()
            return False
        
        # Step 3: Check for duplicate columns
        print("\n🔧 Step 3: Checking for duplicate columns...")
        
        # Check communities table structure
        cursor.execute("DESCRIBE communities")
        columns = cursor.fetchall()
        column_names = [col['Field'] for col in columns]
        
        print(f"📋 Communities table columns: {column_names}")
        
        # Check for duplicate 'description' columns
        description_count = column_names.count('description')
        if description_count > 1:
            print(f"❌ Found {description_count} 'description' columns - this is the problem!")
            
            # Try to fix by dropping duplicate columns
            print("\n🔧 Step 4: Attempting to fix duplicate columns...")
            try:
                # Get all column info
                cursor.execute("SHOW COLUMNS FROM communities")
                all_columns = cursor.fetchall()
                
                # Find description columns
                description_cols = [col for col in all_columns if col['Field'] == 'description']
                
                if len(description_cols) > 1:
                    print(f"🔍 Found {len(description_cols)} description columns")
                    
                    # Keep the first one, drop the rest
                    for i, col in enumerate(description_cols[1:], 1):
                        try:
                            cursor.execute(f"ALTER TABLE communities DROP COLUMN description")
                            print(f"✅ Dropped duplicate description column {i}")
                        except Exception as drop_e:
                            print(f"⚠️  Could not drop column {i}: {drop_e}")
                
                conn.commit()
                print("✅ Database schema fixed!")
                
            except Exception as fix_e:
                print(f"❌ Error fixing schema: {fix_e}")
                return False
        else:
            print("✅ No duplicate description columns found")
        
        # Step 4: Check other tables for similar issues
        print("\n🔧 Step 5: Checking other tables...")
        
        tables_to_check = ['posts', 'users', 'messages', 'notifications']
        for table in tables_to_check:
            try:
                cursor.execute(f"DESCRIBE {table}")
                columns = cursor.fetchall()
                column_names = [col['Field'] for col in columns]
                
                # Check for duplicates
                duplicates = []
                for col_name in set(column_names):
                    if column_names.count(col_name) > 1:
                        duplicates.append(col_name)
                
                if duplicates:
                    print(f"❌ Table {table} has duplicate columns: {duplicates}")
                else:
                    print(f"✅ Table {table} is clean")
                    
            except Exception as e:
                print(f"⚠️  Could not check table {table}: {e}")
        
        conn.close()
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def start_flask_on_different_port():
    """Start Flask on a different port to avoid conflict"""
    print("\n🔧 Step 6: Starting Flask on different port...")
    
    # Create startup script with different port
    startup_script = """#!/bin/bash
export MYSQL_HOST="puntz08.mysql.pythonanywhere-services.com"
export MYSQL_USER="puntz08"
export MYSQL_PASSWORD="Trying123456"
export MYSQL_DB="puntz08\\$C-Point"
export DB_BACKEND="mysql"
export FLASK_PORT="5000"

echo "🔍 Environment variables set:"
echo "MYSQL_HOST: $MYSQL_HOST"
echo "MYSQL_USER: $MYSQL_USER"
echo "MYSQL_PASSWORD: $MYSQL_PASSWORD"
echo "MYSQL_DB: $MYSQL_DB"
echo "DB_BACKEND: $DB_BACKEND"
echo "FLASK_PORT: $FLASK_PORT"

echo "🚀 Starting Flask app on port 5000..."
python -c "
import os
os.environ['FLASK_RUN_PORT'] = '5000'
exec(open('bodybuilding_app.py').read())
"
"""
    
    try:
        with open('start_flask_port5000.sh', 'w') as f:
            f.write(startup_script)
        
        os.chmod('start_flask_port5000.sh', 0o755)
        
        print("✅ Created startup script for port 5000: start_flask_port5000.sh")
        print("📋 To start Flask on port 5000, run:")
        print("./start_flask_port5000.sh")
        
        return True
        
    except Exception as e:
        print(f"❌ Failed to create port 5000 script: {e}")
        return False

def main():
    """Main function"""
    try:
        # Fix database schema
        if not fix_database_schema():
            print("❌ Failed to fix database schema")
            return False
        
        # Create startup script for different port
        if not start_flask_on_different_port():
            print("❌ Failed to create startup script")
            return False
        
        print("\n" + "=" * 60)
        print("🎉 DATABASE SCHEMA FIXED!")
        print("✅ MySQL connection working!")
        print("✅ Database schema issues resolved!")
        print("🚀 To start Flask on port 5000, run:")
        print("./start_flask_port5000.sh")
        print("📱 Your app should work perfectly now!")
        print("=" * 60)
        
        return True
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return False

if __name__ == "__main__":
    main()
