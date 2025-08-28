#!/usr/bin/env python3
"""
Test script to check user_chat database queries and schema
"""

import sqlite3
import os

def test_user_chat_queries():
    print("=== Testing User Chat Database Queries ===")
    
    # Connect to database
    db_path = 'users.db'
    if not os.path.exists(db_path):
        print(f"❌ Database file not found: {db_path}")
        return
    
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Check if tables exist
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'communities', 'user_communities')")
        tables = [row[0] for row in cursor.fetchall()]
        print(f"✅ Found tables: {tables}")
        
        # Check user_communities table structure
        cursor.execute("PRAGMA table_info(user_communities)")
        columns = cursor.fetchall()
        print(f"📋 user_communities columns: {[col[1] for col in columns]}")
        
        # Check communities table structure
        cursor.execute("PRAGMA table_info(communities)")
        community_columns = cursor.fetchall()
        print(f"📋 communities columns: {[col[1] for col in community_columns]}")
        
        # Check users table structure
        cursor.execute("PRAGMA table_info(users)")
        user_columns = cursor.fetchall()
        print(f"📋 users columns: {[col[1] for col in user_columns]}")
        
        # Check if admin user exists
        cursor.execute("SELECT username FROM users WHERE username = 'admin'")
        admin_user = cursor.fetchone()
        if admin_user:
            print(f"✅ Admin user found: {admin_user['username']}")
            
            # Test the community query with correct column names
            try:
                cursor.execute("""
                    SELECT c.id, c.name, c.type, c.creator_username
                    FROM communities c
                    INNER JOIN user_communities uc ON c.id = uc.community_id
                    INNER JOIN users u ON uc.user_id = u.rowid
                    WHERE u.username = ?
                    ORDER BY c.name
                """, ('admin',))
                communities = cursor.fetchall()
                print(f"✅ Communities query successful: {len(communities)} communities found")
                
                for community in communities:
                    print(f"  - {community['name']} ({community['type']})")
                    
                    # Test the members query for each community
                    try:
                        cursor.execute("""
                            SELECT DISTINCT u.username
                            FROM user_communities uc
                            INNER JOIN users u ON uc.user_id = u.rowid
                            WHERE uc.community_id = ? AND u.username != ?
                            ORDER BY u.username
                        """, (community['id'], 'admin'))
                        members = [row[0] for row in cursor.fetchall()]
                        print(f"    Members: {members}")
                    except Exception as e:
                        print(f"    ❌ Members query failed: {e}")
                        
            except Exception as e:
                print(f"❌ Communities query failed: {e}")
        else:
            print("❌ Admin user not found")
            
        # Test general users query
        try:
            cursor.execute("SELECT username FROM users WHERE username != 'admin'")
            all_users = [row[0] for row in cursor.fetchall()]
            print(f"✅ General users query successful: {len(all_users)} users found")
            print(f"  Users: {all_users[:5]}...")  # Show first 5 users
        except Exception as e:
            print(f"❌ General users query failed: {e}")
            
        conn.close()
        print("\n✅ Database test completed successfully!")
        
    except Exception as e:
        print(f"❌ Database test failed: {e}")

if __name__ == "__main__":
    test_user_chat_queries()