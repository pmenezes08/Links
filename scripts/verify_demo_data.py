#!/usr/bin/env python3
"""Verify demo data was seeded correctly."""

import os
import sys

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _REPO)

import pymysql
from pymysql.cursors import DictCursor

DEFAULT_HOST = os.environ.get("MYSQL_HOST", "127.0.0.1")
DEFAULT_PORT = os.environ.get("MYSQL_PORT", "3307")
DEFAULT_USER = os.environ.get("MYSQL_USER", "app_user")
DEFAULT_DB = os.environ.get("MYSQL_DB", "cpoint")

def main():
    conn = pymysql.connect(
        host=DEFAULT_HOST,
        port=int(DEFAULT_PORT),
        user=DEFAULT_USER,
        password=os.environ.get("MYSQL_PASSWORD", ""),
        database=DEFAULT_DB,
        charset="utf8mb4",
        cursorclass=DictCursor,
    )
    
    c = conn.cursor()
    
    # Check communities
    print("=== COMMUNITIES ===")
    c.execute("""
        SELECT id, name, creator_username, tier, parent_community_id 
        FROM communities 
        WHERE name IN ('Summer Travelers', 'Future Thinkers', 'Growth Network', 
                       'Scale Community', 'Enterprise Hub', 'Tech Leadership', 
                       'Product Strategy', 'Sales & Revenue')
        ORDER BY id
    """)
    for row in c.fetchall():
        parent = f", parent={row['parent_community_id']}" if row['parent_community_id'] else ""
        print(f"  {row['id']}: {row['name']} (owner: {row['creator_username']}, tier: {row['tier']}{parent})")
    
    # Check JohnDoe membership
    print("\n=== JOHNDOE MEMBERSHIPS ===")
    c.execute("""
        SELECT c.name, uc.role 
        FROM user_communities uc 
        JOIN communities c ON uc.community_id = c.id 
        JOIN users u ON uc.user_id = u.id 
        WHERE u.username = 'JohnDoe'
        ORDER BY c.id
    """)
    rows = c.fetchall()
    if rows:
        for row in rows:
            print(f"  {row['name']}: {row['role']}")
    else:
        print("  WARNING: JohnDoe has no memberships!")
    
    # Check member counts
    print("\n=== MEMBER COUNTS ===")
    c.execute("""
        SELECT c.name, COUNT(uc.id) as member_count
        FROM communities c
        LEFT JOIN user_communities uc ON c.id = uc.community_id
        WHERE c.name IN ('Summer Travelers', 'Future Thinkers', 'Growth Network',
                         'Scale Community', 'Enterprise Hub', 'Tech Leadership')
        GROUP BY c.id
        ORDER BY c.id
    """)
    for row in c.fetchall():
        print(f"  {row['name']}: {row['member_count']} members")
    
    # Check sample usernames (variety check)
    print("\n=== SAMPLE USERNAMES (first 20) ===")
    c.execute("SELECT username FROM users WHERE email LIKE 'staging_test_%' ORDER BY id LIMIT 20")
    usernames = [row['username'] for row in c.fetchall()]
    print(f"  {', '.join(['@' + u for u in usernames])}")
    
    # Check post/reply counts
    print("\n=== CONTENT COUNTS ===")
    c.execute("""
        SELECT c.name, 
               (SELECT COUNT(*) FROM posts WHERE community_id = c.id) as posts,
               (SELECT COUNT(*) FROM replies WHERE community_id = c.id) as replies
        FROM communities c
        WHERE c.name IN ('Summer Travelers', 'Future Thinkers', 'Enterprise Hub', 
                         'Tech Leadership', 'Growth Network')
        ORDER BY c.id
    """)
    for row in c.fetchall():
        print(f"  {row['name']}: {row['posts']} posts, {row['replies']} replies")
    
    # Check calendar event
    print("\n=== CALENDAR EVENTS ===")
    c.execute("""
        SELECT ce.title, c.name as community
        FROM calendar_events ce
        JOIN communities c ON ce.community_id = c.id
        WHERE c.name = 'Summer Travelers'
    """)
    for row in c.fetchall():
        print(f"  '{row['title']}' in {row['community']}")
    
    conn.close()
    print("\n[verify] Done!")

if __name__ == "__main__":
    main()
