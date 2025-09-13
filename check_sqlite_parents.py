#!/usr/bin/env python3
"""Check parent community data in SQLite database"""

import sqlite3

def check_sqlite_parent_communities():
    """Check parent community data in SQLite"""
    print("=== SQLite Parent Community Data ===")
    try:
        sqlite_path = '/home/puntz08/WorkoutX/Links/users.db'
        conn = sqlite3.connect(sqlite_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        
        # Check communities with parent_community_id
        c.execute("""
            SELECT id, name, parent_community_id, creator_username 
            FROM communities 
            WHERE parent_community_id IS NOT NULL
            ORDER BY id
        """)
        parent_communities = c.fetchall()
        
        if parent_communities:
            print(f"Found {len(parent_communities)} communities with parent_community_id:")
            for comm in parent_communities:
                print(f"  ID: {comm['id']}, Name: {comm['name']}, Parent ID: {comm['parent_community_id']}, Creator: {comm['creator_username']}")
        else:
            print("No communities with parent_community_id found in SQLite")
            
        # Check all communities to see structure
        c.execute("SELECT id, name, parent_community_id FROM communities ORDER BY id LIMIT 10")
        all_communities = c.fetchall()
        print(f"\nFirst 10 communities structure:")
        for comm in all_communities:
            parent_id = comm['parent_community_id'] if comm['parent_community_id'] else 'NULL'
            print(f"  ID: {comm['id']}, Name: {comm['name']}, Parent ID: {parent_id}")
            
        # Check if there are any parent communities (communities that are parents to others)
        c.execute("""
            SELECT DISTINCT parent_community_id 
            FROM communities 
            WHERE parent_community_id IS NOT NULL
        """)
        parent_ids = c.fetchall()
        
        if parent_ids:
            print(f"\nParent Community IDs in use:")
            for pid in parent_ids:
                c.execute("SELECT id, name FROM communities WHERE id = ?", (pid['parent_community_id'],))
                parent = c.fetchone()
                if parent:
                    print(f"  Parent ID: {pid['parent_community_id']}, Name: {parent['name']}")
                else:
                    print(f"  Parent ID: {pid['parent_community_id']}, Name: NOT FOUND")
            
        conn.close()
        
    except Exception as e:
        print(f"Error checking SQLite: {e}")

if __name__ == "__main__":
    check_sqlite_parent_communities()