"""
Convert a large GeoJSON layer to FlatGeobuf (.fgb) — STREAMING version.

Uses fiona to read/write feature-by-feature. Memory usage stays low
(roughly the size of a single feature) regardless of total file size.

FlatGeobuf benefits:
  - 3-4x smaller binary file
  - Built-in spatial index (R-tree) for fast bbox queries
  - Native support in fiona/pyogrio (gpd.read_file works directly)

Usage:
    python scripts/convert_to_fgb.py ms_buildings
    python scripts/convert_to_fgb.py google_buildings
"""

import sys
import time
from pathlib import Path

import fiona

DATA_DIR = Path(__file__).parent.parent / "data"


def convert(slug: str):
    src = DATA_DIR / f"{slug}.geojson"
    dst = DATA_DIR / f"{slug}.fgb"
    if not src.exists():
        print(f"ERROR: {src} not found")
        sys.exit(1)

    src_mb = src.stat().st_size / (1024 * 1024)
    print(f"Streaming convert: {src.name} ({src_mb:.1f} MB) -> {dst.name}")
    print("This processes feature-by-feature — memory usage stays low.")

    t0 = time.time()
    written = 0
    progress_every = 50_000

    with fiona.open(src) as source:
        meta = source.meta.copy()
        meta["driver"] = "FlatGeobuf"
        # FlatGeobuf supports a built-in spatial index by default
        meta["SPATIAL_INDEX"] = "YES"

        with fiona.open(dst, "w", **meta) as sink:
            for feat in source:
                try:
                    sink.write(feat)
                    written += 1
                    if written % progress_every == 0:
                        rate = written / (time.time() - t0)
                        print(f"  wrote {written:,} features  ({rate:,.0f}/sec)", flush=True)
                except Exception as e:
                    # Skip individual bad features rather than aborting
                    if written < 5:
                        print(f"  skipped feature: {e}")
                    continue

    elapsed = time.time() - t0
    dst_mb = dst.stat().st_size / (1024 * 1024)
    print(f"\nDONE — wrote {written:,} features in {elapsed:.1f}s")
    print(f"  output: {dst_mb:.1f} MB ({src_mb / dst_mb:.1f}x smaller than GeoJSON)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/convert_to_fgb.py <slug>")
        sys.exit(1)
    convert(sys.argv[1])
