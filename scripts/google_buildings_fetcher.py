"""
Thai GeoData Hub — Google Open Buildings v3 fetcher

Downloads Google Research's AI-detected building footprints for Thailand from
their public Google Cloud Storage bucket. License: CC BY 4.0 + ODbL.

Source: https://sites.research.google/open-buildings/

Approach:
1. Google publishes per-S2-cell CSV files at:
   https://storage.googleapis.com/open-buildings-data/v3/polygons_s2_level_4_gzip/<S2>_buildings.csv.gz
   The S2 level-4 cells covering Thailand are pre-listed below.
2. For each cell: download, decompress, parse, filter to Thai bbox, keep features.
3. Output: data/google_buildings.geojson (streaming FeatureCollection).

Restartable — tracks completed cells in state file.

Usage:
    python scripts/google_buildings_fetcher.py
"""

import csv
import gzip
import io
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path

import requests
from shapely import wkt
from shapely.geometry import shape, mapping, box

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────

# S2 level-4 cell tokens covering Thailand bbox, computed via s2sphere:
#   coverer = s2.RegionCoverer(); min/max_level=4; covering(LatLngRect(...))
# Updated 2026-05-11: previous list (31b, 319, 31d, 317, 315, 313) was mostly
# wrong — only 31b and 313 actually exist on Google's data tree.
THAILAND_S2_LEVEL4_CELLS = [
    "305",   # West / Andaman side
    "30d",   # Northern Thailand (with 31b)
    "30f",   # NE Isaan / Mekong border
    "311",   # Central + East Thailand (Bangkok!)
    "313",   # Southern peninsula
    "31b",   # NW corner (Chiang Mai)
]

BASE_URL = "https://storage.googleapis.com/open-buildings-data/v3/polygons_s2_level_4_gzip"
HEADERS = {"User-Agent": "ThaiGeoDataHub/1.0 (https://geodata-hub.vercel.app)"}

THAILAND_BBOX = (97.3, 5.6, 105.7, 20.5)
THAI_BOX = box(*THAILAND_BBOX)

DATA_DIR  = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
OUT_PATH  = DATA_DIR / "google_buildings.geojson"
META_PATH = DATA_DIR / "google_buildings_metadata.json"
STATE_PATH = DATA_DIR / ".google_buildings_state.json"

REQUEST_TIMEOUT = 600


# ─────────────────────────────────────────────
# State
# ─────────────────────────────────────────────

def load_state() -> dict:
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"completed_cells": [], "feature_count": 0, "started_at": None}


def save_state(state: dict):
    STATE_PATH.write_text(json.dumps(state), encoding="utf-8")


# ─────────────────────────────────────────────
# Per-cell download + parse
# ─────────────────────────────────────────────

def fetch_cell_features(s2_token: str):
    """Stream-yield Google Open Buildings features from one S2 cell.

    Format (per row): latitude, longitude, area_in_meters, confidence,
                      geometry (WKT POLYGON), full_plus_code
    """
    url = f"{BASE_URL}/{s2_token}_buildings.csv.gz"
    log.info(f"  GET {url}")

    resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    if resp.status_code == 404:
        log.warning(f"  cell {s2_token}: 404 — no data for this cell")
        return
    resp.raise_for_status()

    body = gzip.decompress(resp.content)
    text = body.decode("utf-8", errors="replace")

    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        try:
            geom_wkt = row.get("geometry")
            if not geom_wkt:
                continue
            geom = wkt.loads(geom_wkt)
            yield {
                "type": "Feature",
                "geometry": mapping(geom),
                "properties": {
                    "confidence": float(row.get("confidence") or 0),
                    "area_m2": float(row.get("area_in_meters") or 0),
                    "plus_code": row.get("full_plus_code") or "",
                },
            }
        except Exception:
            continue


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

def main():
    state = load_state()
    if state.get("started_at") is None:
        state["started_at"] = datetime.utcnow().isoformat() + "Z"

    completed = set(state.get("completed_cells", []))
    todo = [c for c in THAILAND_S2_LEVEL4_CELLS if c not in completed]
    log.info(f"S2 cells: {len(THAILAND_S2_LEVEL4_CELLS)} total | done: {len(completed)} | remaining: {len(todo)}")

    is_resume = OUT_PATH.exists() and len(completed) > 0
    mode = "a" if is_resume else "w"
    feature_count = state.get("feature_count", 0)

    with open(OUT_PATH, mode, encoding="utf-8") as out:
        if not is_resume:
            out.write('{"type":"FeatureCollection","features":[\n')

        first_in_session = (feature_count == 0)

        for i, cell in enumerate(todo, 1):
            log.info(f"[{i}/{len(todo)}] cell {cell}")
            try:
                kept = 0
                for feat in fetch_cell_features(cell):
                    try:
                        sh = shape(feat["geometry"])
                        if not THAI_BOX.intersects(sh):
                            continue
                        out.write(("," if not first_in_session else "") + "\n")
                        out.write(json.dumps(feat, ensure_ascii=False))
                        first_in_session = False
                        kept += 1
                        feature_count += 1
                    except Exception:
                        continue
                log.info(f"    kept {kept:,} (running: {feature_count:,})")
                completed.add(cell)
                state["completed_cells"] = list(completed)
                state["feature_count"] = feature_count
                save_state(state)
            except Exception as e:
                log.warning(f"    FAILED on {cell}: {e} — will retry on next run")
                time.sleep(3)
                continue

        out.write("\n]}\n")

    meta = {
        "slug": "google_buildings",
        "name_en": "Google Buildings",
        "name_th": "อาคาร (Google)",
        "geom_type": "Polygon",
        "feature_count": feature_count,
        "bbox": list(THAILAND_BBOX),
        "source": "Google Open Buildings v3",
        "license": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "attribution": "Building footprints © Google",
        "last_refreshed": datetime.utcnow().isoformat() + "Z",
    }
    META_PATH.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info(f"DONE — {feature_count:,} buildings written to {OUT_PATH}")

    if STATE_PATH.exists():
        STATE_PATH.unlink()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log.info("Interrupted — state saved, run again to resume.")
        sys.exit(0)
