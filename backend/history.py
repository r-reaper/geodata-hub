"""
Thai GeoData Hub — Download History Store
File-based, thread-safe. Each user keeps up to 50 records.
"""

import os
import json
import threading
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

_HISTORY_FILE = Path(__file__).parent / "history.json"
_history_lock = threading.Lock()


# ─────────────────────────────────────────────
# I/O helpers
# ─────────────────────────────────────────────

def _read() -> dict:
    if not _HISTORY_FILE.exists():
        return {}
    try:
        return json.loads(_HISTORY_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write(data: dict):
    """Atomic write — avoids corruption on crash."""
    tmp = _HISTORY_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, _HISTORY_FILE)


# ─────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────

def save_download(
    user_id: str,
    download_id: str,
    filename: str,
    layers: list,
    formats: list,
    size_mb: float,
    total_features: int,
    s3_key: Optional[str],
    credits_used: int,
) -> None:
    """Prepend a download record for the user. Keeps last 50."""
    record = {
        "download_id": download_id,
        "filename": filename,
        "layers": layers,
        "formats": formats,
        "size_mb": size_mb,
        "total_features": total_features,
        "s3_key": s3_key,
        "credits_used": credits_used,
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
    with _history_lock:
        data = _read()
        records = data.get(user_id, [])
        records.insert(0, record)
        data[user_id] = records[:50]
        _write(data)


def get_user_history(user_id: str) -> list:
    """Return list of download records (newest first)."""
    with _history_lock:
        return _read().get(user_id, [])


def get_download_record(user_id: str, download_id: str) -> Optional[dict]:
    """Find a specific record. Returns None if not found."""
    for rec in get_user_history(user_id):
        if rec["download_id"] == download_id:
            return rec
    return None
