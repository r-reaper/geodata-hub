"""
Thai GeoData Hub — Attribution & License manifest builder

Builds the ATTRIBUTION.txt / LICENSE.txt / README.txt files that get embedded
in every download ZIP. Per-source attribution + license boilerplate.

Add an entry to LAYER_SOURCES whenever a new data source is integrated.
"""

from datetime import datetime
from typing import Iterable

# ─────────────────────────────────────────────
# Per-layer source map
# ─────────────────────────────────────────────
# Each layer slug → source metadata. When a download includes that layer, the
# corresponding source's attribution + license text is bundled in the ZIP.

LAYER_SOURCES = {
    # OSM-derived layers (currently all 12 baseline layers)
    "province":  "osm",
    "amphoe":    "osm",
    "tambon":    "osm",
    "roads":     "osm",
    "waterways": "osm",
    "railways":  "osm",
    "buildings": "osm",
    "landuse":   "osm",
    "natural":   "osm",
    "parks":     "osm",
    "temples":   "osm",
    "pois":      "osm",

    # Additional sources (added later)
    "ms_buildings":      "microsoft",
    "google_buildings":  "google",
    "worldpop":          "worldpop",
}

SOURCES = {
    "osm": {
        "name":        "OpenStreetMap",
        "url":         "https://www.openstreetmap.org",
        "license":     "Open Database License (ODbL) v1.0",
        "license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
        "attribution": "© OpenStreetMap contributors",
        "notes": (
            "Data extracted via the Overpass API. Under ODbL you must:\n"
            "  • Attribute OpenStreetMap contributors in any product using this data\n"
            "  • Share-Alike: any database derived from this data and publicly\n"
            "    distributed must also be licensed under ODbL\n"
            "  • Keep the database open: don't apply DRM / technical restrictions"
        ),
    },
    "microsoft": {
        "name":        "Microsoft Building Footprints",
        "url":         "https://github.com/microsoft/GlobalMLBuildingFootprints",
        "license":     "Open Database License (ODbL) v1.0",
        "license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
        "attribution": "Building footprints © Microsoft",
        "notes": (
            "Microsoft AI-generated building footprints for Thailand.\n"
            "Same ODbL terms as OSM data above."
        ),
    },
    "google": {
        "name":        "Google Open Buildings",
        "url":         "https://sites.research.google/open-buildings/",
        "license":     "Creative Commons Attribution 4.0 International (CC BY 4.0)",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "attribution": "Building footprints © Google",
        "notes": (
            "Google AI-generated building footprints. Under CC BY 4.0 you must:\n"
            "  • Give credit to Google\n"
            "  • Indicate if changes were made (e.g. clipping to AOI)\n"
            "  • You CAN use this commercially"
        ),
    },
    "worldpop": {
        "name":        "WorldPop",
        "url":         "https://www.worldpop.org/",
        "license":     "Creative Commons Attribution 4.0 International (CC BY 4.0)",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "attribution": "Population data © WorldPop, University of Southampton",
        "notes": (
            "WorldPop population estimates. Under CC BY 4.0 you must:\n"
            "  • Give credit to WorldPop and University of Southampton\n"
            "  • Cite the WorldPop dataset in publications\n"
            "  • You CAN use this commercially"
        ),
    },
}


# ─────────────────────────────────────────────
# Builders
# ─────────────────────────────────────────────

def _used_sources(layer_slugs: Iterable[str]) -> list[str]:
    """Return ordered, deduplicated list of source keys used by these layers."""
    seen: list[str] = []
    for slug in layer_slugs:
        src = LAYER_SOURCES.get(slug)
        if src and src not in seen:
            seen.append(src)
    return seen


def build_attribution_text(layer_slugs: Iterable[str]) -> str:
    """Short attribution file — one line per source, suitable for credits."""
    sources = _used_sources(layer_slugs)
    if not sources:
        return "No attribution required (source unknown).\n"
    lines = [
        "ATTRIBUTIONS — Thai GeoData Hub",
        "================================",
        "",
        "When using this data, you MUST credit the original sources.",
        "Copy the lines below into your map's credits, app's About page,",
        "or report's data section.",
        "",
    ]
    for src in sources:
        s = SOURCES[src]
        lines.append(f"{s['attribution']}")
        lines.append(f"  License: {s['license']} ({s['license_url']})")
        lines.append(f"  Source:  {s['url']}")
        lines.append("")
    lines.append("Thai GeoData Hub processing: clip to user-defined AOI, format conversion.")
    lines.append("")
    return "\n".join(lines)


def build_license_text(layer_slugs: Iterable[str]) -> str:
    """Full license terms file — the legally important one."""
    sources = _used_sources(layer_slugs)
    lines = [
        "LICENSE — Thai GeoData Hub Download",
        "====================================",
        "",
        "This download contains data from one or more of the following",
        "sources, each with its own license terms. You must comply with",
        "ALL applicable licenses below.",
        "",
        "-" * 60,
    ]
    for src in sources:
        s = SOURCES[src]
        lines.extend([
            "",
            f"## {s['name']}",
            f"License:    {s['license']}",
            f"License URL: {s['license_url']}",
            f"Source URL: {s['url']}",
            f"Attribution required: {s['attribution']}",
            "",
            s["notes"],
            "",
            "-" * 60,
        ])

    lines.extend([
        "",
        "## Thai GeoData Hub processing",
        "",
        "The geometric clipping (intersection with your area of interest)",
        "and format conversion (SHP / GeoJSON / KML) performed by Thai",
        "GeoData Hub does not change the underlying data licenses.",
        "Original source licenses apply to all features in this archive.",
        "",
        "Disclaimer: Data is provided AS-IS without warranty. Thai GeoData Hub",
        "is not liable for accuracy, completeness, or fitness for any purpose.",
        "Verify data against authoritative sources before use in critical",
        "applications (legal, safety, planning, navigation, etc.).",
        "",
        f"Download generated: {datetime.utcnow().isoformat()}Z",
        "",
    ])
    return "\n".join(lines)


def build_readme_text(layer_slugs: Iterable[str], formats: Iterable[str], total_features: int) -> str:
    """Friendly README explaining what's in the ZIP."""
    sources = _used_sources(layer_slugs)
    src_names = ", ".join(SOURCES[s]["name"] for s in sources) or "Unknown"
    fmt_list = ", ".join(formats)

    lines = [
        "README — Thai GeoData Hub Download",
        "===================================",
        "",
        f"Layers included:    {', '.join(layer_slugs)}",
        f"Formats:            {fmt_list}",
        f"Total features:     {total_features:,}",
        f"Data sources:       {src_names}",
        "",
        "Files in this archive:",
        "",
    ]
    for slug in layer_slugs:
        for fmt in formats:
            if fmt == "shp":
                lines.append(f"  {slug}.shp / .shx / .dbf / .prj  → ESRI Shapefile (use in QGIS, ArcGIS, etc.)")
            elif fmt == "geojson":
                lines.append(f"  {slug}.geojson                  → GeoJSON (web maps, JS libs, leaflet)")
            elif fmt == "kml":
                lines.append(f"  {slug}.kml                      → KML (Google Earth, Google Maps)")
    lines.extend([
        "",
        "  ATTRIBUTION.txt    → REQUIRED credits (copy into your product)",
        "  LICENSE.txt        → Full legal terms — read this before redistributing",
        "  README.txt         → This file",
        "",
        "All geometries are in EPSG:4326 (WGS 84 lon/lat).",
        "",
        "Questions? Visit https://geodata-hub.vercel.app/attributions",
        "",
    ])
    return "\n".join(lines)
