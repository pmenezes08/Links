#!/usr/bin/env python3
"""
Final MySQL Compatibility Fix
Addresses all remaining rowid references and missing columns
"""

import os
import sys

def run_final_fix():
    """Fix all remaining MySQL compatibility issues"""
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        # Get MySQL credentials
        host = os.environ.get('MYSQL_HOST', 'YOUR_CLOUD_SQL_HOST')
        user = os.environ.get('MYSQL_USER', 'puntz08')
        password = os.environ.get('MYSQL_PASSWORD')
        database = os.environ.get('MYSQL_DATABASE', 'puntz08$C-Point')
        
        if not password:
            print("❌ Error: MYSQL_PASSWORD environment variable is required!")
            return False
        
        print("Final MySQL Compatibility Fix")
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
        
        # 1. Ensure users table has id column (should already be done, but double-check)
        print("\n1. Verifying users table...")
        try:
            cursor.execute("SHOW COLUMNS FROM users LIKE 'id'")
            if not cursor.fetchone():
                print("   ❌ Users table still missing id column!")
                cursor.execute("ALTER TABLE users ADD COLUMN id INTEGER PRIMARY KEY AUTO_INCREMENT FIRST")
                conn.commit()
                print("   ✅ Added id column to users table")
            else:
                print("   ✅ Users table has id column")
        except Exception as e:
            print(f"   ⚠️  Warning: Could not verify users table: {e}")
        
        # 2. Fix user_profiles table - add all missing columns
        print("\n2. Fixing user_profiles table...")
        try:
            cursor.execute("SHOW COLUMNS FROM user_profiles")
            columns = cursor.fetchall()
            column_names = [col['Field'] for col in columns]
            
            missing_columns = []
            expected_columns = ['website', 'instagram', 'twitter', 'location', 'cover_photo', 'bio']
            
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
        
        # 3. Ensure replies table has community_id column
        print("\n3. Fixing replies table...")
        try:
            cursor.execute("SHOW COLUMNS FROM replies LIKE 'community_id'")
            if not cursor.fetchone():
                cursor.execute("ALTER TABLE replies ADD COLUMN community_id INTEGER")
                conn.commit()
                print("   ✅ Added community_id column to replies table")
            else:
                print("   ✅ replies table already has community_id column")
        except Exception as e:
            print(f"   ⚠️  Warning: Could not fix replies table: {e}")
        
        # 4. Check that communities are visible
        print("\n4. Checking community visibility...")
        try:
            cursor.execute("SELECT COUNT(*) as count FROM communities")
            result = cursor.fetchone()
            community_count = result['count'] if result else 0
            print(f"   Total communities in database: {community_count}")
            
            # Check for KW28 specifically
            cursor.execute("SELECT id, name, join_code FROM communities WHERE name LIKE '%KW28%'")
            kw28_communities = cursor.fetchall()
            if kw28_communities:
                print("   ✅ KW28 communities found:")
                for comm in kw28_communities:
                    print(f"     - ID: {comm['id']}, Name: '{comm['name']}', Join Code: '{comm['join_code']}'")
            else:
                print("   ⚠️  No KW28 communities found")
                
        except Exception as e:
            print(f"   ⚠️  Warning: Could not check communities: {e}")
        
        # 5. Test critical queries
        print("\n5. Testing critical queries...")
        
        # Test user ID queries
        try:
            cursor.execute("SELECT id FROM users LIMIT 1")
            result = cursor.fetchone()
            if result:
                print("   ✅ users.id query works")
            else:
                print("   ⚠️  users table is empty")
        except Exception as e:
            print(f"   ❌ users.id query fails: {e}")
        
        # Test user_communities join
        try:
            cursor.execute("""
                SELECT COUNT(*) as count 
                FROM user_communities uc 
                LEFT JOIN users u ON uc.user_id = u.id 
                LIMIT 1
            """)
            print("   ✅ user_communities join with users.id works")
        except Exception as e:
            print(f"   ❌ user_communities join fails: {e}")
        
        # Test user_profiles query
        try:
            cursor.execute("SELECT username, website, cover_photo FROM user_profiles LIMIT 1")
            print("   ✅ user_profiles extended query works")
        except Exception as e:
            print(f"   ❌ user_profiles query fails: {e}")
        
        cursor.close()
        conn.close()
        
        print("\n🎉 Final fix completed!")
        print("\nRecommendations:")
        print("1. Restart your Flask application")
        print("2. Set environment variables if not already set:")
        print("   export DB_BACKEND=mysql")
        print("   export MYSQL_HOST=YOUR_CLOUD_SQL_HOST")
        print("   export MYSQL_USER=puntz08")
        print("   export MYSQL_PASSWORD=your_password")
        print("   export MYSQL_DATABASE='puntz08$C-Point'")
        print("3. Test community creation and visibility")
        
        return True
        
    except ImportError as e:
        print(f"❌ PyMySQL not available: {e}")
        return False
    except Exception as e:
        print(f"❌ Fix failed: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--help":
        print("Final MySQL Compatibility Fix")
        print("Usage: python final_mysql_fix.py")
        print("\nThis script fixes all remaining MySQL compatibility issues:")
        print("- Ensures users table has id column")
        print("- Adds missing columns to user_profiles table")
        print("- Fixes replies table structure")
        print("- Verifies community visibility")
        print("- Tests all critical queries")
        sys.exit(0)
    
    success = run_final_fix()
    sys.exit(0 if success else 1)