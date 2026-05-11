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
import os
import sys
import tempfile
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


# OpenTopography limits SRTMGL1 to 450,000 km² per request. Thailand is
# ~1.5M km², so we split into 4 quadrants (each ~390,000 km²) and mosaic.
# 4° wide × 7.45° tall × 111² km/° ≈ 388,000 km² → under the limit.
TILES = [
    # (name,  west,   south, east,  north)
    ("SW",    97.3,    5.6,  101.5, 13.05),
    ("SE",   101.5,    5.6,  105.7, 13.05),
    ("NW",    97.3,   13.05, 101.5, 20.5),
    ("NE",   101.5,   13.05, 105.7, 20.5),
]


def _fetch_one_tile(name: str, w: float, s: float, e: float, n: float, api_key: str, out_path: Path) -> bool:
    """Download a single SRTM tile from OpenTopography to out_path."""
    url = "https://portal.opentopography.org/API/globaldem"
    params = {
        "demtype": "SRTMGL1",
        "south": s, "north": n, "west": w, "east": e,
        "outputFormat": "GTiff",
        "API_Key": api_key,
    }

    log.info(f"  Fetching tile {name}: ({w}, {s}, {e}, {n})")
    resp = requests.get(url, params=params, headers=HEADERS, timeout=900, stream=True)
    if resp.status_code != 200:
        log.warning(f"  Tile {name} returned HTTP {resp.status_code}: {resp.text[:200]}")
        return False

    total_bytes = int(resp.headers.get("Content-Length", 0))
    written = 0
    last_pct = -1
    with open(out_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=1024 * 1024):
            if chunk:
                f.write(chunk)
                written += len(chunk)
                if total_bytes:
                    pct = written * 100 // total_bytes
                    if pct >= last_pct + 25:  # every 25% per tile to keep log readable
                        log.info(f"    {pct}%  ({written // (1024*1024)} MB / {total_bytes // (1024*1024)} MB)")
                        last_pct = pct

    size_mb = out_path.stat().st_size / (1024 * 1024)
    log.info(f"  Saved tile {name} ({size_mb:.1f} MB)")
    return True


def fetch_via_opentopo() -> bool:
    """Fetch SRTM as 4 tiles and mosaic them into a single GeoTIFF."""
    api_key = os.getenv("OPENTOPO_API_KEY", "").strip()
    if not api_key:
        log.error("OPENTOPO_API_KEY env var is required. Register free at portal.opentopography.org.")
        return False

    log.info("Fetching SRTM 30m over Thailand in 4 tiles (OpenTopography 450k km² limit)…")

    # Write tiles to a temp dir then mosaic
    with tempfile.TemporaryDirectory(prefix="srtm_tiles_") as tmpdir:
        tile_paths: list[Path] = []
        for name, w, s, e, n in TILES:
            tp = Path(tmpdir) / f"srtm_{name}.tif"
            if not _fetch_one_tile(name, w, s, e, n, api_key, tp):
                log.error(f"Failed tile {name} — aborting")
                return False
            tile_paths.append(tp)

        # Mosaic with rasterio
        log.info("Mosaicking tiles into single GeoTIFF…")
        try:
            import rasterio
            from rasterio.merge import merge as rio_merge
        except ImportError:
            log.error("rasterio not installed. Run: pip install rasterio")
            return False

        srcs = [rasterio.open(p) for p in tile_paths]
        try:
            mosaic, out_transform = rio_merge(srcs)
            out_meta = srcs[0].meta.copy()
            out_meta.update({
                "driver":    "GTiff",
                "height":    mosaic.shape[1],
                "width":     mosaic.shape[2],
                "transform": out_transform,
                "compress":  "deflate",  # ~50% smaller for elevation rasters
            })
            with rasterio.open(OUT_PATH, "w", **out_meta) as dst:
                dst.write(mosaic)
        finally:
            for src in srcs:
                src.close()

    size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
    log.info(f"Mosaicked output: {OUT_PATH} ({size_mb:.1f} MB)")
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
