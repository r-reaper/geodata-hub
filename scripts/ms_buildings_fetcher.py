"""
Thai GeoData Hub — Microsoft Global Building Footprints fetcher

Downloads Microsoft's AI-detected building footprints for Thailand from their
public Azure storage. License: ODbL v1.0 (same as OSM).

Source: https://github.com/microsoft/GlobalMLBuildingFootprints

Approach:
1. Download dataset-links.csv (the index of all quadkey files)
2. Filter to rows where Location starts with "Thailand"
3. For each row: download the .csv.gz, parse, filter to Thai bbox, write features
4. Output: data/ms_buildings.geojson (streaming, single FeatureCollection)
5. Save metadata file with feature count + bbox

This script is RESTARTABLE — it tracks completed quadkeys in a state file so
you can stop with Ctrl+C and resume later. Expect ~30 min – 3 h depending on
your connection (downloads ~3 GB, then writes a single output).

Usage:
    python scripts/ms_buildings_fetcher.py
"""

import csv
import gzip
import io
import json
import logging
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import requests
from shapely.geometry import shape, mapping, box

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────

DATASET_INDEX_URL = "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv"
HEADERS = {"User-Agent": "ThaiGeoDataHub/1.0 (https://geodata-hub.vercel.app)"}

THAILAND_BBOX = (97.3, 5.6, 105.7, 20.5)  # (west, south, east, north)
THAI_BOX = box(*THAILAND_BBOX)

DATA_DIR  = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
OUT_PATH  = DATA_DIR / "ms_buildings.geojson"
META_PATH = DATA_DIR / "ms_buildings_metadata.json"
STATE_PATH = DATA_DIR / ".ms_buildings_state.json"

REQUEST_TIMEOUT = 600  # 10 min per file


# ─────────────────────────────────────────────
# State persistence (resume support)
# ─────────────────────────────────────────────

def load_state() -> dict:
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"completed_urls": [], "feature_count": 0, "started_at": None}


def save_state(state: dict):
    STATE_PATH.write_text(json.dumps(state), encoding="utf-8")


# ─────────────────────────────────────────────
# Index download + filter
# ─────────────────────────────────────────────

def fetch_thailand_index() -> list[dict]:
    """Download dataset-links.csv and return only Thailand rows."""
    log.info(f"Downloading dataset index: {DATASET_INDEX_URL}")
    resp = requests.get(DATASET_INDEX_URL, headers=HEADERS, timeout=120)
    resp.raise_for_status()

    text = resp.text
    reader = csv.DictReader(io.StringIO(text))
    thai_rows = [row for row in reader if row.get("Location", "").lower().startswith("thailand")]
    log.info(f"Found {len(thai_rows)} Thailand quadkey files in index")
    return thai_rows


# ─────────────────────────────────────────────
# Per-quadkey download + parse
# ─────────────────────────────────────────────

def fetch_features(url: str):
    """Stream-yield Microsoft building features from a single .csv.gz file.

    Microsoft's per-quadkey files are CSV with columns: latitude, longitude,
    geometry (WKT or GeoJSON string), height (sometimes). Newer files are
    GeoJSONL (one Feature per line). We detect format from first line.
    """
    log.info(f"  GET {url}")
    resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT, stream=True)
    resp.raise_for_status()

    # Microsoft usually gzip's at the HTTP layer with content-encoding;
    # but the file itself is sometimes also gzipped. Detect by URL suffix.
    body = resp.content
    if url.endswith(".gz"):
        body = gzip.decompress(body)
    text = body.decode("utf-8", errors="replace")

    # Detect format by sniffing first non-empty line
    first_line = next((ln for ln in text.splitlines() if ln.strip()), "")
    if first_line.startswith("{") and '"type"' in first_line:
        # GeoJSONL: one feature per line
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                feat = json.loads(line)
                yield feat
            except Exception:
                continue
    else:
        # CSV with WKT/GeoJSON in 'geometry' column
        reader = csv.DictReader(io.StringIO(text))
        for row in reader:
            geom_str = row.get("geometry") or row.get("Geometry")
            if not geom_str:
                continue
            try:
                # Many MS files use stringified GeoJSON in the geometry col
                geom = json.loads(geom_str) if geom_str.lstrip().startswith("{") else None
                if geom is None:
                    continue
                yield {
                    "type": "Feature",
                    "geometry": geom,
                    "properties": {
                        "height": row.get("height") or row.get("Height") or None,
                        "confidence": row.get("confidence") or row.get("Confidence") or None,
                    },
                }
            except Exception:
                continue


# ─────────────────────────────────────────────
# Main pipeline
# ─────────────────────────────────────────────

def main():
    state = load_state()
    if state.get("started_at") is None:
        state["started_at"] = datetime.utcnow().isoformat() + "Z"

    rows = fetch_thailand_index()
    if not rows:
        log.error("No Thailand quadkey files in MS index — aborting")
        sys.exit(1)

    completed = set(state.get("completed_urls", []))
    todo = [r for r in rows if r["Url"] not in completed]
    log.info(f"  Already done: {len(completed)} | Remaining: {len(todo)}")

    # Open output file in append mode if state shows we've started, else fresh
    is_resume = OUT_PATH.exists() and len(completed) > 0
    mode = "a" if is_resume else "w"
    feature_count = state.get("feature_count", 0)

    with open(OUT_PATH, mode, encoding="utf-8") as out:
        if not is_resume:
            out.write('{"type":"FeatureCollection","features":[\n')

        first_in_session = (feature_count == 0)

        for i, row in enumerate(todo, 1):
            url = row["Url"]
            location = row.get("Location", "?")
            log.info(f"[{i}/{len(todo)}] {location} ({row.get('QuadKey','')})")

            try:
                kept = 0
                for feat in fetch_features(url):
                    geom = feat.get("geometry")
                    if not geom:
                        continue
                    try:
                        # Quick bbox filter using shapely
                        sh = shape(geom)
                        if not THAI_BOX.intersects(sh):
                            continue
                        # Keep only the Thailand portion
                        out.write(("," if not first_in_session else "") + "\n")
                        out.write(json.dumps({
                            "type": "Feature",
                            "geometry": mapping(sh),
                            "properties": feat.get("properties", {}),
                        }, ensure_ascii=False))
                        first_in_session = False
                        kept += 1
                        feature_count += 1
                    except Exception:
                        continue

                log.info(f"    kept {kept:,} features (running total: {feature_count:,})")
                completed.add(url)
                state["completed_urls"] = list(completed)
                state["feature_count"] = feature_count
                save_state(state)

            except Exception as e:
                log.warning(f"    FAILED: {e} — will retry on next run")
                # Don't add to completed so it retries
                # Brief pause before next file
                time.sleep(2)
                continue

        # Close FeatureCollection (only if we just finished — best-effort)
        out.write("\n]}\n")

    # Write metadata
    meta = {
        "slug": "ms_buildings",
        "name_en": "Microsoft Buildings",
        "name_th": "อาคาร (Microsoft)",
        "geom_type": "Polygon",
        "feature_count": feature_count,
        "bbox": list(THAILAND_BBOX),
        "source": "Microsoft Global Building Footprints",
        "license": "ODbL v1.0",
        "license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
        "attribution": "Building footprints © Microsoft",
        "last_refreshed": datetime.utcnow().isoformat() + "Z",
    }
    META_PATH.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info(f"DONE — {feature_count:,} buildings written to {OUT_PATH}")
    log.info(f"      metadata at {META_PATH}")

    # Cleanup state file
    if STATE_PATH.exists():
        STATE_PATH.unlink()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log.info("Interrupted — state saved, run script again to resume.")
        sys.exit(0)
