#!/usr/bin/env python3
"""
Migration script to upload existing static files to Cloudflare R2.

Usage:
    python migrate_to_r2.py --dry-run    # Preview what will be uploaded
    python migrate_to_r2.py              # Actually upload files

Run this on PythonAnywhere after setting up R2 environment variables.
"""

import os
import sys
import argparse
from pathlib import Path

# Add the project to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def get_content_type(filename: str) -> str:
    """Get content type based on file extension."""
    ext = os.path.splitext(filename)[1].lower()
    content_types = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.m4v': 'video/x-m4v',
        '.avi': 'video/x-msvideo',
        '.mp3': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg',
        '.wav': 'audio/wav',
        '.opus': 'audio/opus',
        '.pdf': 'application/pdf',
    }
    return content_types.get(ext, 'application/octet-stream')


def migrate_to_r2(dry_run=False, folders=None):
    """Migrate files from local uploads to R2."""
    
    # Check R2 configuration
    R2_ACCESS_KEY = os.environ.get('CLOUDFLARE_R2_ACCESS_KEY')
    R2_SECRET_KEY = os.environ.get('CLOUDFLARE_R2_SECRET_KEY')
    R2_BUCKET = os.environ.get('CLOUDFLARE_R2_BUCKET')
    R2_ENDPOINT = os.environ.get('CLOUDFLARE_R2_ENDPOINT')
    R2_PUBLIC_URL = os.environ.get('CLOUDFLARE_R2_PUBLIC_URL', '').rstrip('/')
    R2_ENABLED = os.environ.get('CLOUDFLARE_R2_ENABLED', '').lower() == 'true'
    
    if not R2_ENABLED:
        print("ERROR: R2 is not enabled. Set CLOUDFLARE_R2_ENABLED=true")
        return
    
    if not all([R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, R2_ENDPOINT]):
        print("ERROR: Missing R2 configuration. Check environment variables:")
        print(f"  CLOUDFLARE_R2_ACCESS_KEY: {'Set' if R2_ACCESS_KEY else 'MISSING'}")
        print(f"  CLOUDFLARE_R2_SECRET_KEY: {'Set' if R2_SECRET_KEY else 'MISSING'}")
        print(f"  CLOUDFLARE_R2_BUCKET: {R2_BUCKET or 'MISSING'}")
        print(f"  CLOUDFLARE_R2_ENDPOINT: {R2_ENDPOINT or 'MISSING'}")
        return
    
    print(f"R2 Configuration:")
    print(f"  Bucket: {R2_BUCKET}")
    print(f"  Endpoint: {R2_ENDPOINT}")
    print(f"  Public URL: {R2_PUBLIC_URL}")
    print()
    
    # Initialize S3 client
    if not dry_run:
        try:
            import boto3
            from botocore.config import Config
            
            s3_client = boto3.client(
                's3',
                endpoint_url=R2_ENDPOINT,
                aws_access_key_id=R2_ACCESS_KEY,
                aws_secret_access_key=R2_SECRET_KEY,
                config=Config(
                    signature_version='s3v4',
                    retries={'max_attempts': 3, 'mode': 'adaptive'}
                ),
                region_name='auto'
            )
            print("✓ S3 client initialized")
        except ImportError:
            print("ERROR: boto3 not installed. Run: pip install boto3")
            return
        except Exception as e:
            print(f"ERROR: Failed to initialize S3 client: {e}")
            return
    else:
        s3_client = None
        print("DRY RUN - No files will be uploaded")
    
    print()
    
    # Find uploads directory
    base_dir = os.path.dirname(os.path.abspath(__file__))
    uploads_dirs = [
        os.path.join(base_dir, 'static', 'uploads'),
        os.path.join(base_dir, 'uploads'),
    ]
    
    # Default folders to migrate
    if folders is None:
        folders = [
            'message_photos',
            'message_videos', 
            'voice_messages',
            'community_stories',
            'community_backgrounds',
            'profile_pictures',
            'audio',
            'video',
            'docs',
        ]
    
    total_files = 0
    total_size = 0
    uploaded_files = 0
    failed_files = 0
    skipped_files = 0
    
    for uploads_dir in uploads_dirs:
        if not os.path.exists(uploads_dir):
            continue
            
        print(f"Scanning: {uploads_dir}")
        
        for folder in folders:
            folder_path = os.path.join(uploads_dir, folder)
            if not os.path.exists(folder_path):
                continue
            
            print(f"\n  📁 {folder}/")
            
            for root, dirs, files in os.walk(folder_path):
                for filename in files:
                    # Skip hidden files and system files
                    if filename.startswith('.'):
                        continue
                    
                    file_path = os.path.join(root, filename)
                    rel_path = os.path.relpath(file_path, uploads_dir)
                    file_size = os.path.getsize(file_path)
                    
                    total_files += 1
                    total_size += file_size
                    
                    # R2 key (path in bucket)
                    r2_key = rel_path.replace('\\', '/')  # Windows compatibility
                    
                    if dry_run:
                        print(f"    Would upload: {rel_path} ({file_size / 1024:.1f} KB)")
                        uploaded_files += 1
                    else:
                        try:
                            # Check if file already exists in R2
                            try:
                                s3_client.head_object(Bucket=R2_BUCKET, Key=r2_key)
                                print(f"    ⏭ Skipped (exists): {rel_path}")
                                skipped_files += 1
                                continue
                            except:
                                pass  # File doesn't exist, proceed with upload
                            
                            # Upload file
                            content_type = get_content_type(filename)
                            with open(file_path, 'rb') as f:
                                s3_client.put_object(
                                    Bucket=R2_BUCKET,
                                    Key=r2_key,
                                    Body=f,
                                    ContentType=content_type,
                                    CacheControl='public, max-age=31536000'
                                )
                            print(f"    ✓ Uploaded: {rel_path} ({file_size / 1024:.1f} KB)")
                            uploaded_files += 1
                        except Exception as e:
                            print(f"    ✗ Failed: {rel_path} - {e}")
                            failed_files += 1
        
        # Also check for files directly in uploads root (not in subfolders)
        print(f"\n  📁 (root files)")
        for filename in os.listdir(uploads_dir):
            file_path = os.path.join(uploads_dir, filename)
            if os.path.isfile(file_path) and not filename.startswith('.'):
                file_size = os.path.getsize(file_path)
                total_files += 1
                total_size += file_size
                
                if dry_run:
                    print(f"    Would upload: {filename} ({file_size / 1024:.1f} KB)")
                    uploaded_files += 1
                else:
                    try:
                        try:
                            s3_client.head_object(Bucket=R2_BUCKET, Key=filename)
                            print(f"    ⏭ Skipped (exists): {filename}")
                            skipped_files += 1
                            continue
                        except:
                            pass
                        
                        content_type = get_content_type(filename)
                        with open(file_path, 'rb') as f:
                            s3_client.put_object(
                                Bucket=R2_BUCKET,
                                Key=filename,
                                Body=f,
                                ContentType=content_type,
                                CacheControl='public, max-age=31536000'
                            )
                        print(f"    ✓ Uploaded: {filename} ({file_size / 1024:.1f} KB)")
                        uploaded_files += 1
                    except Exception as e:
                        print(f"    ✗ Failed: {filename} - {e}")
                        failed_files += 1
    
    print("\n" + "=" * 50)
    print("MIGRATION SUMMARY")
    print("=" * 50)
    print(f"Total files found: {total_files}")
    print(f"Total size: {total_size / (1024 * 1024):.2f} MB")
    if dry_run:
        print(f"Would upload: {uploaded_files} files")
    else:
        print(f"Uploaded: {uploaded_files} files")
        print(f"Skipped (already exists): {skipped_files} files")
        print(f"Failed: {failed_files} files")
    
    if R2_PUBLIC_URL and not dry_run and uploaded_files > 0:
        print(f"\nFiles are now available at: {R2_PUBLIC_URL}/")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Migrate uploads to Cloudflare R2')
    parser.add_argument('--dry-run', action='store_true', help='Preview without uploading')
    parser.add_argument('--folders', nargs='+', help='Specific folders to migrate')
    args = parser.parse_args()
    
    migrate_to_r2(dry_run=args.dry_run, folders=args.folders)
