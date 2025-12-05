#!/usr/bin/env python3
"""
Script to update old R2 public URLs to the new custom domain.

This replaces:
  https://pub-d586263e07824284b4a4dd17db138ff8.r2.dev/...
With:
  https://media.c-point.co/...

Usage:
    python fix_r2_urls.py --dry-run    # Preview changes
    python fix_r2_urls.py              # Apply changes
"""

import os
import sys
import argparse

# Add project to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

OLD_URL = 'https://pub-d586263e07824284b4a4dd17db138ff8.r2.dev'
NEW_URL = 'https://media.c-point.co'


def fix_urls(dry_run=False):
    """Update old R2 URLs to new custom domain."""
    
    # Import database connection
    try:
        from backend.services.database import get_db_connection, USE_MYSQL
    except ImportError:
        print("ERROR: Could not import database module")
        return
    
    print(f"{'DRY RUN - ' if dry_run else ''}Updating R2 URLs...")
    print(f"  Old URL: {OLD_URL}")
    print(f"  New URL: {NEW_URL}")
    print()
    
    # Tables and columns that may contain R2 URLs
    tables_to_update = [
        ('messages', 'image_path'),
        ('messages', 'video_path'),
        ('messages', 'audio_path'),
        ('posts', 'image_path'),
        ('posts', 'video_path'),
        ('posts', 'audio_path'),
        ('replies', 'image_path'),
        ('replies', 'audio_path'),
        ('user_profiles', 'profile_picture'),
        ('communities', 'background_path'),
        ('community_stories', 'media_path'),
    ]
    
    total_updated = 0
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            for table, column in tables_to_update:
                # Check if table/column exists
                try:
                    if USE_MYSQL:
                        c.execute(f"SELECT COUNT(*) FROM {table} WHERE {column} LIKE %s", (f'{OLD_URL}%',))
                    else:
                        c.execute(f"SELECT COUNT(*) FROM {table} WHERE {column} LIKE ?", (f'{OLD_URL}%',))
                    
                    row = c.fetchone()
                    count = row[0] if row else 0
                    
                    if count > 0:
                        print(f"  {table}.{column}: {count} rows to update")
                        
                        if not dry_run:
                            if USE_MYSQL:
                                c.execute(
                                    f"UPDATE {table} SET {column} = REPLACE({column}, %s, %s) WHERE {column} LIKE %s",
                                    (OLD_URL, NEW_URL, f'{OLD_URL}%')
                                )
                            else:
                                c.execute(
                                    f"UPDATE {table} SET {column} = REPLACE({column}, ?, ?) WHERE {column} LIKE ?",
                                    (OLD_URL, NEW_URL, f'{OLD_URL}%')
                                )
                            print(f"    ✓ Updated {count} rows")
                        
                        total_updated += count
                    else:
                        print(f"  {table}.{column}: No old URLs found")
                        
                except Exception as e:
                    print(f"  {table}.{column}: Skipped ({e})")
            
            if not dry_run and total_updated > 0:
                conn.commit()
                print(f"\n✓ Committed {total_updated} updates to database")
            
    except Exception as e:
        print(f"ERROR: Database error: {e}")
        return
    
    print()
    print("=" * 50)
    print("SUMMARY")
    print("=" * 50)
    if dry_run:
        print(f"Would update: {total_updated} rows")
    else:
        print(f"Updated: {total_updated} rows")
    
    if total_updated > 0 and not dry_run:
        print("\n✓ Old R2 URLs have been updated to use the new custom domain!")
        print("  You can now disable the public development URL if it's still enabled.")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Fix old R2 URLs in database')
    parser.add_argument('--dry-run', action='store_true', help='Preview without updating')
    args = parser.parse_args()
    
    fix_urls(dry_run=args.dry_run)
