#!/usr/bin/env python3
"""
Database Diagnostic Script
Check what's currently in your database to diagnose the issues
Run this on PythonAnywhere bash console
"""

import pymysql
from datetime import datetime, timedelta

def diagnose_database():
    """Diagnose database issues"""

    print("🔍 Database Diagnostic")
    print("=" * 30)

    mysql_config = {
        'host': 'puntz08.mysql.pythonanywhere-services.com',
        'user': 'puntz08',
        'password': '',  # Will be prompted
        'database': 'puntz08$C-Point'
    }

    # Get MySQL password
    print("Enter your MySQL password:")
    mysql_password = input().strip()

    if not mysql_password:
        print("❌ MySQL password is required")
        return False

    mysql_config['password'] = mysql_password

    try:
        conn = pymysql.connect(
            host=mysql_config['host'],
            user=mysql_config['user'],
            password=mysql_config['password'],
            database=mysql_config['database'],
            cursorclass=pymysql.cursors.DictCursor
        )
        print("✅ Connected to MySQL successfully!")

        with conn.cursor() as c:

            # Check posts with issues
            print("\n📝 POSTS DIAGNOSTIC:")
            c.execute("SELECT COUNT(*) as total FROM posts")
            result = c.fetchone()
            print(f"   Total posts: {result['total']}")

            c.execute("SELECT COUNT(*) as invalid FROM posts WHERE timestamp LIKE '0000-00-00%' OR timestamp IS NULL OR timestamp = ''")
            result = c.fetchone()
            print(f"   Posts with invalid timestamps: {result['invalid']}")

            # Check recent posts (should be visible)
            now = datetime.now()
            cutoff = now - timedelta(hours=48)
            c.execute("""
                SELECT COUNT(*) as recent
                FROM posts
                WHERE timestamp >= %s
                AND timestamp NOT LIKE '0000-00-00%'
                AND timestamp IS NOT NULL
                AND timestamp != ''
            """, (cutoff.strftime('%Y-%m-%d %H:%M:%S'),))
            result = c.fetchone()
            print(f"   Posts from last 48 hours: {result['recent']}")

            # Check communities
            print("\n🏘️  COMMUNITIES DIAGNOSTIC:")
            c.execute("SELECT COUNT(*) as total FROM communities")
            result = c.fetchone()
            print(f"   Total communities: {result['total']}")

            c.execute("SELECT COUNT(*) as active FROM communities WHERE is_active = 1 OR is_active IS NULL")
            result = c.fetchone()
            print(f"   Active communities: {result['active']}")

            # Check user profiles
            print("\n👤 USER PROFILES DIAGNOSTIC:")
            c.execute("SELECT COUNT(*) as total FROM user_profiles")
            result = c.fetchone()
            print(f"   Total user profiles: {result['total']}")

            c.execute("SELECT COUNT(*) as with_pics FROM user_profiles WHERE profile_picture IS NOT NULL AND profile_picture != ''")
            result = c.fetchone()
            print(f"   Profiles with pictures: {result['with_pics']}")

            # Check user communities relationship
            print("\n🔗 MEMBERSHIP DIAGNOSTIC:")
            c.execute("SELECT COUNT(*) as memberships FROM user_communities")
            result = c.fetchone()
            print(f"   Total memberships: {result['memberships']}")

            # Check specific user (if they want to check themselves)
            print("\n👤 USER SPECIFIC CHECK:")
            username = input("Enter username to check (or press Enter to skip): ").strip()

            if username:
                # Check user's communities
                c.execute("""
                    SELECT COUNT(*) as user_comms
                    FROM user_communities uc
                    JOIN users u ON uc.user_id = u.id
                    WHERE u.username = %s
                """, (username,))
                result = c.fetchone()
                print(f"   {username}'s communities: {result['user_comms']}")

                # Check user's posts
                c.execute("SELECT COUNT(*) as user_posts FROM posts WHERE username = %s", (username,))
                result = c.fetchone()
                print(f"   {username}'s posts: {result['user_posts']}")

                # Check user's profile
                c.execute("SELECT profile_picture FROM user_profiles WHERE username = %s", (username,))
                result = c.fetchone()
                if result and result['profile_picture']:
                    print(f"   {username}'s profile picture: ✅ Exists")
                else:
                    print(f"   {username}'s profile picture: ❌ Missing")

            # Check missing tables
            print("\n📋 TABLES CHECK:")
            c.execute("SHOW TABLES")
            tables = c.fetchall()
            table_names = [list(table.values())[0] for table in tables]

            required_tables = ['university_ads', 'polls', 'poll_options', 'poll_votes']
            missing_tables = []

            for table in required_tables:
                if table not in table_names:
                    missing_tables.append(table)
                    print(f"   ❌ Missing table: {table}")
                else:
                    print(f"   ✅ Table exists: {table}")

            if not missing_tables:
                print("   ✅ All required tables exist")

            print("\n" + "=" * 50)
            print("🔍 DIAGNOSTIC COMPLETE")
            print("=" * 50)

            if result['invalid'] > 0:
                print(f"⚠️  ISSUE FOUND: {result['invalid']} posts have invalid timestamps")
            if result['active'] == 0:
                print("⚠️  ISSUE FOUND: No active communities")
            if missing_tables:
                print(f"⚠️  ISSUE FOUND: Missing tables: {missing_tables}")

            print("\n💡 RECOMMENDATION:")
            print("   Run: python comprehensive_database_fix.py")
            print("=" * 50)

            return True

    except Exception as e:
        print(f"❌ Error: {e}")
        return False
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    diagnose_database()
