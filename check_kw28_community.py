#!/usr/bin/env python3
"""
Check KW28 Community Visibility
Debug why KW28 community is not showing up
"""

import os
import sys

def check_kw28_community():
    """Check KW28 community status and visibility"""
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        # Get MySQL credentials
        host = os.environ.get('MYSQL_HOST', 'puntz08.mysql.pythonanywhere-services.com')
        user = os.environ.get('MYSQL_USER', 'puntz08')
        password = os.environ.get('MYSQL_PASSWORD')
        database = os.environ.get('MYSQL_DATABASE', 'puntz08$C-Point')
        
        if not password:
            print("❌ Error: MYSQL_PASSWORD environment variable is required!")
            return False
        
        print("KW28 Community Visibility Check")
        print("=" * 35)
        
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
        
        # 1. Check if KW28 community exists in database
        print("\n1. Searching for KW28 communities...")
        cursor.execute("""
            SELECT id, name, join_code, creator_username, created_at, is_active
            FROM communities 
            WHERE name LIKE '%KW28%' OR name LIKE '%kw28%' OR join_code LIKE '%KW28%'
        """)
        kw28_communities = cursor.fetchall()
        
        if kw28_communities:
            print(f"   ✅ Found {len(kw28_communities)} KW28 communities:")
            for comm in kw28_communities:
                status = "ACTIVE" if comm.get('is_active', 1) else "INACTIVE"
                print(f"     - ID: {comm['id']}")
                print(f"       Name: '{comm['name']}'")
                print(f"       Join Code: '{comm['join_code']}'")
                print(f"       Creator: {comm['creator_username']}")
                print(f"       Created: {comm['created_at']}")
                print(f"       Status: {status}")
                print()
        else:
            print("   ❌ No KW28 communities found in database")
            
            # Show all communities for reference
            cursor.execute("SELECT id, name, join_code FROM communities ORDER BY id DESC LIMIT 10")
            all_communities = cursor.fetchall()
            if all_communities:
                print("   Recent communities in database:")
                for comm in all_communities:
                    print(f"     - ID: {comm['id']}, Name: '{comm['name']}', Code: '{comm['join_code']}'")
            return False
        
        # 2. Check user membership in KW28 community
        print("2. Checking user membership...")
        
        # Get current user's ID (assuming Paulo)
        cursor.execute("SELECT id FROM users WHERE username = 'Paulo'")
        user_result = cursor.fetchone()
        
        if not user_result:
            print("   ❌ User 'Paulo' not found in database")
            return False
        
        user_id = user_result['id']
        print(f"   User 'Paulo' ID: {user_id}")
        
        # Check membership in KW28 communities
        for comm in kw28_communities:
            cursor.execute("""
                SELECT id, joined_at FROM user_communities 
                WHERE user_id = %s AND community_id = %s
            """, (user_id, comm['id']))
            membership = cursor.fetchone()
            
            if membership:
                print(f"   ✅ Paulo IS a member of '{comm['name']}' (joined: {membership['joined_at']})")
            else:
                print(f"   ❌ Paulo is NOT a member of '{comm['name']}'")
                
                # Add Paulo to the community
                print(f"   🔧 Adding Paulo to '{comm['name']}'...")
                try:
                    from datetime import datetime
                    cursor.execute("""
                        INSERT INTO user_communities (user_id, community_id, joined_at)
                        VALUES (%s, %s, %s)
                    """, (user_id, comm['id'], datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
                    conn.commit()
                    print(f"   ✅ Successfully added Paulo to '{comm['name']}'")
                except Exception as e:
                    print(f"   ❌ Failed to add Paulo to community: {e}")
        
        # 3. Check community visibility settings
        print("\n3. Checking community visibility...")
        for comm in kw28_communities:
            is_active = comm.get('is_active', 1)
            if not is_active:
                print(f"   ⚠️  Community '{comm['name']}' is marked as INACTIVE")
                print("   🔧 Activating community...")
                cursor.execute("UPDATE communities SET is_active = 1 WHERE id = %s", (comm['id'],))
                conn.commit()
                print("   ✅ Community activated")
            else:
                print(f"   ✅ Community '{comm['name']}' is ACTIVE")
        
        # 4. Check posts in KW28 community
        print("\n4. Checking community content...")
        for comm in kw28_communities:
            cursor.execute("SELECT COUNT(*) as count FROM posts WHERE community_id = %s", (comm['id'],))
            post_count = cursor.fetchone()['count']
            print(f"   Community '{comm['name']}' has {post_count} posts")
        
        cursor.close()
        conn.close()
        
        print("\n🎉 KW28 community check completed!")
        print("\nIf KW28 is still not visible:")
        print("1. Clear your browser cache")
        print("2. Restart your Flask application")
        print("3. Check that you're logged in as the right user")
        
        return True
        
    except Exception as e:
        print(f"❌ Error checking KW28 community: {e}")
        return False

if __name__ == "__main__":
    success = check_kw28_community()
    sys.exit(0 if success else 1)