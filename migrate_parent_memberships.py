#!/usr/bin/env python3
"""
Add existing child community members to their parent communities
Run this on PythonAnywhere bash console
"""

import pymysql
import os

def migrate_parent_memberships():
    """Add existing child community members to their parent communities"""
    
    print("Parent Community Membership Migration")
    print("=" * 40)
    
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
            # Find all child communities (communities with parent_community_id)
            print("\n🔍 Finding child communities...")
            c.execute("""
                SELECT c.id, c.name, c.parent_community_id, pc.name as parent_name
                FROM communities c
                JOIN communities pc ON c.parent_community_id = pc.id
                WHERE c.parent_community_id IS NOT NULL
            """)
            child_communities = c.fetchall()
            
            if not child_communities:
                print("No child communities found")
                return True
                
            print(f"Found {len(child_communities)} child communities:")
            for child in child_communities:
                print(f"  - {child['name']} → Parent: {child['parent_name']}")
            
            total_added = 0
            
            for child in child_communities:
                child_id = child['id']
                parent_id = child['parent_community_id']
                child_name = child['name']
                parent_name = child['parent_name']
                
                print(f"\n📋 Processing {child_name}...")
                
                # Get all members of the child community
                c.execute("""
                    SELECT uc.user_id, u.username
                    FROM user_communities uc
                    JOIN users u ON uc.user_id = u.id
                    WHERE uc.community_id = %s
                """, (child_id,))
                
                child_members = c.fetchall()
                print(f"   Found {len(child_members)} members in {child_name}")
                
                added_to_parent = 0
                
                for member in child_members:
                    user_id = member['user_id']
                    username = member['username']
                    
                    # Check if user is already a member of the parent community
                    c.execute("""
                        SELECT id FROM user_communities 
                        WHERE user_id = %s AND community_id = %s
                    """, (user_id, parent_id))
                    
                    if c.fetchone():
                        # Already a member, skip
                        continue
                    
                    # Add user to parent community
                    try:
                        c.execute("""
                            INSERT INTO user_communities (user_id, community_id, joined_at)
                            VALUES (%s, %s, NOW())
                        """, (user_id, parent_id))
                        
                        added_to_parent += 1
                        total_added += 1
                        
                        print(f"   ✅ Added {username} to {parent_name}")
                        
                        # Create notification for the user
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
                            print(f"   ⚠️  Notification failed for {username}: {notify_err}")
                            
                    except Exception as e:
                        print(f"   ❌ Failed to add {username} to {parent_name}: {e}")
                
                print(f"   📊 Added {added_to_parent} new members to {parent_name}")
            
            # Commit all changes
            conn.commit()
            print(f"\n🎉 Migration completed successfully!")
            print(f"📊 Total users added to parent communities: {total_added}")
            
            # Verification
            print(f"\n🔍 Verification - Community membership counts:")
            for child in child_communities:
                # Count members in child community
                c.execute("SELECT COUNT(*) as count FROM user_communities WHERE community_id = %s", (child['id'],))
                child_count = c.fetchone()['count']
                
                # Count members in parent community  
                c.execute("SELECT COUNT(*) as count FROM user_communities WHERE community_id = %s", (child['parent_community_id'],))
                parent_count = c.fetchone()['count']
                
                print(f"  {child['name']}: {child_count} members")
                print(f"  {child['parent_name']}: {parent_count} members")
                print()
            
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
        success = migrate_parent_memberships()
        if success:
            print("\n" + "=" * 50)
            print("✅ MIGRATION SUCCESSFUL!")
            print("All child community members now have access")
            print("to their parent communities automatically!")
            print("=" * 50)
        else:
            print("\n" + "=" * 50)
            print("❌ MIGRATION FAILED!")
            print("Please check the error messages above")
            print("=" * 50)
    except KeyboardInterrupt:
        print("\n❌ Migration cancelled by user")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")