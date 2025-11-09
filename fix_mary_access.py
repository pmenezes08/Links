#!/usr/bin/env python3
"""
Fix Mary's access to ACME Corporation
Ensures sub-community owners have access to parent communities
"""

import os
import sys

sys.path.insert(0, '/home/puntz08/dev/Links')

os.environ['USE_MYSQL'] = '1'
os.environ['MYSQL_HOST'] = 'puntz08.mysql.pythonanywhere-services.com'
os.environ['MYSQL_USER'] = 'puntz08'
os.environ['MYSQL_PASSWORD'] = os.environ.get('MYSQL_PASSWORD', '')
os.environ['MYSQL_DATABASE'] = 'puntz08$C-Point'

from bodybuilding_app import get_db_connection, get_sql_placeholder
from datetime import datetime

def fix_mary_access():
    """Ensure Mary has access to ACME Corporation since she owns Project Management"""
    print("=" * 70)
    print("FIXING MARY'S ACCESS TO PARENT COMMUNITIES")
    print("=" * 70)
    
    username = 'mary'
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            placeholder = get_sql_placeholder()
            
            # Get Mary's user ID
            c.execute(f"SELECT id FROM users WHERE username = {placeholder}", (username,))
            user = c.fetchone()
            if not user:
                print(f"❌ User {username} not found!")
                return
            
            user_id = user['id'] if hasattr(user, 'keys') else user[0]
            print(f"✅ Found user {username} with ID: {user_id}")
            
            # Find all communities where Mary is the creator
            c.execute(f"SELECT id, name, parent_community_id FROM communities WHERE creator_username = {placeholder}", (username,))
            owned_communities = c.fetchall()
            
            print(f"\n📋 Communities owned by {username}:")
            for comm in owned_communities:
                comm_id = comm['id'] if hasattr(comm, 'keys') else comm[0]
                comm_name = comm['name'] if hasattr(comm, 'keys') else comm[1]
                parent_id = comm['parent_community_id'] if hasattr(comm, 'keys') else comm[2]
                print(f"   - {comm_name} (ID: {comm_id}, Parent: {parent_id})")
                
                # If this community has a parent, ensure Mary is a member of all ancestors
                if parent_id:
                    print(f"   → Checking access to parent chain...")
                    current_parent = parent_id
                    added_count = 0
                    
                    while current_parent:
                        # Check if Mary is already a member
                        c.execute(f"""
                            SELECT 1 FROM user_communities 
                            WHERE user_id = {placeholder} AND community_id = {placeholder}
                        """, (user_id, current_parent))
                        
                        if not c.fetchone():
                            # Not a member, add her
                            c.execute(f"""
                                INSERT INTO user_communities (user_id, community_id, role, joined_at)
                                VALUES ({placeholder}, {placeholder}, 'member', {placeholder})
                            """, (user_id, current_parent, datetime.now().isoformat()))
                            
                            c.execute(f"SELECT name FROM communities WHERE id = {placeholder}", (current_parent,))
                            parent_name_row = c.fetchone()
                            parent_name = parent_name_row['name'] if (parent_name_row and hasattr(parent_name_row, 'keys')) else (parent_name_row[0] if parent_name_row else 'Unknown')
                            
                            print(f"      ✅ Added to: {parent_name} (ID: {current_parent})")
                            added_count += 1
                        else:
                            c.execute(f"SELECT name FROM communities WHERE id = {placeholder}", (current_parent,))
                            parent_name_row = c.fetchone()
                            parent_name = parent_name_row['name'] if (parent_name_row and hasattr(parent_name_row, 'keys')) else (parent_name_row[0] if parent_name_row else 'Unknown')
                            print(f"      ℹ️  Already member of: {parent_name} (ID: {current_parent})")
                        
                        # Get next parent
                        c.execute(f"SELECT parent_community_id FROM communities WHERE id = {placeholder}", (current_parent,))
                        next_parent_row = c.fetchone()
                        current_parent = next_parent_row['parent_community_id'] if (next_parent_row and hasattr(next_parent_row, 'keys')) else (next_parent_row[0] if next_parent_row else None)
                    
                    if added_count > 0:
                        print(f"   ✅ Added {added_count} parent membership(s)")
            
            conn.commit()
            print("\n" + "=" * 70)
            print("✅ FIX COMPLETE - Mary now has access to all parent communities")
            print("=" * 70)
            
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    fix_mary_access()
