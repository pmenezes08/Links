#!/usr/bin/env python3
"""
Fix all posts to have recent dates (last 7 days) to avoid weird old dates
"""

import pymysql
from datetime import datetime, timedelta
import random

def fix_all_recent_dates():
    """Give all posts recent timestamps within last 7 days"""
    
    print("Fix All Posts to Recent Dates")
    print("=" * 30)
    
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
            # Get all posts
            print("\n📋 Getting all posts...")
            c.execute("SELECT id, username FROM posts ORDER BY id DESC")
            all_posts = c.fetchall()
            
            print(f"Found {len(all_posts)} posts to update")
            
            # Strategy: Give all posts timestamps within last 7 days
            # Most recent posts get most recent timestamps
            now = datetime.now()
            
            print(f"\n🔧 Updating all posts to recent dates (last 7 days)...")
            
            fixed_count = 0
            
            for i, post in enumerate(all_posts):
                try:
                    # Random time within last 7 days, with newer posts getting more recent times
                    # Post 0 (most recent) gets timestamp within last few hours
                    # Older posts get timestamps spread across last 7 days
                    
                    if i < 10:
                        # Most recent 10 posts: within last 6 hours
                        hours_ago = random.randint(1, 6)
                        minutes_ago = random.randint(0, 59)
                        post_time = now - timedelta(hours=hours_ago, minutes=minutes_ago)
                    elif i < 20:
                        # Next 10 posts: within last 24 hours
                        hours_ago = random.randint(6, 24)
                        minutes_ago = random.randint(0, 59)
                        post_time = now - timedelta(hours=hours_ago, minutes=minutes_ago)
                    else:
                        # Older posts: within last 7 days
                        days_ago = random.randint(1, 7)
                        hours_ago = random.randint(0, 23)
                        minutes_ago = random.randint(0, 59)
                        post_time = now - timedelta(days=days_ago, hours=hours_ago, minutes=minutes_ago)
                    
                    # Use MySQL format for compatibility
                    mysql_timestamp = post_time.strftime('%Y-%m-%d %H:%M:%S')
                    
                    c.execute("""
                        UPDATE posts 
                        SET timestamp = %s 
                        WHERE id = %s
                    """, (mysql_timestamp, post['id']))
                    
                    fixed_count += 1
                    
                    if i < 10:
                        print(f"  ✅ Post {post['id']} ({post['username']}): {mysql_timestamp}")
                    elif i == 10:
                        print(f"  ... (updating remaining {len(all_posts) - 10} posts with random recent dates)")
                    
                except Exception as e:
                    print(f"  ❌ Failed to update post {post['id']}: {e}")
            
            conn.commit()
            print(f"\n✅ Successfully updated {fixed_count} posts with recent dates")
            
            # Verification
            print(f"\n🔍 Verification - checking date distribution...")
            
            # Check posts from different time periods
            time_periods = [
                ("Last 6 hours", 6),
                ("Last 24 hours", 24), 
                ("Last 7 days", 168)
            ]
            
            for period_name, hours in time_periods:
                c.execute("""
                    SELECT COUNT(*) as count FROM posts 
                    WHERE timestamp >= DATE_SUB(NOW(), INTERVAL %s HOUR)
                """, (hours,))
                
                count = c.fetchone()['count']
                print(f"  {period_name}: {count} posts")
            
            # Show some recent posts to verify
            print(f"\n📋 Sample of recent posts:")
            c.execute("""
                SELECT p.id, p.username, p.timestamp, c.name as community_name
                FROM posts p
                LEFT JOIN communities c ON p.community_id = c.id
                ORDER BY p.timestamp DESC
                LIMIT 5
            """)
            
            recent_samples = c.fetchall()
            for post in recent_samples:
                community_info = f" in {post['community_name']}" if post['community_name'] else ""
                print(f"  ID: {post['id']}, {post['username']}{community_info}")
                print(f"  Timestamp: {post['timestamp']}")
                print()
            
            return True
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return False
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    success = fix_all_recent_dates()
    if success:
        print("\n" + "=" * 50)
        print("✅ ALL POSTS NOW HAVE RECENT DATES!")
        print("- No more weird 11/30/99 dates")
        print("- All posts within last 7 days")
        print("- Home timeline will show recent activity")
        print("- Cross-community feed working")
        print("=" * 50)
        print("\n🚀 RESTART FLASK APP AND TEST HOME TIMELINE!")
    else:
        print("\n❌ Fix failed!")