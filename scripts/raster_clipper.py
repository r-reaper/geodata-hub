"""
Thai GeoData Hub — Raster clipping helper

Clips a GeoTIFF to an AOI polygon and returns:
  - GeoTIFF bytes (cropped)
  - PNG preview bytes (small, for quick visualization)
  - Summary stats (sum, mean, min, max, pixel count)

Used for WorldPop population grids and any future raster layers.
Requires `rasterio` — gracefully degrades if not installed.
"""

import io
import logging
from pathlib import Path
from typing import Optional

from shapely.geometry import shape, mapping

log = logging.getLogger(__name__)

# rasterio is heavy; import lazily
try:
    import rasterio
    from rasterio.mask import mask as raster_mask
    from rasterio.io import MemoryFile
    import numpy as np
    RASTERIO_AVAILABLE = True
except ImportError:
    RASTERIO_AVAILABLE = False
    log.warning("rasterio not installed — raster layers will be unavailable")


def clip_raster_to_aoi(raster_path: Path, aoi_geojson: dict) -> Optional[dict]:
    """Clip a GeoTIFF to the AOI polygon.

    Returns a dict with:
      - tif_bytes: cropped GeoTIFF (bytes, can be written to ZIP)
      - stats: { sum, mean, min, max, pixel_count, area_km2 }
      - bounds: [west, south, east, north] of clipped raster
    Returns None if rasterio unavailable or AOI doesn't intersect raster.
    """
    if not RASTERIO_AVAILABLE:
        return None
    if not raster_path.exists():
        log.error(f"Raster not found: {raster_path}")
        return None

    try:
        aoi_geom = shape(aoi_geojson["geometry"] if "geometry" in aoi_geojson else aoi_geojson)
    except Exception as e:
        log.error(f"Invalid AOI geometry: {e}")
        return None

    with rasterio.open(raster_path) as src:
        # Check intersection
        raster_bbox = box_from_bounds(src.bounds)
        if not raster_bbox.intersects(aoi_geom):
            log.info("AOI does not intersect raster")
            return None

        # Clip
        try:
            out_image, out_transform = raster_mask(
                src,
                [mapping(aoi_geom)],
                crop=True,
                nodata=src.nodata,
            )
        except Exception as e:
            log.error(f"Mask failed: {e}")
            return None

        # Build clipped raster's metadata
        out_meta = src.meta.copy()
        out_meta.update({
            "driver": "GTiff",
            "height": out_image.shape[1],
            "width":  out_image.shape[2],
            "transform": out_transform,
            "compress": "deflate",
        })

        # Stats over valid pixels
        nodata = src.nodata
        arr = out_image[0]  # band 1
        if nodata is not None:
            valid = arr[arr != nodata]
        else:
            valid = arr.flatten()
        # Filter out NaN
        valid = valid[~np.isnan(valid)] if valid.dtype.kind == "f" else valid

        stats = {
            "sum":         float(valid.sum())   if valid.size else 0.0,
            "mean":        float(valid.mean())  if valid.size else 0.0,
            "min":         float(valid.min())   if valid.size else 0.0,
            "max":         float(valid.max())   if valid.size else 0.0,
            "pixel_count": int(valid.size),
        }

        # Approx area at the centroid latitude (1° lon ≈ 111 km × cos(lat))
        from math import cos, radians
        cy = (src.bounds.top + src.bounds.bottom) / 2
        pixel_lon = abs(out_transform.a)
        pixel_lat = abs(out_transform.e)
        km_per_lon = 111.32 * cos(radians(cy))
        km_per_lat = 110.57
        pixel_area_km2 = (pixel_lon * km_per_lon) * (pixel_lat * km_per_lat)
        stats["area_km2"] = round(stats["pixel_count"] * pixel_area_km2, 3)

        # Write clipped TIFF to bytes
        with MemoryFile() as memfile:
            with memfile.open(**out_meta) as dst:
                dst.write(out_image)
            tif_bytes = memfile.read()

        # Bounds of clipped output
        clipped_bounds = [
            out_transform.c,                                  # west
            out_transform.f + out_transform.e * out_image.shape[1],  # south
            out_transform.c + out_transform.a * out_image.shape[2],  # east
            out_transform.f,                                  # north
        ]

        return {
            "tif_bytes": tif_bytes,
            "stats":     stats,
            "bounds":    clipped_bounds,
        }


def box_from_bounds(b):
    """Make a shapely box from a rasterio BoundingBox."""
    from shapely.geometry import box
    return box(b.left, b.bottom, b.right, b.top)
