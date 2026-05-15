"""
Thai GeoData Hub — FastAPI Backend (v2 with S3 + Stripe)
"""

import os
import sys
import json
import gc
import ctypes
import asyncio
import tempfile
import logging
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Download history
from history import save_download, get_user_history, get_download_record

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
from clipper_service import ClipService, LAYER_METADATA

# S3 storage
try:
    from s3_storage import upload_file_to_s3, delete_s3_object
    S3_AVAILABLE = bool(os.getenv("S3_ACCESS_KEY", ""))
except ImportError:
    S3_AVAILABLE = False

# Database
DATABASE_URL = os.getenv("DATABASE_URL", "")

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy import create_engine, text

def get_db_engine():
    if not DATABASE_URL:
        return None
    return create_engine(DATABASE_URL)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("geodata_api")

# ─────────────────────────────────────────────
# FastAPI app setup
# ─────────────────────────────────────────────

app = FastAPI(
    title="Thai GeoData Hub API",
    version="2.0.0",
    description="Browse, preview, and clip-download Thai spatial data with S3 + Stripe",
)

# NOTE: allow_credentials=True is incompatible with allow_origins=["*"] in Starlette 0.27+
# Our API uses no cookies / HTTP-auth, so credentials are not needed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Import and mount payments router
from payments import router as payments_router, get_user_credits_db, deduct_credits_db
app.include_router(payments_router)

clip_service = ClipService()


# ─────────────────────────────────────────────
# Memory management helpers (Phase 1 OOM fix)
# ─────────────────────────────────────────────
# Why this exists:
#   Python on Linux glibc holds freed heap memory in its own pool and rarely
#   returns it to the OS. After a few /clip-data requests that each load
#   100-500 MB of geo data, RSS climbs and never comes back down until OOM.
#   gc.collect() releases Python objects; malloc_trim(0) tells glibc to give
#   the OS back the now-unused arenas.
#
#   This brings memory back to baseline after each heavy request instead of
#   accumulating until Railway kills us at 8 GB.

try:
    _LIBC = ctypes.CDLL("libc.so.6")
except OSError:
    _LIBC = None  # not on Linux (e.g. local dev on Windows/macOS) — no-op


def _free_memory() -> None:
    """Release Python and glibc heap memory back to the OS. Cheap (~5 ms)."""
    gc.collect()
    if _LIBC is not None:
        try:
            _LIBC.malloc_trim(0)
        except Exception:
            pass


# Only allow ONE heavy clip-data request at a time per container. Other
# requests wait their turn instead of all eating memory simultaneously.
# Bump to 2 once we've migrated to pyogrio (Phase 2). uvicorn's own worker
# pool is single-process, so this is sufficient on Railway Hobby.
_CLIP_SEMAPHORE = asyncio.Semaphore(1)


# ─────────────────────────────────────────────
# Request models
# ─────────────────────────────────────────────

class AOIRequest(BaseModel):
    type: str = "Feature"
    geometry: dict


class ClipDataRequest(BaseModel):
    aoi: AOIRequest
    layers: list[str]
    formats: list[str] = ["shp", "geojson", "kml"]
    user_id: Optional[str] = None
    # Target output CRS for the downloaded data. Default = WGS 84 (lon/lat).
    # Allowed values:
    #   EPSG:4326  → WGS 84 (lon/lat, decimal degrees)
    #   EPSG:3857  → Web Mercator (meters, for web maps)
    #   EPSG:32647 → UTM Zone 47N (meters, western Thailand: Phuket / Krabi)
    #   EPSG:32648 → UTM Zone 48N (meters, central/eastern Thailand: Bangkok / Isaan)
    target_crs: Optional[str] = "EPSG:4326"


# ─────────────────────────────────────────────
# Credit calculation helpers
# ─────────────────────────────────────────────

def calculate_credits_needed(total_features: int, total_mb: float) -> int:
    """
    Calculate credits needed based on data size and complexity.
    Business logic:
    - First 50 features: free (preview)
    - 1 credit per 100 features above 50
    - 1 credit per 10 MB above 5 MB
    - Minimum charge: 5 credits
    """
    if total_features <= 50:
        return 0

    feature_credits = (total_features - 50) // 100
    size_credits = max(0, int((total_mb - 5) / 10))
    total = max(5, feature_credits + size_credits)
    return total


# ─────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────

@app.get("/")
def root():
    return {
        "message": "Thai GeoData Hub API",
        "version": "2.0.0",
        "features": ["S3 storage", "Stripe payments", "credit system"],
        "docs": "/docs",
    }


@app.get("/health")
def health():
    data_dir = Path(__file__).parent.parent / "data"
    layers_available = list(data_dir.glob("*.geojson"))
    return {
        "status": "healthy",
        "storage": "s3" if S3_AVAILABLE else "file-based",
        "payments": "stripe" if os.getenv("STRIPE_SECRET_KEY") else "demo",
        "layers_with_data": len(layers_available),
        "layers": [p.stem for p in layers_available],
    }


@app.get("/layers", response_model=list[dict])
def get_layers():
    try:
        return clip_service.get_available_layers()
    except Exception as e:
        log.error(f"get_layers failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/layers/{slug}")
def get_layer_detail(slug: str):
    """Quick layer info (used by frontend layer list)."""
    if slug not in LAYER_METADATA:
        raise HTTPException(status_code=404, detail=f"Layer '{slug}' not found")
    try:
        meta = clip_service.get_available_layers()
        layer = next((l for l in meta if l["slug"] == slug), None)
        if not layer:
            raise HTTPException(status_code=404, detail=f"Layer '{slug}' not found")
        return layer
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/layers/{slug}/details")
def get_layer_details_full(slug: str):
    """
    Comprehensive layer metadata for the "info" modal in the UI:
      - source + license + attribution + refresh date
      - geometry type, feature count, bbox, native CRS
      - attribute schema (column names + types)
      - sample feature properties (one example row)
    """
    if slug not in LAYER_METADATA:
        raise HTTPException(status_code=404, detail=f"Layer '{slug}' not found")

    base = LAYER_METADATA[slug]
    meta_file = Path(__file__).parent.parent / "data" / f"{slug}_metadata.json"
    extra = {}
    if meta_file.exists():
        try:
            extra = json.loads(meta_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    # Build attribute schema + sample by sniffing the actual data file
    schema: list = []
    sample: dict = {}
    geom_type_actual = base.get("geom_type", "Unknown")
    crs = "EPSG:4326"

    is_raster = base.get("data_type") == "raster" or base.get("geom_type") == "Raster"
    data_dir = Path(__file__).parent.parent / "data"

    if not is_raster:
        # Vector: open with geopandas and peek at first row
        path = data_dir / f"{slug}.fgb"
        if not path.exists():
            path = data_dir / f"{slug}.geojson"
        if path.exists():
            try:
                import geopandas as gpd
                gdf = gpd.read_file(path, rows=1)
                geom_col = gdf.geometry.name
                geom_type_actual = str(gdf.geometry.geom_type.iloc[0]) if len(gdf) else geom_type_actual
                if gdf.crs:
                    crs = str(gdf.crs)
                for col in gdf.columns:
                    if col == geom_col:
                        continue
                    dtype = str(gdf[col].dtype)
                    schema.append({"name": col, "type": _friendly_type(dtype)})
                if len(gdf):
                    row = gdf.iloc[0].drop(geom_col).to_dict()
                    # convert numpy types to JSON-safe
                    sample = {k: _to_json_safe(v) for k, v in row.items()}
            except Exception as e:
                log.warning(f"layer-details schema sniff failed for {slug}: {e}")
    else:
        # Raster: report grid resolution, value type via rasterio
        path = data_dir / f"{slug}.tif"
        if path.exists():
            try:
                import rasterio
                with rasterio.open(path) as src:
                    schema = [
                        {"name": "value", "type": str(src.dtypes[0])},
                    ]
                    sample = {
                        "raster_band_1": "population count per pixel",
                    }
                    geom_type_actual = "Raster (GeoTIFF)"
                    crs = str(src.crs)
            except Exception:
                pass

    return {
        "slug": slug,
        "name_en": extra.get("name_en", base.get("name_en", slug)),
        "name_th": extra.get("name_th", base.get("name_th", "")),
        "geom_type": geom_type_actual,
        "data_type": extra.get("data_type", "vector"),
        "feature_count": extra.get("feature_count", 0),
        "bbox": extra.get("bbox"),
        "crs_native": crs,
        "crs_available": ["EPSG:4326", "EPSG:3857", "EPSG:32647", "EPSG:32648"],
        "source":      extra.get("source",      LAYER_SOURCE_DEFAULTS.get(slug, {}).get("source", "OpenStreetMap")),
        "source_url":  extra.get("source_url",  LAYER_SOURCE_DEFAULTS.get(slug, {}).get("url", "https://www.openstreetmap.org")),
        "license":     extra.get("license",     LAYER_SOURCE_DEFAULTS.get(slug, {}).get("license", "ODbL v1.0")),
        "license_url": extra.get("license_url", LAYER_SOURCE_DEFAULTS.get(slug, {}).get("license_url", "https://opendatacommons.org/licenses/odbl/1-0/")),
        "attribution": extra.get("attribution", LAYER_SOURCE_DEFAULTS.get(slug, {}).get("attribution", "© OpenStreetMap contributors")),
        "last_refreshed": extra.get("last_refreshed"),
        "description": LAYER_DESCRIPTIONS.get(slug, ""),
        "schema": schema,
        "sample": sample,
    }


def _friendly_type(dtype: str) -> str:
    if "int" in dtype: return "integer"
    if "float" in dtype: return "number"
    if "bool" in dtype: return "boolean"
    if "date" in dtype or "time" in dtype: return "datetime"
    return "string"


def _to_json_safe(v):
    """Convert numpy/pandas types to JSON-serializable Python primitives."""
    if v is None:
        return None
    try:
        import numpy as np
        import pandas as pd
        if isinstance(v, (np.integer,)): return int(v)
        if isinstance(v, (np.floating,)):
            f = float(v)
            return f if (f == f) else None  # NaN → None
        if isinstance(v, (np.bool_,)): return bool(v)
        if pd.isna(v): return None
    except Exception:
        pass
    if isinstance(v, (str, int, float, bool)):
        return v
    return str(v)


# Per-layer human descriptions and fallback source info
LAYER_DESCRIPTIONS = {
    "province":         "Thailand's 76 provinces + Bangkok metropolitan area, official admin_level=4 boundaries.",
    "amphoe":           "District (อำเภอ) boundaries, admin_level=6, ~1,773 districts nationwide.",
    "tambon":           "Sub-district (ตำบล) boundaries, admin_level=8, fine-grained admin units.",
    "roads":            "Major road network: motorway, trunk, primary, secondary, tertiary classes.",
    "waterways":        "Rivers, canals, and streams (waterway=river|canal|stream).",
    "railways":         "Heavy rail, light rail, subway, monorail lines.",
    "buildings":        "Building footprints from OpenStreetMap. Covers most major Thai cities.",
    "ms_buildings":     "Microsoft AI-detected building footprints. Comprehensive nationwide coverage (~24.6M buildings).",
    "google_buildings": "Google AI-detected building footprints with per-feature confidence scores.",
    "landuse":          "Land use polygons: forest, residential, commercial, industrial, farmland, etc.",
    "natural":          "Natural features: water bodies, forests, wetlands, grasslands.",
    "parks":            "National parks, nature reserves, protected areas.",
    "temples":          "Buddhist temples, shrines, and places of worship.",
    "pois":             "Points of interest: hospitals, schools, banks, hotels, museums, etc.",
    "worldpop":         "Population estimate raster, 100m resolution, year 2020, UN-adjusted (~70M people total).",
}

LAYER_SOURCE_DEFAULTS = {
    "ms_buildings":     {"source": "Microsoft Global Building Footprints", "url": "https://github.com/microsoft/GlobalMLBuildingFootprints",
                         "license": "ODbL v1.0", "license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
                         "attribution": "Building footprints © Microsoft"},
    "google_buildings": {"source": "Google Open Buildings v3", "url": "https://sites.research.google/open-buildings/",
                         "license": "CC BY 4.0", "license_url": "https://creativecommons.org/licenses/by/4.0/",
                         "attribution": "Building footprints © Google"},
    "worldpop":         {"source": "WorldPop (University of Southampton)", "url": "https://www.worldpop.org/",
                         "license": "CC BY 4.0", "license_url": "https://creativecommons.org/licenses/by/4.0/",
                         "attribution": "Population data © WorldPop, University of Southampton"},
}


@app.post("/preview")
def preview_aoi(request: ClipDataRequest):
    """Calculate feature count + estimated size for AOI. No credit charge."""
    try:
        results = clip_service.calculate_preview(request.aoi.model_dump(), request.layers)
        return {"layers": results}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error(f"preview failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Reclaim heap from geopandas/fiona temporaries every preview.
        _free_memory()


@app.post("/clip-data")
async def clip_data(request: ClipDataRequest, background_tasks: BackgroundTasks):
    """
    Clip layers to AOI → upload ZIP to S3 → return presigned URL.

    Donation-funded model: all downloads are FREE, no credit check.
    The credits/Stripe code remains in payments.py for future re-enable
    (e.g. premium tier / API access) but is not invoked here.
    """
    user_id = request.user_id
    credits_needed = 0  # always free

    # ── Validate target CRS ──
    ALLOWED_CRS = {"EPSG:4326", "EPSG:3857", "EPSG:32647", "EPSG:32648"}
    target_crs = (request.target_crs or "EPSG:4326").upper()
    if target_crs not in ALLOWED_CRS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported target_crs '{target_crs}'. Allowed: {sorted(ALLOWED_CRS)}",
        )

    # ── Reject if container is already busy with another heavy clip ──
    # asyncio.Semaphore + a short non-blocking try-acquire: if someone else
    # is mid-clip, return 503 immediately rather than queuing forever and
    # piling on memory pressure. Frontend retry banner will surface a
    # friendly "server busy" message.
    if _CLIP_SEMAPHORE.locked():
        raise HTTPException(
            status_code=503,
            detail="Server is busy clipping another request. Please retry in 30 seconds.",
        )

    async with _CLIP_SEMAPHORE:
        # Run blocking clip in a thread so we don't starve the event loop
        # and other endpoints (health, layers, search) stay responsive.
        loop = asyncio.get_event_loop()
        try:
            result = await loop.run_in_executor(
                None,
                lambda: clip_service.clip_and_package(
                    aoi_geojson=request.aoi.model_dump(),
                    layer_slugs=request.layers,
                    formats=request.formats,
                    user_id=user_id,
                    use_credits=(credits_needed > 0),
                    target_crs=target_crs,
                ),
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            log.error(f"clip_data failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            # Always release heap, even on error — geopandas may have
            # already loaded hundreds of MB before throwing.
            _free_memory()

        # ── Cleanup local temp file after S3 upload ──
        local_path = result.get("local_zip_path")
        if local_path and result.get("presigned_url"):
            background_tasks.add_task(cleanup_local_file, local_path)

        # ── Save to download history ──
        if user_id:
            try:
                save_download(
                    user_id=user_id,
                    download_id=result["download_id"],
                    filename=result["filename"],
                    layers=request.layers,
                    formats=request.formats,
                    size_mb=result["size_mb"],
                    total_features=result["total_features"],
                    s3_key=result.get("s3_key"),
                    credits_used=credits_needed,
                )
            except Exception as e:
                log.warning(f"Failed to save download history: {e}")

        # ── Return presigned URL or fallback ──
        if result.get("presigned_url"):
            return {
                "download_id": result["download_id"],
                "presigned_url": result["presigned_url"],
                "expires_in_seconds": result["expires_in_seconds"],
                "filename": result["filename"],
                "size_mb": result["size_mb"],
                "total_features": result["total_features"],
                "layers_included": result["layers_included"],
                "formats_included": result["formats_included"],
                "credits_used": credits_needed,
            }
        else:
            # S3 unavailable — fall back to direct download
            download_id = result["download_id"]
            return RedirectResponse(url=f"/download/{download_id}", status_code=303)


@app.get("/download/{download_id}")
def download_file(download_id: str):
    """
    Fallback local download when S3 is not configured.
    Files expire after 15 minutes (cleanup handled externally).
    """
    zip_path = Path(tempfile.gettempdir()) / f"{download_id}.zip"
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="File not found or expired")
    return FileResponse(
        path=str(zip_path),
        filename=f"thai_geodata_{download_id}.zip",
        media_type="application/zip",
    )


@app.get("/search-location")
def search_location(q: str):
    """
    Search Thai administrative units (province, amphoe, tambon) by name.
    Returns matching locations with their bounding box for map flyTo.
    """
    if not q or len(q) < 2:
        raise HTTPException(status_code=400, detail="Query too short (min 2 chars)")

    if not DATABASE_URL:
        # Fallback: return demo results from local GeoJSON data
        return _search_location_demo(q)

    try:
        engine = get_db_engine()
        with engine.connect() as conn:
            results = conn.execute(
                text("""
                    SELECT
                        osm_id, name_en, name_th,
                        ST_X(ST_Centroid(geom)) as lng,
                        ST_Y(ST_Centroid(geom)) as lat,
                        ST_Extent(geom) as bbox
                    FROM (
                        SELECT osm_id, name_en, name_th, geom FROM thailand_province
                        WHERE name_en ILIKE :q OR name_th ILIKE :q
                        UNION ALL
                        SELECT osm_id, name_en, name_th, geom FROM thailand_amphoe
                        WHERE name_en ILIKE :q OR name_th ILIKE :q
                        UNION ALL
                        SELECT osm_id, name_en, name_th, geom FROM thailand_tambon
                        WHERE name_en ILIKE :q OR name_th ILIKE :q
                    ) combined
                    GROUP BY osm_id, name_en, name_th
                    LIMIT 10
                """),
                {"q": f"%{q}%"}
            ).fetchall()

        locations = []
        for row in results:
            bbox_str = row["bbox"]
            # Parse PostGIS extent: "BOX(xmin ymin,xmax ymax)"
            try:
                bbox_parts = bbox_str.strip().replace("BOX(", "").replace(")", "").split(",")
                minpt = bbox_parts[0].split()
                maxpt = bbox_parts[1].split()
                bbox = [float(minpt[0]), float(minpt[1]), float(maxpt[0]), float(maxpt[1])]
            except Exception:
                bbox = None

            locations.append({
                "osm_id": row["osm_id"],
                "name_en": row["name_en"],
                "name_th": row["name_th"],
                "lng": row["lng"],
                "lat": row["lat"],
                "bbox": bbox,
            })

        return {"results": locations, "query": q}

    except SQLAlchemyError as e:
        log.error(f"search-location DB error: {e}")
        return _search_location_demo(q)
    except Exception as e:
        log.error(f"search-location error: {e}")
        return _search_location_demo(q)


def _search_location_demo(q: str):
    """
    Fallback demo search using local GeoJSON metadata.
    Returns hardcoded popular Thai locations with their bbox.
    """
    DEMO_LOCATIONS = [
        {"name_en": "Bangkok", "name_th": "กรุงเทพมหานคร", "lng": 100.5018, "lat": 13.7563,
         "bbox": [98.5, 13.0, 100.8, 14.5], "type": "province"},
        {"name_en": "Chiang Mai", "name_th": "เชียงใหม่", "lng": 98.9818, "lat": 18.7883,
         "bbox": [98.5, 17.5, 99.5, 19.5], "type": "province"},
        {"name_en": "Phuket", "name_th": "ภูเก็ต", "lng": 98.3929, "lat": 7.8804,
         "bbox": [98.2, 7.6, 98.6, 8.2], "type": "province"},
        {"name_en": "Ayutthaya", "name_th": "พระนครศรีอยุธยา", "lng": 100.5873, "lat": 14.3692,
         "bbox": [100.3, 14.1, 100.9, 14.7], "type": "province"},
        {"name_en": "Pattaya", "name_th": "พัทยา", "lng": 100.8870, "lat": 12.9276,
         "bbox": [100.7, 12.7, 101.1, 13.2], "type": "city"},
        {"name_en": "Hat Yai", "name_th": "หาดใหญ่", "lng": 100.4269, "lat": 6.8031,
         "bbox": [100.2, 6.5, 100.7, 7.1], "type": "city"},
        {"name_en": "Chiang Rai", "name_th": "เชียงราย", "lng": 99.8301, "lat": 19.9075,
         "bbox": [99.4, 19.4, 100.3, 20.4], "type": "province"},
        {"name_en": "Khon Kaen", "name_th": "ขอนแก่น", "lng": 102.8231, "lat": 16.4322,
         "bbox": [102.4, 15.9, 103.1, 17.0], "type": "province"},
        {"name_en": "Surat Thani", "name_th": "สุราษฎร์ธานี", "lng": 99.3333, "lat": 9.1406,
         "bbox": [98.6, 8.3, 100.1, 10.0], "type": "province"},
        {"name_en": "Udon Thani", "name_th": "อุดรธานี", "lng": 102.8211, "lat": 17.4157,
         "bbox": [102.4, 16.9, 103.2, 18.0], "type": "province"},
        {"name_en": "Nakhon Ratchasima", "name_th": "นครราชสีมา", "lng": 102.1000, "lat": 14.9799,
         "bbox": [101.5, 14.3, 102.7, 15.5], "type": "province"},
        {"name_en": "Samut Prakan", "name_th": "สมุทรปราการ", "lng": 100.6068, "lat": 13.6518,
         "bbox": [100.4, 13.3, 100.9, 14.0], "type": "province"},
    ]

    q_lower = q.lower()
    results = [
        loc for loc in DEMO_LOCATIONS
        if q_lower in loc["name_en"].lower() or q_lower in loc["name_th"]
    ][:8]
    return {"results": results, "query": q, "mode": "demo"}


@app.get("/history/{user_id}")
def get_history(user_id: str):
    """Return the download history for a user (most recent first)."""
    records = get_user_history(user_id)
    return {"user_id": user_id, "downloads": records, "count": len(records)}


class RedownloadRequest(BaseModel):
    user_id: str
    download_id: str


@app.post("/redownload")
def redownload(req: RedownloadRequest):
    """
    Re-generate a presigned S3 URL for a previous download.
    No credits charged — user already paid.
    """
    record = get_download_record(req.user_id, req.download_id)
    if not record:
        raise HTTPException(status_code=404, detail="Download record not found")

    s3_key = record.get("s3_key")
    if not s3_key:
        raise HTTPException(
            status_code=410,
            detail="This download was not stored on S3 and is no longer available."
        )

    if not S3_AVAILABLE:
        raise HTTPException(status_code=503, detail="S3 storage is not configured")

    try:
        from s3_storage import get_s3_client, S3_BUCKET_NAME
        client = get_s3_client()
        presigned_url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": S3_BUCKET_NAME, "Key": s3_key},
            ExpiresIn=900,  # 15 minutes
        )
        return {
            "download_id": req.download_id,
            "presigned_url": presigned_url,
            "filename": record.get("filename"),
            "expires_in_seconds": 900,
        }
    except Exception as e:
        log.error(f"Redownload presign failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate download link")


@app.get("/layer-sample/{slug}")
def layer_sample(slug: str, bbox: Optional[str] = None, limit: int = 200):
    """
    Return a GeoJSON sample of a layer for map preview.
    Accepts optional bbox=west,south,east,north for viewport-filtered results.
    Max `limit` features returned (default 200).
    """
    if slug not in LAYER_METADATA:
        raise HTTPException(status_code=404, detail=f"Layer '{slug}' not found")

    # Raster layers can't be sampled as features — return empty FC and a hint
    meta_check = LAYER_METADATA.get(slug, {})
    if meta_check.get("data_type") == "raster" or meta_check.get("geom_type") == "Raster":
        return {
            "type": "FeatureCollection",
            "features": [],
            "note": "Raster layer — preview not supported. Use Download to get the cropped GeoTIFF.",
        }

    # Prefer .fgb (binary, indexed) over .geojson. Critical for ms_buildings_urban
    # which is only stored as FlatGeobuf.
    data_dir = Path(__file__).parent.parent / "data"
    fgb_file = data_dir / f"{slug}.fgb"
    gj_file  = data_dir / f"{slug}.geojson"
    if fgb_file.exists():
        data_file = fgb_file
    elif gj_file.exists():
        data_file = gj_file
    else:
        raise HTTPException(
            status_code=404,
            detail=f"No data available for layer '{slug}'."
        )

    try:
        import geopandas as gpd

        read_kwargs: dict = {}
        if bbox:
            try:
                parts = [float(x) for x in bbox.split(",")]
                if len(parts) == 4:
                    # gpd/Fiona bbox = (west, south, east, north)
                    read_kwargs["bbox"] = tuple(parts)
            except Exception:
                pass

        gdf = gpd.read_file(data_file, **read_kwargs)

        if gdf.empty:
            return {"type": "FeatureCollection", "features": []}

        # Sample if too many
        if len(gdf) > limit:
            gdf = gdf.sample(n=limit, random_state=42)

        return json.loads(gdf.to_json())

    except Exception as e:
        log.error(f"layer-sample failed for {slug}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/admin/refresh/{layer_slug}")
def trigger_refresh(layer_slug: str, background_tasks: BackgroundTasks):
    if layer_slug not in LAYER_METADATA:
        raise HTTPException(status_code=404, detail=f"Unknown layer: {layer_slug}")
    background_tasks.add_task(refresh_layer_background, layer_slug)
    return {"message": f"Refresh for '{layer_slug}' queued", "status": "queued"}


@app.get("/admin/sync-from-r2")
def trigger_r2_sync(background_tasks: BackgroundTasks):
    """
    Re-run the R2 data sync in the background.
    Downloads any missing layer GeoJSON files from R2.
    """
    def _do_sync():
        log.info("Manual R2 sync triggered via /admin/sync-from-r2")
        _sync_data_from_r2()
        data_dir = Path(__file__).parent.parent / "data"
        layers = [p.stem for p in data_dir.glob("*.geojson")]
        log.info(f"R2 sync complete — {len(layers)} layers now available: {sorted(layers)}")

    background_tasks.add_task(_do_sync)
    return {"message": "R2 sync started in background", "status": "queued"}


# ─────────────────────────────────────────────
# Background tasks
# ─────────────────────────────────────────────

def cleanup_local_file(local_path: str):
    """Delete local temp ZIP after S3 upload confirmed."""
    try:
        p = Path(local_path)
        if p.exists():
            p.unlink()
            log.info(f"Cleaned up local file: {local_path}")
    except Exception as e:
        log.error(f"Failed to cleanup {local_path}: {e}")


def refresh_layer_background(layer_slug: str):
    import subprocess
    log.info(f"Starting background refresh for: {layer_slug}")
    try:
        result = subprocess.run(
            [sys.executable, "osm_fetcher.py", "--layer", layer_slug],
            cwd=Path(__file__).parent.parent / "scripts",
            capture_output=True, text=True,
        )
        log.info(f"Refresh for {layer_slug} completed: {result.returncode}")
    except Exception as e:
        log.error(f"Refresh failed for {layer_slug}: {e}")


def _r2_file_differs_from_local(s3_key: str, local_path: "Path") -> Optional[bool]:
    """Compare R2 object size with local file size.

    Returns:
        True  → need to download (local missing or sizes differ)
        False → up-to-date, skip download
        None  → R2 doesn't have this file (also skip — there's nothing to download)
    """
    if not S3_AVAILABLE:
        return None
    try:
        from s3_storage import get_s3_client, S3_BUCKET_NAME
        client = get_s3_client()
        head = client.head_object(Bucket=S3_BUCKET_NAME, Key=s3_key)
        r2_size = head["ContentLength"]
    except Exception:
        # 404 / 403 / etc — file doesn't exist in R2
        return None
    if not local_path.exists():
        return True
    local_size = local_path.stat().st_size
    return local_size != r2_size


def _sync_data_from_r2():
    """
    On startup: download any missing GeoJSON layer files from R2.
    This lets Railway run without the data in the git repo.
    """
    if not S3_AVAILABLE:
        log.info("S3 not configured — skipping data sync")
        return

    try:
        from s3_storage import download_file_from_s3
    except ImportError:
        return

    data_dir = Path(__file__).parent.parent / "data"
    data_dir.mkdir(exist_ok=True)

    # Vector layers — prefer FlatGeobuf (.fgb), fall back to GeoJSON.
    # FGB is binary + indexed → much smaller transfer + lower memory usage.
    #
    # Railway Hobby plan budget (5 GB volume):
    #   All 12 OSM layers (~2 GB GeoJSON)                       ≈ 2.0 GB
    #   WorldPop raster (worldpop.tif)                          ≈ 0.25 GB
    #   SRTM elevation (srtm.tif)                               ≈ 0.25 GB
    #                                                    Total ≈ 2.5 GB
    #
    # ms_buildings (4.7 GB FGB) and google_buildings (17 GB FGB) are still
    # skipped here because they alone exceed the budget when combined with
    # OSM. Enable them by upgrading Railway tier and adding to this list,
    # OR cropping them to major urban areas before re-uploading.
    vector_layers = [
        "province",            # ~152 MB
        "amphoe",              # ~350 MB
        "tambon",              #  ~22 MB
        "roads",               # ~332 MB
        "waterways",           # ~289 MB
        "railways",            #   ~8 MB
        "buildings",           #  ~70 MB — OSM buildings (small subset)
        "landuse",             # ~237 MB
        "natural",             # ~488 MB
        "parks",               #  ~25 MB
        "temples",             #   ~8 MB
        "pois",                #  ~26 MB
        "ms_buildings_urban",  # ~542 MB — MS buildings cropped to 8 cities (2.7M)
    ]
    skipped_layers = ["ms_buildings", "google_buildings"]  # too big for 5 GB (full versions)
    for slug in skipped_layers:
        log.info(f"Skipping {slug} (file too large for current Railway plan)")
    for slug in vector_layers:
        local_fgb = data_dir / f"{slug}.fgb"
        local_gj = data_dir / f"{slug}.geojson"
        # Determine if we need to download by comparing local size with R2 size.
        # This catches the case where a layer was replaced with a bigger
        # version (e.g. google_buildings 1.2 GB → 17 GB).
        needs_download_fgb = _r2_file_differs_from_local(f"data/{slug}.fgb", local_fgb)
        if needs_download_fgb is True:
            log.info(f"Downloading {slug}.fgb (size mismatch or missing) ...")
            if download_file_from_s3(f"data/{slug}.fgb", str(local_fgb)):
                log.info(f"Downloaded {slug}.fgb")
                # If we got .fgb, remove any stale .geojson to avoid confusion
                if local_gj.exists():
                    try: local_gj.unlink()
                    except: pass
                continue
        elif needs_download_fgb is False:
            log.info(f"Data OK (local matches R2): {slug}.fgb")
            continue
        # No .fgb in R2 — fall back to .geojson
        needs_download_gj = _r2_file_differs_from_local(f"data/{slug}.geojson", local_gj)
        if needs_download_gj is True:
            log.info(f"Downloading {slug}.geojson ...")
            if download_file_from_s3(f"data/{slug}.geojson", str(local_gj)):
                log.info(f"Downloaded {slug}.geojson")
            else:
                log.warning(f"Could not download {slug} — layer will be unavailable")
        elif needs_download_gj is False:
            log.info(f"Data OK (local matches R2): {slug}.geojson")

    # Raster layers (.tif): WorldPop population + SRTM 30m elevation.
    raster_layers = ["worldpop", "srtm"]
    for slug in raster_layers:
        local = data_dir / f"{slug}.tif"
        needs = _r2_file_differs_from_local(f"data/{slug}.tif", local)
        if needs is True:
            log.info(f"Downloading {slug}.tif ...")
            if download_file_from_s3(f"data/{slug}.tif", str(local)):
                log.info(f"Downloaded {slug}.tif")
            else:
                log.warning(f"Could not download {slug}.tif")
        elif needs is False:
            log.info(f"Data OK (local matches R2): {slug}.tif")

    # Metadata files (small) — ALWAYS re-download from R2 so feature_count
    # stays in sync when we replace a layer's data. Files are <1 KB each so
    # this adds negligible cold-start time.
    for slug in vector_layers + raster_layers:
        local_meta = data_dir / f"{slug}_metadata.json"
        ok = download_file_from_s3(f"data/{slug}_metadata.json", str(local_meta))
        if ok:
            log.info(f"Refreshed metadata: {slug}")


@app.on_event("startup")
async def startup_event():
    """
    Start fast. Health check needs to pass within Railway's 1-min retry window,
    so we CANNOT block startup on the R2 sync (which can download hundreds of
    MB and take minutes). Instead:

      1. Return control immediately — /health responds 200 instantly.
      2. Sync runs in a background thread; layers come online as files arrive.
      3. /layers reports status="no_data" until each layer's file is on disk.
    """
    import threading

    def _sync_in_background():
        try:
            log.info("Background R2 sync starting (non-blocking)")
            _sync_data_from_r2()
            log.info("Background R2 sync complete")
        except Exception as e:
            log.error(f"Background sync failed: {e}")

    threading.Thread(target=_sync_in_background, daemon=True).start()

    # Ensure S3 bucket exists (quick, non-blocking)
    if S3_AVAILABLE:
        try:
            from s3_storage import ensure_bucket_exists
            ensure_bucket_exists()
        except Exception as e:
            log.warning(f"S3 bucket check failed: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)