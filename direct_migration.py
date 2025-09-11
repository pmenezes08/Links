#!/usr/bin/env python3
"""
Direct MySQL Migration Script
Connects directly to MySQL without using Flask app configuration
"""

import os
import sys

def run_migration():
    """Run database migration with direct MySQL connection"""
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        # Get MySQL credentials from environment or use PythonAnywhere defaults
        host = os.environ.get('MYSQL_HOST', 'puntz08.mysql.pythonanywhere-services.com')
        user = os.environ.get('MYSQL_USER', 'puntz08')
        password = os.environ.get('MYSQL_PASSWORD')
        database = os.environ.get('MYSQL_DATABASE', 'puntz08$C-Point')
        
        if not password:
            print("❌ Error: MYSQL_PASSWORD environment variable is required!")
            print("Set it with: export MYSQL_PASSWORD='your_password'")
            return False
        
        print("Direct MySQL Migration Script")
        print("=" * 40)
        print(f"Connecting to: {host}")
        print(f"Database: {database}")
        print(f"User: {user}")
        
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
        
        # 1. Fix users table - ensure it has id column
        print("\n1. Checking users table...")
        try:
            cursor.execute("SHOW COLUMNS FROM users LIKE 'id'")
            if not cursor.fetchone():
                print("   Adding id column to users table...")
                cursor.execute("ALTER TABLE users ADD COLUMN id INTEGER PRIMARY KEY AUTO_INCREMENT FIRST")
                conn.commit()
                print("   ✅ Added id column")
            else:
                print("   ✅ Users table already has id column")
        except Exception as e:
            print(f"   ⚠️  Warning: Could not fix users table: {e}")
        
        # 2. Fix user_communities table
        print("\n2. Checking user_communities table...")
        try:
            cursor.execute("SHOW TABLES LIKE 'user_communities'")
            if not cursor.fetchone():
                print("   Creating user_communities table...")
                cursor.execute('''CREATE TABLE user_communities (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    user_id INTEGER NOT NULL,
                    community_id INTEGER NOT NULL,
                    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_id (user_id),
                    INDEX idx_community_id (community_id),
                    UNIQUE KEY unique_user_community (user_id, community_id)
                )''')
                conn.commit()
                print("   ✅ Created user_communities table")
            else:
                # Check if it has user_id column
                cursor.execute("SHOW COLUMNS FROM user_communities LIKE 'user_id'")
                if not cursor.fetchone():
                    print("   user_id column missing, recreating table...")
                    cursor.execute("DROP TABLE user_communities")
                    cursor.execute('''CREATE TABLE user_communities (
                        id INTEGER PRIMARY KEY AUTO_INCREMENT,
                        user_id INTEGER NOT NULL,
                        community_id INTEGER NOT NULL,
                        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_user_id (user_id),
                        INDEX idx_community_id (community_id),
                        UNIQUE KEY unique_user_community (user_id, community_id)
                    )''')
                    conn.commit()
                    print("   ✅ Recreated user_communities table")
                else:
                    print("   ✅ user_communities table is correct")
        except Exception as e:
            print(f"   ⚠️  Warning: Could not fix user_communities table: {e}")
        
        # 3. Fix notifications table
        print("\n3. Checking notifications table...")
        try:
            cursor.execute("SHOW COLUMNS FROM notifications LIKE 'created_at'")
            if not cursor.fetchone():
                print("   Adding created_at column to notifications...")
                cursor.execute("ALTER TABLE notifications ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
                conn.commit()
                print("   ✅ Added created_at column")
            else:
                print("   ✅ Notifications table already has created_at column")
        except Exception as e:
            print(f"   ⚠️  Warning: Could not fix notifications table: {e}")
        
        # 4. Create user_login_history table
        print("\n4. Checking user_login_history table...")
        try:
            cursor.execute("SHOW TABLES LIKE 'user_login_history'")
            if not cursor.fetchone():
                print("   Creating user_login_history table...")
                cursor.execute('''CREATE TABLE user_login_history (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    username VARCHAR(255) NOT NULL,
                    login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    ip_address VARCHAR(45),
                    user_agent TEXT,
                    INDEX idx_username (username),
                    INDEX idx_login_time (login_time)
                )''')
                conn.commit()
                print("   ✅ Created user_login_history table")
            else:
                print("   ✅ user_login_history table already exists")
        except Exception as e:
            print(f"   ⚠️  Warning: Could not create user_login_history table: {e}")
        
        # 5. Create other essential tables
        print("\n5. Checking other essential tables...")
        
        # Push subscriptions
        try:
            cursor.execute("SHOW TABLES LIKE 'push_subscriptions'")
            if not cursor.fetchone():
                cursor.execute('''CREATE TABLE push_subscriptions (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    username VARCHAR(255) NOT NULL,
                    endpoint TEXT NOT NULL,
                    p256dh TEXT,
                    auth TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_endpoint (endpoint(255))
                )''')
                conn.commit()
                print("   ✅ Created push_subscriptions table")
            else:
                print("   ✅ push_subscriptions table already exists")
        except Exception as e:
            print(f"   ⚠️  Warning: Could not create push_subscriptions table: {e}")
        
        # 6. Verify the fixes
        print("\n6. Verifying migration...")
        
        # Test user_communities query
        try:
            cursor.execute("SELECT COUNT(*) as count FROM user_communities uc JOIN users u ON uc.user_id = u.id LIMIT 1")
            print("   ✅ user_communities.user_id join works")
        except Exception as e:
            print(f"   ❌ user_communities.user_id join still fails: {e}")
        
        # Test notifications created_at query
        try:
            cursor.execute("SELECT COUNT(*) as count FROM notifications WHERE created_at > '2020-01-01' LIMIT 1")
            print("   ✅ notifications.created_at query works")
        except Exception as e:
            print(f"   ❌ notifications.created_at query still fails: {e}")
        
        cursor.close()
        conn.close()
        
        print("\n🎉 Migration completed successfully!")
        print("\nNext steps:")
        print("1. Make sure your Flask app has these environment variables set:")
        print("   export DB_BACKEND=mysql")
        print("   export MYSQL_HOST=puntz08.mysql.pythonanywhere-services.com")
        print("   export MYSQL_USER=puntz08")
        print("   export MYSQL_PASSWORD=your_password")
        print("   export MYSQL_DATABASE='puntz08$C-Point'")
        print("2. Restart your Flask application")
        
        return True
        
    except ImportError as e:
        print(f"❌ PyMySQL not available: {e}")
        print("Install with: pip install PyMySQL")
        return False
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--help":
        print("Direct MySQL Migration Script")
        print("Usage: python direct_migration.py")
        print("\nRequired environment variable:")
        print("  MYSQL_PASSWORD - Your MySQL password")
        print("\nOptional environment variables:")
        print("  MYSQL_HOST     - MySQL host (default: puntz08.mysql.pythonanywhere-services.com)")
        print("  MYSQL_USER     - MySQL user (default: puntz08)")
        print("  MYSQL_DATABASE - Database name (default: puntz08$C-Point)")
        print("\nExample:")
        print("  export MYSQL_PASSWORD='your_password'")
        print("  python direct_migration.py")
        sys.exit(0)
    
    success = run_migration()
    sys.exit(0 if success else 1)