#!/usr/bin/env python3
"""Migrate KW28 parent community relationship"""

import os
import sys

def migrate_kw28_parent():
    """Set up the KW28 -> WHU parent community relationship"""
    
    # Set environment variables for MySQL connection
    os.environ['DB_BACKEND'] = 'mysql'
    os.environ['MYSQL_HOST'] = 'puntz08.mysql.pythonanywhere-services.com'
    os.environ['MYSQL_USER'] = 'puntz08'
    os.environ['MYSQL_DATABASE'] = 'puntz08$C-Point'
    
    # Get MySQL password from user
    mysql_password = input("Enter MySQL password: ").strip()
    if not mysql_password:
        print("MySQL password is required")
        return False
    
    os.environ['MYSQL_PASSWORD'] = mysql_password
    
    try:
        # Import after setting environment variables
        sys.path.append('/workspace')
        import pymysql
        
        # Connect to MySQL
        conn = pymysql.connect(
            host=os.environ['MYSQL_HOST'],
            user=os.environ['MYSQL_USER'],
            password=os.environ['MYSQL_PASSWORD'],
            database=os.environ['MYSQL_DATABASE'],
            cursorclass=pymysql.cursors.DictCursor
        )
        
        print("Connected to MySQL successfully!")
        
        with conn.cursor() as c:
            # First, let's see what communities exist
            print("\n=== Current Communities ===")
            c.execute("SELECT id, name, type, parent_community_id FROM communities ORDER BY name")
            communities = c.fetchall()
            
            for comm in communities:
                parent_info = f" (Parent: {comm['parent_community_id']})" if comm['parent_community_id'] else ""
                print(f"ID: {comm['id']}, Name: {comm['name']}, Type: {comm['type']}{parent_info}")
            
            # Look for KW28 and WHU communities
            print("\n=== Looking for KW28 and WHU communities ===")
            
            # Find KW28 community
            c.execute("SELECT id, name FROM communities WHERE name LIKE '%KW28%' OR name LIKE '%kw28%'")
            kw28_communities = c.fetchall()
            
            # Find WHU/Otto community
            c.execute("SELECT id, name FROM communities WHERE name LIKE '%WHU%' OR name LIKE '%Otto%'")
            whu_communities = c.fetchall()
            
            print("KW28 communities found:")
            for comm in kw28_communities:
                print(f"  ID: {comm['id']}, Name: {comm['name']}")
                
            print("WHU/Otto communities found:")
            for comm in whu_communities:
                print(f"  ID: {comm['id']}, Name: {comm['name']}")
            
            if not kw28_communities:
                print("No KW28 community found")
                return False
                
            if not whu_communities:
                print("No WHU/Otto community found")
                return False
            
            # If multiple communities found, let user choose
            if len(kw28_communities) > 1:
                print("\nMultiple KW28 communities found. Please choose:")
                for i, comm in enumerate(kw28_communities):
                    print(f"{i}: {comm['name']}")
                choice = int(input("Enter number: "))
                kw28_community = kw28_communities[choice]
            else:
                kw28_community = kw28_communities[0]
                
            if len(whu_communities) > 1:
                print("\nMultiple WHU communities found. Please choose:")
                for i, comm in enumerate(whu_communities):
                    print(f"{i}: {comm['name']}")
                choice = int(input("Enter number: "))
                whu_community = whu_communities[choice]
            else:
                whu_community = whu_communities[0]
            
            print(f"\nSetting up relationship:")
            print(f"Child: {kw28_community['name']} (ID: {kw28_community['id']})")
            print(f"Parent: {whu_community['name']} (ID: {whu_community['id']})")
            
            confirm = input("\nProceed with this setup? (y/N): ").strip().lower()
            if confirm != 'y':
                print("Migration cancelled")
                return False
            
            # Update KW28 community to have WHU as parent
            c.execute("""
                UPDATE communities 
                SET parent_community_id = %s 
                WHERE id = %s
            """, (whu_community['id'], kw28_community['id']))
            
            if c.rowcount > 0:
                print(f"✓ Successfully set {whu_community['name']} as parent of {kw28_community['name']}")
                
                # Verify the relationship
                c.execute("""
                    SELECT c.id, c.name, pc.name as parent_name
                    FROM communities c
                    LEFT JOIN communities pc ON c.parent_community_id = pc.id
                    WHERE c.id = %s
                """, (kw28_community['id'],))
                
                result = c.fetchone()
                if result:
                    print(f"✓ Verification: {result['name']} -> Parent: {result['parent_name']}")
                
                # Now let's check users in KW28 community
                print(f"\n=== Users in {kw28_community['name']} community ===")
                c.execute("""
                    SELECT u.username 
                    FROM users u
                    JOIN user_communities uc ON u.id = uc.user_id
                    WHERE uc.community_id = %s
                """, (kw28_community['id'],))
                
                users = c.fetchall()
                print(f"Found {len(users)} users:")
                for user in users:
                    print(f"  - {user['username']}")
                
                conn.commit()
                print(f"\n✓ Migration completed successfully!")
                print(f"Users in {kw28_community['name']} will now see '{whu_community['name']}' on their dashboard")
                
            else:
                print("✗ No rows were updated")
                return False
        
        conn.close()
        return True
        
    except Exception as e:
        print(f"Error during migration: {e}")
        return False

if __name__ == "__main__":
    print("KW28 Parent Community Migration")
    print("================================")
    success = migrate_kw28_parent()
    if success:
        print("\n🎉 Migration completed successfully!")
    else:
        print("\n❌ Migration failed")