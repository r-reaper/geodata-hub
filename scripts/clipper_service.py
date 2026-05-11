"""
Thai GeoData Hub — Clipping Service (File-based, no PostgreSQL required)
Performs spatial intersection between user AOI and local GeoJSON layers.
Outputs multi-format ZIP (Shapefile, GeoJSON, KML).
"""

import sys
import io
import json
import math
import tempfile
import zipfile
import logging
import uuid
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

import geopandas as gpd
import pandas as pd
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

# Attribution / license file builders embedded in every ZIP
from attribution import build_attribution_text, build_license_text, build_readme_text

# S3 storage integration — graceful degradation when boto3 unavailable
S3_AVAILABLE = False
upload_file_to_s3 = None
delete_s3_object = None

try:
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError

    sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
    from s3_storage import upload_file_to_s3, delete_s3_object
    S3_AVAILABLE = bool(os.getenv("S3_ACCESS_KEY", ""))
except ImportError:
    # boto3 not installed — S3 features disabled, use local file storage
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────
DATA_DIR = Path(__file__).parent.parent / "data"

LAYER_METADATA = {
    "roads":            {"slug": "roads",            "name_en": "Road Network",            "name_th": "เส้นทางจราจร",        "geom_type": "Linestring"},
    "waterways":        {"slug": "waterways",        "name_en": "Waterways",                "name_th": "แหล่งน้ำ",              "geom_type": "Linestring"},
    "railways":         {"slug": "railways",         "name_en": "Railways",                 "name_th": "ทางรถไฟ",              "geom_type": "Linestring"},
    "buildings":        {"slug": "buildings",        "name_en": "Buildings (OSM)",          "name_th": "อาคาร (OSM)",          "geom_type": "Polygon"},
    "ms_buildings":         {"slug": "ms_buildings",         "name_en": "Buildings (Microsoft)",        "name_th": "อาคาร (Microsoft)",        "geom_type": "Polygon"},
    "ms_buildings_urban":   {"slug": "ms_buildings_urban",   "name_en": "Buildings (Microsoft, urban)", "name_th": "อาคาร (Microsoft, เมืองหลัก)", "geom_type": "Polygon"},
    "google_buildings":     {"slug": "google_buildings",     "name_en": "Buildings (Google)",           "name_th": "อาคาร (Google)",           "geom_type": "Polygon"},
    "landuse":          {"slug": "landuse",          "name_en": "Land Use",                 "name_th": "การใช้ประโยชน์ที่ดิน",   "geom_type": "Polygon"},
    "natural":          {"slug": "natural",          "name_en": "Natural Features",         "name_th": "ลักษณะทางธรรมชาติ",    "geom_type": "Polygon"},
    "parks":            {"slug": "parks",            "name_en": "National Parks",            "name_th": "อุทยานแห่งชาติ",          "geom_type": "Polygon"},
    "temples":          {"slug": "temples",          "name_en": "Temples & Shrines",         "name_th": "วัด/ศาสนสถาน",           "geom_type": "Point"},
    "pois":             {"slug": "pois",             "name_en": "Points of Interest",        "name_th": "สถานที่สำคัญ",            "geom_type": "Point"},
    "province":         {"slug": "province",         "name_en": "Province Boundaries",     "name_th": "ขอบเขตจังหวัด",        "geom_type": "Polygon"},
    "amphoe":           {"slug": "amphoe",           "name_en": "District Boundaries",     "name_th": "ขอบเขตอำเภอ",          "geom_type": "Polygon"},
    "tambon":           {"slug": "tambon",           "name_en": "Sub-district Boundaries", "name_th": "ขอบเขตตำบล",           "geom_type": "Polygon"},
    "worldpop":         {"slug": "worldpop",         "name_en": "Population (WorldPop 2020)", "name_th": "ประชากร (WorldPop 2020)", "geom_type": "Raster", "data_type": "raster"},
    "srtm":             {"slug": "srtm",             "name_en": "Elevation (SRTM 30m)",      "name_th": "ความสูง (SRTM 30 ม.)",     "geom_type": "Raster", "data_type": "raster"},
}

# Layers that are stored as raster GeoTIFF instead of vector GeoJSON
RASTER_LAYERS = {"worldpop", "srtm"}

DRIVER_MAP = {
    "shp": "ESRI Shapefile",
    "geojson": "GeoJSON",
    "kml": "KML",
}


# ─────────────────────────────────────────────
# Core clipping logic
# ─────────────────────────────────────────────

def load_layer_from_file(slug: str, bbox: tuple | None = None) -> gpd.GeoDataFrame:
    """Load a layer from local file. Prefers FlatGeobuf (.fgb) over GeoJSON.

    FlatGeobuf is binary and indexed → much faster for large layers and supports
    bbox push-down so we don't load the whole file into memory.

    Args:
        slug: layer slug (e.g. "ms_buildings")
        bbox: optional (west, south, east, north) — passed to fiona for spatial
              push-down filter when reading FlatGeobuf or GeoJSON.
    """
    fgb = DATA_DIR / f"{slug}.fgb"
    geojson = DATA_DIR / f"{slug}.geojson"
    path = fgb if fgb.exists() else geojson
    if not path.exists():
        raise FileNotFoundError(f"No data file found for layer: {slug} (tried {fgb}, {geojson})")
    read_kwargs: dict = {}
    if bbox:
        read_kwargs["bbox"] = tuple(bbox)
    gdf = gpd.read_file(path, **read_kwargs)
    return gdf


def load_metadata(slug: str) -> dict:
    path = DATA_DIR / f"{slug}_metadata.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return LAYER_METADATA.get(slug, {})


def clip_layer(gdf: gpd.GeoDataFrame, aoi_geom) -> gpd.GeoDataFrame:
    """Perform spatial intersection between layer and AOI."""
    if gdf.empty:
        return gpd.GeoDataFrame(columns=gdf.columns, geometry="geometry", crs=gdf.crs)

    # Use spatial index for performance
    gdf_sindex = gdf.sindex
    aoi_bounds = aoi_geom.bounds
    candidate_idx = list(gdf_sindex.intersection(aoi_bounds))

    if not candidate_idx:
        return gpd.GeoDataFrame(columns=gdf.columns, geometry="geometry", crs=gdf.crs)

    candidates = gdf.iloc[candidate_idx].copy()

    # Filter to only those that actually intersect
    clipped_geoms = []
    clipped_rows = []
    for _, row in candidates.iterrows():
        try:
            if row.geometry.intersects(aoi_geom):
                inter = row.geometry.intersection(aoi_geom)
                if not inter.is_empty:
                    clipped_geoms.append(inter)
                    clipped_rows.append(row.drop("geometry").drop("geom", errors="ignore"))
        except Exception:
            continue

    if not clipped_rows:
        return gpd.GeoDataFrame(columns=gdf.columns, geometry="geometry", crs=gdf.crs)

    # Build result GeoDataFrame from clipped rows and clipped geometries
    result = gpd.GeoDataFrame(clipped_rows, geometry=clipped_geoms, crs=gdf.crs or "EPSG:4326")
    result.rename_geometry("geom", inplace=True)
    return result


def estimate_size_mb(gdf: gpd.GeoDataFrame, fmt: str) -> float:
    if gdf.empty:
        return 0.0
    per_feature = {"shp": 2500, "geojson": 800, "kml": 1200}
    return (len(gdf) * per_feature.get(fmt, 2000)) / (1024 * 1024)


def gdf_to_bytes(gdf: gpd.GeoDataFrame, fmt: str, layer_name: str) -> bytes:
    if fmt == "kml":
        gdf_kml = gdf.copy()
        name_col = next((c for c in ["name_en", "name_th", "name"] if c in gdf_kml.columns), None)
        gdf_kml["Name"] = gdf_kml[name_col].fillna("") if name_col else ""
        gdf_kml["Description"] = ""
        with tempfile.NamedTemporaryFile(suffix=".kml", delete=False) as tmp:
            gdf_kml.to_file(tmp.name, driver="KML", encoding="utf-8")
            data = Path(tmp.name).read_bytes()
        Path(tmp.name).unlink()
        return data
    elif fmt == "shp":
        tmpdir = Path(tempfile.mkdtemp())
        shp_path = tmpdir / f"{layer_name}.shp"
        gdf.to_file(shp_path, driver="ESRI Shapefile", encoding="utf-8")
        parts = {}
        for sub_ext in ["shp", "shx", "dbf", "prj"]:
            fpath = tmpdir / f"{layer_name}.{sub_ext}"
            if fpath.exists():
                parts[sub_ext] = fpath.read_bytes()
        for fpath in tmpdir.glob(f"{layer_name}.*"):
            fpath.unlink()
        tmpdir.rmdir()
        return parts
    else:
        buf = io.BytesIO()
        gdf.to_file(buf, driver=DRIVER_MAP[fmt], encoding="utf-8")
        buf.seek(0)
        return buf.read()


def create_download_zip(
    gdf: gpd.GeoDataFrame,
    layer_slug: str,
    formats: list[str] = ("shp", "geojson", "kml"),
) -> tuple[bytes, float]:
    """Create ZIP with multiple format exports."""
    if gdf.empty:
        raise ValueError("No features to export after clipping")

    zip_buf = io.BytesIO()
    total_size_mb = 0.0
    layer_name = layer_slug.replace("-", "_")

    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fmt in formats:
            if fmt == "shp":
                parts = gdf_to_bytes(gdf, fmt, layer_name)
                for sub_ext, data in parts.items():
                    zf.writestr(f"{layer_name}.{sub_ext}", data)
                    total_size_mb += len(data) / (1024 * 1024)
            else:
                filename = f"{layer_name}.{fmt}"
                data = gdf_to_bytes(gdf, fmt, layer_name)
                zf.writestr(filename, data)
                total_size_mb += len(data) / (1024 * 1024)

        # ── Embed attribution + license + readme (legal requirement) ──
        zf.writestr("ATTRIBUTION.txt", build_attribution_text([layer_slug]))
        zf.writestr("LICENSE.txt",     build_license_text([layer_slug]))
        zf.writestr("README.txt",      build_readme_text([layer_slug], list(formats), len(gdf)))

    zip_buf.seek(0)
    return zip_buf.read(), total_size_mb


# ─────────────────────────────────────────────
# ClipService — FastAPI integration
# ─────────────────────────────────────────────

class ClipService:

    def get_available_layers(self) -> list[dict]:
        layers = []
        for slug in LAYER_METADATA:
            meta = load_metadata(slug)
            # Raster layers live in .tif; vector layers in .fgb (preferred) or .geojson
            if slug in RASTER_LAYERS:
                file_present = (DATA_DIR / f"{slug}.tif").exists()
            else:
                file_present = (DATA_DIR / f"{slug}.fgb").exists() or (DATA_DIR / f"{slug}.geojson").exists()
            layers.append({
                "slug": slug,
                "name_en": meta.get("name_en", slug),
                "name_th": meta.get("name_th", ""),
                "geom_type": meta.get("geom_type", "Unknown"),
                "feature_count": meta.get("feature_count", 0),
                "data_type": meta.get("data_type", "vector"),
                "status": "active" if file_present else "no_data",
            })
        return layers

    def calculate_preview(self, aoi_geojson: dict, layer_slugs: list[str]) -> dict:
        try:
            aoi_geom = shape(aoi_geojson["geometry"])
        except Exception as e:
            raise ValueError(f"Invalid GeoJSON: {e}")

        results = {}
        for slug in layer_slugs:
            try:
                if slug in RASTER_LAYERS:
                    # Raster preview — return summary stats instead of feature count
                    from raster_clipper import clip_raster_to_aoi
                    raster_path = DATA_DIR / f"{slug}.tif"
                    if not raster_path.exists():
                        results[slug] = {"error": f"No data file for raster layer: {slug}"}
                        continue
                    r = clip_raster_to_aoi(raster_path, aoi_geojson)
                    if r is None:
                        results[slug] = {"feature_count": 0, "error": "AOI does not intersect raster"}
                        continue
                    s = r["stats"]
                    # For population grids, "feature_count" is repurposed as estimated total population
                    results[slug] = {
                        "feature_count": int(round(s["sum"])),
                        "raster_stats": {
                            "sum":  round(s["sum"], 1),
                            "mean": round(s["mean"], 4),
                            "min":  round(s["min"], 4),
                            "max":  round(s["max"], 4),
                            "pixel_count": s["pixel_count"],
                            "area_km2": round(s["area_km2"], 2),
                        },
                        "estimated_mb_shp": round(len(r["tif_bytes"]) / (1024 * 1024), 3),
                        "estimated_mb_geojson": round(len(r["tif_bytes"]) / (1024 * 1024), 3),
                    }
                else:
                    # Push down AOI bbox so we don't load the whole file
                    gdf = load_layer_from_file(slug, bbox=aoi_geom.bounds)
                    clipped = clip_layer(gdf, aoi_geom)
                    results[slug] = {
                        "feature_count": len(clipped),
                        "estimated_mb_shp": round(estimate_size_mb(clipped, "shp"), 3),
                        "estimated_mb_geojson": round(estimate_size_mb(clipped, "geojson"), 3),
                        "centroid": mapping(clipped.geometry.centroid.unary_union).get("coordinates")
                                    if not clipped.empty else None,
                    }
            except FileNotFoundError as e:
                results[slug] = {"error": str(e)}
            except Exception as e:
                results[slug] = {"error": str(e)}
        return results

    def clip_and_package(
        self,
        aoi_geojson: dict,
        layer_slugs: list[str],
        formats: list[str] = ("shp", "geojson", "kml"),
        user_id: Optional[str] = None,
        use_credits: bool = False,
        target_crs: str = "EPSG:4326",
    ) -> dict:
        """Clip layers to AOI, optionally reproject to target_crs, upload ZIP to S3."""
        try:
            aoi_geom = shape(aoi_geojson["geometry"])
        except Exception as e:
            raise ValueError(f"Invalid AOI geometry: {e}")

        if aoi_geom.area > 100:
            raise ValueError("AOI too large. Please draw a smaller area.")

        total_features = 0
        zip_parts = []     # vector: (gdf, slug)
        raster_parts = []  # raster: (clip_result, slug)

        for slug in layer_slugs:
            try:
                if slug in RASTER_LAYERS:
                    from raster_clipper import clip_raster_to_aoi
                    raster_path = DATA_DIR / f"{slug}.tif"
                    if not raster_path.exists():
                        continue
                    r = clip_raster_to_aoi(raster_path, aoi_geojson)
                    if r is None:
                        continue
                    raster_parts.append((r, slug))
                    total_features += int(round(r["stats"]["sum"]))
                else:
                    gdf = load_layer_from_file(slug, bbox=aoi_geom.bounds)
                    clipped = clip_layer(gdf, aoi_geom)
                    if clipped.empty:
                        continue
                    total_features += len(clipped)
                    zip_parts.append((clipped, slug))
            except FileNotFoundError:
                continue

        if not zip_parts and not raster_parts:
            raise ValueError("No data found for selected layers. Run the appropriate fetcher first.")

        download_id = uuid.uuid4().hex
        zip_path = Path(tempfile.gettempdir()) / f"{download_id}.zip"
        total_size_mb = 0.0

        # ── CRS handling ──
        # KML always requires EPSG:4326 (WGS 84) by spec.
        # SHP/GeoJSON honour the requested target_crs.
        do_reproject = target_crs and target_crs.upper() not in ("EPSG:4326", "EPSG:WGS84")
        if do_reproject:
            log.info(f"Reprojecting vector layers to {target_crs} (KML keeps EPSG:4326)")

        def _gdf_in_crs(gdf, fmt):
            """Return gdf in the right CRS for the given output format."""
            if not do_reproject or fmt == "kml":
                return gdf
            try:
                return gdf.to_crs(target_crs) if gdf.crs else gdf
            except Exception as e:
                log.warning(f"reproject failed (fmt={fmt}): {e} — keeping original CRS")
                return gdf

        with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
            # ── Vector layers ──
            for gdf, slug in zip_parts:
                layer_name = slug.replace("-", "_")
                for fmt in formats:
                    gdf_out = _gdf_in_crs(gdf, fmt)
                    if fmt == "shp":
                        parts = gdf_to_bytes(gdf_out, fmt, layer_name)
                        for sub_ext, data in parts.items():
                            zf.writestr(f"{layer_name}.{sub_ext}", data)
                            total_size_mb += len(data) / (1024 * 1024)
                    else:
                        filename = f"{layer_name}.{fmt}"
                        data = gdf_to_bytes(gdf_out, fmt, layer_name)
                        zf.writestr(filename, data)
                        total_size_mb += len(data) / (1024 * 1024)

            # ── Raster layers (always emitted as GeoTIFF + summary CSV) ──
            for r, slug in raster_parts:
                layer_name = slug.replace("-", "_")
                # Cropped GeoTIFF
                zf.writestr(f"{layer_name}.tif", r["tif_bytes"])
                total_size_mb += len(r["tif_bytes"]) / (1024 * 1024)
                # Stats CSV
                s = r["stats"]
                csv_text = (
                    "metric,value\n"
                    f"sum,{s['sum']}\n"
                    f"mean,{s['mean']}\n"
                    f"min,{s['min']}\n"
                    f"max,{s['max']}\n"
                    f"pixel_count,{s['pixel_count']}\n"
                    f"area_km2,{s['area_km2']}\n"
                )
                zf.writestr(f"{layer_name}_stats.csv", csv_text)
                total_size_mb += len(csv_text) / (1024 * 1024)

            # ── Embed attribution + license + readme (legal requirement) ──
            included_slugs = [s for _, s in zip_parts] + [s for _, s in raster_parts]
            zf.writestr("ATTRIBUTION.txt", build_attribution_text(included_slugs))
            zf.writestr("LICENSE.txt",     build_license_text(included_slugs))
            zf.writestr("README.txt",      build_readme_text(included_slugs, list(formats), total_features, target_crs))

        # ── Upload to S3 ──
        object_key = f"downloads/{download_id}.zip"
        presigned_url = None
        local_cleanup_needed = True

        if S3_AVAILABLE and upload_file_to_s3:
            presigned_url = upload_file_to_s3(str(zip_path), object_key)
            if presigned_url:
                local_cleanup_needed = True
                log.info(f"Uploaded ZIP to S3: {object_key}")
            else:
                log.warning("S3 upload failed — falling back to local file serve")

        return {
            "download_id": download_id,
            "filename": f"thai_geodata_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip",
            "size_mb": round(total_size_mb, 3),
            "total_features": total_features,
            "layers_included": layer_slugs,
            "formats_included": formats,
            # S3 fields
            "presigned_url": presigned_url,
            "s3_key": object_key if presigned_url else None,
            "expires_in_seconds": 900,  # 15 minutes
            "local_cleanup_needed": local_cleanup_needed,
            # Fallback: local path if S3 unavailable
            "local_zip_path": str(zip_path) if not presigned_url else None,
        }


# ─────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Clip & Package Thai GeoData")
    parser.add_argument("--aoi", required=True, help="GeoJSON file path")
    parser.add_argument("--layers", nargs="+", required=True, choices=list(LAYER_METADATA.keys()))
    parser.add_argument("--formats", nargs="+", default=["shp", "geojson", "kml"])
    args = parser.parse_args()

    aoi_geojson = json.loads(Path(args.aoi).read_text(encoding="utf-8"))
    svc = ClipService()
    result = svc.clip_and_package(aoi_geojson, args.layers, args.formats)
    print(json.dumps(result, indent=2))