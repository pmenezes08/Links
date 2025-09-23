#!/usr/bin/env python3
"""
MySQL-Safe Database Diagnostic Script
Handles MySQL datetime issues that cause the app to break
Run this on PythonAnywhere bash console
"""

import pymysql
from datetime import datetime, timedelta

def mysql_safe_diagnose():
    """Diagnose database issues with MySQL-safe queries"""

    print("🔍 MySQL-Safe Database Diagnostic")
    print("=" * 40)

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

            # ===============================
            # SAFE POSTS DIAGNOSTIC
            # ===============================
            print("\n📝 POSTS DIAGNOSTIC (MySQL-Safe):")

            # Total posts (safe)
            c.execute("SELECT COUNT(*) as total FROM posts")
            result = c.fetchone()
            total_posts = result['total'] if result else 0
            print(f"   Total posts: {total_posts}")

            # Check for problematic timestamp formats
            try:
                c.execute("SELECT COUNT(*) as problematic FROM posts WHERE timestamp = '' OR timestamp IS NULL")
                result = c.fetchone()
                empty_timestamps = result['problematic'] if result else 0
                print(f"   Posts with empty/null timestamps: {empty_timestamps}")
            except:
                print("   ⚠️  Could not check empty timestamps")

            # Check for 0000-00-00 timestamps
            try:
                c.execute("SELECT COUNT(*) as invalid FROM posts WHERE timestamp LIKE '0000-00-00%'")
                result = c.fetchone()
                invalid_timestamps = result['invalid'] if result else 0
                print(f"   Posts with 0000-00-00 timestamps: {invalid_timestamps}")
            except:
                print("   ⚠️  Could not check 0000-00-00 timestamps")

            # ===============================
            # COMMUNITIES DIAGNOSTIC
            # ===============================
            print("\n🏘️  COMMUNITIES DIAGNOSTIC:")

            c.execute("SELECT COUNT(*) as total FROM communities")
            result = c.fetchone()
            total_communities = result['total'] if result else 0
            print(f"   Total communities: {total_communities}")

            c.execute("SELECT COUNT(*) as active FROM communities WHERE is_active = 1")
            result = c.fetchone()
            active_communities = result['active'] if result else 0
            print(f"   Active communities: {active_communities}")

            # ===============================
            # USER PROFILES DIAGNOSTIC
            # ===============================
            print("\n👤 USER PROFILES DIAGNOSTIC:")

            c.execute("SELECT COUNT(*) as total FROM user_profiles")
            result = c.fetchone()
            total_profiles = result['total'] if result else 0
            print(f"   Total user profiles: {total_profiles}")

            c.execute("SELECT COUNT(*) as with_pics FROM user_profiles WHERE profile_picture IS NOT NULL AND profile_picture != ''")
            result = c.fetchone()
            profiles_with_pics = result['with_pics'] if result else 0
            print(f"   Profiles with pictures: {profiles_with_pics}")

            # ===============================
            # MEMBERSHIP DIAGNOSTIC
            # ===============================
            print("\n🔗 MEMBERSHIP DIAGNOSTIC:")

            c.execute("SELECT COUNT(*) as memberships FROM user_communities")
            result = c.fetchone()
            total_memberships = result['memberships'] if result else 0
            print(f"   Total memberships: {total_memberships}")

            # ===============================
            # TABLES CHECK
            # ===============================
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

            # ===============================
            # SAMPLE PROBLEMATIC POSTS
            # ===============================
            print("\n🔍 SAMPLE PROBLEMATIC POSTS:")

            try:
                c.execute("""
                    SELECT id, username, timestamp, LEFT(content, 50) as content_preview
                    FROM posts
                    WHERE timestamp LIKE '0000-00-00%'
                    OR timestamp = ''
                    OR timestamp IS NULL
                    ORDER BY id DESC
                    LIMIT 5
                """)

                problematic_posts = c.fetchall()

                if problematic_posts:
                    print(f"   Found {len(problematic_posts)} problematic posts:")
                    for post in problematic_posts:
                        timestamp_display = post['timestamp'] if post['timestamp'] else 'NULL'
                        print(f"     ID {post['id']} ({post['username']}): '{timestamp_display}'")
                        print(f"       Content: {post['content_preview']}...")
                        print()
                else:
                    print("   ✅ No obviously problematic posts found")

            except Exception as e:
                print(f"   ⚠️  Could not check problematic posts: {e}")

            # ===============================
            # DIAGNOSIS SUMMARY
            # ===============================
            print("\n" + "=" * 50)
            print("🔍 DIAGNOSTIC SUMMARY")
            print("=" * 50)

            issues_found = []

            if invalid_timestamps > 0:
                issues_found.append(f"❌ {invalid_timestamps} posts with 0000-00-00 timestamps")
            if empty_timestamps > 0:
                issues_found.append(f"❌ {empty_timestamps} posts with empty/null timestamps")
            if active_communities == 0:
                issues_found.append("❌ No active communities")
            if profiles_with_pics == 0:
                issues_found.append("❌ No profile pictures")
            if missing_tables:
                issues_found.append(f"❌ Missing tables: {missing_tables}")

            if issues_found:
                print("🚨 ISSUES FOUND:")
                for issue in issues_found:
                    print(f"   {issue}")
            else:
                print("✅ No obvious issues detected")

            print(f"\n📊 OVERVIEW:")
            print(f"   • Total posts: {total_posts}")
            print(f"   • Total communities: {total_communities}")
            print(f"   • Active communities: {active_communities}")
            print(f"   • User profiles: {total_profiles}")
            print(f"   • Profiles with pictures: {profiles_with_pics}")

            print("\n💡 RECOMMENDATION:")
            if issues_found:
                print("   Run the comprehensive fix: python mysql_safe_fix.py")
            else:
                print("   Your database looks OK. Check your Flask app logs for other issues.")

            print("=" * 50)

            return True

    except Exception as e:
        print(f"❌ Error: {e}")
        return False
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    mysql_safe_diagnose()
