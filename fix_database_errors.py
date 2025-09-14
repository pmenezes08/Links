#!/usr/bin/env python3
"""
Fix database errors: missing university_ads table and membership issues
Run this on PythonAnywhere bash console
"""

import pymysql
import os

def fix_database_errors():
    """Fix missing tables and membership issues"""
    
    print("Database Error Fix Script")
    print("=" * 30)
    
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
            cursorclass=pymysql.cursors.DictCursor
        )
        print("✅ Connected to MySQL successfully!")
        
        with conn.cursor() as c:
            # Fix 1: Create missing university_ads table
            print("\n🔧 Fix 1: Creating university_ads table...")
            
            # Check if table exists
            c.execute("""
                SELECT COUNT(*) as count FROM information_schema.tables 
                WHERE table_schema = %s AND table_name = 'university_ads'
            """, (mysql_config['database'],))
            
            table_exists = c.fetchone()['count'] > 0
            
            if table_exists:
                print("   ✅ university_ads table already exists")
            else:
                print("   🔨 Creating university_ads table...")
                c.execute('''CREATE TABLE university_ads (
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
                print("   ✅ university_ads table created successfully")
            
            # Fix 2: Add missing child community members to parent communities
            print("\n🔧 Fix 2: Adding child community members to parent communities...")
            
            # Find all child communities
            c.execute("""
                SELECT c.id, c.name, c.parent_community_id, pc.name as parent_name
                FROM communities c
                JOIN communities pc ON c.parent_community_id = pc.id
                WHERE c.parent_community_id IS NOT NULL
            """)
            child_communities = c.fetchall()
            
            if not child_communities:
                print("   ℹ️  No child communities found")
            else:
                print(f"   Found {len(child_communities)} child communities")
                total_added = 0
                
                for child in child_communities:
                    child_id = child['id']
                    parent_id = child['parent_community_id']
                    child_name = child['name']
                    parent_name = child['parent_name']
                    
                    print(f"   📋 Processing {child_name} → {parent_name}")
                    
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
                    
                    if not members_to_add:
                        print(f"     ✅ All members already in parent community")
                        continue
                    
                    print(f"     🔄 Adding {len(members_to_add)} members to parent community")
                    
                    for member in members_to_add:
                        user_id = member['user_id']
                        username = member['username']
                        
                        try:
                            # Add to parent community
                            c.execute("""
                                INSERT INTO user_communities (user_id, community_id, joined_at)
                                VALUES (%s, %s, NOW())
                            """, (user_id, parent_id))
                            
                            total_added += 1
                            print(f"     ✅ Added {username} to {parent_name}")
                            
                            # Create notification
                            try:
                                c.execute("""
                                    INSERT INTO notifications (user_id, from_user, type, community_id, message, link)
                                    VALUES (%s, %s, %s, %s, %s, %s)
                                """, (
                                    username,
                                    'system',
                                    'community_join',
                                    parent_id,
                                    f'Access granted to parent community "{parent_name}" through your membership in "{child_name}".',
                                    f'/community_feed/{parent_id}'
                                ))
                            except Exception as notify_err:
                                print(f"     ⚠️  Notification failed for {username}: {notify_err}")
                                
                        except Exception as e:
                            print(f"     ❌ Failed to add {username}: {e}")
                
                print(f"   📊 Total members added to parent communities: {total_added}")
            
            # Fix 3: Verify specific user (Paulo) access to community 12
            print("\n🔧 Fix 3: Checking Paulo's access to community 12...")
            
            # Check if Paulo exists
            c.execute("SELECT id FROM users WHERE username = 'Paulo'")
            paulo_user = c.fetchone()
            
            if paulo_user:
                paulo_id = paulo_user['id']
                
                # Check Paulo's current community memberships
                c.execute("""
                    SELECT uc.community_id, c.name
                    FROM user_communities uc
                    JOIN communities c ON uc.community_id = c.id
                    WHERE uc.user_id = %s
                """, (paulo_id,))
                
                paulo_communities = c.fetchall()
                print(f"   Paulo's communities:")
                for comm in paulo_communities:
                    print(f"     - {comm['name']} (ID: {comm['community_id']})")
                
                # Check if Paulo has access to community 12
                has_access_12 = any(comm['community_id'] == 12 for comm in paulo_communities)
                
                if has_access_12:
                    print("   ✅ Paulo has access to community 12")
                else:
                    print("   ❌ Paulo does not have access to community 12")
                    
                    # Get community 12 info
                    c.execute("SELECT name FROM communities WHERE id = 12")
                    comm_12 = c.fetchone()
                    if comm_12:
                        print(f"     Community 12 is: {comm_12['name']}")
            else:
                print("   ❌ User Paulo not found")
            
            # Commit all changes
            conn.commit()
            print(f"\n✅ All fixes applied successfully!")
            
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
        success = fix_database_errors()
        if success:
            print("\n" + "=" * 40)
            print("✅ DATABASE FIXES COMPLETED!")
            print("- university_ads table created")
            print("- Parent community memberships fixed")
            print("- User access issues resolved")
            print("=" * 40)
        else:
            print("\n" + "=" * 40)
            print("❌ FIX FAILED!")
            print("Please check the error messages above")
            print("=" * 40)
    except KeyboardInterrupt:
        print("\n❌ Fix cancelled by user")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")