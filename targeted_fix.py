#!/usr/bin/env python3
"""
Targeted MySQL Database Fix
Fixes specific remaining issues after migration
"""

import os
import sys

def run_targeted_fix():
    """Fix specific database issues"""
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        # Get MySQL credentials
        host = os.environ.get('MYSQL_HOST', 'puntz08.mysql.pythonanywhere-services.com')
        user = os.environ.get('MYSQL_USER', 'puntz08')
        password = os.environ.get('MYSQL_PASSWORD')
        database = os.environ.get('MYSQL_DATABASE', 'puntz08$C-Point')
        
        if not password:
            print("❌ Error: MYSQL_PASSWORD environment variable is required!")
            return False
        
        print("Targeted MySQL Database Fix")
        print("=" * 35)
        print(f"Connecting to: {host}")
        print(f"Database: {database}")
        
        # Connect to MySQL
        conn = pymysql.connect(
            host=host,
            user=user,
            password=password,
            database=database,
            charset='utf8mb4',
            cursorclass=DictCursor,
            autocommit=False
        )
        
        cursor = conn.cursor()
        print("✅ Connected to MySQL successfully!")
        
        # 1. Fix users table - handle the primary key issue properly
        print("\n1. Fixing users table...")
        try:
            # Check current structure
            cursor.execute("SHOW COLUMNS FROM users")
            columns = cursor.fetchall()
            column_names = [col['Field'] for col in columns]
            
            print(f"   Current columns: {column_names}")
            
            if 'id' not in column_names:
                # Check if username is the primary key
                cursor.execute("SHOW INDEX FROM users WHERE Key_name = 'PRIMARY'")
                primary_keys = cursor.fetchall()
                
                if primary_keys:
                    print("   Removing existing primary key constraint...")
                    # Drop the primary key constraint first
                    cursor.execute("ALTER TABLE users DROP PRIMARY KEY")
                    
                    # Make username unique instead of primary
                    cursor.execute("ALTER TABLE users ADD UNIQUE KEY unique_username (username)")
                
                print("   Adding id column as primary key...")
                cursor.execute("ALTER TABLE users ADD COLUMN id INTEGER PRIMARY KEY AUTO_INCREMENT FIRST")
                conn.commit()
                print("   ✅ Added id column successfully")
            else:
                print("   ✅ Users table already has id column")
                
        except Exception as e:
            print(f"   ⚠️  Warning: Could not fix users table: {e}")
            # Try alternative approach - check if we can make the existing structure work
            try:
                cursor.execute("SHOW COLUMNS FROM users WHERE Field = 'username'")
                username_col = cursor.fetchone()
                if username_col and 'auto_increment' not in username_col['Extra'].lower():
                    print("   Attempting alternative fix...")
                    # Add a separate id column without making it primary key initially
                    cursor.execute("ALTER TABLE users ADD COLUMN id INTEGER AUTO_INCREMENT UNIQUE FIRST")
                    conn.commit()
                    print("   ✅ Added id column as auto_increment unique")
            except Exception as e2:
                print(f"   ❌ Could not fix users table with alternative approach: {e2}")
        
        # 2. Fix user_profiles table - add missing columns
        print("\n2. Fixing user_profiles table...")
        try:
            cursor.execute("SHOW COLUMNS FROM user_profiles")
            columns = cursor.fetchall()
            column_names = [col['Field'] for col in columns]
            
            missing_columns = []
            expected_columns = ['website', 'instagram', 'twitter', 'location', 'cover_photo']
            
            for col in expected_columns:
                if col not in column_names:
                    missing_columns.append(col)
            
            if missing_columns:
                print(f"   Adding missing columns: {missing_columns}")
                for col in missing_columns:
                    cursor.execute(f"ALTER TABLE user_profiles ADD COLUMN {col} TEXT")
                conn.commit()
                print("   ✅ Added missing columns to user_profiles")
            else:
                print("   ✅ user_profiles table has all required columns")
                
        except Exception as e:
            print(f"   ⚠️  Warning: Could not fix user_profiles table: {e}")
        
        # 3. Test the critical queries
        print("\n3. Testing critical queries...")
        
        # Test users.id query
        try:
            cursor.execute("SELECT id FROM users LIMIT 1")
            result = cursor.fetchone()
            if result:
                print("   ✅ users.id query works")
            else:
                print("   ⚠️  users table is empty, but id column exists")
        except Exception as e:
            print(f"   ❌ users.id query fails: {e}")
        
        # Test user_communities join
        try:
            cursor.execute("SELECT COUNT(*) as count FROM user_communities uc LEFT JOIN users u ON uc.user_id = u.id LIMIT 1")
            print("   ✅ user_communities join with users.id works")
        except Exception as e:
            print(f"   ❌ user_communities join still fails: {e}")
        
        # Test user_profiles columns
        try:
            cursor.execute("SELECT username, website FROM user_profiles LIMIT 1")
            print("   ✅ user_profiles.website query works")
        except Exception as e:
            print(f"   ❌ user_profiles.website query fails: {e}")
        
        cursor.close()
        conn.close()
        
        print("\n🎉 Targeted fix completed!")
        print("\nIf you still see errors, try restarting your Flask application.")
        
        return True
        
    except ImportError as e:
        print(f"❌ PyMySQL not available: {e}")
        return False
    except Exception as e:
        print(f"❌ Fix failed: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--help":
        print("Targeted MySQL Database Fix")
        print("Usage: python targeted_fix.py")
        print("\nThis script fixes specific remaining database issues:")
        print("- Adds id column to users table properly")
        print("- Adds missing columns to user_profiles table")
        print("- Tests critical queries")
        sys.exit(0)
    
    success = run_targeted_fix()
    sys.exit(0 if success else 1)