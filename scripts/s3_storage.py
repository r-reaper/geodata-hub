"""
Thai GeoData Hub — S3 Storage Service
Handles upload to S3-compatible storage (Cloudflare R2 / AWS S3)
and generates presigned download URLs.
"""

import boto3
import os
import logging
from botocore.config import Config
from botocore.exceptions import ClientError

log = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Configuration from environment
# ─────────────────────────────────────────────

S3_ENDPOINT_URL   = os.getenv("S3_ENDPOINT_URL",        "")       # e.g. https://xxx.r2.cloudflarestorage.com
S3_ACCESS_KEY     = os.getenv("S3_ACCESS_KEY",           "")
S3_SECRET_KEY     = os.getenv("S3_SECRET_KEY",           "")
S3_REGION         = os.getenv("S3_REGION",                "auto")
S3_BUCKET_NAME    = os.getenv("S3_BUCKET_NAME",          "geodata-downloads")
S3_PUBLIC_URL     = os.getenv("S3_PUBLIC_URL",            "")       # Optional public base URL

PRESIGN_EXPIRY_SECONDS = 15 * 60  # 15 minutes


def get_s3_client():
    """Create an S3-compatible boto3 client."""
    client_kwargs = {
        "aws_access_key_id":     S3_ACCESS_KEY,
        "aws_secret_access_key": S3_SECRET_KEY,
        "region_name":           S3_REGION,
        "config": Config(
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "standard"},
        ),
    }
    if S3_ENDPOINT_URL:
        client_kwargs["endpoint_url"] = S3_ENDPOINT_URL

    return boto3.client("s3", **client_kwargs)


def ensure_bucket_exists():
    """Create the bucket if it doesn't exist (idempotent)."""
    if not S3_ACCESS_KEY:
        log.warning("S3 not configured — storage will use local temp files only.")
        return False

    try:
        client = get_s3_client()
        client.head_bucket(Bucket=S3_BUCKET_NAME)
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        if error_code in ("404", "NoSuchBucket"):
            try:
                client.create_bucket(Bucket=S3_BUCKET_NAME)
                log.info(f"Created bucket: {S3_BUCKET_NAME}")
            except Exception as create_err:
                log.error(f"Failed to create bucket: {create_err}")
                return False
        else:
            log.warning(f"S3 bucket check failed: {e}")
            return False
    return True


def upload_file_to_s3(local_path: str, object_key: str) -> str | None:
    """
    Upload a local file to S3-compatible storage.
    Returns the presigned download URL or None on failure.
    """
    if not S3_ACCESS_KEY:
        return None

    try:
        client = get_s3_client()
        client.upload_file(
            Filename=str(local_path),
            Bucket=S3_BUCKET_NAME,
            Key=object_key,
            ExtraArgs={"ContentType": "application/zip"},
        )

        # Generate presigned URL
        presigned_url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": S3_BUCKET_NAME, "Key": object_key},
            ExpiresIn=PRESIGN_EXPIRY_SECONDS,
        )
        log.info(f"Uploaded to S3: {object_key}")
        return presigned_url

    except ClientError as e:
        log.error(f"S3 upload failed: {e}")
        return None
    except Exception as e:
        log.error(f"Unexpected S3 error: {e}")
        return None


def delete_s3_object(object_key: str) -> bool:
    """Delete an object from S3 (used for cleanup / expiry)."""
    if not S3_ACCESS_KEY:
        return False

    try:
        client = get_s3_client()
        client.delete_object(Bucket=S3_BUCKET_NAME, Key=object_key)
        log.info(f"Deleted S3 object: {object_key}")
        return True
    except Exception as e:
        log.error(f"S3 delete failed for {object_key}: {e}")
        return False