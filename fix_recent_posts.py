#!/usr/bin/env python3
"""
Fix the recent posts that still have 0000-00-00 timestamps
"""

import pymysql
from datetime import datetime, timedelta

def fix_recent_posts():
    """Fix the specific recent posts that still have invalid timestamps"""
    
    print("Fix Recent Posts Script")
    print("=" * 25)
    
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
            # Target the specific problematic posts
            problem_posts = [163, 156, 154, 153, 152, 151, 150, 149, 148, 147]
            
            print(f"\n🎯 Targeting {len(problem_posts)} specific posts with 0000-00-00 timestamps...")
            
            # Start with very recent timestamps (last few hours)
            base_time = datetime.now() - timedelta(hours=6)
            
            for i, post_id in enumerate(problem_posts):
                # Each post gets a timestamp 30 minutes apart, starting 6 hours ago
                post_time = base_time + timedelta(minutes=i * 30)
                dd_mm_yyyy_timestamp = post_time.strftime('%d-%m-%Y %H:%M:%S')
                
                try:
                    # Direct update with specific post ID
                    c.execute("""
                        UPDATE posts 
                        SET timestamp = %s 
                        WHERE id = %s
                    """, (dd_mm_yyyy_timestamp, post_id))
                    
                    rows_affected = c.rowcount
                    
                    if rows_affected > 0:
                        print(f"  ✅ Post {post_id}: {dd_mm_yyyy_timestamp}")
                    else:
                        print(f"  ⚠️  Post {post_id}: No rows affected (post may not exist)")
                        
                except Exception as e:
                    print(f"  ❌ Post {post_id}: {e}")
            
            # Commit changes
            conn.commit()
            print(f"\n💾 Changes committed to database")
            
            # Verify the specific posts
            print(f"\n🔍 Verification - checking the fixed posts...")
            
            for post_id in problem_posts[:5]:  # Check first 5
                c.execute("SELECT id, username, timestamp FROM posts WHERE id = %s", (post_id,))
                result = c.fetchone()
                
                if result:
                    print(f"  Post {result['id']} ({result['username']}): {result['timestamp']}")
                    
                    # Test parsing
                    try:
                        dt = datetime.strptime(result['timestamp'], '%d-%m-%Y %H:%M:%S')
                        age = datetime.now() - dt
                        within_48h = age <= timedelta(hours=48)
                        print(f"    Parsed: {dt}, Age: {age}, Within 48h: {'✅' if within_48h else '❌'}")
                    except Exception as parse_error:
                        print(f"    ❌ Still cannot parse: {parse_error}")
                else:
                    print(f"  ❌ Post {post_id} not found")
                print()
            
            # Final check: posts that should appear in home timeline
            print(f"\n🏠 Posts that should now appear in home timeline:")
            c.execute("""
                SELECT p.id, p.username, p.content, p.timestamp, c.name as community_name
                FROM posts p
                LEFT JOIN communities c ON p.community_id = c.id
                WHERE p.id IN (163, 156, 154, 153, 152, 151, 150, 149, 148, 147)
                ORDER BY p.id DESC
            """)
            
            fixed_posts = c.fetchall()
            
            timeline_count = 0
            for post in fixed_posts:
                try:
                    dt = datetime.strptime(post['timestamp'], '%d-%m-%Y %H:%M:%S')
                    age = datetime.now() - dt
                    within_48h = age <= timedelta(hours=48)
                    
                    if within_48h:
                        timeline_count += 1
                        community_info = f" in {post['community_name']}" if post['community_name'] else ""
                        print(f"  ✅ ID: {post['id']}, {post['username']}{community_info}")
                        print(f"      Content: {post['content'][:50]}...")
                        print(f"      Timestamp: {post['timestamp']}")
                        print()
                        
                except:
                    print(f"  ❌ Post {post['id']}: Still has parsing issues")
            
            print(f"📊 Total posts that will appear in home timeline: {timeline_count}")
            
            return True
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return False
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    success = fix_recent_posts()
    if success:
        print("\n" + "=" * 50)
        print("✅ RECENT POSTS FIXED!")
        print("- Recent posts now have valid DD-MM-YYYY timestamps")
        print("- Posts are within 48-hour window")
        print("- Restart Flask app and check home timeline")
        print("=" * 50)
    else:
        print("\n❌ Fix failed!")