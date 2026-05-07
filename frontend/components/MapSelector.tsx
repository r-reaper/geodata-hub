// Thai GeoData Hub — MapSelector v5
// Clean, simple, step-by-step UX. No accordions, no clutter.

"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface AOIFeature extends GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> {}

interface LayerInfo {
  slug: string;
  name_en: string;
  name_th: string;
  geom_type: string;
  feature_count: number;
  status?: string;
}

interface PreviewResult {
  feature_count: number;
  estimated_mb_geojson?: number;
  error?: string;
}

interface SearchResult {
  name_en: string;
  name_th: string;
  lng: number;
  lat: number;
  bbox?: number[];
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

const LAYERS: LayerInfo[] = [
  { slug: "province",  name_en: "Provinces",      name_th: "จังหวัด",          geom_type: "Polygon",    feature_count: 0 },
  { slug: "amphoe",    name_en: "Districts",      name_th: "อำเภอ",            geom_type: "Polygon",    feature_count: 0 },
  { slug: "tambon",    name_en: "Sub-districts",  name_th: "ตำบล",             geom_type: "Polygon",    feature_count: 0 },
  { slug: "roads",     name_en: "Roads",          name_th: "ถนน",              geom_type: "Linestring", feature_count: 0 },
  { slug: "waterways", name_en: "Waterways",      name_th: "แหล่งน้ำ",         geom_type: "Linestring", feature_count: 0 },
  { slug: "railways",  name_en: "Railways",       name_th: "ทางรถไฟ",          geom_type: "Linestring", feature_count: 0 },
  { slug: "buildings", name_en: "Buildings",      name_th: "อาคาร",            geom_type: "Polygon",    feature_count: 0 },
  { slug: "landuse",   name_en: "Land Use",       name_th: "การใช้ที่ดิน",     geom_type: "Polygon",    feature_count: 0 },
  { slug: "natural",   name_en: "Natural",        name_th: "ธรรมชาติ",         geom_type: "Polygon",    feature_count: 0 },
  { slug: "parks",     name_en: "National Parks", name_th: "อุทยาน",           geom_type: "Polygon",    feature_count: 0 },
  { slug: "temples",   name_en: "Temples",        name_th: "วัด",              geom_type: "Point",      feature_count: 0 },
  { slug: "pois",      name_en: "POIs",           name_th: "สถานที่สำคัญ",     geom_type: "Point",      feature_count: 0 },
];

const LAYER_COLORS: Record<string, string> = {
  province:  "#8B5CF6", amphoe:    "#3B82F6", tambon:    "#06B6D4",
  roads:     "#EF4444", waterways: "#0EA5E9", railways:  "#7C3AED",
  buildings: "#F97316", landuse:   "#22C55E", natural:   "#14B8A6",
  parks:     "#16A34A", temples:   "#EAB308", pois:      "#EC4899",
};

const QUICK_LOCATIONS = [
  { name: "Bangkok", lng: 100.5018, lat: 13.7563, zoom: 11 },
  { name: "Chiang Mai", lng: 98.9818, lat: 18.7883, zoom: 11 },
  { name: "Phuket", lng: 98.3929, lat: 7.8804, zoom: 11 },
  { name: "Pattaya", lng: 100.8870, lat: 12.9276, zoom: 12 },
];

// ─────────────────────────────────────────────
// AOI file parser (KML / GeoJSON)
// ─────────────────────────────────────────────

function parseAOIFile(text: string, filename: string): AOIFeature | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  try {
    if (ext === "geojson" || ext === "json") {
      const data = JSON.parse(text);
      const feat = data.type === "FeatureCollection" ? data.features?.[0] : data;
      if (!feat?.geometry) return null;
      const g = feat.geometry;
      if (g.type !== "Polygon" && g.type !== "MultiPolygon") return null;
      return { type: "Feature", geometry: g, properties: {} };
    }
    if (ext === "kml") {
      const doc = new DOMParser().parseFromString(text, "text/xml");
      const coordsEl = doc.querySelector("Polygon coordinates");
      if (!coordsEl?.textContent) return null;
      const pts: number[][] = coordsEl.textContent.trim().split(/\s+/).map((p) => {
        const [lon, lat] = p.split(",").map(Number);
        return [lon, lat];
      }).filter((p) => !isNaN(p[0]) && !isNaN(p[1]));
      if (pts.length < 3) return null;
      return { type: "Feature", geometry: { type: "Polygon", coordinates: [pts] }, properties: {} };
    }
  } catch {}
  return null;
}

function approxAreaKm2(feature: AOIFeature): number {
  // Quick approximation using shoelace formula on lng/lat — fine for AOI display
  const coords = feature.geometry.type === "Polygon"
    ? feature.geometry.coordinates[0]
    : feature.geometry.coordinates[0][0];
  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    area += (coords[i + 1][0] - coords[i][0]) * (coords[i + 1][1] + coords[i][1]);
  }
  // 1 deg² ≈ 12,300 km² near equator (rough)
  return Math.abs(area / 2) * 12300;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function MapSelector() {
  // ── Refs
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const startDrawingRef = useRef<() => void>(() => {});
  const cancelDrawingRef = useRef<() => void>(() => {});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const visibleLayersRef = useRef<Set<string>>(new Set());

  // ── State
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [aoi, setAoi] = useState<AOIFeature | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [selectedLayers, setSelectedLayers] = useState<Set<string>>(new Set());
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(new Set());
  const [layers, setLayers] = useState<LayerInfo[]>(LAYERS);
  const [preview, setPreview] = useState<Record<string, PreviewResult> | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingDownload, setLoadingDownload] = useState(false);
  const [loadingLayer, setLoadingLayer] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [toast, setToast] = useState<{ msg: string; type: "info" | "success" | "error" } | null>(null);
  const [formats, setFormats] = useState<Set<string>>(new Set(["geojson"]));

  // ── Toast
  const showToast = useCallback((msg: string, type: "info" | "success" | "error" = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ─────────────────────────────────────────────
  // API health + layer metadata fetch
  // ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(20000) });
          if (cancelled) return;
          if (r.ok) { setApiOk(true); return; }
        } catch {}
        if (i < 2) await new Promise((r) => setTimeout(r, 5000));
      }
      if (!cancelled) {
        setApiOk(false);
        showToast("Backend is waking up — refresh in 30 s if layers don't load", "error");
      }
    })();
    return () => { cancelled = true; };
  }, [showToast]);

  // Fetch layer counts
  useEffect(() => {
    if (apiOk !== true) return;
    fetch(`${API_BASE}/layers`)
      .then((r) => r.json())
      .then((data: LayerInfo[]) => {
        const merged = LAYERS.map((l) => {
          const live = data.find((d) => d.slug === l.slug);
          return live ? { ...l, feature_count: live.feature_count, status: live.status } : l;
        });
        setLayers(merged);
      })
      .catch(() => {});
  }, [apiOk]);

  // ─────────────────────────────────────────────
  // Map init
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    if (!MAPBOX_TOKEN) { setMapReady(false); return; }

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [100.9925, 15.87],
      zoom: 5.8,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(new mapboxgl.ScaleControl(), "bottom-left");

    // ── Surface Mapbox errors (token restrictions, network issues, etc.)
    map.on("error", (e: any) => {
      const err = e?.error;
      const status = err?.status;
      const msg = err?.message || "Unknown Mapbox error";
      // 401/403: token issue (expired, invalid, or URL-restricted)
      if (status === 401 || status === 403 || /forbidden|unauthorized|access token/i.test(msg)) {
        setMapError(`Mapbox token rejected (${status || "auth"}): ${msg}. The token is likely URL-restricted — add ${window.location.origin} to allowed URLs in Mapbox account settings, OR remove URL restrictions on the token.`);
      } else if (!mapReady) {
        // Errors before initial load are usually fatal
        setMapError(`Map failed to load: ${msg}`);
      }
      // eslint-disable-next-line no-console
      console.error("[Mapbox]", e);
    });

    // ── Force resize on container/window changes (defends against flex-layout race)
    const resize = () => map.resize();
    const ro = new ResizeObserver(resize);
    if (mapContainer.current) ro.observe(mapContainer.current);
    window.addEventListener("resize", resize);
    setTimeout(resize, 100);

    // ── Drawing state
    const drawing = {
      active: false,
      points: [] as [number, number][],
      markers: [] as mapboxgl.Marker[],
      onClick: null as ((e: mapboxgl.MapMouseEvent) => void) | null,
      onDbl: null as ((e: mapboxgl.MapMouseEvent) => void) | null,
      onKey: null as ((e: KeyboardEvent) => void) | null,
    };

    const cleanup = () => {
      drawing.active = false;
      map.getCanvas().style.cursor = "";
      if (drawing.onClick) map.off("click", drawing.onClick);
      if (drawing.onDbl) map.off("dblclick", drawing.onDbl);
      if (drawing.onKey) document.removeEventListener("keydown", drawing.onKey);
      drawing.onClick = null; drawing.onDbl = null; drawing.onKey = null;
      if (map.getLayer("draw-line")) map.removeLayer("draw-line");
      if (map.getSource("draw-line")) map.removeSource("draw-line");
      drawing.markers.forEach((m) => m.remove());
      drawing.markers = [];
      drawing.points = [];
    };

    const start = () => {
      if (!map.isStyleLoaded()) return;
      cleanup();
      drawing.active = true;
      setIsDrawing(true);
      map.getCanvas().style.cursor = "crosshair";

      drawing.onClick = (e: mapboxgl.MapMouseEvent) => {
        const ll: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        drawing.points.push(ll);
        const el = document.createElement("div");
        el.style.cssText = "width:10px;height:10px;background:#2563EB;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);";
        drawing.markers.push(new mapboxgl.Marker({ element: el }).setLngLat(ll).addTo(map));

        const data: GeoJSON.Feature = { type: "Feature", geometry: { type: "LineString", coordinates: drawing.points }, properties: {} };
        if (map.getSource("draw-line")) (map.getSource("draw-line") as mapboxgl.GeoJSONSource).setData(data);
        else if (drawing.points.length >= 2) {
          map.addSource("draw-line", { type: "geojson", data });
          map.addLayer({ id: "draw-line", type: "line", source: "draw-line", paint: { "line-color": "#2563EB", "line-width": 2.5, "line-dasharray": [3, 2] } });
        }
      };

      drawing.onDbl = (e: mapboxgl.MapMouseEvent) => {
        e.preventDefault();
        if (drawing.points.length < 3) {
          showToast("Click at least 3 points to draw a polygon", "info");
          return;
        }
        const coords = [...drawing.points, drawing.points[0]];
        const feat: AOIFeature = { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} };
        setAoi(feat);
        const src = map.getSource("aoi") as mapboxgl.GeoJSONSource | undefined;
        src?.setData({ type: "FeatureCollection", features: [feat] });
        cleanup();
        setIsDrawing(false);
        showToast("Area defined — now select layers", "success");
      };

      drawing.onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") { cleanup(); setIsDrawing(false); showToast("Drawing cancelled", "info"); }
      };

      map.on("click", drawing.onClick);
      map.on("dblclick", drawing.onDbl);
      document.addEventListener("keydown", drawing.onKey);
    };

    const cancel = () => { cleanup(); setIsDrawing(false); };

    startDrawingRef.current = start;
    cancelDrawingRef.current = cancel;

    map.on("load", () => {
      map.addSource("aoi", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "aoi-fill", type: "fill", source: "aoi", paint: { "fill-color": "#2563EB", "fill-opacity": 0.12 } });
      map.addLayer({ id: "aoi-line", type: "line", source: "aoi", paint: { "line-color": "#2563EB", "line-width": 2.5, "line-dasharray": [4, 2] } });
      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─────────────────────────────────────────────
  // Layer preview on map (toggle visibility)
  // ─────────────────────────────────────────────
  const showLayerOnMap = useCallback(async (slug: string) => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (visibleLayersRef.current.has(slug)) return;

    setLoadingLayer(slug);
    try {
      const b = map.getBounds();
      const bbox = b ? `bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}&` : "";
      const r = await fetch(`${API_BASE}/layer-sample/${slug}?${bbox}limit=300`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) {
        const err = await r.json().catch(() => ({})).then((d: any) => d.detail || `HTTP ${r.status}`);
        throw new Error(err);
      }
      const fc = await r.json();
      if (!fc.features?.length) { showToast(`${slug}: no features in current map view — zoom out`, "info"); return; }

      const sourceId = `prv-${slug}`;
      const layerId = `prv-${slug}-layer`;
      const color = LAYER_COLORS[slug] || "#888";
      const gt = LAYERS.find((l) => l.slug === slug)?.geom_type.toLowerCase();

      if (!map.getSource(sourceId)) map.addSource(sourceId, { type: "geojson", data: fc });
      else (map.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(fc);

      if (!map.getLayer(layerId)) {
        if (gt === "point") map.addLayer({ id: layerId, type: "circle", source: sourceId, paint: { "circle-radius": 5, "circle-color": color, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
        else if (gt === "polygon") map.addLayer({ id: layerId, type: "fill", source: sourceId, paint: { "fill-color": color, "fill-opacity": 0.35, "fill-outline-color": color } });
        else map.addLayer({ id: layerId, type: "line", source: sourceId, paint: { "line-color": color, "line-width": 2 } });
      }
      visibleLayersRef.current.add(slug);
      setVisibleLayers(new Set(visibleLayersRef.current));
    } catch (e: any) {
      showToast(`Failed to load ${slug}: ${e.message || e}`, "error");
    } finally {
      setLoadingLayer(null);
    }
  }, [mapReady, showToast]);

  const hideLayerFromMap = useCallback((slug: string) => {
    const map = mapRef.current;
    if (!map) return;
    const sourceId = `prv-${slug}`;
    const layerId = `prv-${slug}-layer`;
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    visibleLayersRef.current.delete(slug);
    setVisibleLayers(new Set(visibleLayersRef.current));
  }, []);

  // ─────────────────────────────────────────────
  // AOI handlers
  // ─────────────────────────────────────────────
  const startDraw = () => { startDrawingRef.current(); };
  const cancelDraw = () => { cancelDrawingRef.current(); };
  const clearAoi = () => {
    setAoi(null);
    setPreview(null);
    const src = mapRef.current?.getSource("aoi") as mapboxgl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: [] });
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const feat = parseAOIFile(text, file.name);
    if (!feat) {
      showToast("Could not parse AOI from file. Use GeoJSON Polygon or KML.", "error");
      return;
    }
    setAoi(feat);
    const src = mapRef.current?.getSource("aoi") as mapboxgl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: [feat] });
    // Zoom to AOI
    const coords = feat.geometry.type === "Polygon" ? feat.geometry.coordinates[0] : feat.geometry.coordinates[0][0];
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    mapRef.current?.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 60 });
    showToast(`Loaded AOI from ${file.name}`, "success");
    e.target.value = "";
  };

  // ─────────────────────────────────────────────
  // Search
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${API_BASE}/search-location?q=${encodeURIComponent(searchQuery)}`);
        const d = await r.json();
        setSearchResults(d.results || []);
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const flyToLocation = (lng: number, lat: number, zoom: number = 11, bbox?: number[]) => {
    const map = mapRef.current;
    if (!map) return;
    if (bbox && bbox.length === 4) {
      map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 60 });
    } else {
      map.flyTo({ center: [lng, lat], zoom });
    }
    setSearchResults([]);
    setSearchQuery("");
  };

  // ─────────────────────────────────────────────
  // Layer selection toggle
  // ─────────────────────────────────────────────
  const toggleLayerSelected = (slug: string) => {
    setSelectedLayers((prev) => {
      const n = new Set(prev);
      if (n.has(slug)) n.delete(slug); else n.add(slug);
      return n;
    });
    setPreview(null);
  };

  const toggleLayerVisible = (slug: string) => {
    if (visibleLayersRef.current.has(slug)) hideLayerFromMap(slug);
    else showLayerOnMap(slug);
  };

  const toggleFormat = (fmt: string) => {
    setFormats((prev) => {
      const n = new Set(prev);
      if (n.has(fmt)) n.delete(fmt); else n.add(fmt);
      if (n.size === 0) n.add("geojson");
      return n;
    });
  };

  // ─────────────────────────────────────────────
  // Preview & download
  // ─────────────────────────────────────────────
  const runPreview = async () => {
    if (!aoi || selectedLayers.size === 0) return;
    setLoadingPreview(true);
    try {
      const r = await fetch(`${API_BASE}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aoi, layers: Array.from(selectedLayers), formats: ["geojson"] }),
      });
      if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
      const data = await r.json();
      setPreview(data.layers);
    } catch (e: any) {
      showToast(`Preview failed: ${e.message || e}`, "error");
    } finally {
      setLoadingPreview(false);
    }
  };

  const runDownload = async () => {
    if (!aoi || selectedLayers.size === 0) return;
    setLoadingDownload(true);
    try {
      const r = await fetch(`${API_BASE}/clip-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aoi, layers: Array.from(selectedLayers), formats: Array.from(formats) }),
      });
      if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
      const data = await r.json();
      if (data.presigned_url) {
        window.open(data.presigned_url, "_blank");
        showToast(`Downloading ${data.filename}`, "success");
      } else {
        window.open(`${API_BASE}/download/${data.download_id}`, "_blank");
      }
    } catch (e: any) {
      showToast(`Download failed: ${e.message || e}`, "error");
    } finally {
      setLoadingDownload(false);
    }
  };

  // ─────────────────────────────────────────────
  // Derived values
  // ─────────────────────────────────────────────
  const aoiAreaKm2 = aoi ? approxAreaKm2(aoi) : 0;
  const totalPreviewFeatures = preview
    ? Object.values(preview).reduce((sum, p) => sum + (p.feature_count || 0), 0)
    : 0;
  const canDownload = aoi && selectedLayers.size > 0 && formats.size > 0 && !loadingDownload;

  // ─────────────────────────────────────────────
  // Render — Mapbox token missing
  // ─────────────────────────────────────────────
  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 p-8">
        <div className="max-w-md bg-white rounded-xl shadow-lg p-8 border border-red-200">
          <div className="text-3xl mb-3">🗺️</div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Map cannot load</h2>
          <p className="text-slate-600 mb-4 text-sm">
            <code className="bg-slate-100 px-1.5 py-0.5 rounded text-red-600 text-xs">NEXT_PUBLIC_MAPBOX_TOKEN</code> is not set.
          </p>
          <ol className="text-sm text-slate-700 space-y-2 list-decimal list-inside">
            <li>Open Vercel → your project → Settings → Environment Variables</li>
            <li>Add <code className="bg-slate-100 px-1 rounded text-xs">NEXT_PUBLIC_MAPBOX_TOKEN</code> with your <code className="text-xs">pk....</code> token</li>
            <li>Redeploy</li>
          </ol>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // Render — main UI
  // ─────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Top bar */}
      <header className="h-14 bg-white border-b border-slate-200 px-5 flex items-center justify-between shadow-sm z-20">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🇹🇭</span>
          <div>
            <h1 className="font-bold text-slate-900 leading-tight">Thai GeoData Hub</h1>
            <p className="text-xs text-slate-500 leading-tight">Free OSM downloads · Pay only for large extracts</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {apiOk === false && (
            <span className="px-2 py-1 rounded-md bg-red-50 text-red-700 text-xs font-medium border border-red-200">
              Backend unreachable
            </span>
          )}
          {apiOk === true && (
            <span className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200">
              ● Online
            </span>
          )}
          <a href="/credits" className="text-slate-600 hover:text-slate-900 font-medium">
            Credits
          </a>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* ── Side panel ── */}
        <aside className="w-[360px] bg-white border-r border-slate-200 overflow-y-auto flex flex-col">
          {/* STEP 1 — Search / navigate */}
          <Section step={1} title="Find your area" done={!!aoi}>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Bangkok, Phuket, Chiang Mai…"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {searchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-60 overflow-y-auto z-10">
                  {searchResults.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => flyToLocation(r.lng, r.lat, 11, r.bbox)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b last:border-0 border-slate-100"
                    >
                      <div className="font-medium text-sm text-slate-900">{r.name_en}</div>
                      <div className="text-xs text-slate-500">{r.name_th}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_LOCATIONS.map((q) => (
                <button
                  key={q.name}
                  onClick={() => flyToLocation(q.lng, q.lat, q.zoom)}
                  className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700"
                >
                  {q.name}
                </button>
              ))}
            </div>
          </Section>

          {/* STEP 2 — Define AOI */}
          <Section step={2} title="Define area of interest" done={!!aoi} disabled={!mapReady}>
            {!aoi ? (
              <div className="space-y-2">
                {!isDrawing ? (
                  <>
                    <button
                      onClick={startDraw}
                      disabled={!mapReady}
                      className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-md font-medium text-sm flex items-center justify-center gap-2"
                    >
                      ✏️ Draw on map
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-2 px-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md font-medium text-sm flex items-center justify-center gap-2"
                    >
                      📁 Upload GeoJSON or KML
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".geojson,.json,.kml"
                      onChange={handleFile}
                      className="hidden"
                    />
                  </>
                ) : (
                  <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                    <p className="text-xs text-blue-900 font-medium mb-1">Drawing mode</p>
                    <p className="text-xs text-blue-800 mb-2">Click points on the map. Double-click to finish, or press Esc to cancel.</p>
                    <button
                      onClick={cancelDraw}
                      className="w-full py-1.5 px-3 bg-white border border-blue-300 hover:bg-blue-50 text-blue-700 rounded-md text-xs font-medium"
                    >
                      Cancel drawing
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-sm font-medium text-emerald-900">✓ Area defined</span>
                </div>
                <p className="text-xs text-emerald-800 mb-2">Approx. {aoiAreaKm2.toFixed(1)} km²</p>
                <button
                  onClick={clearAoi}
                  className="w-full py-1.5 px-3 bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-700 rounded-md text-xs font-medium"
                >
                  Clear & redraw
                </button>
              </div>
            )}
          </Section>

          {/* STEP 3 — Pick layers */}
          <Section
            step={3}
            title="Pick data layers"
            done={selectedLayers.size > 0}
            disabled={!aoi}
            hint={!aoi ? "Define an area first" : `${selectedLayers.size} selected`}
          >
            <div className="space-y-1">
              {layers.map((l) => {
                const sel = selectedLayers.has(l.slug);
                const vis = visibleLayers.has(l.slug);
                const loading = loadingLayer === l.slug;
                const color = LAYER_COLORS[l.slug];
                return (
                  <div
                    key={l.slug}
                    className={`flex items-center gap-2 p-2 rounded-md border ${sel ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                  >
                    <input
                      type="checkbox"
                      checked={sel}
                      onChange={() => aoi && toggleLayerSelected(l.slug)}
                      disabled={!aoi}
                      className="w-4 h-4 cursor-pointer"
                    />
                    <LayerSymbol geomType={l.geom_type} color={color} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-900 leading-tight truncate">{l.name_en}</div>
                      <div className="text-[11px] text-slate-500 leading-tight">{l.feature_count.toLocaleString()} features</div>
                    </div>
                    <button
                      onClick={() => toggleLayerVisible(l.slug)}
                      disabled={loading || !mapReady}
                      title={vis ? "Hide on map" : "Show on map"}
                      className={`w-7 h-7 rounded text-xs flex items-center justify-center ${vis ? "bg-slate-800 text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-600"}`}
                    >
                      {loading ? "…" : (vis ? "👁" : "👁︎")}
                    </button>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* STEP 4 — Format & download */}
          <Section
            step={4}
            title="Format & download"
            disabled={!aoi || selectedLayers.size === 0}
          >
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-slate-700 mb-1.5">Export formats</p>
                <div className="flex gap-1.5">
                  {[
                    { v: "geojson", label: "GeoJSON" },
                    { v: "shp", label: "Shapefile" },
                    { v: "kml", label: "KML" },
                  ].map(({ v, label }) => (
                    <button
                      key={v}
                      onClick={() => toggleFormat(v)}
                      className={`flex-1 py-1.5 px-2 text-xs rounded-md font-medium border ${formats.has(v) ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={runPreview}
                disabled={!aoi || selectedLayers.size === 0 || loadingPreview}
                className="w-full py-2 px-3 text-sm rounded-md font-medium bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700"
              >
                {loadingPreview ? "Counting…" : "Preview feature count"}
              </button>

              {preview && (
                <div className="bg-slate-50 border border-slate-200 rounded-md p-2.5">
                  <p className="text-xs font-medium text-slate-700 mb-1">
                    Total: {totalPreviewFeatures.toLocaleString()} features
                  </p>
                  <div className="space-y-0.5 text-xs text-slate-600">
                    {Object.entries(preview).map(([slug, p]) => (
                      <div key={slug} className="flex justify-between">
                        <span>{LAYERS.find((l) => l.slug === slug)?.name_en || slug}</span>
                        <span className="font-mono">{p.error ? <span className="text-red-600">err</span> : p.feature_count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={runDownload}
                disabled={!canDownload}
                className="w-full py-3 px-3 text-sm rounded-md font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white shadow-sm"
              >
                {loadingDownload ? "Preparing ZIP…" : "⬇ Download ZIP"}
              </button>
              <p className="text-[11px] text-slate-500 text-center">
                Free for areas under 5 MB · No login required
              </p>
            </div>
          </Section>
        </aside>

        {/* ── Map ── */}
        <main className="flex-1 relative">
          <div ref={mapContainer} className="absolute inset-0" />
          {!mapReady && !mapError && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-100/80 backdrop-blur-sm z-10">
              <div className="text-center">
                <div className="text-4xl animate-pulse">🌏</div>
                <p className="text-sm text-slate-600 mt-2">Loading map…</p>
              </div>
            </div>
          )}

          {mapError && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/95 z-10 p-6">
              <div className="max-w-lg bg-red-50 border border-red-200 rounded-xl p-6 shadow-lg">
                <div className="text-3xl mb-2">⚠️</div>
                <h3 className="font-bold text-red-900 mb-2">Map failed to load</h3>
                <p className="text-sm text-red-800 mb-4 break-words">{mapError}</p>
                <details className="text-xs text-red-700">
                  <summary className="cursor-pointer font-medium mb-1">How to fix</summary>
                  <ol className="list-decimal list-inside space-y-1 mt-2 text-slate-700">
                    <li>Open <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noopener noreferrer" className="underline text-blue-600">account.mapbox.com/access-tokens</a></li>
                    <li>Click your token (the <code>pk.…</code> one)</li>
                    <li>Either remove all URL restrictions, OR add <code className="bg-white px-1 rounded">{typeof window !== "undefined" ? window.location.origin : "your-domain"}</code> to allowed URLs</li>
                    <li>Save and refresh this page</li>
                  </ol>
                </details>
              </div>
            </div>
          )}

          {/* Floating tip when no AOI */}
          {mapReady && !aoi && !isDrawing && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white rounded-full shadow-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 flex items-center gap-2">
              <span className="text-blue-600">▸</span>
              Click <span className="font-medium">"Draw on map"</span> to define your area
            </div>
          )}
          {isDrawing && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-blue-600 rounded-full shadow-lg px-4 py-2 text-sm text-white flex items-center gap-2 font-medium">
              <span className="animate-pulse">●</span>
              Click points · Double-click to finish · Esc to cancel
            </div>
          )}
        </main>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 max-w-sm rounded-lg shadow-lg px-4 py-3 text-sm border ${
          toast.type === "error" ? "bg-red-50 text-red-900 border-red-200" :
          toast.type === "success" ? "bg-emerald-50 text-emerald-900 border-emerald-200" :
          "bg-slate-800 text-white border-slate-700"
        } z-50`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function Section({
  step, title, done = false, disabled = false, hint, children,
}: {
  step: number;
  title: string;
  done?: boolean;
  disabled?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`p-4 border-b border-slate-200 ${disabled ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${done ? "bg-emerald-500 text-white" : disabled ? "bg-slate-200 text-slate-500" : "bg-blue-600 text-white"}`}>
          {done ? "✓" : step}
        </span>
        <h3 className="font-semibold text-sm text-slate-900 flex-1">{title}</h3>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function LayerSymbol({ geomType, color }: { geomType: string; color: string }) {
  const t = geomType.toLowerCase();
  if (t === "point") return <span className="inline-block w-3 h-3 rounded-full" style={{ background: color, border: "1.5px solid #fff", boxShadow: "0 0 0 1px " + color }} />;
  if (t === "polygon") return <span className="inline-block w-3 h-3" style={{ background: color, opacity: 0.6, border: "1.5px solid " + color }} />;
  return <span className="inline-block w-4 h-0.5" style={{ background: color }} />;
}
