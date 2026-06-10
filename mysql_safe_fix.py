#!/usr/bin/env python3
"""
MySQL-Safe Database Fix Script
Safely fixes MySQL datetime issues without causing errors
Run this on Cloud Run bash console
"""

import pymysql
from datetime import datetime, timedelta

def mysql_safe_fix():
    """Fix database issues with MySQL-safe operations"""

    print("🔧 MySQL-Safe Database Fix")
    print("=" * 30)

    mysql_config = {
        'host': 'YOUR_CLOUD_SQL_HOST',
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

            fixes_applied = 0

            # ===============================
            # FIX 1: Create Missing Tables
            # ===============================
            print("\n🔧 Fix 1: Creating missing tables...")

            # Create university_ads table if it doesn't exist
            try:
                c.execute('''CREATE TABLE IF NOT EXISTS university_ads (
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
                )''')
                print("   ✅ university_ads table created/verified")
                fixes_applied += 1
            except Exception as e:
                print(f"   ⚠️  university_ads table issue: {e}")

            # ===============================
            # FIX 2: Fix Invalid Timestamps (Safe Method)
            # ===============================
            print("\n🔧 Fix 2: Fixing invalid timestamps (safe method)...")

            # Find posts with invalid timestamps using safe queries
            try:
                # Get posts with 0000-00-00 timestamps
                c.execute("""
                    SELECT id, username
                    FROM posts
                    WHERE timestamp LIKE '0000-00-00%'
                    ORDER BY id DESC
                    LIMIT 20
                """)

                invalid_posts = c.fetchall()
                print(f"   Found {len(invalid_posts)} posts with 0000-00-00 timestamps")

                if invalid_posts:
                    base_time = datetime.now() - timedelta(hours=24)

                    for i, post in enumerate(invalid_posts):
                        post_id = post['id']
                        # Each post gets a timestamp 2 hours apart, starting 24 hours ago
                        post_time = base_time + timedelta(hours=i*2)
                        dd_mm_yyyy_timestamp = post_time.strftime('%d-%m-%Y %H:%M:%S')

                        try:
                            c.execute("""
                                UPDATE posts
                                SET timestamp = %s
                                WHERE id = %s
                            """, (dd_mm_yyyy_timestamp, post_id))

                            print(f"   ✅ Fixed post {post_id}: {dd_mm_yyyy_timestamp}")
                            fixes_applied += 1

                        except Exception as e:
                            print(f"   ❌ Failed to fix post {post_id}: {e}")

            except Exception as e:
                print(f"   ⚠️  Could not fix 0000-00-00 timestamps: {e}")

            # Fix posts with empty/null timestamps
            try:
                c.execute("""
                    SELECT id, username
                    FROM posts
                    WHERE timestamp = '' OR timestamp IS NULL
                    ORDER BY id DESC
                    LIMIT 20
                """)

                empty_posts = c.fetchall()
                print(f"   Found {len(empty_posts)} posts with empty/null timestamps")

                if empty_posts:
                    base_time = datetime.now() - timedelta(hours=12)

                    for i, post in enumerate(empty_posts):
                        post_id = post['id']
                        # Each post gets a timestamp 1 hour apart, starting 12 hours ago
                        post_time = base_time + timedelta(hours=i)
                        dd_mm_yyyy_timestamp = post_time.strftime('%d-%m-%Y %H:%M:%S')

                        try:
                            c.execute("""
                                UPDATE posts
                                SET timestamp = %s
                                WHERE id = %s
                            """, (dd_mm_yyyy_timestamp, post_id))

                            print(f"   ✅ Fixed post {post_id}: {dd_mm_yyyy_timestamp}")
                            fixes_applied += 1

                        except Exception as e:
                            print(f"   ❌ Failed to fix post {post_id}: {e}")

            except Exception as e:
                print(f"   ⚠️  Could not fix empty timestamps: {e}")

            # ===============================
            # FIX 3: Ensure Communities are Active
            # ===============================
            print("\n🔧 Fix 3: Ensuring communities are active...")

            try:
                c.execute("""
                    UPDATE communities
                    SET is_active = 1
                    WHERE is_active IS NULL OR is_active = 0
                """)

                affected_rows = c.rowcount
                if affected_rows > 0:
                    print(f"   ✅ Activated {affected_rows} communities")
                    fixes_applied += affected_rows
                else:
                    print("   ✅ All communities already active")

            except Exception as e:
                print(f"   ⚠️  Could not activate communities: {e}")

            # ===============================
            # FIX 4: Add Missing User Profile Columns
            # ===============================
            print("\n🔧 Fix 4: Adding missing user_profiles columns...")

            try:
                # Check current table structure
                c.execute("SHOW COLUMNS FROM user_profiles")
                columns = c.fetchall()
                column_names = [col['Field'] for col in columns]

                required_columns = {
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
                            c.execute(f"ALTER TABLE user_profiles ADD COLUMN {col_name} {col_def}")
                            print(f"   ✅ Added column: {col_name}")
                            fixes_applied += 1
                        except Exception as e:
                            print(f"   ⚠️  Could not add {col_name}: {e}")

            except Exception as e:
                print(f"   ⚠️  Could not check/modify user_profiles: {e}")

            # ===============================
            # FIX 5: Verify Recent Posts
            # ===============================
            print("\n🔧 Fix 5: Verifying recent posts are visible...")

            try:
                # Check posts that should be visible in the last 48 hours
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
                recent_posts = result['recent'] if result else 0
                print(f"   📊 Posts from last 48 hours: {recent_posts}")

            except Exception as e:
                print(f"   ⚠️  Could not verify recent posts: {e}")

            # ===============================
            # COMMIT ALL CHANGES
            # ===============================
            conn.commit()
            print(f"\n💾 All changes committed to database")

            # ===============================
            # FINAL VERIFICATION
            # ===============================
            print("\n🔍 FINAL VERIFICATION:")

            # Check total posts
            c.execute("SELECT COUNT(*) as total FROM posts")
            result = c.fetchone()
            total_posts = result['total'] if result else 0

            # Check active communities
            c.execute("SELECT COUNT(*) as active FROM communities WHERE is_active = 1")
            result = c.fetchone()
            active_communities = result['active'] if result else 0

            # Check profiles with pictures
            c.execute("SELECT COUNT(*) as with_pics FROM user_profiles WHERE profile_picture IS NOT NULL AND profile_picture != ''")
            result = c.fetchone()
            profiles_with_pics = result['with_pics'] if result else 0

            print(f"   📊 Total posts: {total_posts}")
            print(f"   🏘️  Active communities: {active_communities}")
            print(f"   👤 Profiles with pictures: {profiles_with_pics}")

            print("\n" + "=" * 50)
            print("🎉 MYSQL-SAFE FIX COMPLETED!")
            print("=" * 50)
            print(f"✅ Fixes applied: {fixes_applied}")

            print("\n🚀 NEXT STEPS:")
            print("   1. Restart your Flask app on Cloud Run")
            print("   2. Clear browser cache (Ctrl+F5)")
            print("   3. Check home timeline - posts should appear")
            print("   4. Check communities page - communities should be visible")
            print("   5. Check profile pictures - avatars should display")
            print("")
            print("💡 If issues persist:")
            print("   - Check Flask app logs on Cloud Run")
            print("   - Verify your app is using the correct database connection")
            print("=" * 50)

            return True

    except Exception as e:
        print(f"❌ Error: {e}")
        return False
    finally:
        if 'conn' in locals():
            conn.close()
            print("🔌 Database connection closed")

if __name__ == "__main__":
    try:
        success = mysql_safe_fix()
        if not success:
            print("\n❌ Fix failed!")
            exit(1)
    except KeyboardInterrupt:
        print("\n❌ Fix cancelled by user")
        exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        exit(1)
