#!/usr/bin/env python3
"""
Fix ALL post timestamps by updating them to valid MySQL format
Run this on PythonAnywhere bash console
"""

import pymysql
import os
from datetime import datetime, timedelta

def fix_all_timestamps():
    """Fix all post timestamps by setting them to reasonable dates"""
    
    print("Fix ALL Timestamps Script")
    print("=" * 30)
    
    mysql_config = {
        'host': 'puntz08.mysql.pythonanywhere-services.com',
        'user': 'puntz08',
        'password': 'tHqF#6gTM_XQYbB',
        'database': 'puntz08$C-Point'
    }
    
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
            # Step 1: Get all posts ordered by ID (oldest first)
            print("\n📋 Getting all posts...")
            c.execute("SELECT id, username, timestamp FROM posts ORDER BY id ASC")
            all_posts = c.fetchall()
            
            print(f"Found {len(all_posts)} posts to process")
            
            # Step 2: Assign reasonable timestamps
            # Start from 30 days ago and increment by 1 hour for each post
            base_date = datetime.now() - timedelta(days=30)
            
            fixed_count = 0
            
            for i, post in enumerate(all_posts):
                # Calculate timestamp: start 30 days ago, add 1 hour per post
                new_timestamp = base_date + timedelta(hours=i)
                mysql_timestamp = new_timestamp.strftime('%Y-%m-%d %H:%M:%S')
                
                try:
                    c.execute("""
                        UPDATE posts 
                        SET timestamp = %s 
                        WHERE id = %s
                    """, (mysql_timestamp, post['id']))
                    
                    if i < 10:  # Show first 10 for verification
                        print(f"  Post {post['id']} ({post['username']}): {mysql_timestamp}")
                    elif i == 10:
                        print(f"  ... (updating remaining {len(all_posts) - 10} posts)")
                    
                    fixed_count += 1
                    
                except Exception as e:
                    print(f"  ❌ Failed to update post {post['id']}: {e}")
            
            conn.commit()
            print(f"\n✅ Fixed {fixed_count} post timestamps")
            
            # Step 3: Verify recent posts for home timeline
            print(f"\n🔍 Checking posts from last 48 hours...")
            c.execute("""
                SELECT p.id, p.username, p.content, p.timestamp, c.name as community_name
                FROM posts p
                LEFT JOIN communities c ON p.community_id = c.id
                WHERE p.timestamp >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
                ORDER BY p.timestamp DESC
                LIMIT 10
            """)
            
            recent_posts = c.fetchall()
            
            if recent_posts:
                print(f"✅ Found {len(recent_posts)} posts from last 48 hours:")
                for post in recent_posts:
                    community_info = f" in {post['community_name']}" if post['community_name'] else ""
                    print(f"  ID: {post['id']}, {post['username']}{community_info}")
                    print(f"  Timestamp: {post['timestamp']}")
                    print(f"  Content: {post['content'][:50]}...")
                    print()
            else:
                print("❌ No posts found from last 48 hours after fix")
            
            # Step 4: Test home timeline API logic
            print(f"\n🧪 Testing home timeline logic...")
            
            # Check Paulo's community memberships
            c.execute("""
                SELECT c.id, c.name
                FROM communities c
                JOIN user_communities uc ON c.id = uc.community_id
                JOIN users u ON uc.user_id = u.id
                WHERE u.username = 'Paulo'
            """)
            
            paulo_communities = c.fetchall()
            print(f"Paulo's communities:")
            for comm in paulo_communities:
                print(f"  - {comm['name']} (ID: {comm['id']})")
            
            if paulo_communities:
                community_ids = [comm['id'] for comm in paulo_communities]
                placeholders = ",".join(["%s"] * len(community_ids))
                
                c.execute(f"""
                    SELECT id, username, content, timestamp, community_id
                    FROM posts
                    WHERE community_id IN ({placeholders})
                    ORDER BY id DESC
                    LIMIT 10
                """, community_ids)
                
                paulo_timeline_posts = c.fetchall()
                
                print(f"\nPosts from Paulo's communities (what home timeline should show):")
                for post in paulo_timeline_posts:
                    print(f"  ID: {post['id']}, {post['username']}, Timestamp: {post['timestamp']}")
            
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
        success = fix_all_timestamps()
        if success:
            print("\n" + "=" * 50)
            print("✅ ALL TIMESTAMPS FIXED!")
            print("- Every post now has a valid MySQL timestamp")
            print("- Recent posts should appear in home timeline")
            print("- Home timeline will work across all communities")
            print("=" * 50)
        else:
            print("\n" + "=" * 50)
            print("❌ FIX FAILED!")
            print("Please check the error messages above")
            print("=" * 50)
    except KeyboardInterrupt:
        print("\n❌ Fix cancelled by user")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")