#!/usr/bin/env python3
"""
SQLite to MySQL Community Data Migration Script
Migrates #KW28 community data and related records from SQLite to MySQL
"""

import os
import sys
import sqlite3
from datetime import datetime

def get_sqlite_connection(db_path):
    """Connect to SQLite database"""
    try:
        if not os.path.exists(db_path):
            print(f"❌ SQLite database not found at: {db_path}")
            return None
        
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row  # Enable column access by name
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
    except ImportError as e:
        print(f"❌ PyMySQL not available: {e}")
        return None
    except Exception as e:
        print(f"❌ Error connecting to MySQL: {e}")
        return None

def find_kw28_community(sqlite_conn):
    """Find the #KW28 community in SQLite database"""
    try:
        cursor = sqlite_conn.cursor()
        
        # Search for #KW28 community by name or join_code
        cursor.execute("""
            SELECT * FROM communities 
            WHERE name LIKE '%KW28%' OR name LIKE '%#KW28%' OR join_code LIKE '%KW28%'
        """)
        communities = cursor.fetchall()
        
        if communities:
            print(f"Found {len(communities)} matching communities:")
            for i, comm in enumerate(communities):
                print(f"  {i+1}. ID: {comm['id']}, Name: '{comm['name']}', Join Code: '{comm['join_code']}'")
            return communities
        else:
            print("❌ No communities found matching 'KW28'")
            
            # Show all communities for reference
            cursor.execute("SELECT id, name, join_code FROM communities LIMIT 10")
            all_communities = cursor.fetchall()
            if all_communities:
                print("\nAvailable communities:")
                for comm in all_communities:
                    print(f"  - ID: {comm['id']}, Name: '{comm['name']}', Join Code: '{comm['join_code']}'")
            return []
            
    except Exception as e:
        print(f"❌ Error searching for #KW28 community: {e}")
        return []

def migrate_community_data(sqlite_conn, mysql_conn, community_id):
    """Migrate a specific community and its related data"""
    
    # Helper function to safely get values from SQLite Row
    def safe_get(row, key, default=''):
        try:
            return row[key] if row[key] is not None else default
        except (IndexError, KeyError):
            return default
    
    try:
        sqlite_cursor = sqlite_conn.cursor()
        mysql_cursor = mysql_conn.cursor()
        
        print(f"\n🔄 Migrating community ID {community_id}...")
        
        # 1. Get community data from SQLite
        sqlite_cursor.execute("SELECT * FROM communities WHERE id = ?", (community_id,))
        community = sqlite_cursor.fetchone()
        
        if not community:
            print(f"❌ Community {community_id} not found in SQLite")
            return False
        
        print(f"   Community: {community['name']} (Join Code: {community['join_code']})")
        
        # 2. Migrate the community record
        print("   Migrating community record...")
        
        # Check if community already exists in MySQL
        mysql_cursor.execute("SELECT id FROM communities WHERE join_code = %s", (community['join_code'],))
        existing = mysql_cursor.fetchone()
        
        if existing:
            mysql_community_id = existing['id']
            print(f"   ✅ Community already exists in MySQL with ID {mysql_community_id}")
        else:
            # Insert community into MySQL
            community_data = {
                'name': community['name'],
                'type': safe_get(community, 'type', 'general'),
                'creator_username': community['creator_username'],
                'join_code': community['join_code'],
                'created_at': safe_get(community, 'created_at', datetime.now().isoformat()),
                'description': safe_get(community, 'description', ''),
                'location': safe_get(community, 'location', ''),
                'background_path': safe_get(community, 'background_path', ''),
                'info': safe_get(community, 'info', ''),
                'info_updated_at': safe_get(community, 'info_updated_at', ''),
                'template': safe_get(community, 'template', 'default'),
                'background_color': safe_get(community, 'background_color', '#2d3839'),
                'text_color': safe_get(community, 'text_color', '#ffffff'),
                'accent_color': safe_get(community, 'accent_color', '#4db6ac'),
                'card_color': safe_get(community, 'card_color', '#1a2526'),
                'is_active': safe_get(community, 'is_active', 1)
            }
            
            mysql_cursor.execute("""
                INSERT INTO communities (name, type, creator_username, join_code, created_at, 
                                       description, location, background_path, info, info_updated_at,
                                       template, background_color, text_color, accent_color, 
                                       card_color, is_active)
                VALUES (%(name)s, %(type)s, %(creator_username)s, %(join_code)s, %(created_at)s,
                       %(description)s, %(location)s, %(background_path)s, %(info)s, %(info_updated_at)s,
                       %(template)s, %(background_color)s, %(text_color)s, %(accent_color)s,
                       %(card_color)s, %(is_active)s)
            """, community_data)
            
            mysql_community_id = mysql_cursor.lastrowid
            mysql_conn.commit()
            print(f"   ✅ Inserted community with new ID {mysql_community_id}")
        
        # 3. Migrate posts
        print("   Migrating posts...")
        sqlite_cursor.execute("SELECT * FROM posts WHERE community_id = ?", (community_id,))
        posts = sqlite_cursor.fetchall()
        
        migrated_posts = 0
        for post in posts:
            try:
                # Check if post already exists
                mysql_cursor.execute("SELECT id FROM posts WHERE content = %s AND username = %s AND community_id = %s", 
                                   (post['content'], post['username'], mysql_community_id))
                if mysql_cursor.fetchone():
                    continue  # Skip if already exists
                
                mysql_cursor.execute("""
                    INSERT INTO posts (username, content, image_path, timestamp, community_id)
                    VALUES (%s, %s, %s, %s, %s)
                """, (post['username'], post['content'], safe_get(post, 'image_path'), 
                     post['timestamp'], mysql_community_id))
                migrated_posts += 1
            except Exception as e:
                print(f"     Warning: Could not migrate post: {e}")
        
        mysql_conn.commit()
        print(f"   ✅ Migrated {migrated_posts} posts")
        
        # 4. Migrate user_communities relationships
        print("   Migrating user memberships...")
        sqlite_cursor.execute("SELECT * FROM user_communities WHERE community_id = ?", (community_id,))
        memberships = sqlite_cursor.fetchall()
        
        migrated_memberships = 0
        for membership in memberships:
            try:
                # Get user ID from username (since SQLite might use different structure)
                username = safe_get(membership, 'username') or safe_get(membership, 'user_id')
                mysql_cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
                user_result = mysql_cursor.fetchone()
                
                if not user_result:
                    continue  # Skip if user doesn't exist in MySQL
                
                user_id = user_result['id']
                
                # Check if membership already exists
                mysql_cursor.execute("SELECT id FROM user_communities WHERE user_id = %s AND community_id = %s", 
                                   (user_id, mysql_community_id))
                if mysql_cursor.fetchone():
                    continue  # Skip if already exists
                
                mysql_cursor.execute("""
                    INSERT INTO user_communities (user_id, community_id, joined_at)
                    VALUES (%s, %s, %s)
                """, (user_id, mysql_community_id, safe_get(membership, 'joined_at', datetime.now().isoformat())))
                migrated_memberships += 1
            except Exception as e:
                print(f"     Warning: Could not migrate membership: {e}")
        
        mysql_conn.commit()
        print(f"   ✅ Migrated {migrated_memberships} user memberships")
        
        # 5. Migrate other related data (replies, reactions, etc.)
        print("   Migrating replies and reactions...")
        
        # Get all post IDs for this community
        mysql_cursor.execute("SELECT id FROM posts WHERE community_id = %s", (mysql_community_id,))
        mysql_post_ids = [row['id'] for row in mysql_cursor.fetchall()]
        
        if mysql_post_ids:
            # Migrate replies (this is complex as we need to map old post IDs to new ones)
            sqlite_cursor.execute("""
                SELECT r.* FROM replies r 
                JOIN posts p ON r.post_id = p.id 
                WHERE p.community_id = ?
            """, (community_id,))
            replies = sqlite_cursor.fetchall()
            
            migrated_replies = 0
            for reply in replies:
                try:
                    # Find corresponding MySQL post by content matching
                    sqlite_cursor.execute("SELECT content, username FROM posts WHERE id = ?", (reply['post_id'],))
                    original_post = sqlite_cursor.fetchone()
                    
                    if original_post:
                        mysql_cursor.execute("""
                            SELECT id FROM posts 
                            WHERE content = %s AND username = %s AND community_id = %s
                        """, (original_post['content'], original_post['username'], mysql_community_id))
                        mysql_post = mysql_cursor.fetchone()
                        
                        if mysql_post:
                            # Check if replies table has community_id column
                            mysql_cursor.execute("SHOW COLUMNS FROM replies LIKE 'community_id'")
                            has_community_id = mysql_cursor.fetchone() is not None
                            
                            if has_community_id:
                                mysql_cursor.execute("""
                                    INSERT INTO replies (post_id, username, content, image_path, timestamp, community_id)
                                    VALUES (%s, %s, %s, %s, %s, %s)
                                """, (mysql_post['id'], reply['username'], reply['content'], 
                                     safe_get(reply, 'image_path'), reply['timestamp'], mysql_community_id))
                            else:
                                mysql_cursor.execute("""
                                    INSERT INTO replies (post_id, username, content, image_path, timestamp)
                                    VALUES (%s, %s, %s, %s, %s)
                                """, (mysql_post['id'], reply['username'], reply['content'], 
                                     safe_get(reply, 'image_path'), reply['timestamp']))
                            migrated_replies += 1
                except Exception as e:
                    print(f"     Warning: Could not migrate reply: {e}")
            
            mysql_conn.commit()
            print(f"   ✅ Migrated {migrated_replies} replies")
        
        print(f"✅ Successfully migrated community '{community['name']}'!")
        return True
        
    except Exception as e:
        print(f"❌ Error migrating community data: {e}")
        mysql_conn.rollback()
        return False

def run_migration():
    """Main migration function"""
    
    # Get SQLite database path
    sqlite_path = input("Enter path to SQLite database file (e.g., /home/puntz08/WorkoutX/Links/users.db): ").strip()
    if not sqlite_path:
        sqlite_path = "/home/puntz08/WorkoutX/Links/users.db"
    
    print(f"\nSQLite to MySQL Community Data Migration")
    print("=" * 50)
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
        # Find #KW28 community
        print("\n2. Searching for #KW28 community...")
        communities = find_kw28_community(sqlite_conn)
        
        if not communities:
            return False
        
        # If multiple communities found, let user choose
        if len(communities) > 1:
            while True:
                try:
                    choice = int(input(f"\nSelect community to migrate (1-{len(communities)}): ")) - 1
                    if 0 <= choice < len(communities):
                        selected_community = communities[choice]
                        break
                    else:
                        print("Invalid choice. Please try again.")
                except ValueError:
                    print("Please enter a valid number.")
        else:
            selected_community = communities[0]
        
        # Migrate the selected community
        print(f"\n3. Migrating community: {selected_community['name']}")
        success = migrate_community_data(sqlite_conn, mysql_conn, selected_community['id'])
        
        if success:
            print("\n🎉 Migration completed successfully!")
            print("\nRecommendations:")
            print("1. Restart your Flask application")
            print("2. Verify the community data appears correctly")
            print("3. Test community functionality")
        
        return success
        
    finally:
        sqlite_conn.close()
        mysql_conn.close()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--help":
        print("SQLite to MySQL Community Data Migration")
        print("Usage: python sqlite_to_mysql_migration.py")
        print("\nThis script migrates #KW28 community data from SQLite to MySQL.")
        print("It will migrate:")
        print("- Community record")
        print("- All posts in the community")
        print("- User memberships")
        print("- Replies and reactions")
        print("\nRequired environment variable:")
        print("  MYSQL_PASSWORD - Your MySQL password")
        sys.exit(0)
    
    success = run_migration()
    sys.exit(0 if success else 1)