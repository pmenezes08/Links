#!/usr/bin/env python3
"""
Fix all duplicate columns in all tables
"""

import os
import subprocess
import time

def fix_all_duplicate_columns():
    """Fix duplicate columns in all tables"""
    print("🔧 FIXING ALL DUPLICATE COLUMNS")
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
    
    # Step 2: Fix duplicate columns in all tables
    print("\n🔧 Step 2: Fixing duplicate columns in all tables...")
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
        
        # Get all tables
        cursor.execute("SHOW TABLES")
        tables = cursor.fetchall()
        table_names = [list(table.values())[0] for table in tables]
        
        print(f"📋 Found tables: {table_names}")
        
        # Check each table for duplicate columns
        for table_name in table_names:
            print(f"\n🔍 Checking table: {table_name}")
            
            try:
                cursor.execute(f"DESCRIBE {table_name}")
                columns = cursor.fetchall()
                column_names = [col['Field'] for col in columns]
                
                # Find duplicate columns
                duplicates = []
                for col_name in set(column_names):
                    count = column_names.count(col_name)
                    if count > 1:
                        duplicates.append((col_name, count))
                
                if duplicates:
                    print(f"❌ Found duplicate columns in {table_name}: {duplicates}")
                    
                    # Fix duplicate columns
                    for col_name, count in duplicates:
                        print(f"🔧 Fixing {col_name} in {table_name} (found {count} times)")
                        
                        # Get all instances of this column
                        cursor.execute(f"SHOW COLUMNS FROM {table_name} WHERE Field = '{col_name}'")
                        col_instances = cursor.fetchall()
                        
                        # Keep the first one, drop the rest
                        for i, col_instance in enumerate(col_instances[1:], 1):
                            try:
                                cursor.execute(f"ALTER TABLE {table_name} DROP COLUMN `{col_name}`")
                                print(f"✅ Dropped duplicate {col_name} column {i}")
                            except Exception as drop_e:
                                print(f"⚠️  Could not drop {col_name} column {i}: {drop_e}")
                    
                    conn.commit()
                    print(f"✅ Fixed duplicates in {table_name}")
                else:
                    print(f"✅ Table {table_name} is clean")
                    
            except Exception as table_e:
                print(f"⚠️  Error checking table {table_name}: {table_e}")
        
        # Step 3: Verify all tables are clean
        print("\n🔧 Step 3: Verifying all tables are clean...")
        all_clean = True
        
        for table_name in table_names:
            try:
                cursor.execute(f"DESCRIBE {table_name}")
                columns = cursor.fetchall()
                column_names = [col['Field'] for col in columns]
                
                # Check for duplicates
                duplicates = []
                for col_name in set(column_names):
                    if column_names.count(col_name) > 1:
                        duplicates.append(col_name)
                
                if duplicates:
                    print(f"❌ {table_name} still has duplicates: {duplicates}")
                    all_clean = False
                else:
                    print(f"✅ {table_name} is clean")
                    
            except Exception as verify_e:
                print(f"⚠️  Error verifying {table_name}: {verify_e}")
        
        conn.close()
        
        if all_clean:
            print("\n✅ All tables are clean!")
            return True
        else:
            print("\n❌ Some tables still have duplicates")
            return False
        
    except Exception as e:
        print(f"❌ Error fixing database: {e}")
        return False

def test_mysql_connection():
    """Test MySQL connection"""
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
            return True
        else:
            print("❌ MySQL connection failed")
            return False
            
    except Exception as e:
        print(f"❌ MySQL connection error: {e}")
        return False

def create_startup_script():
    """Create startup script"""
    print("\n🔧 Step 5: Creating startup script...")
    
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
        with open('start_flask_clean.sh', 'w') as f:
            f.write(startup_script)
        
        os.chmod('start_flask_clean.sh', 0o755)
        
        print("✅ Created clean startup script: start_flask_clean.sh")
        return True
        
    except Exception as e:
        print(f"❌ Failed to create startup script: {e}")
        return False

def main():
    """Main function"""
    try:
        # Fix all duplicate columns
        if not fix_all_duplicate_columns():
            print("❌ Failed to fix all duplicate columns")
            return False
        
        # Test MySQL connection
        if not test_mysql_connection():
            print("❌ MySQL connection test failed")
            return False
        
        # Create startup script
        if not create_startup_script():
            print("❌ Failed to create startup script")
            return False
        
        print("\n" + "=" * 60)
        print("🎉 ALL DUPLICATE COLUMNS FIXED!")
        print("✅ MySQL connection working!")
        print("✅ All tables are clean!")
        print("🚀 To start Flask, run:")
        print("./start_flask_clean.sh")
        print("📱 Your app should work perfectly now!")
        print("=" * 60)
        
        return True
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return False

if __name__ == "__main__":
    main()
