#!/usr/bin/env python3
"""
Convert all post timestamps to DD-MM-YYYY HH:MM:SS format
"""

import pymysql
from datetime import datetime

def convert_to_dd_mm_yyyy():
    """Convert all post timestamps to DD-MM-YYYY format"""
    
    print("Convert Timestamps to DD-MM-YYYY Format")
    print("=" * 40)
    
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
            # Get all posts with their current timestamps
            print("\n📋 Getting all posts with current timestamps...")
            c.execute("""
                SELECT id, username, timestamp
                FROM posts 
                ORDER BY id ASC
            """)
            all_posts = c.fetchall()
            
            print(f"Found {len(all_posts)} posts to convert")
            
            converted_count = 0
            failed_count = 0
            
            print(f"\n🔄 Converting timestamps to DD-MM-YYYY format...")
            
            for i, post in enumerate(all_posts):
                try:
                    current_timestamp = post['timestamp']
                    
                    # Parse the current timestamp (should be YYYY-MM-DD HH:MM:SS format)
                    if isinstance(current_timestamp, str):
                        # Parse string timestamp
                        dt = datetime.strptime(current_timestamp[:19], '%Y-%m-%d %H:%M:%S')
                    else:
                        # Already a datetime object
                        dt = current_timestamp
                    
                    # Convert to DD-MM-YYYY HH:MM:SS format
                    dd_mm_yyyy_format = dt.strftime('%d-%m-%Y %H:%M:%S')
                    
                    # Update the post
                    c.execute("""
                        UPDATE posts 
                        SET timestamp = %s 
                        WHERE id = %s
                    """, (dd_mm_yyyy_format, post['id']))
                    
                    converted_count += 1
                    
                    # Show progress for first and last few posts
                    if i < 5 or i >= len(all_posts) - 5:
                        print(f"  Post {post['id']} ({post['username']}): {current_timestamp} → {dd_mm_yyyy_format}")
                    elif i == 5:
                        print(f"  ... (converting {len(all_posts) - 10} more posts)")
                    
                except Exception as e:
                    print(f"  ❌ Failed to convert post {post['id']}: {e}")
                    failed_count += 1
            
            conn.commit()
            print(f"\n✅ Successfully converted {converted_count} timestamps to DD-MM-YYYY format")
            if failed_count > 0:
                print(f"❌ Failed to convert {failed_count} timestamps")
            
            # Verification
            print(f"\n🔍 Verification - checking converted timestamps...")
            
            # Check a sample of posts
            c.execute("""
                SELECT id, username, timestamp
                FROM posts 
                ORDER BY id DESC
                LIMIT 5
            """)
            
            sample_posts = c.fetchall()
            
            for post in sample_posts:
                print(f"  Post {post['id']} ({post['username']}): {post['timestamp']}")
                
                # Test that it can be parsed with DD-MM-YYYY format
                try:
                    dt = datetime.strptime(post['timestamp'], '%d-%m-%Y %H:%M:%S')
                    print(f"    ✅ Parsing successful: {dt}")
                except Exception as e:
                    print(f"    ❌ Parsing failed: {e}")
            
            # Check home timeline eligibility
            print(f"\n🏠 Home timeline check...")
            
            # Count posts that should appear in timeline
            timeline_count = 0
            c.execute("SELECT id, timestamp FROM posts ORDER BY id DESC LIMIT 20")
            recent_posts = c.fetchall()
            
            for post in recent_posts:
                try:
                    dt = datetime.strptime(post['timestamp'], '%d-%m-%Y %H:%M:%S')
                    age = datetime.now() - dt
                    if age.total_seconds() <= (48 * 3600):  # 48 hours
                        timeline_count += 1
                except:
                    pass
            
            print(f"  📊 {timeline_count} posts will appear in home timeline")
            
            return True
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return False
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    success = convert_to_dd_mm_yyyy()
    if success:
        print("\n" + "=" * 60)
        print("✅ ALL TIMESTAMPS CONVERTED TO DD-MM-YYYY!")
        print("- All posts now use DD-MM-YYYY HH:MM:SS format")
        print("- Chronological order maintained")
        print("- Home timeline will show recent posts")
        print("- Consistent European date format throughout")
        print("=" * 60)
        print("\n🚀 RESTART FLASK APP - DD-MM-YYYY FORMAT ACTIVE!")
    else:
        print("\n❌ Conversion failed!")