#!/usr/bin/env python3
"""
Migrate User Profiles and Avatars from SQLite to MySQL
Transfers user profile data including profile pictures
"""

import os
import sys
import sqlite3

def get_sqlite_connection(db_path):
    """Connect to SQLite database"""
    try:
        if not os.path.exists(db_path):
            print(f"❌ SQLite database not found at: {db_path}")
            return None
        
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        print(f"❌ Error connecting to SQLite: {e}")
        return None

def get_mysql_connection():
    """Connect to MySQL database"""
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        host = os.environ.get('MYSQL_HOST', 'puntz08.mysql.pythonanywhere-services.com')
        user = os.environ.get('MYSQL_USER', 'puntz08')
        password = os.environ.get('MYSQL_PASSWORD')
        database = os.environ.get('MYSQL_DATABASE', 'puntz08$C-Point')
        
        if not password:
            print("❌ Error: MYSQL_PASSWORD environment variable is required!")
            return None
            
        conn = pymysql.connect(
            host=host,
            user=user,
            password=password,
            database=database,
            charset='utf8mb4',
            cursorclass=DictCursor,
            autocommit=False
        )
        return conn
    except Exception as e:
        print(f"❌ Error connecting to MySQL: {e}")
        return None

def safe_get(row, key, default=''):
    """Safely get values from SQLite Row"""
    try:
        return row[key] if row[key] is not None else default
    except (IndexError, KeyError):
        return default

def migrate_user_profiles():
    """Migrate user profiles from SQLite to MySQL"""
    
    # Get SQLite database path
    sqlite_path = input("Enter path to SQLite database file (default: /home/puntz08/WorkoutX/Links/users.db): ").strip()
    if not sqlite_path:
        sqlite_path = "/home/puntz08/WorkoutX/Links/users.db"
    
    print(f"\nUser Profile Migration")
    print("=" * 30)
    print(f"SQLite Database: {sqlite_path}")
    
    # Connect to databases
    print("\n1. Connecting to databases...")
    sqlite_conn = get_sqlite_connection(sqlite_path)
    if not sqlite_conn:
        return False
    
    mysql_conn = get_mysql_connection()
    if not mysql_conn:
        sqlite_conn.close()
        return False
    
    print("✅ Connected to both databases successfully!")
    
    try:
        sqlite_cursor = sqlite_conn.cursor()
        mysql_cursor = mysql_conn.cursor()
        
        # Get target users
        target_users = ['Paulo', 'mary', 'admin']
        print(f"\n2. Looking for users: {target_users}")
        
        migrated_count = 0
        
        for username in target_users:
            print(f"\n   Processing user: {username}")
            
            # Get user profile from SQLite
            sqlite_cursor.execute("SELECT * FROM user_profiles WHERE username = ?", (username,))
            profile = sqlite_cursor.fetchone()
            
            if not profile:
                print(f"     ❌ No profile found in SQLite for {username}")
                continue
            
            print(f"     ✅ Found profile in SQLite")
            
            # Check if profile already exists in MySQL
            mysql_cursor.execute("SELECT username FROM user_profiles WHERE username = %s", (username,))
            existing = mysql_cursor.fetchone()
            
            # Prepare profile data
            profile_data = {
                'username': username,
                'display_name': safe_get(profile, 'display_name', username),
                'bio': safe_get(profile, 'bio', ''),
                'location': safe_get(profile, 'location', ''),
                'website': safe_get(profile, 'website', ''),
                'instagram': safe_get(profile, 'instagram', ''),
                'twitter': safe_get(profile, 'twitter', ''),
                'profile_picture': safe_get(profile, 'profile_picture', ''),
                'cover_photo': safe_get(profile, 'cover_photo', ''),
                'is_public': safe_get(profile, 'is_public', 1),
                'created_at': safe_get(profile, 'created_at', ''),
                'updated_at': safe_get(profile, 'updated_at', '')
            }
            
            # Show what we're migrating
            if profile_data['profile_picture']:
                print(f"     📸 Profile picture: {profile_data['profile_picture']}")
            if profile_data['display_name'] != username:
                print(f"     📝 Display name: {profile_data['display_name']}")
            if profile_data['bio']:
                print(f"     📄 Bio: {profile_data['bio'][:50]}...")
            
            try:
                if existing:
                    # Update existing profile
                    print(f"     🔄 Updating existing profile...")
                    mysql_cursor.execute("""
                        UPDATE user_profiles SET
                        display_name = %(display_name)s,
                        bio = %(bio)s,
                        location = %(location)s,
                        website = %(website)s,
                        instagram = %(instagram)s,
                        twitter = %(twitter)s,
                        profile_picture = %(profile_picture)s,
                        cover_photo = %(cover_photo)s,
                        is_public = %(is_public)s,
                        updated_at = NOW()
                        WHERE username = %(username)s
                    """, profile_data)
                else:
                    # Insert new profile
                    print(f"     ➕ Creating new profile...")
                    mysql_cursor.execute("""
                        INSERT INTO user_profiles 
                        (username, display_name, bio, location, website, instagram, twitter, 
                         profile_picture, cover_photo, is_public, created_at, updated_at)
                        VALUES 
                        (%(username)s, %(display_name)s, %(bio)s, %(location)s, %(website)s, 
                         %(instagram)s, %(twitter)s, %(profile_picture)s, %(cover_photo)s, 
                         %(is_public)s, NOW(), NOW())
                    """, profile_data)
                
                mysql_conn.commit()
                migrated_count += 1
                print(f"     ✅ Successfully migrated profile for {username}")
                
            except Exception as e:
                print(f"     ❌ Failed to migrate {username}: {e}")
                mysql_conn.rollback()
        
        # Verify migration
        print(f"\n3. Verifying migration...")
        for username in target_users:
            mysql_cursor.execute("""
                SELECT username, display_name, profile_picture 
                FROM user_profiles 
                WHERE username = %s
            """, (username,))
            result = mysql_cursor.fetchone()
            
            if result:
                pic_status = "✅ HAS AVATAR" if result['profile_picture'] else "❌ NO AVATAR"
                display = result['display_name'] or username
                print(f"   {username} ({display}): {pic_status}")
                if result['profile_picture']:
                    print(f"     Avatar path: {result['profile_picture']}")
            else:
                print(f"   {username}: ❌ NOT FOUND")
        
        sqlite_conn.close()
        mysql_conn.close()
        
        print(f"\n🎉 Migration completed! Migrated {migrated_count} user profiles.")
        
        if migrated_count > 0:
            print("\nNext steps:")
            print("1. Restart your Flask application")
            print("2. Check that avatars are visible in the app")
            print("3. Verify that profile pictures are loading correctly")
        
        return True
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        sqlite_conn.close()
        mysql_conn.close()
        return False

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--help":
        print("User Profile Migration Script")
        print("Usage: python migrate_user_profiles.py")
        print("\nThis script migrates user profiles and avatars from SQLite to MySQL.")
        print("Target users: Paulo, mary, admin")
        print("\nRequired environment variable:")
        print("  MYSQL_PASSWORD - Your MySQL password")
        sys.exit(0)
    
    success = migrate_user_profiles()
    sys.exit(0 if success else 1)