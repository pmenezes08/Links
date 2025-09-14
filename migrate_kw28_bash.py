#!/usr/bin/env python3
"""
Standalone script to migrate KW28 parent community relationship
Run this directly on PythonAnywhere bash console
"""

import pymysql
import os
import sys

def migrate_kw28_parent():
    """Set up the KW28 -> WHU parent community relationship"""
    
    print("KW28 Parent Community Migration")
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
            # Show current communities
            print("\n📋 Current communities in database:")
            c.execute("SELECT id, name, type, parent_community_id FROM communities ORDER BY name")
            communities = c.fetchall()
            
            for comm in communities:
                parent_info = f" (Parent ID: {comm['parent_community_id']})" if comm['parent_community_id'] else ""
                print(f"  ID: {comm['id']}, Name: {comm['name']}, Type: {comm['type']}{parent_info}")
            
            # Find KW28 community
            print("\n🔍 Looking for KW28 community...")
            c.execute("SELECT id, name FROM communities WHERE name LIKE %s", ('%KW28%',))
            kw28_community = c.fetchone()
            
            if kw28_community:
                print(f"✅ Found KW28: ID {kw28_community['id']}, Name: {kw28_community['name']}")
            else:
                print("❌ KW28 community not found")
                # Let's try other variations
                c.execute("SELECT id, name FROM communities WHERE name LIKE %s OR name LIKE %s", ('%kw28%', '%#KW28%'))
                kw28_community = c.fetchone()
                if kw28_community:
                    print(f"✅ Found KW28 variant: ID {kw28_community['id']}, Name: {kw28_community['name']}")
                else:
                    print("❌ No KW28 community found with any variation")
                    return False
            
            # Find WHU/Otto community
            print("\n🔍 Looking for WHU/Otto parent community...")
            c.execute("SELECT id, name FROM communities WHERE name LIKE %s OR name LIKE %s", ('%WHU%', '%Otto%'))
            whu_community = c.fetchone()
            
            if whu_community:
                print(f"✅ Found WHU/Otto: ID {whu_community['id']}, Name: {whu_community['name']}")
            else:
                print("❌ WHU/Otto community not found")
                # Let's try other variations
                c.execute("SELECT id, name FROM communities WHERE name LIKE %s OR name LIKE %s OR name LIKE %s", 
                         ('%whu%', '%university%', '%Universität%'))
                whu_community = c.fetchone()
                if whu_community:
                    print(f"✅ Found university community: ID {whu_community['id']}, Name: {whu_community['name']}")
                else:
                    print("❌ No parent community found")
                    return False
            
            # Show the relationship we're about to create
            print(f"\n🔗 Setting up parent-child relationship:")
            print(f"   Child:  {kw28_community['name']} (ID: {kw28_community['id']})")
            print(f"   Parent: {whu_community['name']} (ID: {whu_community['id']})")
            
            # Confirm the migration
            print(f"\nProceed with setting {whu_community['name']} as parent of {kw28_community['name']}?")
            confirm = input("Type 'yes' to continue: ").strip().lower()
            
            if confirm != 'yes':
                print("❌ Migration cancelled")
                return False
            
            # Perform the migration
            print("\n🔄 Updating database...")
            c.execute("""
                UPDATE communities 
                SET parent_community_id = %s 
                WHERE id = %s
            """, (whu_community['id'], kw28_community['id']))
            
            if c.rowcount > 0:
                print(f"✅ Successfully updated {c.rowcount} community")
                
                # Commit the changes
                conn.commit()
                print("✅ Changes committed to database")
                
                # Verify the relationship
                print("\n🔍 Verifying the relationship...")
                c.execute("""
                    SELECT c.id, c.name, c.parent_community_id, pc.name as parent_name
                    FROM communities c
                    LEFT JOIN communities pc ON c.parent_community_id = pc.id
                    WHERE c.id = %s
                """, (kw28_community['id'],))
                
                result = c.fetchone()
                if result and result['parent_name']:
                    print(f"✅ Verification successful:")
                    print(f"   {result['name']} -> Parent: {result['parent_name']}")
                else:
                    print("❌ Verification failed - relationship not found")
                    return False
                
                # Show affected users
                print(f"\n👥 Users in {kw28_community['name']} community:")
                c.execute("""
                    SELECT u.username 
                    FROM users u
                    JOIN user_communities uc ON u.id = uc.user_id
                    WHERE uc.community_id = %s
                    ORDER BY u.username
                """, (kw28_community['id'],))
                
                users = c.fetchall()
                if users:
                    print(f"   Found {len(users)} users who will see '{whu_community['name']}' on their dashboard:")
                    for user in users:
                        print(f"     - {user['username']}")
                else:
                    print("   No users found in this community")
                
                print(f"\n🎉 Migration completed successfully!")
                print(f"Users in {kw28_community['name']} will now see '{whu_community['name']}' on their dashboard")
                
                return True
                
            else:
                print("❌ No rows were updated")
                return False
        
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
        success = migrate_kw28_parent()
        if success:
            print("\n" + "=" * 40)
            print("✅ MIGRATION SUCCESSFUL!")
            print("Users in KW28 community will now see the parent")
            print("community name on their dashboard instead of")
            print("'Your Communities'")
            print("=" * 40)
        else:
            print("\n" + "=" * 40)
            print("❌ MIGRATION FAILED!")
            print("Please check the error messages above")
            print("=" * 40)
    except KeyboardInterrupt:
        print("\n❌ Migration cancelled by user")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")