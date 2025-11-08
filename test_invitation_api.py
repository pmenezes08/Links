#!/usr/bin/env python3
"""Test if invitation API is working"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

import mysql.connector

# Database config
DB_CONFIG = {
    'host': os.environ.get('MYSQL_HOST', 'localhost'),
    'user': os.environ.get('MYSQL_USER', ''),
    'password': os.environ.get('MYSQL_PASSWORD', ''),
    'database': os.environ.get('MYSQL_DB', ''),
}

def test_invitation_table():
    """Check if community_invitations table exists and has data"""
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor(dictionary=True)
        
        # Check if table exists
        cursor.execute("SHOW TABLES LIKE 'community_invitations'")
        if not cursor.fetchone():
            print("❌ Table 'community_invitations' does NOT exist!")
            print("\nYou need to reload your webapp to create the table.")
            return False
        
        print("✅ Table 'community_invitations' exists")
        
        # Check for unused invitations
        cursor.execute("""
            SELECT ci.*, c.name as community_name
            FROM community_invitations ci
            JOIN communities c ON ci.community_id = c.id
            WHERE ci.used = 0
            ORDER BY ci.invited_at DESC
            LIMIT 5
        """)
        
        invitations = cursor.fetchall()
        
        if not invitations:
            print("\n⚠️  No unused invitations found in database")
            print("   Send a new invitation from Admin Dashboard first")
        else:
            print(f"\n✅ Found {len(invitations)} unused invitation(s):")
            for inv in invitations:
                print(f"\n   Email: {inv['invited_email']}")
                print(f"   Community: {inv['community_name']}")
                print(f"   Token: {inv['token'][:20]}...")
                print(f"   Invited by: {inv['invited_by_username']}")
                print(f"   Invited at: {inv['invited_at']}")
                print(f"\n   Test URL: https://www.c-point.co/signup?invite={inv['token']}")
        
        cursor.close()
        conn.close()
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == '__main__':
    test_invitation_table()
