#!/usr/bin/env python3
"""
Script to fix event notification links to use new EventDetail page format.
Converts: /community/X/event/Y/rsvp → /event/Y
"""

import os
import re

def fix_event_notification_links():
    """Update event notification links to new format"""
    
    print("=" * 60)
    print("Event Notification Links Fix Script")
    print("=" * 60)
    
    use_mysql = os.environ.get('USE_MYSQL', '').lower() == 'true'
    
    if not use_mysql:
        print("\n⚠️  USE_MYSQL is not set to 'true'")
        print("This script is for MySQL databases only.")
        return False
    
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        # Get MySQL credentials from environment
        host = os.environ.get('MYSQL_HOST')
        user = os.environ.get('MYSQL_USER')
        password = os.environ.get('MYSQL_PASSWORD')
        database = os.environ.get('MYSQL_DB')
        
        if not all([host, user, password, database]):
            print("\n❌ ERROR: Missing MySQL environment variables")
            return False
        
        print(f"\n1. Connecting to MySQL database: {database}")
        
        # Connect to database
        conn = pymysql.connect(
            host=host,
            user=user,
            password=password,
            database=database,
            charset='utf8mb4',
            cursorclass=DictCursor
        )
        
        c = conn.cursor()
        print("   ✅ Connected successfully!")
        
        # Find all event invitation notifications with old link format
        print("\n2. Finding event notifications with old link format...")
        c.execute("""
            SELECT id, link, message 
            FROM notifications 
            WHERE type = 'event_invitation' 
            AND link LIKE '/community/%/event/%'
        """)
        
        notifications = c.fetchall()
        print(f"   Found {len(notifications)} notifications to update")
        
        if len(notifications) == 0:
            print("   ✅ All notifications already have the correct format!")
            conn.close()
            return True
        
        # Update each notification
        print("\n3. Updating notification links...")
        updated_count = 0
        
        for notif in notifications:
            old_link = notif['link']
            
            # Extract event_id from link like: /community/43/event/25/rsvp
            # Pattern: /community/X/event/Y or /community/X/event/Y/rsvp
            match = re.search(r'/community/\d+/event/(\d+)', old_link)
            
            if match:
                event_id = match.group(1)
                new_link = f"/event/{event_id}"
                
                c.execute("""
                    UPDATE notifications 
                    SET link = %s 
                    WHERE id = %s
                """, (new_link, notif['id']))
                
                updated_count += 1
                print(f"   Updated notification {notif['id']}: {old_link} → {new_link}")
        
        conn.commit()
        conn.close()
        
        print("\n" + "=" * 60)
        print(f"✅ SUCCESS: Updated {updated_count} notification(s)")
        print("=" * 60)
        print("\nEvent notifications now link to the EventDetail page!")
        return True
        
    except ImportError:
        print("\n❌ ERROR: pymysql is not installed")
        return False
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    import sys
    success = fix_event_notification_links()
    sys.exit(0 if success else 1)
