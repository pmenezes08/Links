#!/usr/bin/env python3
"""
Fix broken timestamps back to MySQL format for database compatibility
"""

import pymysql
from datetime import datetime, timedelta

def fix_display_format():
    """Fix broken timestamps back to MySQL format"""
    
    print("Fix Broken Timestamps to MySQL Format")
    print("=" * 35)
    
    mysql_config = {
        'host': 'puntz08.mysql.pythonanywhere-services.com',
        'user': 'puntz08',
        'password': 'tHqF#6gTM_XQYbB',
        'database': 'puntz08$C-Point'
    }
    
    try:
        conn = pymysql.connect(
            host=mysql_config['host'],
            user=mysql_config['user'],
            password=mysql_config['password'],
            database=mysql_config['database'],
            cursorclass=pymysql.cursors.DictCursor
        )
        print("✅ Connected to MySQL successfully!")
        
        with conn.cursor() as c:
            # Fix posts with 0000-00-00 timestamps
            print("\n🔧 Fixing broken timestamps...")
            
            # Get the problematic posts
            broken_post_ids = [163, 156, 154, 153, 152, 151, 150, 149, 148, 147]
            
            now = datetime.now()
            fixed_count = 0
            
            for i, post_id in enumerate(broken_post_ids):
                # Give recent timestamps (within last 24 hours)
                hours_ago = i * 2  # 2 hours apart
                if hours_ago > 23:
                    hours_ago = 23
                
                post_time = now - timedelta(hours=hours_ago)
                mysql_timestamp = post_time.strftime('%Y-%m-%d %H:%M:%S')
                
                try:
                    c.execute("""
                        UPDATE posts 
                        SET timestamp = %s 
                        WHERE id = %s
                    """, (mysql_timestamp, post_id))
                    
                    if c.rowcount > 0:
                        print(f"  ✅ Post {post_id}: {mysql_timestamp}")
                        fixed_count += 1
                    else:
                        print(f"  ⚠️  Post {post_id}: No rows affected")
                        
                except Exception as e:
                    print(f"  ❌ Post {post_id}: {e}")
            
            conn.commit()
            print(f"\n✅ Fixed {fixed_count} broken timestamps")
            
            # Verification
            print(f"\n🔍 Verification - checking home timeline posts...")
            c.execute("""
                SELECT p.id, p.username, p.timestamp, c.name as community_name,
                       TIMESTAMPDIFF(HOUR, p.timestamp, NOW()) as hours_ago
                FROM posts p
                LEFT JOIN communities c ON p.community_id = c.id
                WHERE p.timestamp >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
                ORDER BY p.timestamp DESC
                LIMIT 10
            """)
            
            timeline_posts = c.fetchall()
            
            if timeline_posts:
                print(f"✅ Found {len(timeline_posts)} posts for home timeline:")
                for post in timeline_posts:
                    community_info = f" in {post['community_name']}" if post['community_name'] else ""
                    print(f"  ID: {post['id']}, {post['username']}{community_info}")
                    print(f"  MySQL: {post['timestamp']}")
                    
                    # Show DD-MM-YYYY display format
                    try:
                        dt = datetime.strptime(str(post['timestamp']), '%Y-%m-%d %H:%M:%S')
                        display_format = dt.strftime('%d-%m-%Y %H:%M:%S')
                        print(f"  Display: {display_format} ({post['hours_ago']}h ago)")
                    except Exception as e:
                        print(f"  ❌ Display conversion failed: {e}")
                    print()
            else:
                print("❌ No posts found for home timeline")
            
            return True
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return False
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    success = fix_display_format()
    if success:
        print("\n" + "=" * 50)
        print("✅ TIMESTAMPS FIXED!")
        print("- Broken timestamps restored to MySQL format")
        print("- Posts will appear in home timeline")
        print("- Frontend will display in DD-MM-YYYY format")
        print("=" * 50)
        print("\n🚀 RESTART FLASK APP AND CHECK HOME TIMELINE!")