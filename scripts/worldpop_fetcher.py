"""
Thai GeoData Hub — WorldPop population grid fetcher

Downloads WorldPop's 100m gridded population estimate for Thailand.
License: CC BY 4.0 — University of Southampton.

Source: https://www.worldpop.org/

We use the unconstrained "ppp" (population per pixel) UN-adjusted product:
  https://data.worldpop.org/GIS/Population/Global_2000_2020/2020/THA/tha_ppp_2020_UNadj.tif

Output: a GeoTIFF saved to data/worldpop.tif (raster).
This is then clipped on demand by clipper_service for downloads.

Usage:
    python scripts/worldpop_fetcher.py
"""

import json
import logging
import sys
from datetime import datetime
from pathlib import Path

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# Year 2020 is the most recent UN-adjusted product available for free.
# 100m unconstrained = "ppp", projected EPSG:4326.
WORLDPOP_URL = "https://data.worldpop.org/GIS/Population/Global_2000_2020/2020/THA/tha_ppp_2020_UNadj.tif"

DATA_DIR  = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
OUT_PATH  = DATA_DIR / "worldpop.tif"
META_PATH = DATA_DIR / "worldpop_metadata.json"

HEADERS = {"User-Agent": "ThaiGeoDataHub/1.0 (https://geodata-hub.vercel.app)"}


def main():
    log.info(f"Downloading {WORLDPOP_URL}")
    log.info("This is ~50 MB — should complete in 1–3 minutes.")

    resp = requests.get(WORLDPOP_URL, headers=HEADERS, timeout=600, stream=True)
    resp.raise_for_status()

    total_bytes = int(resp.headers.get("Content-Length", 0))
    written = 0
    with open(OUT_PATH, "wb") as f:
        for chunk in resp.iter_content(chunk_size=1024 * 1024):
            if chunk:
                f.write(chunk)
                written += len(chunk)
                if total_bytes:
                    pct = written * 100 // total_bytes
                    if written % (5 * 1024 * 1024) < 1024 * 1024:
                        log.info(f"  {pct}%  ({written // (1024*1024)} MB / {total_bytes // (1024*1024)} MB)")

    size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
    log.info(f"Saved {OUT_PATH} ({size_mb:.1f} MB)")

    # Try to read raster metadata using rasterio if available
    pop_total = None
    bbox = None
    width = height = None
    try:
        import rasterio
        with rasterio.open(OUT_PATH) as src:
            bbox = list(src.bounds)
            width, height = src.width, src.height
            # Sum population (ignore nodata)
            arr = src.read(1, masked=True)
            pop_total = float(arr.sum())
            log.info(f"  bounds: {bbox}")
            log.info(f"  size:   {width}×{height} px")
            log.info(f"  total population (≈): {pop_total:,.0f}")
    except ImportError:
        log.warning("rasterio not installed — metadata will be partial")

    meta = {
        "slug": "worldpop",
        "name_en": "Population (WorldPop 2020)",
        "name_th": "ประชากร (WorldPop 2020)",
        "geom_type": "Raster",
        "data_type": "raster",
        "resolution_m": 100,
        "year": 2020,
        "feature_count": int(pop_total) if pop_total else 0,  # repurposed for "people"
        "bbox": bbox,
        "raster_size": [width, height] if width else None,
        "size_mb": round(size_mb, 2),
        "source": "WorldPop (University of Southampton)",
        "source_url": "https://www.worldpop.org/",
        "license": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "attribution": "Population data © WorldPop, University of Southampton",
        "last_refreshed": datetime.utcnow().isoformat() + "Z",
        "filename": "worldpop.tif",
    }
    META_PATH.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info(f"Metadata saved to {META_PATH}")
    log.info("DONE")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log.error(f"FAILED: {e}")
        sys.exit(1)
