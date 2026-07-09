"""Cloudflare R2 Storage Service - S3-compatible CDN storage."""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Private object key prefix for user CVs (no public ACL; serve via authenticated backend only).
CV_R2_KEY_PREFIX = "private/cv"

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
            CacheControl='public, max-age=31536000',  # 1 year cache
            ACL='public-read'
        )
        
        # Build public URL
        public_url = f"{R2_PUBLIC_URL}/{key}" if R2_PUBLIC_URL else None
        
        logger.info(f"Successfully uploaded to R2: {key}")
        return True, public_url
        
    except Exception as e:
        logger.error(f"Failed to upload to R2: {e}")
        return False, None


def upload_private_bytes_to_r2(
    file_data: bytes,
    key: str,
    content_type: Optional[str] = None,
) -> bool:
    """Upload bytes without public-read ACL. For PII (e.g. CVs); access via server-side get only."""
    if not R2_ENABLED:
        logger.debug("R2 not enabled, skipping private upload")
        return False
    client = get_s3_client()
    if not client:
        return False
    try:
        if not content_type:
            content_type = get_content_type(key)
        client.put_object(
            Bucket=R2_BUCKET,
            Key=key,
            Body=file_data,
            ContentType=content_type,
            CacheControl="private, max-age=0, no-store",
        )
        logger.info("Successfully uploaded private object to R2: %s", key)
        return True
    except Exception as e:
        logger.error("Failed private upload to R2: %s", e)
        return False


def upload_public_bytes_to_r2(
    file_data: bytes,
    key: str,
    content_type: Optional[str] = None,
    *,
    cache_control: str = "public, max-age=300",
) -> bool:
    """Upload bytes for Worker-served public artifacts/manifests.

    Public build objects are not trusted to be fetched directly by browsers;
    the Cloudflare Worker reads them through an R2 binding and applies the final
    response headers. The object metadata is still cache-friendly for edge reads.
    """
    if not R2_ENABLED:
        logger.debug("R2 not enabled, skipping public upload")
        return False
    client = get_s3_client()
    if not client:
        return False
    try:
        if not content_type:
            content_type = get_content_type(key)
        client.put_object(
            Bucket=R2_BUCKET,
            Key=key,
            Body=file_data,
            ContentType=content_type,
            CacheControl=cache_control,
        )
        logger.info("Successfully uploaded public object to R2: %s", key)
        return True
    except Exception as e:
        logger.error("Failed public upload to R2: %s", e)
        return False


def download_bytes_from_r2(key: str) -> Optional[bytes]:
    """Read full object body from R2. Returns None if missing or error."""
    if not R2_ENABLED or not key:
        return None
    client = get_s3_client()
    if not client:
        return None
    try:
        resp = client.get_object(Bucket=R2_BUCKET, Key=key)
        body = resp.get("Body")
        if body is None:
            return None
        data = body.read()
        try:
            body.close()
        except Exception:
            pass
        return data
    except Exception as e:
        logger.error("Failed to download from R2 key=%s: %s", key, e)
        return None


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


def head_object(key: str) -> Optional[dict]:
    """Return object metadata from R2, or None when unavailable."""
    if not R2_ENABLED:
        return None
    client = get_s3_client()
    if not client:
        return None
    try:
        return client.head_object(Bucket=R2_BUCKET, Key=key)
    except Exception as e:
        logger.error(f"Failed to read R2 object metadata: {e}")
        return None


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


def generate_presigned_upload_url(
    key: str,
    content_type: str,
    expires_in: int = 3600
) -> Optional[str]:
    """
    Generate a presigned PUT URL for direct client upload to R2.
    Bypasses Cloud Run's 32MB request limit for large videos.
    
    Args:
        key: Object key (path) in the bucket, e.g. message_videos/video_20250102_123456.mp4
        content_type: MIME type (e.g. video/mp4)
        expires_in: URL validity in seconds (default 1 hour)
    
    Returns:
        Presigned PUT URL, or None if R2 not configured
    """
    if not R2_ENABLED:
        return None
    client = get_s3_client()
    if not client:
        return None
    try:
        url = client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': R2_BUCKET,
                'Key': key,
                'ContentType': content_type,
            },
            ExpiresIn=expires_in
        )
        return url
    except Exception as e:
        logger.error(f"Failed to generate presigned URL for {key}: {e}")
        return None


# Minimum part size for S3-compatible multipart (5 MiB except last part).
MULTIPART_PART_SIZE = 5 * 1024 * 1024


def create_multipart_upload(key: str, content_type: str) -> Optional[str]:
    """Start a multipart upload; returns UploadId or None."""
    if not R2_ENABLED:
        return None
    client = get_s3_client()
    if not client:
        return None
    try:
        resp = client.create_multipart_upload(
            Bucket=R2_BUCKET,
            Key=key,
            ContentType=content_type,
            CacheControl="public, max-age=31536000",
        )
        return resp.get("UploadId")
    except Exception as e:
        logger.error("Failed to create multipart upload for %s: %s", key, e)
        return None


def presign_upload_part(
    key: str,
    upload_id: str,
    part_number: int,
    expires_in: int = 900,
) -> Optional[str]:
    """Presigned URL for one multipart part (PUT)."""
    if not R2_ENABLED or part_number < 1:
        return None
    client = get_s3_client()
    if not client:
        return None
    try:
        return client.generate_presigned_url(
            "upload_part",
            Params={
                "Bucket": R2_BUCKET,
                "Key": key,
                "UploadId": upload_id,
                "PartNumber": int(part_number),
            },
            ExpiresIn=expires_in,
        )
    except Exception as e:
        logger.error("Failed to presign part %s for %s: %s", part_number, key, e)
        return None


def list_multipart_upload_parts(key: str, upload_id: str) -> List[Dict[str, Any]]:
    """List uploaded parts with ETags from R2 (authoritative; browser may not see ETag due to CORS)."""
    if not R2_ENABLED:
        return []
    client = get_s3_client()
    if not client:
        return []
    try:
        collected: List[Dict[str, Any]] = []
        marker: Optional[int] = None
        while True:
            kwargs: Dict[str, Any] = {
                "Bucket": R2_BUCKET,
                "Key": key,
                "UploadId": upload_id,
            }
            if marker is not None:
                kwargs["PartNumberMarker"] = marker
            resp = client.list_parts(**kwargs)
            for part in resp.get("Parts") or []:
                pn = part.get("PartNumber")
                etag = part.get("ETag")
                if pn and etag:
                    collected.append({"PartNumber": int(pn), "ETag": str(etag)})
            if not resp.get("IsTruncated"):
                break
            marker = resp.get("NextPartNumberMarker")
            if not marker:
                break
        return sorted(collected, key=lambda p: int(p["PartNumber"]))
    except Exception as e:
        logger.error("Failed to list multipart parts for %s: %s", key, e)
        return []


def complete_multipart_upload(
    key: str,
    upload_id: str,
    parts: List[Dict[str, Any]],
) -> bool:
    """Complete multipart upload. parts: [{PartNumber, ETag}, ...]."""
    if not R2_ENABLED or not parts:
        return False
    client = get_s3_client()
    if not client:
        return False
    try:
        sorted_parts = sorted(parts, key=lambda p: int(p["PartNumber"]))
        client.complete_multipart_upload(
            Bucket=R2_BUCKET,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={"Parts": sorted_parts},
        )
        logger.info("Completed multipart upload: %s", key)
        return True
    except Exception as e:
        logger.error("Failed to complete multipart upload %s: %s", key, e)
        return False


def abort_multipart_upload(key: str, upload_id: str) -> bool:
    """Abort an in-progress multipart upload."""
    if not R2_ENABLED:
        return False
    client = get_s3_client()
    if not client:
        return False
    try:
        client.abort_multipart_upload(Bucket=R2_BUCKET, Key=key, UploadId=upload_id)
        logger.info("Aborted multipart upload: %s", key)
        return True
    except Exception as e:
        logger.error("Failed to abort multipart upload %s: %s", key, e)
        return False
