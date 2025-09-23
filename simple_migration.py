#!/usr/bin/env python3
"""
Simple MySQL Migration Script
Uses the same database connection as the Flask app
"""

import sys
import os

# Add current directory to path to import from bodybuilding_app
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def run_migration():
    """Run database migration using Flask app's connection"""
    try:
        # Set environment variables to force MySQL usage
        os.environ['DB_BACKEND'] = 'mysql'
        
        # Set MySQL connection details for PythonAnywhere if not already set
        if not os.environ.get('MYSQL_HOST'):
            os.environ['MYSQL_HOST'] = 'puntz08.mysql.pythonanywhere-services.com'
        if not os.environ.get('MYSQL_USER'):
            os.environ['MYSQL_USER'] = 'puntz08'
        if not os.environ.get('MYSQL_DATABASE'):
            os.environ['MYSQL_DATABASE'] = 'puntz08$C-Point'
        
        if not os.environ.get('MYSQL_PASSWORD'):
            print("❌ Error: MYSQL_PASSWORD environment variable is required!")
            print("Set it with: export MYSQL_PASSWORD='your_password'")
            return False
        
        # Import the database connection from the Flask app
        from bodybuilding_app import get_db_connection
        
        print("Starting MySQL migration...")
        print("Using Flask app's database connection...")
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # 1. Fix users table - ensure it has id column
            print("1. Checking users table...")
            try:
                cursor.execute("SHOW COLUMNS FROM users LIKE 'id'")
                if not cursor.fetchone():
                    print("   Adding id column to users table...")
                    cursor.execute("ALTER TABLE users ADD COLUMN id INTEGER PRIMARY KEY AUTO_INCREMENT FIRST")
                    conn.commit()
                    print("   ✓ Added id column")
                else:
                    print("   ✓ Users table already has id column")
            except Exception as e:
                print(f"   Warning: Could not fix users table: {e}")
            
            # 2. Fix user_communities table
            print("2. Checking user_communities table...")
            try:
                cursor.execute("SHOW TABLES LIKE 'user_communities'")
                if not cursor.fetchone():
                    print("   Creating user_communities table...")
                    cursor.execute('''CREATE TABLE user_communities (
                        id INTEGER PRIMARY KEY AUTO_INCREMENT,
                        user_id INTEGER NOT NULL,
                        community_id INTEGER NOT NULL,
                        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(user_id, community_id)
                    )''')
                    conn.commit()
                    print("   ✓ Created user_communities table")
                else:
                    # Check if it has user_id column
                    cursor.execute("SHOW COLUMNS FROM user_communities LIKE 'user_id'")
                    if not cursor.fetchone():
                        print("   Recreating user_communities table with correct schema...")
                        cursor.execute("DROP TABLE user_communities")
                        cursor.execute('''CREATE TABLE user_communities (
                            id INTEGER PRIMARY KEY AUTO_INCREMENT,
                            user_id INTEGER NOT NULL,
                            community_id INTEGER NOT NULL,
                            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            UNIQUE(user_id, community_id)
                        )''')
                        conn.commit()
                        print("   ✓ Recreated user_communities table")
                    else:
                        print("   ✓ user_communities table is correct")
            except Exception as e:
                print(f"   Warning: Could not fix user_communities table: {e}")
            
            # 3. Fix notifications table
            print("3. Checking notifications table...")
            try:
                cursor.execute("SHOW COLUMNS FROM notifications LIKE 'created_at'")
                if not cursor.fetchone():
                    print("   Adding created_at column to notifications...")
                    cursor.execute("ALTER TABLE notifications ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
                    conn.commit()
                    print("   ✓ Added created_at column")
                else:
                    print("   ✓ Notifications table already has created_at column")
            except Exception as e:
                print(f"   Warning: Could not fix notifications table: {e}")
            
            # 4. Create user_login_history table
            print("4. Checking user_login_history table...")
            try:
                cursor.execute("SHOW TABLES LIKE 'user_login_history'")
                if not cursor.fetchone():
                    print("   Creating user_login_history table...")
                    cursor.execute('''CREATE TABLE user_login_history (
                        id INTEGER PRIMARY KEY AUTO_INCREMENT,
                        username VARCHAR(255) NOT NULL,
                        login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        ip_address VARCHAR(45),
                        user_agent TEXT
                    )''')
                    cursor.execute("CREATE INDEX IF NOT EXISTS idx_login_username ON user_login_history(username)")
                    cursor.execute("CREATE INDEX IF NOT EXISTS idx_login_time ON user_login_history(login_time)")
                    conn.commit()
                    print("   ✓ Created user_login_history table")
                else:
                    print("   ✓ user_login_history table already exists")
            except Exception as e:
                print(f"   Warning: Could not create user_login_history table: {e}")
            
            # 5. Create other essential tables
            print("5. Checking other essential tables...")
            
            # Push subscriptions
            try:
                cursor.execute("SHOW TABLES LIKE 'push_subscriptions'")
                if not cursor.fetchone():
                    cursor.execute('''CREATE TABLE push_subscriptions (
                        id INTEGER PRIMARY KEY AUTO_INCREMENT,
                        username VARCHAR(255) NOT NULL,
                        endpoint TEXT NOT NULL UNIQUE,
                        p256dh TEXT,
                        auth TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )''')
                    conn.commit()
                    print("   ✓ Created push_subscriptions table")
            except Exception as e:
                print(f"   Warning: Could not create push_subscriptions table: {e}")
            
            print("\n✅ Migration completed successfully!")
            return True
            
    except ImportError as e:
        print(f"❌ Could not import from bodybuilding_app: {e}")
        print("Make sure you're running this script from the same directory as bodybuilding_app.py")
        return False
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        return False

if __name__ == "__main__":
    print("Simple MySQL Migration Script")
    print("=" * 40)
    
    if len(sys.argv) > 1 and sys.argv[1] == "--help":
        print("Usage: python simple_migration.py")
        print("\nThis script uses the same database connection as your Flask app.")
        print("Make sure your environment variables are set correctly:")
        print("  MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE")
        sys.exit(0)
    
    success = run_migration()
    sys.exit(0 if success else 1)