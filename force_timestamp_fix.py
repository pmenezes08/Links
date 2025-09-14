#!/usr/bin/env python3
"""
Force timestamp fix using MySQL built-in functions and alternative approaches
"""

import pymysql
from datetime import datetime, timedelta

def force_timestamp_fix():
    """Force fix timestamps using multiple approaches"""
    
    print("Force Timestamp Fix Script")
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
            # First, let's check the table structure
            print("\n🔍 Checking posts table structure...")
            c.execute("DESCRIBE posts")
            columns = c.fetchall()
            
            for col in columns:
                if col['Field'] == 'timestamp':
                    print(f"  Timestamp column: {col['Type']} {col['Null']} {col['Default']} {col['Extra']}")
            
            # Try different approaches to update timestamps
            problem_posts = [163, 156, 154, 153, 152, 151, 150, 149, 148, 147]
            
            print(f"\n🔧 Trying multiple approaches to fix timestamps...")
            
            # Approach 1: Use NOW() function
            print("Approach 1: Using NOW() function...")
            for i, post_id in enumerate(problem_posts):
                try:
                    c.execute("UPDATE posts SET timestamp = NOW() WHERE id = %s", (post_id,))
                    if c.rowcount > 0:
                        print(f"  ✅ Post {post_id}: Updated with NOW()")
                    else:
                        print(f"  ⚠️  Post {post_id}: No rows affected")
                except Exception as e:
                    print(f"  ❌ Post {post_id}: {e}")
            
            conn.commit()
            
            # Check if NOW() worked
            c.execute("SELECT id, timestamp FROM posts WHERE id IN (163, 156, 154) ORDER BY id DESC")
            check_results = c.fetchall()
            
            still_broken = []
            for result in check_results:
                if result['timestamp'] == '0000-00-00 00:00:00' or not result['timestamp']:
                    still_broken.append(result['id'])
                else:
                    print(f"  ✅ Post {result['id']}: {result['timestamp']}")
            
            # Approach 2: If NOW() didn't work, try CURRENT_TIMESTAMP
            if still_broken:
                print(f"\nApproach 2: Using CURRENT_TIMESTAMP for {len(still_broken)} remaining posts...")
                for post_id in still_broken:
                    try:
                        c.execute("UPDATE posts SET timestamp = CURRENT_TIMESTAMP WHERE id = %s", (post_id,))
                        if c.rowcount > 0:
                            print(f"  ✅ Post {post_id}: Updated with CURRENT_TIMESTAMP")
                        else:
                            print(f"  ⚠️  Post {post_id}: Still no rows affected")
                    except Exception as e:
                        print(f"  ❌ Post {post_id}: {e}")
                
                conn.commit()
            
            # Approach 3: If still not working, try recreating the posts
            c.execute("SELECT id, timestamp FROM posts WHERE id IN (163, 156, 154) ORDER BY id DESC")
            final_check = c.fetchall()
            
            still_broken_final = []
            for result in final_check:
                if result['timestamp'] == '0000-00-00 00:00:00' or not result['timestamp']:
                    still_broken_final.append(result['id'])
                else:
                    print(f"  ✅ Final check - Post {result['id']}: {result['timestamp']}")
            
            if still_broken_final:
                print(f"\nApproach 3: Checking for constraints/triggers...")
                
                # Check for triggers
                c.execute("SHOW TRIGGERS LIKE 'posts'")
                triggers = c.fetchall()
                if triggers:
                    print("  Found triggers on posts table:")
                    for trigger in triggers:
                        print(f"    - {trigger['Trigger']}: {trigger['Event']} {trigger['Timing']}")
                else:
                    print("  No triggers found on posts table")
                
                # Try to understand why updates aren't working
                print(f"\n🔍 Investigating post 163 specifically...")
                c.execute("SELECT * FROM posts WHERE id = 163")
                post_163 = c.fetchone()
                
                if post_163:
                    print("  Post 163 data:")
                    for key, value in post_163.items():
                        print(f"    {key}: {value}")
                else:
                    print("  ❌ Post 163 not found!")
            
            # Final verification
            print(f"\n📊 Final status check...")
            c.execute("""
                SELECT COUNT(*) as count FROM posts 
                WHERE timestamp != '0000-00-00 00:00:00' 
                AND timestamp IS NOT NULL 
                AND timestamp != ''
            """)
            valid_count = c.fetchone()['count']
            
            c.execute("SELECT COUNT(*) as count FROM posts")
            total_count = c.fetchone()['count']
            
            print(f"  Valid timestamps: {valid_count}/{total_count}")
            
            return True
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return False
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    force_timestamp_fix()