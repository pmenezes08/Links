#!/usr/bin/env python3
"""
Script to upload the CPoint logo to Cloudflare R2.

Usage:
    1. Make sure you have the logo image file (e.g., cpoint-logo.png)
    2. Set environment variables or update this script with your R2 credentials
    3. Run: python upload_logo_to_r2.py /path/to/cpoint-logo.png

The script will output the public URL to use in the invite page.
"""

import os
import sys
import boto3
from botocore.config import Config

# R2 Configuration - set these environment variables or hardcode temporarily
R2_ACCESS_KEY = os.environ.get('CLOUDFLARE_R2_ACCESS_KEY')
R2_SECRET_KEY = os.environ.get('CLOUDFLARE_R2_SECRET_KEY')
R2_BUCKET = os.environ.get('CLOUDFLARE_R2_BUCKET')
R2_ENDPOINT = os.environ.get('CLOUDFLARE_R2_ENDPOINT')
R2_PUBLIC_URL = os.environ.get('CLOUDFLARE_R2_PUBLIC_URL', '').rstrip('/')

def upload_logo(file_path: str):
    """Upload logo to R2 and return the public URL."""
    
    if not all([R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, R2_ENDPOINT]):
        print("Error: Missing R2 configuration. Set these environment variables:")
        print("  CLOUDFLARE_R2_ACCESS_KEY")
        print("  CLOUDFLARE_R2_SECRET_KEY")
        print("  CLOUDFLARE_R2_BUCKET")
        print("  CLOUDFLARE_R2_ENDPOINT")
        print("  CLOUDFLARE_R2_PUBLIC_URL")
        sys.exit(1)
    
    if not os.path.exists(file_path):
        print(f"Error: File not found: {file_path}")
        sys.exit(1)
    
    # Determine content type
    ext = os.path.splitext(file_path)[1].lower()
    content_types = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
    }
    content_type = content_types.get(ext, 'image/png')
    
    # Create S3 client for R2
    client = boto3.client(
        's3',
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        config=Config(signature_version='s3v4'),
        region_name='auto'
    )
    
    # Upload the logo
    key = 'assets/cpoint-logo.png'  # Fixed path for the logo
    
    print(f"Uploading {file_path} to R2...")
    
    with open(file_path, 'rb') as f:
        client.put_object(
            Bucket=R2_BUCKET,
            Key=key,
            Body=f.read(),
            ContentType=content_type,
            CacheControl='public, max-age=31536000'  # 1 year cache
        )
    
    public_url = f"{R2_PUBLIC_URL}/{key}" if R2_PUBLIC_URL else f"(bucket)/{key}"
    
    print(f"\n✅ Logo uploaded successfully!")
    print(f"\nPublic URL: {public_url}")
    print(f"\nUpdate the CPOINT_LOGO_URL in bodybuilding_app.py to:")
    print(f'CPOINT_LOGO_URL = "{public_url}"')
    
    return public_url

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python upload_logo_to_r2.py /path/to/logo.png")
        print("\nOr save the logo as 'cpoint-logo.png' in the current directory")
        
        # Check for default file
        default_path = 'cpoint-logo.png'
        if os.path.exists(default_path):
            upload_logo(default_path)
        else:
            sys.exit(1)
    else:
        upload_logo(sys.argv[1])
