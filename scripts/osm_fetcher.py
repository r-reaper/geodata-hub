"""
Thai GeoData Hub — OSM Data Fetcher
Saves data to local GeoJSON files (no PostgreSQL required).
"""

import argparse
import json
import time
import logging
import sys
import math
from datetime import datetime
from pathlib import Path

import requests
from shapely.geometry import LineString, Polygon, mapping
from shapely.ops import linemerge, polygonize

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", encoding="utf-8")
log = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
HEADERS = {
    "User-Agent": "ThaiGeoDataHub/1.0 (geospatial app; python/requests)",
}
TIMEOUT = 300

THAILAND_BBOX = (97.3, 6.5, 105.7, 20.5)
DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

LAYER_METADATA = {
    "roads":      {"slug": "roads",      "name_en": "Road Network",              "name_th": "เส้นทางจราจร",        "geom_type": "Linestring"},
    "waterways":  {"slug": "waterways",  "name_en": "Waterways",                  "name_th": "แหล่งน้ำ",              "geom_type": "Linestring"},
    "railways":   {"slug": "railways",   "name_en": "Railways",                   "name_th": "ทางรถไฟ",              "geom_type": "Linestring"},
    "buildings":  {"slug": "buildings",  "name_en": "Buildings",                  "name_th": "อาคาร/สิ่งปลูกสร้าง",   "geom_type": "Polygon"},
    "landuse":    {"slug": "landuse",    "name_en": "Land Use",                   "name_th": "การใช้ประโยชน์ที่ดิน",   "geom_type": "Polygon"},
    "natural":    {"slug": "natural",    "name_en": "Natural Features",           "name_th": "ลักษณะทางธรรมชาติ",    "geom_type": "Polygon"},
    "pois":       {"slug": "pois",       "name_en": "Points of Interest",         "name_th": "สถานที่สำคัญ",          "geom_type": "Point"},
    "province":   {"slug": "province",   "name_en": "Province Boundaries",       "name_th": "ขอบเขตจังหวัด",        "geom_type": "Polygon"},
    "amphoe":     {"slug": "amphoe",     "name_en": "District Boundaries",       "name_th": "ขอบเขตอำเภอ",          "geom_type": "Polygon"},
    "tambon":     {"slug": "tambon",     "name_en": "Sub-district Boundaries",   "name_th": "ขอบเขตตำบล",           "geom_type": "Polygon"},
}


def thai_bbox_str():
    w, s, e, n = THAILAND_BBOX
    return f"{s},{w},{n},{e}"


OVERPASS_QUERIES = {
    "roads": f"""
    [out:json][timeout:{TIMEOUT}];
    (
      way["highway"="motorway"]({thai_bbox_str()});
      way["highway"="motorway_link"]({thai_bbox_str()});
      way["highway"="trunk"]({thai_bbox_str()});
      way["highway"="trunk_link"]({thai_bbox_str()});
      way["highway"="primary"]({thai_bbox_str()});
      way["highway"="primary_link"]({thai_bbox_str()});
      way["highway"="secondary"]({thai_bbox_str()});
      way["highway"="secondary_link"]({thai_bbox_str()});
      way["highway"="tertiary"]({thai_bbox_str()});
    );
    out body geom;
    """,
    "waterways": f"""
    [out:json][timeout:{TIMEOUT}];
    (
      way["waterway"="river"]({thai_bbox_str()});
      way["waterway"="stream"]({thai_bbox_str()});
      way["waterway"="canal"]({thai_bbox_str()});
    );
    out body geom;
    """,
    "railways": f"""
    [out:json][timeout:{TIMEOUT}];
    (
      way["railway"="rail"]({thai_bbox_str()});
      way["railway"="light_rail"]({thai_bbox_str()});
      way["railway"="subway"]({thai_bbox_str()});
      way["railway"="monorail"]({thai_bbox_str()});
    );
    out body geom;
    """,
    "buildings": f"""
    [out:json][timeout:{TIMEOUT}];
    (way["building"]({thai_bbox_str()}););
    out body geom;
    """,
    "landuse": f"""
    [out:json][timeout:{TIMEOUT}];
    (
      way["landuse"~"forest|park|residential|commercial|industrial|farmland|grass|recreation_ground|cemetery|retail"]({thai_bbox_str()});
      relation["landuse"~"forest|park|residential|commercial|industrial|farmland|grass|recreation_ground|cemetery|retail"]({thai_bbox_str()});
    );
    out body geom;
    """,
    "natural": f"""
    [out:json][timeout:{TIMEOUT}];
    (
      way["natural"~"water|forest|wood|beach|wetland|grassland|scrub"]({thai_bbox_str()});
      relation["natural"~"water|forest|wood|beach|wetland|grassland|scrub"]({thai_bbox_str()});
    );
    out body geom;
    """,
    "pois": f"""
    [out:json][timeout:{TIMEOUT}];
    (
      node["amenity"~"hospital|school|university|bank|restaurant|temple|police|fire_station|pharmacy|library|marketplace"]({thai_bbox_str()});
      node["tourism"~"hotel|museum|attraction|viewpoint"]({thai_bbox_str()});
    );
    out body;
    """,
    "province": f"""
    [out:json][timeout:{TIMEOUT}];
    rel["boundary"="administrative"]["admin_level"="4"]({thai_bbox_str()});
    out body geom;
    """,
    "amphoe": f"""
    [out:json][timeout:{TIMEOUT}];
    rel["boundary"="administrative"]["admin_level"="6"]({thai_bbox_str()});
    out body geom;
    """,
    "tambon": f"""
    [out:json][timeout:{TIMEOUT}];
    rel["boundary"="administrative"]["admin_level"="8"]({thai_bbox_str()});
    out body geom;
    """,
}


# ─────────────────────────────────────────────
# Overpass fetch
# ─────────────────────────────────────────────

def fetch_overpass(query: str) -> dict:
    for attempt in range(3):
        try:
            resp = requests.post(OVERPASS_URL, data={"data": query},
                                 headers=HEADERS, timeout=TIMEOUT)
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.RequestException as e:
            log.warning(f"Attempt {attempt + 1}/3 failed: {e}")
            if attempt < 2:
                time.sleep(5 * (attempt + 1))
            else:
                raise


# ─────────────────────────────────────────────
# Geometry helpers
# ─────────────────────────────────────────────

def coords_to_geom(coords: list[tuple]) -> LineString | Polygon | None:
    """Build a shapely geometry from coordinate list."""
    if len(coords) < 2:
        return None
    try:
        ls = LineString(coords)
        if not ls.is_valid:
            ls = ls.buffer(0)
        return ls
    except Exception:
        return None


def haversine_length_km(coords: list[tuple]) -> float:
    """Approximate length in km using Haversine formula."""
    if len(coords) < 2:
        return 0.0
    total = 0.0
    for i in range(len(coords) - 1):
        lon1, lat1 = math.radians(coords[i][0]), math.radians(coords[i][1])
        lon2, lat2 = math.radians(coords[i+1][0]), math.radians(coords[i+1][1])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
        total += 2 * 6371 * math.asin(math.sqrt(a))
    return total


# ─────────────────────────────────────────────
# Parse Overpass elements → records (list of dicts with shapely geom)
# ─────────────────────────────────────────────

def parse_osm_elements(data: dict) -> list[dict]:
    """Parse Overpass JSON → list of records with shapely geometry objects."""
    elements = data.get("elements", [])
    records = []

    for el in elements:
        if el["type"] not in ("way", "relation"):
            continue
        try:
            tags = el.get("tags", {})
            geom_list = el.get("geometry", [])
            if not geom_list:
                continue

            coords = [(pt["lon"], pt["lat"]) for pt in geom_list
                      if "lat" in pt and "lon" in pt]
            if len(coords) < 2:
                continue

            geom = coords_to_geom(coords)
            if geom is None or geom.is_empty:
                continue

            rec = {
                "osm_id": el["id"],
                "osm_type": el["type"],
                "name_en": tags.get("name:en"),
                "name_th": tags.get("name"),
                "tags": json.dumps(tags, ensure_ascii=False),
                "geom": geom,
            }
            records.append(rec)
        except Exception:
            continue

    return records


# ─────────────────────────────────────────────
# Processors (operate on records list, add fields)
# ─────────────────────────────────────────────

def process_roads(records: list[dict]) -> list[dict]:
    for rec in records:
        tags = json.loads(rec.get("tags", "{}")) if isinstance(rec.get("tags"), str) else rec.get("tags", {})
        rec["road_class"] = tags.get("highway", "unknown")
        rec["road_ref"] = tags.get("ref", "")
        rec["oneway"] = tags.get("oneway", "no") == "yes"
        rec["surface"] = tags.get("surface", "unknown")
        coords = list(rec["geom"].coords)
        rec["length_km"] = round(haversine_length_km(coords), 3)
        rec.pop("tags", None)
    return records


def process_waterways(records: list[dict]) -> list[dict]:
    for rec in records:
        tags = json.loads(rec.get("tags", "{}")) if isinstance(rec.get("tags"), str) else rec.get("tags", {})
        rec["water_type"] = tags.get("waterway", "unknown")
        try:
            w = tags.get("width", "0")
            rec["width_m"] = float(w.replace("m", ""))
        except Exception:
            rec["width_m"] = 0.0
        coords = list(rec["geom"].coords)
        rec["length_km"] = round(haversine_length_km(coords), 3)
        rec.pop("tags", None)
    return records


def parse_admin_relations(data: dict) -> list[dict]:
    """Parse Overpass relations into polygon records using linemerge + polygonize."""
    records = []
    for el in data.get("elements", []):
        if el["type"] != "relation":
            continue
        tags = el.get("tags", {})

        outer_lines = []
        for member in el.get("members", []):
            if member.get("type") != "way":
                continue
            if member.get("role") not in ("outer", ""):
                continue
            geom_list = member.get("geometry", [])
            coords = [(pt["lon"], pt["lat"]) for pt in geom_list
                      if "lat" in pt and "lon" in pt]
            if len(coords) >= 2:
                outer_lines.append(LineString(coords))

        if not outer_lines:
            continue

        try:
            merged = linemerge(outer_lines)
            polys = list(polygonize(merged))
            if not polys:
                continue
            poly = max(polys, key=lambda p: p.area)
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.is_empty:
                continue
        except Exception:
            continue

        records.append({
            "osm_id": el["id"],
            "osm_type": "relation",
            "name_en": tags.get("name:en"),
            "name_th": tags.get("name"),
            "admin_level": tags.get("admin_level"),
            "ref": tags.get("ref", tags.get("ISO3166-2", "")),
            "geom": poly,
        })

    return records


def process_admin(records: list[dict]) -> list[dict]:
    return records


def process_railways(records: list[dict]) -> list[dict]:
    for rec in records:
        tags = json.loads(rec.get("tags", "{}")) if isinstance(rec.get("tags"), str) else rec.get("tags", {})
        rec["railway_type"] = tags.get("railway", "unknown")
        rec["operator"]     = tags.get("operator", "")
        rec["electrified"]  = tags.get("electrified", "no")
        coords = list(rec["geom"].coords)
        rec["length_km"] = round(haversine_length_km(coords), 3)
        rec.pop("tags", None)
    return records


def process_landuse(records: list[dict]) -> list[dict]:
    for rec in records:
        tags = json.loads(rec.get("tags", "{}")) if isinstance(rec.get("tags"), str) else rec.get("tags", {})
        rec["landuse_type"] = tags.get("landuse", "unknown")
        rec["area_m2"]      = round(rec["geom"].area * 1e10, 0) if rec.get("geom") else 0  # rough degrees→m²
        rec.pop("tags", None)
    return records


def process_natural(records: list[dict]) -> list[dict]:
    for rec in records:
        tags = json.loads(rec.get("tags", "{}")) if isinstance(rec.get("tags"), str) else rec.get("tags", {})
        rec["natural_type"] = tags.get("natural", "unknown")
        rec["area_m2"]      = round(rec["geom"].area * 1e10, 0) if rec.get("geom") else 0
        rec.pop("tags", None)
    return records


def parse_pois(data: dict) -> list[dict]:
    """Parse Overpass node elements → POI records with Point geometry."""
    from shapely.geometry import Point
    records = []
    for el in data.get("elements", []):
        if el["type"] != "node":
            continue
        if "lat" not in el or "lon" not in el:
            continue
        tags = el.get("tags", {})
        records.append({
            "osm_id":    el["id"],
            "osm_type":  "node",
            "name_en":   tags.get("name:en"),
            "name_th":   tags.get("name"),
            "poi_type":  tags.get("amenity") or tags.get("tourism", "unknown"),
            "operator":  tags.get("operator", ""),
            "phone":     tags.get("phone", ""),
            "website":   tags.get("website", ""),
            "geom":      Point(el["lon"], el["lat"]),
        })
    return records


def process_buildings(records: list[dict]) -> list[dict]:
    for rec in records:
        tags = json.loads(rec.get("tags", "{}")) if isinstance(rec.get("tags"), str) else rec.get("tags", {})
        rec["building_type"] = tags.get("building", "other")
        try:
            rec["levels"] = int(tags.get("building:levels", 1))
        except Exception:
            rec["levels"] = 1
        try:
            v = tags.get("height", "0")
            rec["height_m"] = float(v.replace("m", ""))
        except Exception:
            rec["height_m"] = 0.0
        rec.pop("tags", None)
    return records


# ─────────────────────────────────────────────
# Save to GeoJSON
# ─────────────────────────────────────────────

def save_layer(records: list[dict], slug: str) -> int:
    path = DATA_DIR / f"{slug}.geojson"
    if not records:
        log.warning(f"No records for {slug}, skipping save")
        return 0

    features = []
    for rec in records:
        geom = rec.get("geom")
        if geom is None or geom.is_empty:
            continue
        props = {k: v for k, v in rec.items() if k != "geom"}
        features.append({
            "type": "Feature",
            "geometry": mapping(geom),
            "properties": props,
        })

    fc = {"type": "FeatureCollection", "features": features}
    path.write_text(json.dumps(fc, ensure_ascii=False, indent=2), encoding="utf-8")
    count = len(features)
    log.info(f"Saved {count} features → {path}")
    return count


def save_metadata(slug: str, feature_count: int, bbox: tuple | None):
    meta_path = DATA_DIR / f"{slug}_metadata.json"
    existing = {}
    if meta_path.exists():
        try:
            existing = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    existing.update({
        "slug": slug,
        "feature_count": feature_count,
        "bbox": list(bbox) if bbox else None,
        "last_refreshed": datetime.now().isoformat(),
        **LAYER_METADATA.get(slug, {}),
    })
    meta_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")


# ─────────────────────────────────────────────
# Bbox of all geometries
# ─────────────────────────────────────────────

def compute_bbox(records: list[dict]) -> tuple | None:
    if not records:
        return None
    bounds = [r["geom"].bounds for r in records if r.get("geom") and not r["geom"].is_empty]
    if not bounds:
        return None
    return (min(b[0] for b in bounds), min(b[1] for b in bounds),
            max(b[2] for b in bounds), max(b[3] for b in bounds))


# ─────────────────────────────────────────────
# Main fetch pipeline
# ─────────────────────────────────────────────

ADMIN_LAYERS  = {"province", "amphoe", "tambon"}
POI_LAYERS    = {"pois"}
POLYGON_LAYERS = {"landuse", "natural"}  # way or relation, needs polygon reconstruction


def fetch_layer(layer_slug: str) -> bool:
    processor_map = {
        "roads":     process_roads,
        "waterways": process_waterways,
        "railways":  process_railways,
        "buildings": process_buildings,
        "landuse":   process_landuse,
        "natural":   process_natural,
        "pois":      lambda r: r,   # pois already processed in parse_pois
        "province":  process_admin,
        "amphoe":    process_admin,
        "tambon":    process_admin,
    }

    if layer_slug not in processor_map:
        log.error(f"Unknown layer: {layer_slug}")
        return False

    query = OVERPASS_QUERIES.get(layer_slug)
    if not query:
        log.error(f"No query defined for: {layer_slug}")
        return False

    processor = processor_map[layer_slug]

    log.info(f"Fetching OSM data for layer: {layer_slug}")
    log.info(f"Query size: {len(query)} chars")

    try:
        data = fetch_overpass(query)
        log.info(f"Received {len(data.get('elements', []))} elements from Overpass")

        if layer_slug in ADMIN_LAYERS:
            records = parse_admin_relations(data)
        elif layer_slug in POI_LAYERS:
            records = parse_pois(data)
        elif layer_slug in POLYGON_LAYERS:
            # For landuse/natural: ways → polygon, relations → polygon via linemerge
            way_records = parse_osm_elements(data)
            # Convert LineString ways that form closed rings into Polygons
            from shapely.geometry import Polygon
            for rec in way_records:
                geom = rec.get("geom")
                if geom and geom.geom_type == "LineString":
                    coords = list(geom.coords)
                    if len(coords) >= 4 and coords[0] == coords[-1]:
                        try:
                            poly = Polygon(coords)
                            if poly.is_valid and not poly.is_empty:
                                rec["geom"] = poly
                        except Exception:
                            pass
            rel_records = parse_admin_relations(data)  # relations use linemerge
            records = [r for r in way_records if r.get("geom") and r["geom"].geom_type == "Polygon"] + rel_records
        else:
            records = parse_osm_elements(data)

        log.info(f"Parsed {len(records)} valid records")

        if not records:
            log.warning(f"No data parsed for {layer_slug}")
            return False

        processed = processor(records)
        count = save_layer(processed, layer_slug)

        bbox = compute_bbox(processed)
        save_metadata(layer_slug, count, bbox)
        log.info(f"{layer_slug} complete — {count} features saved")
        return True

    except Exception as e:
        log.error(f"Failed to fetch {layer_slug}: {e}")
        import traceback
        traceback.print_exc()
        return False


ALL_LAYERS = ["roads", "waterways", "railways", "buildings", "landuse", "natural",
              "pois", "province", "amphoe", "tambon"]

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Thai GeoData Hub — OSM Fetcher")
    parser.add_argument("--layer", choices=ALL_LAYERS + ["all"], required=True)
    parser.add_argument("--ensure-schema", action="store_true", help="No-op for file-based mode")
    args = parser.parse_args()

    if args.layer == "all":
        for layer in ALL_LAYERS:
            success = fetch_layer(layer)
            log.info(f"{layer}: {'OK' if success else 'FAILED'}")
            time.sleep(5)
    else:
        success = fetch_layer(args.layer)
        if not success:
            sys.exit(1)
