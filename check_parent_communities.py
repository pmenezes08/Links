#!/usr/bin/env python3
"""Check parent community data in SQLite and MySQL databases"""

import sqlite3
import pymysql
import os

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
        c.execute("SELECT id, name, parent_community_id FROM communities ORDER BY id LIMIT 5")
        all_communities = c.fetchall()
        print(f"\nFirst 5 communities structure:")
        for comm in all_communities:
            print(f"  ID: {comm['id']}, Name: {comm['name']}, Parent ID: {comm['parent_community_id']}")
            
        conn.close()
        
    except Exception as e:
        print(f"Error checking SQLite: {e}")

def check_mysql_parent_communities():
    """Check parent community data in MySQL"""
    print("\n=== MySQL Parent Community Data ===")
    try:
        # Get MySQL connection details from environment
        host = os.environ.get('MYSQL_HOST', 'puntz08.mysql.pythonanywhere-services.com')
        user = os.environ.get('MYSQL_USER', 'puntz08')
        password = os.environ.get('MYSQL_PASSWORD', '')
        database = os.environ.get('MYSQL_DATABASE', 'puntz08$C-Point')
        
        if not password:
            print("MySQL password not set in environment")
            return
            
        conn = pymysql.connect(
            host=host,
            user=user,
            password=password,
            database=database,
            cursorclass=pymysql.cursors.DictCursor
        )
        
        with conn.cursor() as c:
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
                print("No communities with parent_community_id found in MySQL")
                
            # Check all communities to see structure
            c.execute("SELECT id, name, parent_community_id FROM communities ORDER BY id LIMIT 5")
            all_communities = c.fetchall()
            print(f"\nFirst 5 communities structure:")
            for comm in all_communities:
                print(f"  ID: {comm['id']}, Name: {comm['name']}, Parent ID: {comm['parent_community_id']}")
        
        conn.close()
        
    except Exception as e:
        print(f"Error checking MySQL: {e}")

def migrate_parent_community_data():
    """Migrate parent community data from SQLite to MySQL"""
    print("\n=== Migrating Parent Community Data ===")
    try:
        # SQLite connection
        sqlite_path = '/home/puntz08/WorkoutX/Links/users.db'
        sqlite_conn = sqlite3.connect(sqlite_path)
        sqlite_conn.row_factory = sqlite3.Row
        
        # MySQL connection
        host = os.environ.get('MYSQL_HOST', 'puntz08.mysql.pythonanywhere-services.com')
        user = os.environ.get('MYSQL_USER', 'puntz08')
        password = os.environ.get('MYSQL_PASSWORD', '')
        database = os.environ.get('MYSQL_DATABASE', 'puntz08$C-Point')
        
        if not password:
            print("MySQL password not set in environment")
            return
            
        mysql_conn = pymysql.connect(
            host=host,
            user=user,
            password=password,
            database=database,
            cursorclass=pymysql.cursors.DictCursor
        )
        
        # Get communities with parent_community_id from SQLite
        sqlite_c = sqlite_conn.cursor()
        sqlite_c.execute("""
            SELECT id, name, parent_community_id 
            FROM communities 
            WHERE parent_community_id IS NOT NULL
        """)
        parent_communities = sqlite_c.fetchall()
        
        if not parent_communities:
            print("No parent community data to migrate")
            return
            
        # Update MySQL communities with parent_community_id
        mysql_c = mysql_conn.cursor()
        updated_count = 0
        
        for comm in parent_communities:
            try:
                mysql_c.execute("""
                    UPDATE communities 
                    SET parent_community_id = %s 
                    WHERE id = %s AND name = %s
                """, (comm['parent_community_id'], comm['id'], comm['name']))
                
                if mysql_c.rowcount > 0:
                    updated_count += 1
                    print(f"  Updated community '{comm['name']}' (ID: {comm['id']}) with parent_community_id: {comm['parent_community_id']}")
                    
            except Exception as e:
                print(f"  Error updating community {comm['id']}: {e}")
                
        mysql_conn.commit()
        print(f"\nMigration complete. Updated {updated_count} communities with parent_community_id")
        
        sqlite_conn.close()
        mysql_conn.close()
        
    except Exception as e:
        print(f"Error during migration: {e}")

if __name__ == "__main__":
    check_sqlite_parent_communities()
    check_mysql_parent_communities()
    
    # Ask if user wants to migrate
    print("\n" + "="*50)
    migrate = input("Migrate parent community data from SQLite to MySQL? (y/N): ").strip().lower()
    if migrate == 'y':
        migrate_parent_community_data()
        print("\nChecking MySQL again after migration:")
        check_mysql_parent_communities()