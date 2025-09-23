#!/usr/bin/env python3
"""Migrate parent community relationships from SQLite to MySQL"""

import os
import sys
sys.path.append('/workspace')

# Import Flask app configuration
from bodybuilding_app import get_db_connection, logger
import sqlite3

def migrate_parent_communities():
    """Migrate parent community data from SQLite to MySQL"""
    print("=== Migrating Parent Community Data ===")
    
    try:
        # Try different SQLite paths
        sqlite_paths = [
            '/home/puntz08/WorkoutX/Links/users.db',
            '/workspace/users.db',
            'users.db'
        ]
        
        sqlite_conn = None
        for path in sqlite_paths:
            try:
                if os.path.exists(path):
                    sqlite_conn = sqlite3.connect(path)
                    sqlite_conn.row_factory = sqlite3.Row
                    print(f"Connected to SQLite at: {path}")
                    break
            except Exception as e:
                print(f"Failed to connect to {path}: {e}")
                continue
        
        if not sqlite_conn:
            print("Could not connect to SQLite database")
            return False
        
        # Get MySQL connection using Flask app's method
        mysql_conn = get_db_connection()
        
        # Get communities with parent_community_id from SQLite
        sqlite_c = sqlite_conn.cursor()
        sqlite_c.execute("""
            SELECT id, name, parent_community_id, creator_username, type
            FROM communities 
            WHERE parent_community_id IS NOT NULL
            ORDER BY id
        """)
        parent_communities = sqlite_c.fetchall()
        
        if not parent_communities:
            print("No parent community data found in SQLite")
            sqlite_conn.close()
            mysql_conn.close()
            return False
            
        print(f"Found {len(parent_communities)} communities with parent relationships:")
        for comm in parent_communities:
            print(f"  ID: {comm['id']}, Name: {comm['name']}, Parent ID: {comm['parent_community_id']}")
        
        # Update MySQL communities with parent_community_id
        mysql_c = mysql_conn.cursor()
        updated_count = 0
        
        for comm in parent_communities:
            try:
                # First check if the community exists in MySQL
                mysql_c.execute("""
                    SELECT id, name FROM communities 
                    WHERE name = %s AND creator_username = %s
                """, (comm['name'], comm['creator_username']))
                
                mysql_community = mysql_c.fetchone()
                
                if mysql_community:
                    # Update with parent_community_id
                    mysql_c.execute("""
                        UPDATE communities 
                        SET parent_community_id = %s 
                        WHERE id = %s
                    """, (comm['parent_community_id'], mysql_community['id']))
                    
                    if mysql_c.rowcount > 0:
                        updated_count += 1
                        print(f"  ✓ Updated '{comm['name']}' with parent_community_id: {comm['parent_community_id']}")
                    else:
                        print(f"  ✗ No rows updated for '{comm['name']}'")
                else:
                    print(f"  ✗ Community '{comm['name']}' not found in MySQL")
                    
            except Exception as e:
                print(f"  ✗ Error updating community {comm['name']}: {e}")
                
        mysql_conn.commit()
        print(f"\nMigration complete. Updated {updated_count} communities with parent relationships")
        
        # Verify the migration
        print("\n=== Verification ===")
        mysql_c.execute("""
            SELECT c.id, c.name, c.parent_community_id, pc.name as parent_name
            FROM communities c
            LEFT JOIN communities pc ON c.parent_community_id = pc.id
            WHERE c.parent_community_id IS NOT NULL
            ORDER BY c.id
        """)
        
        migrated_communities = mysql_c.fetchall()
        print(f"Communities with parent relationships in MySQL: {len(migrated_communities)}")
        for comm in migrated_communities:
            print(f"  ID: {comm['id']}, Name: {comm['name']}, Parent: {comm['parent_name']} (ID: {comm['parent_community_id']})")
        
        sqlite_conn.close()
        mysql_conn.close()
        
        return updated_count > 0
        
    except Exception as e:
        print(f"Error during migration: {e}")
        return False

if __name__ == "__main__":
    success = migrate_parent_communities()
    if success:
        print("\n✓ Parent community migration completed successfully!")
    else:
        print("\n✗ Parent community migration failed or no data to migrate")