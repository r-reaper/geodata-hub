"""
Thai GeoData Hub — Microsoft Buildings urban-area crop.

Source data: data/ms_buildings.fgb (4.7 GB, 24.6M buildings, all of Thailand)
Output:      data/ms_buildings_urban.fgb (~1-2 GB, buildings in major cities only)

Why crop?
  - Free Railway tier and Hobby plan together can't host the full 4.7 GB
  - Most users only care about buildings in cities they're analyzing
  - Cropping to 8 metropolitan bboxes keeps the most-valuable data while
    fitting comfortably under the 5 GB Railway Hobby volume

Cities included (covers ~80% of Thailand's urban population):
  - Bangkok metro (BKK, Samut Prakan, Nonthaburi, Pathum Thani)
  - Chiang Mai
  - Chiang Rai
  - Phuket
  - Pattaya (Chonburi)
  - Hat Yai
  - Khon Kaen
  - Nakhon Ratchasima (Korat)

Usage:
    python scripts/ms_buildings_urban_crop.py
"""

import logging
import sys
import time
from datetime import datetime
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

DATA_DIR  = Path(__file__).parent.parent / "data"
SRC_PATH  = DATA_DIR / "ms_buildings.fgb"
OUT_PATH  = DATA_DIR / "ms_buildings_urban.fgb"
META_PATH = DATA_DIR / "ms_buildings_urban_metadata.json"

# (name_en, name_th, west, south, east, north)
URBAN_BBOXES = [
    ("Bangkok metro",  "กรุงเทพมหานครและปริมณฑล", 100.30, 13.50, 100.95, 14.05),
    ("Chiang Mai",     "เชียงใหม่",              98.85,  18.60,  99.15, 18.95),
    ("Chiang Rai",     "เชียงราย",               99.75,  19.85, 100.00, 20.05),
    ("Phuket",         "ภูเก็ต",                 98.25,   7.70,  98.50,  8.20),
    ("Pattaya",        "พัทยา (ชลบุรี)",        100.85,  12.85, 101.05, 13.05),
    ("Hat Yai",        "หาดใหญ่",               100.40,   6.80, 100.55,  7.05),
    ("Khon Kaen",      "ขอนแก่น",               102.70,  16.35, 102.95, 16.55),
    ("Korat",          "นครราชสีมา",           101.95,  14.85, 102.20, 15.10),
]


def main():
    if not SRC_PATH.exists():
        log.error(f"Source not found: {SRC_PATH}")
        log.error("Run scripts/ms_buildings_fetcher.py first, or download ms_buildings.fgb from R2.")
        sys.exit(1)

    log.info(f"Source: {SRC_PATH} ({SRC_PATH.stat().st_size / (1024**3):.2f} GB)")
    log.info(f"Cropping to {len(URBAN_BBOXES)} urban bboxes...")

    try:
        import fiona
        from shapely.geometry import box, shape, mapping
    except ImportError as e:
        log.error(f"Need fiona + shapely: {e}")
        sys.exit(1)

    # Open source, copy schema, write to FGB output
    t0 = time.time()
    kept = 0
    with fiona.open(SRC_PATH) as src:
        meta = src.meta.copy()
        meta["driver"] = "FlatGeobuf"
        meta["SPATIAL_INDEX"] = "YES"
        log.info(f"Source schema: {list(meta['schema']['properties'].keys())[:5]}...")
        log.info(f"Source CRS:    {meta['crs']}")
        log.info(f"Total source features (estimate): {len(src):,}")

        # Build shapely boxes for fast intersection check
        boxes = [(name, box(w, s, e, n)) for name, _, w, s, e, n in URBAN_BBOXES]

        with fiona.open(OUT_PATH, "w", **meta) as sink:
            for i, name_box in enumerate(boxes):
                bname, bbox = name_box
                w, s, e, n = bbox.bounds
                log.info(f"  [{i+1}/{len(boxes)}] {bname} ({w:.2f}, {s:.2f}, {e:.2f}, {n:.2f}) …")
                tile_kept = 0
                # fiona supports bbox push-down for FGB → uses spatial index
                for feat in src.filter(bbox=bbox.bounds):
                    try:
                        sink.write(feat)
                        tile_kept += 1
                        kept += 1
                        if kept % 50_000 == 0:
                            rate = kept / max(1, time.time() - t0)
                            log.info(f"    running total: {kept:,} ({rate:,.0f}/s)")
                    except Exception:
                        continue
                log.info(f"  → {bname}: {tile_kept:,} buildings")

    elapsed = time.time() - t0
    size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
    log.info(f"\nDONE — {kept:,} buildings in {elapsed:.1f}s")
    log.info(f"  output: {OUT_PATH} ({size_mb:.1f} MB)")

    # Metadata
    import json
    meta_json = {
        "slug": "ms_buildings_urban",
        "name_en": "Buildings (Microsoft, urban)",
        "name_th": "อาคาร (Microsoft, เมืองหลัก)",
        "geom_type": "Polygon",
        "feature_count": kept,
        "source": "Microsoft Global Building Footprints (urban subset)",
        "license": "ODbL v1.0",
        "license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
        "attribution": "Building footprints © Microsoft",
        "coverage_bboxes": [
            {"name_en": ne, "name_th": nt, "bbox": [w, s, e, n]}
            for ne, nt, w, s, e, n in URBAN_BBOXES
        ],
        "last_refreshed": datetime.utcnow().isoformat() + "Z",
        "size_mb": round(size_mb, 2),
    }
    META_PATH.write_text(json.dumps(meta_json, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info(f"  metadata: {META_PATH}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log.info("Interrupted.")
        sys.exit(0)
