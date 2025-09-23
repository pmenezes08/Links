#!/usr/bin/env python3
"""
Check post dates and timestamps in the database
Run this on PythonAnywhere bash console
"""

import pymysql
import os
from datetime import datetime, timedelta

def check_post_dates():
    """Check post timestamps and identify date issues"""
    
    print("Post Date Analysis")
    print("=" * 30)
    
    # MySQL connection details for PythonAnywhere
    mysql_config = {
        'host': 'puntz08.mysql.pythonanywhere-services.com',
        'user': 'puntz08',
        'password': '',  # Will be prompted
        'database': 'puntz08$C-Point'
    }
    
    # Get MySQL password
    print("Enter your MySQL password:")
    mysql_password = input().strip()
    
    if not mysql_password:
        print("❌ MySQL password is required")
        return False
    
    mysql_config['password'] = mysql_password
    
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
            # Get current time for comparison
            now = datetime.now()
            forty_eight_hours_ago = now - timedelta(hours=48)
            
            print(f"\n🕒 Current time: {now}")
            print(f"🕒 48 hours ago: {forty_eight_hours_ago}")
            
            # Check recent posts in WHU community (ID: 12)
            print(f"\n📋 Recent posts in WHU community (ID: 12):")
            c.execute("""
                SELECT id, username, content, timestamp, community_id
                FROM posts 
                WHERE community_id = 12
                ORDER BY id DESC 
                LIMIT 10
            """)
            
            whu_posts = c.fetchall()
            
            if not whu_posts:
                print("   ❌ No posts found in WHU community")
            else:
                print(f"   Found {len(whu_posts)} posts:")
                for post in whu_posts:
                    print(f"     ID: {post['id']}, User: {post['username']}")
                    print(f"     Content: {post['content'][:50]}...")
                    print(f"     Timestamp: {post['timestamp']}")
                    
                    # Try to parse the timestamp
                    try:
                        # Try different timestamp formats
                        timestamp_str = post['timestamp']
                        parsed_date = None
                        
                        # Format 1: MM.DD.YY HH:MM
                        try:
                            parsed_date = datetime.strptime(timestamp_str, '%m.%d.%y %H:%M')
                        except:
                            pass
                            
                        # Format 2: YYYY-MM-DD HH:MM:SS
                        if not parsed_date:
                            try:
                                parsed_date = datetime.strptime(timestamp_str[:19], '%Y-%m-%d %H:%M:%S')
                            except:
                                pass
                        
                        # Format 3: MM/DD/YY HH:MM AM/PM
                        if not parsed_date:
                            try:
                                parsed_date = datetime.strptime(timestamp_str, '%m/%d/%y %I:%M %p')
                            except:
                                pass
                        
                        if parsed_date:
                            age = now - parsed_date
                            within_48h = age <= timedelta(hours=48)
                            print(f"     Parsed: {parsed_date}")
                            print(f"     Age: {age}")
                            print(f"     Within 48h: {'✅' if within_48h else '❌'}")
                        else:
                            print(f"     ❌ Could not parse timestamp: {timestamp_str}")
                            
                    except Exception as e:
                        print(f"     ❌ Error parsing timestamp: {e}")
                    
                    print()
            
            # Check posts in KW28 community (ID: 21)
            print(f"\n📋 Recent posts in KW28 community (ID: 21):")
            c.execute("""
                SELECT id, username, content, timestamp, community_id
                FROM posts 
                WHERE community_id = 21
                ORDER BY id DESC 
                LIMIT 10
            """)
            
            kw28_posts = c.fetchall()
            
            if not kw28_posts:
                print("   ❌ No posts found in KW28 community")
            else:
                print(f"   Found {len(kw28_posts)} posts:")
                for post in kw28_posts:
                    print(f"     ID: {post['id']}, User: {post['username']}")
                    print(f"     Content: {post['content'][:50]}...")
                    print(f"     Timestamp: {post['timestamp']}")
                    print()
            
            # Check all recent posts across all communities
            print(f"\n📋 All recent posts (last 20):")
            c.execute("""
                SELECT p.id, p.username, p.content, p.timestamp, p.community_id, c.name as community_name
                FROM posts p
                LEFT JOIN communities c ON p.community_id = c.id
                ORDER BY p.id DESC 
                LIMIT 20
            """)
            
            all_posts = c.fetchall()
            
            for post in all_posts:
                community_info = f" in {post['community_name']}" if post['community_name'] else ""
                print(f"   ID: {post['id']}, {post['username']}{community_info}")
                print(f"   Timestamp: {post['timestamp']}")
                print()
            
            # Check user's community memberships
            print(f"\n👥 Checking user community memberships:")
            c.execute("""
                SELECT u.username, GROUP_CONCAT(CONCAT(c.name, ' (', c.id, ')') SEPARATOR ', ') as communities
                FROM users u
                JOIN user_communities uc ON u.id = uc.user_id
                JOIN communities c ON uc.community_id = c.id
                WHERE u.username IN ('Paulo', 'admin', 'mary')
                GROUP BY u.username
            """)
            
            memberships = c.fetchall()
            for membership in memberships:
                print(f"   {membership['username']}: {membership['communities']}")
            
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
        check_post_dates()
    except KeyboardInterrupt:
        print("\n❌ Analysis cancelled by user")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")