#!/usr/bin/env python3
"""
Delete all talking avatar posts from database
Removes posts, imagine_jobs, and related files
"""

import os
import sys
import mysql.connector
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

# Database configuration
DB_CONFIG = {
    'host': os.environ.get('MYSQL_HOST', 'localhost'),
    'user': os.environ.get('MYSQL_USER', ''),
    'password': os.environ.get('MYSQL_PASSWORD', ''),
    'database': os.environ.get('MYSQL_DB', ''),
}

def get_db_connection():
    """Connect to MySQL database"""
    return mysql.connector.connect(**DB_CONFIG)

def delete_talking_avatar_posts(dry_run=True):
    """
    Delete all talking avatar related posts
    
    Args:
        dry_run: If True, only shows what would be deleted without actually deleting
    """
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    
    try:
        print("=" * 60)
        print("TALKING AVATAR POST CLEANUP")
        print("=" * 60)
        print()
        
        if dry_run:
            print("🔍 DRY RUN MODE - No changes will be made")
            print()
        else:
            print("⚠️  DELETION MODE - Posts will be permanently deleted!")
            print()
        
        # 1. Find all talking avatar jobs
        print("Step 1: Finding talking avatar jobs...")
        cursor.execute("""
            SELECT id, created_by, target_type, target_id, source_path, audio_path, result_path, status
            FROM imagine_jobs
            WHERE source_type = 'talking_avatar'
            ORDER BY created_at DESC
        """)
        jobs = cursor.fetchall()
        
        print(f"Found {len(jobs)} talking avatar jobs")
        print()
        
        if not jobs:
            print("✅ No talking avatar jobs found. Database is clean!")
            return
        
        # 2. Collect post IDs and file paths
        post_ids = []
        files_to_delete = []
        
        for job in jobs:
            print(f"Job {job['id']}:")
            print(f"  Created by: {job['created_by']}")
            print(f"  Target: {job['target_type']} #{job['target_id']}")
            print(f"  Status: {job['status']}")
            print(f"  Source: {job['source_path']}")
            print(f"  Audio: {job['audio_path']}")
            print(f"  Result: {job['result_path']}")
            print()
            
            if job['target_type'] == 'post' and job['target_id']:
                post_ids.append(job['target_id'])
            
            # Collect files
            if job['source_path']:
                files_to_delete.append(job['source_path'])
            if job['audio_path']:
                files_to_delete.append(job['audio_path'])
            if job['result_path']:
                files_to_delete.append(job['result_path'])
        
        # 3. Get post details
        if post_ids:
            print(f"Step 2: Finding {len(post_ids)} related posts...")
            placeholders = ','.join(['%s'] * len(post_ids))
            cursor.execute(f"""
                SELECT id, username, community_id, content, video_path, image_path, timestamp
                FROM posts
                WHERE id IN ({placeholders})
                ORDER BY timestamp DESC
            """, post_ids)
            posts = cursor.fetchall()
            
            print(f"Found {len(posts)} posts:")
            print()
            
            for post in posts:
                print(f"Post {post['id']}:")
                print(f"  User: {post['username']}")
                print(f"  Community: {post['community_id']}")
                print(f"  Content: {post['content'][:100] if post['content'] else '(no content)'}...")
                print(f"  Video: {post['video_path']}")
                print(f"  Image: {post['image_path']}")
                print(f"  Date: {post['timestamp']}")
                print()
                
                # Add post media to files to delete
                if post['video_path'] and post['video_path'] != 'pending':
                    files_to_delete.append(post['video_path'])
                if post['image_path']:
                    files_to_delete.append(post['image_path'])
        
        # 4. Show summary
        print("=" * 60)
        print("SUMMARY")
        print("=" * 60)
        print(f"Jobs to delete: {len(jobs)}")
        print(f"Posts to delete: {len(post_ids)}")
        print(f"Files to delete: {len(set(files_to_delete))}")
        print()
        
        # 5. Confirm deletion
        if not dry_run:
            print("⚠️  This will permanently delete:")
            print(f"   - {len(jobs)} imagine_jobs entries")
            print(f"   - {len(post_ids)} posts")
            print(f"   - {len(set(files_to_delete))} files from disk")
            print()
            
            response = input("Type 'DELETE' to confirm: ")
            if response != 'DELETE':
                print("Cancelled.")
                return
            
            # Delete from database
            print()
            print("Deleting from database...")
            
            # Delete posts
            if post_ids:
                placeholders = ','.join(['%s'] * len(post_ids))
                
                # Delete related reactions
                cursor.execute(f"DELETE FROM reactions WHERE post_id IN ({placeholders})", post_ids)
                print(f"  Deleted reactions for {cursor.rowcount} posts")
                
                # Delete related comments
                cursor.execute(f"DELETE FROM comments WHERE post_id IN ({placeholders})", post_ids)
                print(f"  Deleted {cursor.rowcount} comments")
                
                # Delete posts
                cursor.execute(f"DELETE FROM posts WHERE id IN ({placeholders})", post_ids)
                print(f"  Deleted {cursor.rowcount} posts")
            
            # Delete imagine_jobs
            job_ids = [job['id'] for job in jobs]
            placeholders = ','.join(['%s'] * len(job_ids))
            cursor.execute(f"DELETE FROM imagine_jobs WHERE id IN ({placeholders})", job_ids)
            print(f"  Deleted {cursor.rowcount} imagine_jobs")
            
            conn.commit()
            print()
            print("✅ Database cleanup complete!")
            print()
            
            # Delete files
            print("Deleting files from disk...")
            upload_folder = os.path.join(os.path.dirname(__file__), 'uploads')
            deleted_count = 0
            
            for file_path in set(files_to_delete):
                if not file_path or file_path == 'pending':
                    continue
                
                # Remove 'uploads/' prefix if present
                clean_path = file_path.replace('uploads/', '')
                full_path = os.path.join(upload_folder, clean_path)
                
                if os.path.exists(full_path):
                    try:
                        os.remove(full_path)
                        deleted_count += 1
                        print(f"  Deleted: {clean_path}")
                    except Exception as e:
                        print(f"  ⚠️  Could not delete {clean_path}: {e}")
                else:
                    print(f"  ⏭️  Not found: {clean_path}")
            
            print()
            print(f"✅ Deleted {deleted_count} files from disk")
            print()
            print("=" * 60)
            print("CLEANUP COMPLETE!")
            print("=" * 60)
        else:
            print("🔍 DRY RUN COMPLETE - No changes were made")
            print()
            print("To actually delete, run:")
            print("  python3 delete_talking_avatar_posts.py --delete")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        conn.rollback()
    finally:
        cursor.close()
        conn.close()

if __name__ == '__main__':
    # Check for --delete flag
    dry_run = '--delete' not in sys.argv
    
    if dry_run:
        print("Running in DRY RUN mode (no changes will be made)")
        print("To actually delete, add --delete flag")
        print()
    
    delete_talking_avatar_posts(dry_run=dry_run)
