#!/usr/bin/env python3
"""
Debug home timeline - check exactly what's happening
"""

import pymysql

def debug_timeline():
    """Debug why home timeline isn't showing posts"""
    
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
        
        with conn.cursor() as c:
            # Check Paulo's communities
            print("Paulo's communities:")
            c.execute("""
                SELECT c.id, c.name FROM communities c
                JOIN user_communities uc ON c.id = uc.community_id
                JOIN users u ON uc.user_id = u.id
                WHERE u.username = 'Paulo'
            """)
            communities = c.fetchall()
            
            community_ids = []
            for comm in communities:
                community_ids.append(comm['id'])
                print(f"  - {comm['name']} (ID: {comm['id']})")
            
            if not community_ids:
                print("❌ Paulo has no community memberships!")
                return
            
            # Check posts in those communities
            print(f"\nPosts in Paulo's communities:")
            placeholders = ",".join(["%s"] * len(community_ids))
            c.execute(f"""
                SELECT id, username, content, timestamp, community_id
                FROM posts
                WHERE community_id IN ({placeholders})
                ORDER BY id DESC
                LIMIT 10
            """, community_ids)
            
            posts = c.fetchall()
            
            if not posts:
                print("❌ No posts found in Paulo's communities!")
            else:
                print(f"Found {len(posts)} posts:")
                for post in posts:
                    print(f"  ID: {post['id']}, User: {post['username']}")
                    print(f"  Content: {post['content'][:50]}...")
                    print(f"  Timestamp: {post['timestamp']}")
                    print(f"  Community ID: {post['community_id']}")
                    print()
            
            # Test the home timeline API directly
            print("Testing home timeline API simulation:")
            
            # Simulate what the API does
            from datetime import datetime, timedelta
            now = datetime.utcnow()
            forty_eight = timedelta(hours=48)
            
            timeline_posts = []
            for post in posts:
                timestamp_str = str(post.get('timestamp', ''))
                print(f"  Processing post {post['id']}: timestamp = '{timestamp_str}'")
                
                # Try parsing with DD-MM-YYYY format
                try:
                    dt = datetime.strptime(timestamp_str[:19], '%d-%m-%Y %H:%M:%S')
                    age = now - dt
                    within_48h = age <= forty_eight
                    print(f"    Parsed as DD-MM-YYYY: {dt}")
                    print(f"    Age: {age}")
                    print(f"    Within 48h: {'✅' if within_48h else '❌'}")
                    
                    if within_48h:
                        timeline_posts.append(post)
                except Exception as e:
                    print(f"    ❌ DD-MM-YYYY parsing failed: {e}")
                    
                    # Try other formats
                    try:
                        dt = datetime.strptime(timestamp_str[:19], '%Y-%m-%d %H:%M:%S')
                        age = now - dt
                        within_48h = age <= forty_eight
                        print(f"    Parsed as YYYY-MM-DD: {dt}")
                        print(f"    Age: {age}")
                        print(f"    Within 48h: {'✅' if within_48h else '❌'}")
                        
                        if within_48h:
                            timeline_posts.append(post)
                    except:
                        print(f"    ❌ All parsing failed for: {timestamp_str}")
                print()
            
            print(f"📊 Result: {len(timeline_posts)} posts would appear in home timeline")
            for post in timeline_posts:
                print(f"  - Post {post['id']} by {post['username']}")
            
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    debug_timeline()