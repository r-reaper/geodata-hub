"""
Thai GeoData Hub — FastAPI Backend (v2 with S3 + Stripe)
"""

import os
import sys
import json
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


@app.post("/clip-data")
def clip_data(request: ClipDataRequest, background_tasks: BackgroundTasks):
    """
    Clip layers to AOI → upload ZIP to S3 → return presigned URL.
    Checks and deducts credits before processing.
    """
    user_id = request.user_id

    # ── Credit check ──
    credits_needed = 0
    if user_id:
        # First calculate what we'll need (do preview internally)
        try:
            preview_results = clip_service.calculate_preview(
                request.aoi.model_dump(), request.layers
            )
            total_features = sum(
                r.get("feature_count", 0) for r in preview_results.values()
                if isinstance(r, dict) and "feature_count" in r
            )
            total_mb = sum(
                r.get("estimated_mb_shp", 0) for r in preview_results.values()
                if isinstance(r, dict) and "estimated_mb_shp" in r
            )
            credits_needed = calculate_credits_needed(total_features, total_mb)
        except Exception as e:
            log.warning(f"Preview failed for credit calc: {e}")

        # Deduct credits (atomic — works with both DB and file store)
        if credits_needed > 0:
            ok = deduct_credits_db(user_id, credits_needed)
            if not ok:
                raise HTTPException(
                    status_code=402,
                    detail=f"Insufficient credits. Need {credits_needed}, check /payments/credits/{user_id}",
                )

    # ── Execute clipping ──
    try:
        result = clip_service.clip_and_package(
            aoi_geojson=request.aoi.model_dump(),
            layer_slugs=request.layers,
            formats=request.formats,
            user_id=user_id,
            use_credits=(credits_needed > 0),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error(f"clip_data failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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

    data_file = Path(__file__).parent.parent / "data" / f"{slug}.geojson"
    if not data_file.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No data available for layer '{slug}'. Run osm_fetcher.py first."
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
    vector_layers = ["province", "amphoe", "tambon", "roads", "waterways", "railways",
                     "buildings", "landuse", "natural", "parks", "temples", "pois",
                     "ms_buildings", "google_buildings"]
    for slug in vector_layers:
        local_fgb = data_dir / f"{slug}.fgb"
        local_gj = data_dir / f"{slug}.geojson"
        if local_fgb.exists() or local_gj.exists():
            log.info(f"Data OK (local): {slug}")
            continue
        # Try .fgb first (preferred)
        log.info(f"Trying {slug}.fgb from R2 ...")
        ok = download_file_from_s3(f"data/{slug}.fgb", str(local_fgb))
        if ok:
            log.info(f"Downloaded {slug}.fgb (FlatGeobuf)")
            continue
        # Fall back to .geojson
        log.info(f"  no .fgb, trying {slug}.geojson ...")
        ok = download_file_from_s3(f"data/{slug}.geojson", str(local_gj))
        if ok:
            log.info(f"Downloaded {slug}.geojson")
        else:
            log.warning(f"Could not download {slug} — layer will be unavailable")

    # Raster layers (.tif) — WorldPop and any future raster layers
    raster_layers = ["worldpop"]
    for slug in raster_layers:
        local = data_dir / f"{slug}.tif"
        if local.exists():
            log.info(f"Data OK (local): {slug}.tif")
            continue
        log.info(f"Downloading {slug}.tif from R2 ...")
        ok = download_file_from_s3(f"data/{slug}.tif", str(local))
        if ok:
            log.info(f"Downloaded {slug}.tif")
        else:
            log.warning(f"Could not download {slug}.tif — layer will be unavailable")

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
    import asyncio
    # Run data sync in a thread so we don't block the event loop
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _sync_data_from_r2)
    # Ensure S3 bucket exists
    if S3_AVAILABLE:
        try:
            from s3_storage import ensure_bucket_exists
            ensure_bucket_exists()
        except Exception as e:
            log.warning(f"S3 bucket check failed: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)