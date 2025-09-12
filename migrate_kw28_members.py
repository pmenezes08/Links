#!/usr/bin/env python3
"""
Migrate KW28 Community Members from SQLite to MySQL
Transfers all user memberships for the KW28 community
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

def migrate_kw28_members():
    """Migrate KW28 community members from SQLite to MySQL"""
    
    # Get SQLite database path
    sqlite_path = input("Enter path to SQLite database file (default: /home/puntz08/WorkoutX/Links/users.db): ").strip()
    if not sqlite_path:
        sqlite_path = "/home/puntz08/WorkoutX/Links/users.db"
    
    print(f"\nKW28 Community Members Migration")
    print("=" * 40)
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
        
        # Find KW28 community in SQLite
        print("\n2. Finding KW28 community in SQLite...")
        sqlite_cursor.execute("""
            SELECT id, name, join_code FROM communities 
            WHERE name LIKE '%KW28%' OR name LIKE '%kw28%' OR join_code LIKE '%KW28%'
        """)
        sqlite_communities = sqlite_cursor.fetchall()
        
        if not sqlite_communities:
            print("❌ No KW28 community found in SQLite database")
            return False
        
        # Show found communities
        print(f"   Found {len(sqlite_communities)} KW28 communities in SQLite:")
        for comm in sqlite_communities:
            print(f"     - ID: {comm['id']}, Name: '{comm['name']}', Code: '{comm['join_code']}'")
        
        # Select the community to migrate
        if len(sqlite_communities) > 1:
            while True:
                try:
                    choice = int(input(f"\nSelect community to migrate members from (1-{len(sqlite_communities)}): ")) - 1
                    if 0 <= choice < len(sqlite_communities):
                        selected_sqlite_community = sqlite_communities[choice]
                        break
                    else:
                        print("Invalid choice. Please try again.")
                except ValueError:
                    print("Please enter a valid number.")
        else:
            selected_sqlite_community = sqlite_communities[0]
        
        sqlite_community_id = selected_sqlite_community['id']
        community_name = selected_sqlite_community['name']
        join_code = selected_sqlite_community['join_code']
        
        print(f"\n   Selected: {community_name} (ID: {sqlite_community_id}, Code: {join_code})")
        
        # Find corresponding community in MySQL
        print("\n3. Finding KW28 community in MySQL...")
        mysql_cursor.execute("""
            SELECT id, name, join_code FROM communities 
            WHERE join_code = %s OR name = %s
        """, (join_code, community_name))
        mysql_community = mysql_cursor.fetchone()
        
        if not mysql_community:
            print(f"❌ KW28 community not found in MySQL database")
            print("   Make sure you've run the community migration first!")
            return False
        
        mysql_community_id = mysql_community['id']
        print(f"   ✅ Found in MySQL: {mysql_community['name']} (ID: {mysql_community_id})")
        
        # Get all members from SQLite KW28 community
        print(f"\n4. Getting members from SQLite KW28 community...")
        
        # First, try to get members directly from user_communities table
        sqlite_cursor.execute("""
            SELECT uc.user_id, uc.joined_at, u.username
            FROM user_communities uc
            LEFT JOIN users u ON uc.user_id = u.rowid
            WHERE uc.community_id = ?
        """, (sqlite_community_id,))
        sqlite_memberships = sqlite_cursor.fetchall()
        
        if not sqlite_memberships:
            print("   ❌ No members found using user_id approach, trying username approach...")
            # Try alternative approach if the above doesn't work
            sqlite_cursor.execute("""
                SELECT uc.*, u.username, u.rowid as user_rowid
                FROM user_communities uc
                JOIN users u ON u.username = uc.username OR u.rowid = uc.user_id
                WHERE uc.community_id = ?
            """, (sqlite_community_id,))
            sqlite_memberships = sqlite_cursor.fetchall()
        
        if not sqlite_memberships:
            print("   ❌ No members found in SQLite KW28 community")
            return False
        
        print(f"   ✅ Found {len(sqlite_memberships)} members in SQLite")
        
        # Show members found
        member_usernames = []
        for member in sqlite_memberships:
            username = safe_get(member, 'username', 'Unknown')
            joined_at = safe_get(member, 'joined_at', 'Unknown')
            print(f"     - {username} (joined: {joined_at})")
            if username != 'Unknown':
                member_usernames.append(username)
        
        # Migrate members to MySQL
        print(f"\n5. Migrating {len(member_usernames)} members to MySQL...")
        
        migrated_count = 0
        skipped_count = 0
        
        for username in member_usernames:
            print(f"   Processing: {username}")
            
            # Get user ID from MySQL users table
            mysql_cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            mysql_user = mysql_cursor.fetchone()
            
            if not mysql_user:
                print(f"     ❌ User {username} not found in MySQL users table")
                continue
            
            mysql_user_id = mysql_user['id']
            
            # Check if membership already exists
            mysql_cursor.execute("""
                SELECT id FROM user_communities 
                WHERE user_id = %s AND community_id = %s
            """, (mysql_user_id, mysql_community_id))
            existing_membership = mysql_cursor.fetchone()
            
            if existing_membership:
                print(f"     ⚠️  {username} is already a member")
                skipped_count += 1
                continue
            
            # Add membership
            try:
                # Get original join date if available
                original_member = next((m for m in sqlite_memberships if safe_get(m, 'username') == username), None)
                joined_at = safe_get(original_member, 'joined_at', datetime.now().strftime('%Y-%m-%d %H:%M:%S')) if original_member else datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                
                mysql_cursor.execute("""
                    INSERT INTO user_communities (user_id, community_id, joined_at)
                    VALUES (%s, %s, %s)
                """, (mysql_user_id, mysql_community_id, joined_at))
                
                print(f"     ✅ Added {username} to KW28 community")
                migrated_count += 1
                
            except Exception as e:
                print(f"     ❌ Failed to add {username}: {e}")
        
        mysql_conn.commit()
        
        # Verify migration
        print(f"\n6. Verifying migration...")
        mysql_cursor.execute("""
            SELECT u.username, uc.joined_at
            FROM user_communities uc
            JOIN users u ON uc.user_id = u.id
            WHERE uc.community_id = %s
            ORDER BY uc.joined_at
        """, (mysql_community_id,))
        mysql_members = mysql_cursor.fetchall()
        
        print(f"   ✅ KW28 community now has {len(mysql_members)} members in MySQL:")
        for member in mysql_members:
            print(f"     - {member['username']} (joined: {member['joined_at']})")
        
        sqlite_conn.close()
        mysql_conn.close()
        
        print(f"\n🎉 Migration completed!")
        print(f"   Migrated: {migrated_count} new members")
        print(f"   Skipped: {skipped_count} existing members")
        print(f"   Total members in KW28: {len(mysql_members)}")
        
        print("\nNext steps:")
        print("1. Restart your Flask application")
        print("2. Check that all members are visible in the KW28 community")
        print("3. Verify member list and permissions")
        
        return True
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        sqlite_conn.close()
        mysql_conn.close()
        return False

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--help":
        print("KW28 Community Members Migration Script")
        print("Usage: python migrate_kw28_members.py")
        print("\nThis script migrates all members of the KW28 community from SQLite to MySQL.")
        print("It will:")
        print("- Find the KW28 community in both databases")
        print("- Get all members from SQLite")
        print("- Add them to the MySQL community")
        print("- Preserve original join dates")
        print("- Skip members who are already in the community")
        print("\nRequired environment variable:")
        print("  MYSQL_PASSWORD - Your MySQL password")
        sys.exit(0)
    
    success = migrate_kw28_members()
    sys.exit(0 if success else 1)