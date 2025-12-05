"""Cloudflare R2 Storage Service - S3-compatible CDN storage."""

from __future__ import annotations

import logging
import os
from io import BytesIO
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# R2 Configuration from environment
R2_ACCESS_KEY = os.environ.get('CLOUDFLARE_R2_ACCESS_KEY')
R2_SECRET_KEY = os.environ.get('CLOUDFLARE_R2_SECRET_KEY')
R2_BUCKET = os.environ.get('CLOUDFLARE_R2_BUCKET')
R2_ACCOUNT_ID = os.environ.get('CLOUDFLARE_R2_ACCOUNT_ID')
R2_PUBLIC_URL = os.environ.get('CLOUDFLARE_R2_PUBLIC_URL', '').rstrip('/')
R2_ENDPOINT = os.environ.get('CLOUDFLARE_R2_ENDPOINT')

# Check if R2 is configured AND explicitly enabled
# Set CLOUDFLARE_R2_ENABLED=true in environment to enable R2 uploads
R2_ENABLED = (
    os.environ.get('CLOUDFLARE_R2_ENABLED', '').lower() == 'true' and
    all([R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, R2_ENDPOINT])
)

_s3_client = None


def get_s3_client():
    """Get or create the S3 client for R2."""
    global _s3_client
    
    if not R2_ENABLED:
        return None
    
    if _s3_client is not None:
        return _s3_client
    
    try:
        import boto3
        from botocore.config import Config
        
        _s3_client = boto3.client(
            's3',
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY,
            aws_secret_access_key=R2_SECRET_KEY,
            config=Config(
                signature_version='s3v4',
                retries={'max_attempts': 3, 'mode': 'adaptive'}
            ),
            region_name='auto'  # R2 uses 'auto' region
        )
        logger.info("R2 S3 client initialized successfully")
        return _s3_client
    except ImportError:
        logger.warning("boto3 not installed - R2 storage disabled")
        return None
    except Exception as e:
        logger.error(f"Failed to initialize R2 client: {e}")
        return None


def get_content_type(filename: str) -> str:
    """Get content type based on file extension."""
    ext = os.path.splitext(filename)[1].lower()
    content_types = {
        # Images
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        # Videos
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.m4v': 'video/x-m4v',
        '.avi': 'video/x-msvideo',
        # Audio
        '.mp3': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg',
        '.wav': 'audio/wav',
        '.opus': 'audio/opus',
        '.webm': 'audio/webm',
        # Documents
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }
    return content_types.get(ext, 'application/octet-stream')


def upload_to_r2(
    file_data: bytes,
    key: str,
    content_type: Optional[str] = None
) -> Tuple[bool, Optional[str]]:
    """
    Upload file data to R2.
    
    Args:
        file_data: The file bytes to upload
        key: The object key (path) in the bucket
        content_type: Optional content type, auto-detected if not provided
    
    Returns:
        Tuple of (success: bool, public_url: Optional[str])
    """
    if not R2_ENABLED:
        logger.debug("R2 not enabled, skipping upload")
        return False, None
    
    client = get_s3_client()
    if not client:
        return False, None
    
    try:
        # Auto-detect content type if not provided
        if not content_type:
            content_type = get_content_type(key)
        
        # Upload to R2
        client.put_object(
            Bucket=R2_BUCKET,
            Key=key,
            Body=file_data,
            ContentType=content_type,
            CacheControl='public, max-age=31536000'  # 1 year cache
        )
        
        # Build public URL
        public_url = f"{R2_PUBLIC_URL}/{key}" if R2_PUBLIC_URL else None
        
        logger.info(f"Successfully uploaded to R2: {key}")
        return True, public_url
        
    except Exception as e:
        logger.error(f"Failed to upload to R2: {e}")
        return False, None


def upload_file_to_r2(
    file,
    key: str,
    content_type: Optional[str] = None
) -> Tuple[bool, Optional[str]]:
    """
    Upload a file object to R2.
    
    Args:
        file: File-like object with read() method
        key: The object key (path) in the bucket
        content_type: Optional content type
    
    Returns:
        Tuple of (success: bool, public_url: Optional[str])
    """
    try:
        # Read file data
        file.seek(0)
        file_data = file.read()
        file.seek(0)  # Reset for potential local save
        
        return upload_to_r2(file_data, key, content_type)
    except Exception as e:
        logger.error(f"Failed to read file for R2 upload: {e}")
        return False, None


def delete_from_r2(key: str) -> bool:
    """
    Delete an object from R2.
    
    Args:
        key: The object key to delete
    
    Returns:
        True if deleted successfully, False otherwise
    """
    if not R2_ENABLED:
        return False
    
    client = get_s3_client()
    if not client:
        return False
    
    try:
        client.delete_object(Bucket=R2_BUCKET, Key=key)
        logger.info(f"Successfully deleted from R2: {key}")
        return True
    except Exception as e:
        logger.error(f"Failed to delete from R2: {e}")
        return False


def get_r2_public_url(key: str) -> Optional[str]:
    """Get the public URL for an R2 object."""
    if not R2_PUBLIC_URL or not key:
        return None
    # Remove leading slash if present
    key = key.lstrip('/')
    return f"{R2_PUBLIC_URL}/{key}"


def is_r2_url(url: str) -> bool:
    """Check if a URL is an R2 CDN URL."""
    if not url or not R2_PUBLIC_URL:
        return False
    return url.startswith(R2_PUBLIC_URL)
