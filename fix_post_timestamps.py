#!/usr/bin/env python3
"""
Fix post timestamp issues in the database
Run this on PythonAnywhere bash console
"""

import pymysql
import os
from datetime import datetime

def fix_post_timestamps():
    """Fix invalid post timestamps in the database"""
    
    print("Post Timestamp Fix Script")
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
            # Find posts with invalid timestamps
            print("\n🔍 Finding posts with invalid timestamps...")
            
            c.execute("""
                SELECT id, username, content, timestamp, community_id
                FROM posts 
                WHERE timestamp = '0000-00-00 00:00:00' 
                   OR timestamp IS NULL 
                   OR timestamp = ''
                ORDER BY id DESC
            """)
            
            invalid_posts = c.fetchall()
            
            if invalid_posts:
                print(f"Found {len(invalid_posts)} posts with invalid timestamps:")
                
                for post in invalid_posts:
                    print(f"  ID: {post['id']}, User: {post['username']}, Timestamp: {post['timestamp']}")
                    
                    # Fix with current timestamp in the format the app expects
                    current_time = datetime.now().strftime('%m.%d.%y %H:%M')
                    
                    c.execute("""
                        UPDATE posts 
                        SET timestamp = %s 
                        WHERE id = %s
                    """, (current_time, post['id']))
                    
                    print(f"    ✅ Updated to: {current_time}")
                
                conn.commit()
                print(f"\n✅ Fixed {len(invalid_posts)} posts with invalid timestamps")
            else:
                print("✅ No posts with invalid timestamps found")
            
            # Now let's also fix the timestamp format issue in the Flask app
            # The parsing logic needs to handle YYYY-MM-DD HH:MM:SS format
            print(f"\n📋 Checking posts with valid MySQL timestamps...")
            
            c.execute("""
                SELECT id, username, content, timestamp, community_id
                FROM posts 
                WHERE timestamp LIKE '____-__-__ __:__:__'
                ORDER BY id DESC 
                LIMIT 10
            """)
            
            mysql_format_posts = c.fetchall()
            
            if mysql_format_posts:
                print(f"Found {len(mysql_format_posts)} posts with MySQL timestamp format:")
                for post in mysql_format_posts:
                    # Convert from YYYY-MM-DD HH:MM:SS to MM.DD.YY HH:MM format
                    try:
                        mysql_timestamp = post['timestamp']
                        
                        # Parse MySQL format
                        dt = datetime.strptime(mysql_timestamp, '%Y-%m-%d %H:%M:%S')
                        
                        # Convert to app format (MM.DD.YY HH:MM)
                        app_format = dt.strftime('%m.%d.%y %H:%M')
                        
                        c.execute("""
                            UPDATE posts 
                            SET timestamp = %s 
                            WHERE id = %s
                        """, (app_format, post['id']))
                        
                        print(f"  ID: {post['id']} - {mysql_timestamp} → {app_format}")
                        
                    except Exception as e:
                        print(f"  ❌ Error converting timestamp for post {post['id']}: {e}")
                
                conn.commit()
                print(f"\n✅ Converted {len(mysql_format_posts)} timestamps to app format")
            else:
                print("✅ No MySQL format timestamps to convert")
            
            # Verification - check recent posts again
            print(f"\n🔍 Verification - Recent posts after fixes:")
            
            c.execute("""
                SELECT id, username, content, timestamp, community_id
                FROM posts 
                WHERE community_id IN (12, 21)
                ORDER BY id DESC 
                LIMIT 5
            """)
            
            recent_posts = c.fetchall()
            
            for post in recent_posts:
                print(f"  ID: {post['id']}, User: {post['username']}")
                print(f"  Timestamp: {post['timestamp']}")
                
                # Test if this timestamp would be included in 48h window
                try:
                    dt = datetime.strptime(post['timestamp'], '%m.%d.%y %H:%M')
                    age = datetime.now() - dt
                    within_48h = age.total_seconds() <= (48 * 3600)
                    print(f"  Age: {age}, Within 48h: {'✅' if within_48h else '❌'}")
                except:
                    print(f"  ❌ Still cannot parse timestamp")
                print()
            
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
        success = fix_post_timestamps()
        if success:
            print("\n" + "=" * 40)
            print("✅ TIMESTAMP FIXES COMPLETED!")
            print("- Invalid timestamps (0000-00-00) fixed")
            print("- MySQL format timestamps converted to app format")
            print("- Posts should now appear in home timeline")
            print("=" * 40)
        else:
            print("\n" + "=" * 40)
            print("❌ FIX FAILED!")
            print("Please check the error messages above")
            print("=" * 40)
    except KeyboardInterrupt:
        print("\n❌ Fix cancelled by user")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")