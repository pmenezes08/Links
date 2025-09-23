#!/usr/bin/env python3
"""
Debug Profile Page Error
Test the /api/profile_me endpoint to find the specific error
"""

import os
import sys

def debug_profile_error():
    """Debug the profile page error"""
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
        
        print("Profile Page Error Debug")
        print("=" * 30)
        
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
        
        # Test the exact query from /api/profile_me
        username = 'Paulo'  # Test with your username
        print(f"\n🔍 Testing profile query for user: {username}")
        
        try:
            cursor.execute("""
                SELECT u.username, u.email, u.subscription,
                       p.display_name, p.bio, p.location, p.website,
                       p.instagram, p.twitter, p.profile_picture, p.cover_photo
                FROM users u
                LEFT JOIN user_profiles p ON u.username = p.username
                WHERE u.username = %s
            """, (username,))
            
            row = cursor.fetchone()
            
            if row:
                print("   ✅ Profile query successful!")
                print("   📋 Profile data:")
                for key, value in row.items():
                    print(f"     - {key}: {value}")
            else:
                print(f"   ❌ No profile data found for {username}")
                
                # Check if user exists in users table
                cursor.execute("SELECT username FROM users WHERE username = %s", (username,))
                user_exists = cursor.fetchone()
                
                if user_exists:
                    print(f"   ✅ User {username} exists in users table")
                    
                    # Check if profile exists in user_profiles table
                    cursor.execute("SELECT username FROM user_profiles WHERE username = %s", (username,))
                    profile_exists = cursor.fetchone()
                    
                    if profile_exists:
                        print(f"   ✅ Profile exists in user_profiles table")
                    else:
                        print(f"   ❌ No profile in user_profiles table for {username}")
                else:
                    print(f"   ❌ User {username} does not exist in users table")
                
        except Exception as e:
            print(f"   ❌ Profile query failed: {e}")
            
            # Check table structures
            print("\n🔍 Checking table structures...")
            
            # Check users table
            try:
                cursor.execute("SHOW COLUMNS FROM users")
                users_columns = cursor.fetchall()
                print(f"   Users table columns: {[col['Field'] for col in users_columns]}")
            except Exception as e:
                print(f"   ❌ Error checking users table: {e}")
            
            # Check user_profiles table
            try:
                cursor.execute("SHOW COLUMNS FROM user_profiles")
                profiles_columns = cursor.fetchall()
                print(f"   User_profiles table columns: {[col['Field'] for col in profiles_columns]}")
            except Exception as e:
                print(f"   ❌ Error checking user_profiles table: {e}")
                
        # Test messages table for photo messaging
        print(f"\n📸 Testing messages table for photo messaging...")
        try:
            cursor.execute("SHOW COLUMNS FROM messages")
            messages_columns = cursor.fetchall()
            messages_column_names = [col['Field'] for col in messages_columns]
            print(f"   Messages table columns: {messages_column_names}")
            
            if 'image_path' in messages_column_names:
                print("   ✅ image_path column exists in messages table")
            else:
                print("   ❌ image_path column missing from messages table")
                print("   🔧 Run: python fix_messages_table.py")
                
        except Exception as e:
            print(f"   ❌ Error checking messages table: {e}")
        
        cursor.close()
        conn.close()
        
        print("\n💡 Recommendations:")
        print("1. If profile query failed due to missing columns:")
        print("   - Run: python fix_user_profiles_table.py")
        print("2. If image_path column is missing:")
        print("   - Run: python fix_messages_table.py") 
        print("3. If user doesn't exist in user_profiles:")
        print("   - Run: python migrate_user_profiles.py")
        print("4. After fixes, restart Flask application")
        
        return True
        
    except Exception as e:
        print(f"❌ Debug failed: {e}")
        return False

if __name__ == "__main__":
    success = debug_profile_error()
    sys.exit(0 if success else 1)