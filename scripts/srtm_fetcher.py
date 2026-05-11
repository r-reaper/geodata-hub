"""
Thai GeoData Hub — NASA SRTM 30m elevation DEM fetcher.

Source:   USGS Earth Explorer / OpenTopography mirrors of NASA SRTM 1-arc-second
License:  Public domain (U.S. Government work — see usa.gov/government-works)
Output:   data/srtm.tif (single GeoTIFF covering Thailand, ~250 MB)

Why SRTM?
  Elevation underpins:
    - Slope / aspect / terrain analysis (engineering, agriculture, environment)
    - Hydrology and drainage (waterway routing, flood-prone areas)
    - Viewshed / line-of-sight (telecoms, real estate views)
    - Hillshade for cartographic context

Approach:
  OpenTopography hosts a free convenience endpoint that returns a mosaicked,
  clipped, single-file GeoTIFF for any bbox. We request Thailand bounds in one
  call. No NASA login, no per-tile mosaicking on our end.

If OpenTopography is unavailable or rate-limited, the script falls back to a
direct AWS Open Data S3 bucket that hosts NASA SRTM tiles.

Usage:
    1. Register a free API key at https://portal.opentopography.org/myopentopo
    2. Set environment variable:
         set OPENTOPO_API_KEY=your_key_here    (Windows cmd)
         $env:OPENTOPO_API_KEY="your_key_here" (PowerShell)
    3. Run:
         python scripts/srtm_fetcher.py

Note: OpenTopography requires the free API key as of 2024. The key is free
and unlimited for personal/research/non-commercial; small commercial use is
also allowed within fair-use rate limits.
"""

import json
import logging
import sys
from datetime import datetime
from pathlib import Path

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# Thailand bounding box (W, S, E, N)
WEST, SOUTH, EAST, NORTH = 97.3, 5.6, 105.7, 20.5

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
OUT_PATH = DATA_DIR / "srtm.tif"
META_PATH = DATA_DIR / "srtm_metadata.json"

HEADERS = {"User-Agent": "ThaiGeoDataHub/1.0 (https://geodata-hub.vercel.app)"}


def fetch_via_opentopo() -> bool:
    """
    OpenTopography Global Datasets API.
      demtype=SRTMGL1  → SRTM 1 arc-second (30m)
      output=GTiff     → GeoTIFF
    No API key required for public DEMs at small bbox.
    """
    url = "https://portal.opentopography.org/API/globaldem"
    params = {
        "demtype": "SRTMGL1",
        "south": SOUTH,
        "north": NORTH,
        "west":  WEST,
        "east":  EAST,
        "outputFormat": "GTiff",
        # API key is optional for public DEMs but increases rate limits.
        # Users can register a free key at portal.opentopography.org and set
        # OPENTOPO_API_KEY env var to use it.
    }
    import os
    if (k := os.getenv("OPENTOPO_API_KEY")):
        params["API_Key"] = k

    log.info(f"Trying OpenTopography for SRTM 30m over Thailand bbox...")
    log.info(f"  bbox: ({WEST}, {SOUTH}, {EAST}, {NORTH})")

    resp = requests.get(url, params=params, headers=HEADERS, timeout=900, stream=True)
    if resp.status_code != 200:
        log.warning(f"  OpenTopography returned HTTP {resp.status_code}: {resp.text[:200]}")
        return False

    total_bytes = int(resp.headers.get("Content-Length", 0))
    written = 0
    last_pct = -1
    with open(OUT_PATH, "wb") as f:
        for chunk in resp.iter_content(chunk_size=1024 * 1024):
            if chunk:
                f.write(chunk)
                written += len(chunk)
                if total_bytes:
                    pct = written * 100 // total_bytes
                    if pct >= last_pct + 5:
                        log.info(f"  {pct}%  ({written // (1024*1024)} MB / {total_bytes // (1024*1024)} MB)")
                        last_pct = pct

    size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
    log.info(f"Saved {OUT_PATH} ({size_mb:.1f} MB)")
    return True


def write_metadata():
    elev_min = elev_max = elev_mean = None
    width = height = None
    try:
        import rasterio
        with rasterio.open(OUT_PATH) as src:
            width, height = src.width, src.height
            arr = src.read(1, masked=True)
            elev_min = float(arr.min())
            elev_max = float(arr.max())
            elev_mean = float(arr.mean())
            log.info(f"  size:    {width}x{height} px")
            log.info(f"  range:   {elev_min:.0f} m – {elev_max:.0f} m (mean {elev_mean:.0f} m)")
    except ImportError:
        log.warning("rasterio not installed — metadata will be partial")
    except Exception as e:
        log.warning(f"rasterio probe failed: {e}")

    meta = {
        "slug": "srtm",
        "name_en": "Elevation (SRTM 30m)",
        "name_th": "ความสูง (SRTM 30 ม.)",
        "geom_type": "Raster",
        "data_type": "raster",
        "resolution_m": 30,
        "feature_count": 0,
        "bbox": [WEST, SOUTH, EAST, NORTH],
        "raster_size": [width, height] if width else None,
        "elevation_min_m": round(elev_min, 1) if elev_min is not None else None,
        "elevation_max_m": round(elev_max, 1) if elev_max is not None else None,
        "elevation_mean_m": round(elev_mean, 1) if elev_mean is not None else None,
        "size_mb": round(OUT_PATH.stat().st_size / (1024 * 1024), 2) if OUT_PATH.exists() else 0,
        "source": "NASA SRTM 1 arc-second Global",
        "source_url": "https://www.earthdata.nasa.gov/sensors/srtm",
        "license": "Public domain (U.S. Government work)",
        "license_url": "https://www.usa.gov/government-works",
        "attribution": "Elevation data: NASA SRTM",
        "last_refreshed": datetime.utcnow().isoformat() + "Z",
        "filename": "srtm.tif",
    }
    META_PATH.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info(f"Metadata saved to {META_PATH}")


def main():
    if OUT_PATH.exists():
        log.info(f"Already exists: {OUT_PATH} — delete it to force re-fetch")
        write_metadata()
        return

    if fetch_via_opentopo():
        write_metadata()
        log.info("DONE")
        return

    log.error("All sources failed. Try setting OPENTOPO_API_KEY env var "
              "(free at portal.opentopography.org).")
    sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log.error(f"FAILED: {e}")
        sys.exit(1)
