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


def upload_file_to_s3(
    local_path: str,
    object_key: str,
    download_filename: str | None = None,
) -> str | None:
    """
    Upload a local file to S3-compatible storage.
    Returns the presigned download URL or None on failure.

    Args:
        local_path: path to the file on disk.
        object_key: S3 key to upload to (e.g. "downloads/abc.zip").
        download_filename: user-friendly filename for browsers. Sets both
            the stored object's Content-Disposition AND the presigned URL's
            response-override params. Without this, Chrome flags the ZIP
            as "Blocked / unverified download" because the response has no
            attachment header. If None, we fall back to the bare object_key
            (still better than nothing).
    """
    if not S3_ACCESS_KEY:
        return None

    # Build the Content-Disposition value once and reuse for both the
    # at-rest object metadata and the presigned URL's response override.
    # Filename is double-quoted per RFC 6266; spaces / unicode in the
    # filename are safe inside the quotes for any modern browser.
    fname = download_filename or object_key.rsplit("/", 1)[-1]
    content_disposition = f'attachment; filename="{fname}"'

    try:
        client = get_s3_client()
        client.upload_file(
            Filename=str(local_path),
            Bucket=S3_BUCKET_NAME,
            Key=object_key,
            ExtraArgs={
                "ContentType": "application/zip",
                "ContentDisposition": content_disposition,
            },
        )

        # Generate presigned URL with response-override params so that even
        # if a different process generates a signed URL later without the
        # override, the headers baked into the object above still apply.
        # Belt-and-suspenders for Chrome's download-safety heuristic.
        presigned_url = client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": S3_BUCKET_NAME,
                "Key": object_key,
                "ResponseContentDisposition": content_disposition,
                "ResponseContentType": "application/zip",
            },
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


def download_file_from_s3(object_key: str, local_path: str, quiet_404: bool = False) -> bool:
    """Download a file from S3-compatible storage to a local path.

    Args:
        quiet_404: when True, log 404 (missing key) as INFO instead of ERROR.
                   Used by the metadata-refresh path: some metadata JSONs
                   aren't in R2 yet but local copies ship with the Docker
                   image, so a 404 isn't a real failure.
    """
    if not S3_ACCESS_KEY:
        return False
    try:
        client = get_s3_client()
        client.download_file(S3_BUCKET_NAME, object_key, local_path)
        log.info(f"Downloaded from S3: {object_key} → {local_path}")
        return True
    except ClientError as e:
        # Detect 404 from the error code so we can downgrade the log level.
        is_404 = False
        try:
            code = e.response.get("Error", {}).get("Code", "")
            is_404 = code in ("404", "NoSuchKey")
        except Exception:
            pass
        if is_404 and quiet_404:
            log.info(f"S3 key missing (using local copy if any): {object_key}")
        else:
            log.error(f"S3 download failed for {object_key}: {e}")
        return False
    except Exception as e:
        log.error(f"Unexpected S3 download error for {object_key}: {e}")
        return False


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