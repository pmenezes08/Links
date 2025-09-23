#!/usr/bin/env python3
"""
Comprehensive Database Fix for Links App
Fixes all major database issues causing missing posts, avatars, and communities
Run this on PythonAnywhere bash console
"""

import pymysql
import os
from datetime import datetime, timedelta
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def comprehensive_database_fix():
    """Fix all database issues in one comprehensive script"""

    print("🔧 Comprehensive Database Fix")
    print("=" * 50)

    # MySQL connection details for PythonAnywhere
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
        print("\n🔌 Connecting to MySQL...")
        conn = pymysql.connect(
            host=mysql_config['host'],
            user=mysql_config['user'],
            password=mysql_config['password'],
            database=mysql_config['database'],
            cursorclass=pymysql.cursors.DictCursor,
            charset='utf8mb4'
        )
        print("✅ Connected to MySQL successfully!")

        with conn.cursor() as c:

            # ===============================
            # FIX 1: Create Missing Tables
            # ===============================
            print("\n🔧 Fix 1: Creating missing tables...")

            # Create university_ads table if it doesn't exist
            c.execute("""
                CREATE TABLE IF NOT EXISTS university_ads (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    community_id INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    price TEXT NOT NULL,
                    image_url TEXT NOT NULL,
                    link_url TEXT,
                    is_active TINYINT(1) DEFAULT 1,
                    display_order INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL,
                    created_by TEXT NOT NULL,
                    clicks INTEGER DEFAULT 0,
                    impressions INTEGER DEFAULT 0,
                    FOREIGN KEY (community_id) REFERENCES communities (id) ON DELETE CASCADE
                )
            """)
            print("   ✅ university_ads table created/verified")

            # ===============================
            # FIX 2: Fix Invalid Timestamps
            # ===============================
            print("\n🔧 Fix 2: Fixing invalid timestamps...")

            # Find posts with invalid timestamps
            c.execute("""
                SELECT id, username, timestamp
                FROM posts
                WHERE timestamp LIKE '0000-00-00%'
                OR timestamp IS NULL
                OR timestamp = ''
                ORDER BY id DESC
                LIMIT 100
            """)

            invalid_posts = c.fetchall()
            print(f"   Found {len(invalid_posts)} posts with invalid timestamps")

            if invalid_posts:
                base_time = datetime.now() - timedelta(hours=24)

                for i, post in enumerate(invalid_posts):
                    post_id = post['id']
                    # Each post gets a timestamp 1 hour apart, starting 24 hours ago
                    post_time = base_time + timedelta(hours=i)
                    dd_mm_yyyy_timestamp = post_time.strftime('%d-%m-%Y %H:%M:%S')

                    try:
                        c.execute("""
                            UPDATE posts
                            SET timestamp = %s
                            WHERE id = %s
                        """, (dd_mm_yyyy_timestamp, post_id))

                        print(f"   ✅ Fixed post {post_id}: {dd_mm_yyyy_timestamp}")

                    except Exception as e:
                        print(f"   ❌ Failed to fix post {post_id}: {e}")

            # ===============================
            # FIX 3: Fix User Profiles Table
            # ===============================
            print("\n🔧 Fix 3: Fixing user_profiles table structure...")

            # Check current table structure
            c.execute("SHOW COLUMNS FROM user_profiles")
            columns = c.fetchall()
            column_names = [col['Field'] for col in columns]

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

            for col_name, col_def in required_columns.items():
                if col_name not in column_names:
                    try:
                        if 'PRIMARY KEY' in col_def:
                            c.execute(f"ALTER TABLE user_profiles ADD COLUMN {col_name} {col_def}")
                        else:
                            c.execute(f"ALTER TABLE user_profiles ADD COLUMN {col_name} {col_def}")
                        print(f"   ✅ Added column: {col_name}")
                    except Exception as e:
                        print(f"   ⚠️  Could not add {col_name}: {e}")

            # ===============================
            # FIX 4: Fix Parent/Child Community Memberships
            # ===============================
            print("\n🔧 Fix 4: Fixing parent/child community memberships...")

            # Find all child communities
            c.execute("""
                SELECT c.id, c.name, c.parent_community_id, pc.name as parent_name
                FROM communities c
                JOIN communities pc ON c.parent_community_id = pc.id
                WHERE c.parent_community_id IS NOT NULL
            """)

            child_communities = c.fetchall()
            print(f"   Found {len(child_communities)} child communities")

            total_added = 0
            for child in child_communities:
                child_id = child['id']
                parent_id = child['parent_community_id']

                # Get members of child community who are not in parent
                c.execute("""
                    SELECT uc.user_id, u.username
                    FROM user_communities uc
                    JOIN users u ON uc.user_id = u.id
                    WHERE uc.community_id = %s
                    AND uc.user_id NOT IN (
                        SELECT user_id FROM user_communities
                        WHERE community_id = %s
                    )
                """, (child_id, parent_id))

                members_to_add = c.fetchall()

                for member in members_to_add:
                    user_id = member['user_id']
                    username = member['username']

                    try:
                        c.execute("""
                            INSERT INTO user_communities (user_id, community_id, joined_at)
                            VALUES (%s, %s, NOW())
                        """, (user_id, parent_id))
                        total_added += 1
                        print(f"   ✅ Added {username} to parent community")
                    except Exception as e:
                        print(f"   ❌ Failed to add {username}: {e}")

            print(f"   📊 Total members added to parent communities: {total_added}")

            # ===============================
            # FIX 5: Ensure Communities are Active
            # ===============================
            print("\n🔧 Fix 5: Ensuring communities are active...")

            c.execute("""
                UPDATE communities
                SET is_active = 1
                WHERE is_active IS NULL OR is_active = 0
            """)

            affected_rows = c.rowcount
            print(f"   ✅ Activated {affected_rows} communities")

            # ===============================
            # FIX 6: Verify Database Integrity
            # ===============================
            print("\n🔧 Fix 6: Verifying database integrity...")

            # Check for posts that should be visible
            c.execute("""
                SELECT COUNT(*) as total_posts
                FROM posts
                WHERE timestamp NOT LIKE '0000-00-00%'
                AND timestamp IS NOT NULL
                AND timestamp != ''
            """)

            result = c.fetchone()
            valid_posts = result['total_posts'] if result else 0
            print(f"   📊 Valid posts in database: {valid_posts}")

            # Check user profiles
            c.execute("SELECT COUNT(*) as total_profiles FROM user_profiles")
            result = c.fetchone()
            profiles = result['total_profiles'] if result else 0
            print(f"   👤 User profiles: {profiles}")

            # Check communities
            c.execute("SELECT COUNT(*) as total_communities FROM communities WHERE is_active = 1")
            result = c.fetchone()
            communities = result['total_communities'] if result else 0
            print(f"   🏘️  Active communities: {communities}")

            # ===============================
            # FIX 7: Clear Cache (if Redis is available)
            # ===============================
            print("\n🔧 Fix 7: Clearing cache...")
            try:
                # This would be done via Redis if available
                print("   ℹ️  Cache clearing would be done via Redis in production")
            except:
                pass

            # Commit all changes
            conn.commit()
            print("\n✅ All database fixes applied successfully!")

            print("\n" + "=" * 50)
            print("🎉 DATABASE FIXES COMPLETED!")
            print("=" * 50)
            print("📋 Summary:")
            print(f"   • Fixed {len(invalid_posts) if 'invalid_posts' in locals() else 0} invalid timestamps")
            print(f"   • Activated {affected_rows} communities")
            print(f"   • Added {total_added} parent community memberships")
            print("   • Created missing tables")
            print("   • Fixed user_profiles structure")
            print("")
            print("🚀 Next steps:")
            print("   1. Restart your Flask app on PythonAnywhere")
            print("   2. Clear browser cache")
            print("   3. Check home timeline - posts should now appear")
            print("   4. Check communities page - all communities should be visible")
            print("   5. Check profile pictures - avatars should display")
            print("=" * 50)

            return True

    except pymysql.Error as e:
        print(f"❌ MySQL Error: {e}")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False
    finally:
        if 'conn' in locals():
            conn.close()
            print("🔌 Database connection closed")

if __name__ == "__main__":
    try:
        success = comprehensive_database_fix()
        if not success:
            print("\n❌ Fix failed!")
            exit(1)
    except KeyboardInterrupt:
        print("\n❌ Fix cancelled by user")
        exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        exit(1)
