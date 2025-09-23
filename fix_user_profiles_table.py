#!/usr/bin/env python3
"""
Fix User Profiles Table Structure
Ensures all required columns exist before migration
"""

import os
import sys

def fix_user_profiles_table():
    """Add missing columns to user_profiles table"""
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
        
        print("Fix User Profiles Table Structure")
        print("=" * 40)
        
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
        
        # Check current table structure
        print("\n1. Checking current user_profiles table structure...")
        cursor.execute("SHOW COLUMNS FROM user_profiles")
        columns = cursor.fetchall()
        column_names = [col['Field'] for col in columns]
        
        print(f"   Current columns: {column_names}")
        
        # Define required columns
        required_columns = {
            'username': 'VARCHAR(255) PRIMARY KEY',
            'display_name': 'TEXT',
            'bio': 'TEXT',
            'location': 'TEXT',
            'website': 'TEXT',
            'instagram': 'TEXT',
            'twitter': 'TEXT',
            'profile_picture': 'TEXT',
            'cover_photo': 'TEXT',
            'is_public': 'TINYINT(1) DEFAULT 1',
            'created_at': 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
            'updated_at': 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
        }
        
        # Find missing columns
        missing_columns = []
        for col_name, col_def in required_columns.items():
            if col_name not in column_names:
                missing_columns.append((col_name, col_def))
        
        if missing_columns:
            print(f"\n2. Adding missing columns: {[col[0] for col in missing_columns]}")
            
            for col_name, col_def in missing_columns:
                try:
                    # Special handling for primary key
                    if 'PRIMARY KEY' in col_def:
                        if 'username' not in column_names:
                            cursor.execute(f"ALTER TABLE user_profiles ADD COLUMN {col_name} {col_def}")
                    else:
                        cursor.execute(f"ALTER TABLE user_profiles ADD COLUMN {col_name} {col_def}")
                    
                    print(f"   ✅ Added column: {col_name}")
                    
                except Exception as e:
                    print(f"   ⚠️  Could not add {col_name}: {e}")
            
            conn.commit()
            print("   ✅ All missing columns added")
        else:
            print("\n2. ✅ All required columns already exist")
        
        # Verify final structure
        print("\n3. Verifying final table structure...")
        cursor.execute("SHOW COLUMNS FROM user_profiles")
        final_columns = cursor.fetchall()
        final_column_names = [col['Field'] for col in final_columns]
        
        print(f"   Final columns: {final_column_names}")
        
        # Check for all required columns
        missing_after_fix = []
        for col_name in required_columns.keys():
            if col_name not in final_column_names:
                missing_after_fix.append(col_name)
        
        if missing_after_fix:
            print(f"   ❌ Still missing: {missing_after_fix}")
            return False
        else:
            print("   ✅ All required columns present")
        
        cursor.close()
        conn.close()
        
        print("\n🎉 User profiles table structure fixed!")
        print("\nYou can now run: python migrate_user_profiles.py")
        
        return True
        
    except Exception as e:
        print(f"❌ Error fixing user_profiles table: {e}")
        return False

if __name__ == "__main__":
    success = fix_user_profiles_table()
    sys.exit(0 if success else 1)