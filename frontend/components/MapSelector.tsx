// Thai GeoData Hub — MapSelector v4
// Professional QGIS-inspired layout
// Features: layer map preview, AOI draw + file upload, download history, credits

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
  estimated_mb_shp?: number;
  estimated_mb_geojson?: number;
  error?: string;
}

interface ClipResult {
  download_id: string;
  presigned_url?: string;
  filename: string;
  size_mb: number;
  total_features: number;
  layers_included: string[];
  formats_included: string[];
  credits_used?: number;
}

interface DownloadRecord {
  download_id: string;
  filename: string;
  layers: string[];
  formats: string[];
  size_mb: number;
  total_features: number;
  credits_used: number;
  created_at: string;
  s3_key?: string;
}

interface SearchResult {
  name_en: string;
  name_th: string;
  lng: number;
  lat: number;
  bbox?: number[];
  type?: string;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

const LAYERS_CATALOG: LayerInfo[] = [
  { slug: "province",  name_en: "Province Boundaries",     name_th: "ขอบเขตจังหวัด",          geom_type: "Polygon",    feature_count: 0 },
  { slug: "amphoe",    name_en: "District Boundaries",     name_th: "ขอบเขตอำเภอ",             geom_type: "Polygon",    feature_count: 0 },
  { slug: "tambon",    name_en: "Sub-district Boundaries", name_th: "ขอบเขตตำบล",              geom_type: "Polygon",    feature_count: 0 },
  { slug: "roads",     name_en: "Road Network",            name_th: "เส้นทางจราจร",             geom_type: "Linestring", feature_count: 0 },
  { slug: "waterways", name_en: "Waterways",               name_th: "แหล่งน้ำ",                geom_type: "Linestring", feature_count: 0 },
  { slug: "railways",  name_en: "Railways",                name_th: "ทางรถไฟ",                 geom_type: "Linestring", feature_count: 0 },
  { slug: "buildings", name_en: "Buildings",               name_th: "อาคาร/สิ่งปลูกสร้าง",      geom_type: "Polygon",    feature_count: 0 },
  { slug: "landuse",   name_en: "Land Use",                name_th: "การใช้ประโยชน์ที่ดิน",      geom_type: "Polygon",    feature_count: 0 },
  { slug: "natural",   name_en: "Natural Features",        name_th: "ลักษณะทางธรรมชาติ",        geom_type: "Polygon",    feature_count: 0 },
  { slug: "parks",     name_en: "National Parks",          name_th: "อุทยานแห่งชาติ",           geom_type: "Polygon",    feature_count: 0 },
  { slug: "temples",   name_en: "Temples & Shrines",       name_th: "วัด/ศาสนสถาน",            geom_type: "Point",      feature_count: 0 },
  { slug: "pois",      name_en: "Points of Interest",      name_th: "สถานที่สำคัญ",             geom_type: "Point",      feature_count: 0 },
];

const FORMAT_OPTIONS = [
  { value: "geojson", label: "GeoJSON", ext: ".geojson" },
  { value: "shp",     label: "Shapefile", ext: ".shp" },
  { value: "kml",     label: "KML", ext: ".kml" },
];

const CREDIT_PACKS = [
  { credits: 100,  price_thb: 100,  label: "Starter",   popular: false },
  { credits: 500,  price_thb: 450,  label: "Explorer",  popular: true  },
  { credits: 1000, price_thb: 800,  label: "Pro",       popular: false },
  { credits: 5000, price_thb: 3500, label: "Enterprise",popular: false },
];

const LAYER_COLORS: Record<string, string> = {
  province:  "#8B5CF6",
  amphoe:    "#3B82F6",
  tambon:    "#06B6D4",
  roads:     "#EF4444",
  waterways: "#0EA5E9",
  railways:  "#7C3AED",
  buildings: "#F97316",
  landuse:   "#22C55E",
  natural:   "#14B8A6",
  parks:     "#16A34A",
  temples:   "#EAB308",
  pois:      "#EC4899",
};

// ─────────────────────────────────────────────
// KML / GeoJSON file parser
// ─────────────────────────────────────────────

function parseAOIFile(text: string, filename: string): AOIFeature | null {
  const ext = filename.split(".").pop()?.toLowerCase();

  if (ext === "geojson" || ext === "json") {
    try {
      const data = JSON.parse(text);
      let geometry: GeoJSON.Geometry | undefined;
      if (data.type === "FeatureCollection" && Array.isArray(data.features) && data.features.length > 0) {
        geometry = data.features[0].geometry;
      } else if (data.type === "Feature") {
        geometry = data.geometry;
      } else if (data.type === "Polygon" || data.type === "MultiPolygon") {
        geometry = data;
      }
      if (geometry && (geometry.type === "Polygon" || geometry.type === "MultiPolygon")) {
        return { type: "Feature", geometry, properties: {} };
      }
    } catch { /* invalid JSON */ }
    return null;
  }

  if (ext === "kml") {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, "application/xml");
      // Try Polygon first
      const poly = doc.querySelector("Polygon");
      if (poly) {
        const outer = poly.querySelector("outerBoundaryIs coordinates, LinearRing coordinates");
        const raw = outer?.textContent?.trim() ?? "";
        const coords = raw.split(/\s+/).map((c) => {
          const p = c.split(",").map(Number);
          return [p[0], p[1]] as [number, number];
        }).filter((c) => !isNaN(c[0]) && !isNaN(c[1]));
        if (coords.length >= 3) {
          if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
            coords.push(coords[0]);
          }
          return { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} };
        }
      }
    } catch { /* invalid KML */ }
    return null;
  }

  return null;
}

// ─────────────────────────────────────────────
// Layer symbol (QGIS legend style)
// ─────────────────────────────────────────────

function LayerSymbol({ slug, geomType, size = 16 }: { slug: string; geomType: string; size?: number }) {
  const color = LAYER_COLORS[slug] || "#888";
  const t = geomType.toLowerCase();
  if (t === "point") {
    return (
      <span style={{ width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ width: size * 0.65, height: size * 0.65, borderRadius: "50%", background: color, display: "inline-block" }} />
      </span>
    );
  }
  if (t === "polygon") {
    return (
      <span style={{ width: size, height: size * 0.75, border: `2px solid ${color}`, borderRadius: 2, background: color + "30", display: "inline-block", flexShrink: 0 }} />
    );
  }
  // linestring
  return (
    <span style={{ width: size, height: 3, background: color, borderRadius: 2, display: "inline-block", flexShrink: 0, marginTop: 4 }} />
  );
}

// ─────────────────────────────────────────────
// Toast notification
// ─────────────────────────────────────────────

interface Toast { id: number; msg: string; type: "error" | "info" | "success" }

let _toastId = 0;

// ─────────────────────────────────────────────
// Small reusable components
// ─────────────────────────────────────────────

function SectionHeader({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800 text-white text-xs font-bold uppercase tracking-widest hover:bg-slate-700 transition-colors select-none">
      <span>{label}</span>
      <span className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}>▾</span>
    </button>
  );
}

function Spinner({ message = "Processing…" }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-7 flex flex-col items-center gap-3 min-w-[220px]">
        <div className="text-5xl animate-spin">🌏</div>
        <p className="text-gray-700 font-semibold text-sm">{message}</p>
        <div className="w-40 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600 animate-pulse rounded-full w-3/4" />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function MapSelector() {
  // ── Refs
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const startDrawingRef = useRef<() => void>(() => {});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Map state
  const [mapReady, setMapReady] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);

  // ── AOI
  const [aoi, setAoi] = useState<AOIFeature | null>(null);
  const [aoiSource, setAoiSource] = useState<"draw" | "file" | null>(null);

  // ── User & credits
  const [userId, setUserId] = useState<string>(() =>
    typeof window !== "undefined" ? (localStorage.getItem("geodata_email") || "") : ""
  );
  const [showEmailModal, setShowEmailModal] = useState<boolean>(() =>
    typeof window !== "undefined" ? !localStorage.getItem("geodata_email") : true
  );
  const [credits, setCredits] = useState(0);

  // ── Layers
  const [layers, setLayers] = useState<LayerInfo[]>(LAYERS_CATALOG);
  const [selectedLayers, setSelectedLayers] = useState<string[]>(["province", "roads"]);
  const [loadingLayerSlug, setLoadingLayerSlug] = useState<string | null>(null);
  const [layerErrors, setLayerErrors] = useState<Record<string, string>>({});
  const visibleOnMap = useRef<Set<string>>(new Set());

  // ── Export
  const [selectedFormats, setSelectedFormats] = useState<string[]>(["geojson", "shp"]);
  const [previewResults, setPreviewResults] = useState<Record<string, PreviewResult>>({});
  const [loadingPreview, setLoadingPreview] = useState(false);

  // ── Download
  const [downloading, setDownloading] = useState(false);
  const [lastClip, setLastClip] = useState<ClipResult | null>(null);

  // ── History
  const [history, setHistory] = useState<DownloadRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [redownloading, setRedownloading] = useState<string | null>(null);

  // ── Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // ── UI
  const [openSections, setOpenSections] = useState({ layers: true, aoi: true, export: true, history: false });
  const [showTopup, setShowTopup] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [apiOk, setApiOk] = useState<boolean | null>(null); // null = checking

  const toggleSection = (k: keyof typeof openSections) =>
    setOpenSections((s) => ({ ...s, [k]: !s[k] }));

  // ─────────────────────────────────────────────
  // Toast helpers
  // ─────────────────────────────────────────────

  const addToast = useCallback((msg: string, type: Toast["type"] = "info") => {
    const id = ++_toastId;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  // ─────────────────────────────────────────────
  // API health check on mount
  // ─────────────────────────────────────────────

  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(8000) });
        setApiOk(r.ok);
        if (!r.ok) addToast("Backend unreachable — set NEXT_PUBLIC_API_URL in Vercel", "error");
      } catch {
        setApiOk(false);
        addToast("Cannot reach backend. Check NEXT_PUBLIC_API_URL env var.", "error");
      }
    };
    check();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─────────────────────────────────────────────
  // Init effects
  // ─────────────────────────────────────────────

  useEffect(() => {
    fetchLayers();
    if (userId) fetchCredits();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ─────────────────────────────────────────────
  // Map initialisation
  // ─────────────────────────────────────────────

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [100.9925, 15.87],
      zoom: 6,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(new mapboxgl.ScaleControl(), "bottom-left");

    map.on("load", () => {
      // AOI source
      map.addSource("aoi", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "aoi-fill", type: "fill", source: "aoi", paint: { "fill-color": "#2563EB", "fill-opacity": 0.12 } });
      map.addLayer({ id: "aoi-line", type: "line", source: "aoi", paint: { "line-color": "#2563EB", "line-width": 2.5, "line-dasharray": [4, 2] } });

      setMapReady(true);
    });

    // ── Drawing logic
    const drawing = {
      active: false,
      points: [] as [number, number][],
      markers: [] as mapboxgl.Marker[],
      onClick: null as ((e: mapboxgl.MapMouseEvent) => void) | null,
      onDblClick: null as ((e: mapboxgl.MapMouseEvent) => void) | null,
      onKey: null as ((e: KeyboardEvent) => void) | null,
    };

    const cleanupDrawing = () => {
      drawing.active = false;
      map.getCanvas().style.cursor = "";
      if (drawing.onClick) map.off("click", drawing.onClick);
      if (drawing.onDblClick) map.off("dblclick", drawing.onDblClick);
      if (drawing.onKey) document.removeEventListener("keydown", drawing.onKey);
      drawing.onClick = null; drawing.onDblClick = null; drawing.onKey = null;
      if (map.getLayer("draw-line")) map.removeLayer("draw-line");
      if (map.getSource("draw-line")) map.removeSource("draw-line");
      drawing.markers.forEach((m) => m.remove());
      drawing.markers = [];
      drawing.points = [];
    };

    const startDrawing = () => {
      if (!map.isStyleLoaded()) return;
      cleanupDrawing();
      drawing.active = true;
      setIsDrawing(true);
      map.getCanvas().style.cursor = "crosshair";

      drawing.onClick = (e: mapboxgl.MapMouseEvent) => {
        const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        drawing.points.push(lngLat);

        const el = document.createElement("div");
        el.style.cssText = "width:9px;height:9px;background:#2563EB;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);";
        const m = new mapboxgl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
        drawing.markers.push(m);

        const data: GeoJSON.Feature = { type: "Feature", geometry: { type: "LineString", coordinates: drawing.points }, properties: {} };
        if (map.getSource("draw-line")) {
          (map.getSource("draw-line") as mapboxgl.GeoJSONSource).setData(data);
        } else if (drawing.points.length >= 2) {
          map.addSource("draw-line", { type: "geojson", data });
          map.addLayer({ id: "draw-line", type: "line", source: "draw-line", paint: { "line-color": "#2563EB", "line-width": 2 } });
        }
      };

      drawing.onDblClick = (e: mapboxgl.MapMouseEvent) => {
        e.preventDefault();
        if (drawing.points.length < 3) { addToast("Need at least 3 points to close polygon", "info"); return; }
        const coords = [...drawing.points, drawing.points[0]];
        const feature: AOIFeature = { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} };
        setAoi(feature);
        setAoiSource("draw");
        (map.getSource("aoi") as mapboxgl.GeoJSONSource)?.setData({ type: "FeatureCollection", features: [feature] });
        cleanupDrawing();
        setIsDrawing(false);
        addToast("Area of Interest set ✓", "success");
      };

      drawing.onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") { cleanupDrawing(); setIsDrawing(false); addToast("Drawing cancelled", "info"); }
      };

      map.on("click", drawing.onClick);
      map.on("dblclick", drawing.onDblClick);
      document.addEventListener("keydown", drawing.onKey);
    };

    startDrawingRef.current = startDrawing;
    map.on("load", startDrawing);
    mapRef.current = map;

    return () => { map.remove(); mapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start drawing when mapReady changes
  useEffect(() => {
    if (mapReady && !aoi) startDrawingRef.current();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // ─────────────────────────────────────────────
  // Layer map preview
  // ─────────────────────────────────────────────

  const addLayerToMap = useCallback(async (slug: string) => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (visibleOnMap.current.has(slug)) return;

    setLoadingLayerSlug(slug);
    setLayerErrors((e) => { const n = { ...e }; delete n[slug]; return n; });

    try {
      const bounds = map.getBounds();
      const bboxParam = bounds
        ? `bbox=${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}&`
        : "";
      const resp = await fetch(`${API_BASE}/layer-sample/${slug}?${bboxParam}limit=300`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        const detail = await resp.json().then((d) => d.detail).catch(() => resp.statusText);
        throw new Error(detail);
      }
      const geojson = await resp.json();
      if (!geojson.features || geojson.features.length === 0) {
        addToast(`${slug}: no data in current view`, "info");
        return;
      }

      const sourceId = `preview-${slug}`;
      const layerId  = `preview-${slug}-layer`;
      const color    = LAYER_COLORS[slug] || "#888";
      const meta     = LAYERS_CATALOG.find((l) => l.slug === slug);
      const gt       = (meta?.geom_type || "").toLowerCase();

      if (!map.getSource(sourceId)) map.addSource(sourceId, { type: "geojson", data: geojson });
      else (map.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(geojson);

      if (!map.getLayer(layerId)) {
        if (gt === "point") {
          map.addLayer({ id: layerId, type: "circle", source: sourceId,
            paint: { "circle-color": color, "circle-radius": 5, "circle-opacity": 0.9, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
        } else if (gt === "polygon") {
          map.addLayer({ id: layerId, type: "fill", source: sourceId,
            paint: { "fill-color": color, "fill-opacity": 0.2 } });
          map.addLayer({ id: `${layerId}-outline`, type: "line", source: sourceId,
            paint: { "line-color": color, "line-width": 1.5 } });
        } else {
          map.addLayer({ id: layerId, type: "line", source: sourceId,
            paint: { "line-color": color, "line-width": 2, "line-opacity": 0.85 } });
        }
      }

      visibleOnMap.current.add(slug);
      addToast(`${slug} loaded on map`, "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLayerErrors((e) => ({ ...e, [slug]: msg }));
      addToast(`${slug}: ${msg}`, "error");
    } finally {
      setLoadingLayerSlug(null);
    }
  }, [mapReady, addToast]);

  const removeLayerFromMap = useCallback((slug: string) => {
    const map = mapRef.current;
    if (!map) return;
    const layerId = `preview-${slug}-layer`;
    if (map.getLayer(`${layerId}-outline`)) map.removeLayer(`${layerId}-outline`);
    if (map.getLayer(layerId))  map.removeLayer(layerId);
    if (map.getSource(`preview-${slug}`)) map.removeSource(`preview-${slug}`);
    visibleOnMap.current.delete(slug);
  }, []);

  const toggleLayer = useCallback((slug: string) => {
    setSelectedLayers((prev) => {
      const next = prev.includes(slug) ? prev.filter((l) => l !== slug) : [...prev, slug];
      // Side-effect: add/remove map preview
      if (!prev.includes(slug)) addLayerToMap(slug);
      else removeLayerFromMap(slug);
      return next;
    });
    // Clear stale preview results when layers change
    setPreviewResults({});
  }, [addLayerToMap, removeLayerFromMap]);

  // Load selected layers on map when map becomes ready
  useEffect(() => {
    if (!mapReady) return;
    selectedLayers.forEach((slug) => { if (!visibleOnMap.current.has(slug)) addLayerToMap(slug); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // ─────────────────────────────────────────────
  // AOI helpers
  // ─────────────────────────────────────────────

  const setAoiOnMap = (feature: AOIFeature) => {
    const src = mapRef.current?.getSource("aoi") as mapboxgl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: [feature] });
    // Fit map to AOI
    if (feature.geometry.type === "Polygon") {
      const coords = feature.geometry.coordinates[0];
      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      mapRef.current?.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 60, duration: 1000 }
      );
    }
  };

  const clearAoi = () => {
    setAoi(null);
    setAoiSource(null);
    setPreviewResults({});
    setLastClip(null);
    const src = mapRef.current?.getSource("aoi") as mapboxgl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: [] });
    // Restart drawing mode
    if (mapReady) startDrawingRef.current();
  };

  // ─────────────────────────────────────────────
  // AOI file upload
  // ─────────────────────────────────────────────

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const feature = parseAOIFile(text, file.name);
      if (!feature) {
        addToast(`Could not parse AOI from ${file.name}. Use GeoJSON Polygon or KML Polygon.`, "error");
        return;
      }
      setAoi(feature);
      setAoiSource("file");
      setAoiOnMap(feature);
      addToast(`AOI loaded from ${file.name} ✓`, "success");
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = "";
  };

  // ─────────────────────────────────────────────
  // API calls
  // ─────────────────────────────────────────────

  const fetchLayers = async () => {
    try {
      const r = await fetch(`${API_BASE}/layers`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) { const d = await r.json(); if (d.length) setLayers(d); }
    } catch { /* keep static catalog */ }
  };

  const fetchCredits = async () => {
    try {
      const r = await fetch(`${API_BASE}/payments/credits/${userId}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) { const d = await r.json(); setCredits(d.credits ?? 0); }
    } catch { setCredits(0); }
  };

  const fetchHistory = async () => {
    if (!userId) return;
    setHistoryLoading(true);
    try {
      const r = await fetch(`${API_BASE}/history/${userId}`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) { const d = await r.json(); setHistory(d.downloads || []); }
    } catch { /* ignore */ }
    finally { setHistoryLoading(false); }
  };

  const handleSearch = async () => {
    if (searchQuery.length < 2) return;
    setSearching(true);
    try {
      const r = await fetch(`${API_BASE}/search-location?q=${encodeURIComponent(searchQuery)}`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) { const d = await r.json(); setSearchResults(d.results || []); }
    } catch { /* ignore */ }
    finally { setSearching(false); }
  };

  const selectSearchResult = (res: SearchResult) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [res.lng, res.lat], zoom: 12, duration: 1200 });
    setSearchResults([]);
    setSearchQuery("");
  };

  const handlePreview = async () => {
    if (!aoi) { addToast("Draw or upload an AOI first", "info"); return; }
    if (selectedLayers.length === 0) { addToast("Select at least one layer", "info"); return; }
    setLoadingPreview(true);
    setPreviewResults({});
    try {
      const r = await fetch(`${API_BASE}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aoi, layers: selectedLayers, formats: selectedFormats }),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
      const d = await r.json();
      setPreviewResults(d.layers || {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast(`Preview failed: ${msg}`, "error");
    } finally {
      setLoadingPreview(false);
    }
  };

  const calcCredits = (): number => {
    const totalF = Object.values(previewResults).reduce((s, r) => s + (r?.feature_count || 0), 0);
    const totalMb = Object.values(previewResults).reduce((s, r) => s + (r?.estimated_mb_geojson || 0), 0);
    if (totalF <= 50) return 0;
    return Math.max(5, Math.floor((totalF - 50) / 100) + Math.max(0, Math.floor((totalMb - 5) / 10)));
  };

  const creditsNeeded = calcCredits();
  const totalFeatures = Object.values(previewResults).reduce((s, r) => s + (r?.feature_count || 0), 0);
  const totalMb = Object.values(previewResults).reduce((s, r) => s + (r?.estimated_mb_geojson || 0), 0);

  const executeDownload = async () => {
    setShowConfirm(false);
    setDownloading(true);
    try {
      const r = await fetch(`${API_BASE}/clip-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aoi, layers: selectedLayers, formats: selectedFormats, user_id: userId }),
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) {
        const err = await r.json();
        if (r.status === 402) { addToast(`Insufficient credits: ${err.detail}`, "error"); setShowTopup(true); return; }
        throw new Error(err.detail || `HTTP ${r.status}`);
      }
      const result: ClipResult = await r.json();
      setLastClip(result);
      await fetchCredits();
      // Trigger download
      const url = result.presigned_url || `${API_BASE}/download/${result.download_id}`;
      const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      addToast("Download started ✓", "success");
    } catch (err: unknown) {
      addToast(`Download failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setDownloading(false);
    }
  };

  const handleDownload = () => {
    if (!aoi) { addToast("No AOI selected", "info"); return; }
    if (selectedLayers.length === 0) { addToast("Select at least one layer", "info"); return; }
    if (Object.keys(previewResults).length === 0) { addToast("Run 'Calculate Cost' first", "info"); return; }
    if (creditsNeeded > credits) { addToast(`Need ${creditsNeeded} credits, you have ${credits}`, "error"); setShowTopup(true); return; }
    if (creditsNeeded > 0) setShowConfirm(true);
    else executeDownload();
  };

  const handleRedownload = async (rec: DownloadRecord) => {
    setRedownloading(rec.download_id);
    try {
      const r = await fetch(`${API_BASE}/redownload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, download_id: rec.download_id }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error((await r.json()).detail);
      const d = await r.json();
      const a = document.createElement("a"); a.href = d.presigned_url; a.target = "_blank"; a.rel = "noopener noreferrer";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      addToast("Re-download started ✓", "success");
    } catch (err: unknown) {
      addToast(`Re-download failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setRedownloading(null);
    }
  };

  const handleTopup = async (pack: typeof CREDIT_PACKS[0]) => {
    try {
      const r = await fetch(`${API_BASE}/payments/create-checkout-session`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, amount: pack.credits,
          redirect_url: `${window.location.origin}/credits?success=1`,
          cancel_url: `${window.location.origin}/credits?canceled=1` }),
      });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      window.location.href = d.checkout_url;
    } catch (err: unknown) {
      addToast(`Checkout failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-slate-100 select-none">

      {/* ── Header */}
      <header className="bg-slate-900 text-white flex items-center justify-between px-5 py-2.5 shadow-lg z-10 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🇹🇭</span>
          <div>
            <h1 className="text-sm font-bold tracking-wide">Thai GeoData Hub</h1>
            <p className="text-slate-400 text-xs">Open GIS data for Thailand</p>
          </div>
        </div>

        {/* API status pill */}
        {apiOk === false && (
          <div className="hidden sm:flex items-center gap-1.5 bg-red-900/60 text-red-300 text-xs px-3 py-1 rounded-full border border-red-700">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            Backend unreachable — set NEXT_PUBLIC_API_URL in Vercel
          </div>
        )}

        <div className="flex items-center gap-3">
          {userId && <span className="text-slate-400 text-xs hidden md:block truncate max-w-[180px]">{userId}</span>}
          <div className="flex items-center gap-2 bg-slate-700 px-3 py-1.5 rounded-full text-sm">
            <span className="text-yellow-400">💳</span>
            <span className="font-semibold">{credits.toLocaleString()}</span>
            <span className="text-slate-400 text-xs">cr</span>
            <button onClick={() => setShowTopup(true)}
              className="ml-1 bg-blue-600 hover:bg-blue-500 text-white text-xs px-2.5 py-0.5 rounded-full transition-colors font-medium">
              + Buy
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">

        {/* ══ SIDEBAR ══ */}
        <aside className="w-[300px] shrink-0 bg-white flex flex-col overflow-y-auto border-r border-slate-200 shadow-md">

          {/* Search */}
          <div className="p-3 border-b border-slate-200 bg-slate-50">
            <div className="flex gap-2">
              <input type="text" value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="🔍 Search province, city…"
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={handleSearch} disabled={searching}
                className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 font-medium">
                {searching ? "…" : "Go"}
              </button>
            </div>
            {searchResults.length > 0 && (
              <div className="absolute z-30 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl w-64 max-h-52 overflow-y-auto">
                {searchResults.map((r, i) => (
                  <button key={i} onClick={() => selectSearchResult(r)}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-blue-50 border-b border-slate-100 last:border-0 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-800">{r.name_en}</p>
                      <p className="text-xs text-slate-500">{r.name_th}</p>
                    </div>
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full ml-2 shrink-0">{r.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── SECTION: LAYERS */}
          <div>
            <SectionHeader label="📂 Layers" open={openSections.layers} onToggle={() => toggleSection("layers")} />
            {openSections.layers && (
              <div className="p-3 space-y-1">
                <p className="text-xs text-slate-400 mb-2">Check a layer to see it on the map and include in export.</p>
                {layers.map((layer) => {
                  const checked = selectedLayers.includes(layer.slug);
                  const loading = loadingLayerSlug === layer.slug;
                  const hasError = Boolean(layerErrors[layer.slug]);
                  const isOnMap = visibleOnMap.current.has(layer.slug);
                  return (
                    <label key={layer.slug}
                      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors border ${
                        checked ? "bg-blue-50 border-blue-200" : hasError ? "bg-red-50 border-red-200" : "border-transparent hover:bg-slate-50"
                      }`}>
                      <input type="checkbox" checked={checked}
                        onChange={() => toggleLayer(layer.slug)}
                        className="w-4 h-4 rounded accent-blue-600 shrink-0" />
                      <LayerSymbol slug={layer.slug} geomType={layer.geom_type} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{layer.name_en}</p>
                        <p className="text-xs text-slate-400 truncate">{layer.name_th}</p>
                      </div>
                      <div className="shrink-0 flex items-center gap-1">
                        {loading && <span className="text-xs text-blue-500 animate-pulse">●</span>}
                        {!loading && isOnMap && <span className="text-xs" title="Visible on map">🗺</span>}
                        {hasError && <span className="text-xs" title={layerErrors[layer.slug]}>⚠️</span>}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── SECTION: AOI */}
          <div className="border-t border-slate-200">
            <SectionHeader label="✏️ Area of Interest" open={openSections.aoi} onToggle={() => toggleSection("aoi")} />
            {openSections.aoi && (
              <div className="p-3 space-y-2">
                {/* Draw button */}
                <button
                  onClick={() => { clearAoi(); }}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 text-sm font-semibold transition-all ${
                    isDrawing
                      ? "border-blue-500 bg-blue-500 text-white animate-pulse"
                      : aoi
                      ? "border-slate-200 bg-slate-50 text-slate-600 hover:border-blue-400"
                      : "border-blue-500 bg-blue-500 text-white hover:bg-blue-600"
                  }`}>
                  {isDrawing ? "✏️ Drawing… (double-click to close, Esc cancel)" : aoi ? "✏️ Redraw Polygon" : "✏️ Draw Polygon on Map"}
                </button>

                {/* File upload */}
                <button onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:border-blue-400 hover:bg-blue-50 transition-all">
                  📂 Upload KML / GeoJSON
                </button>
                <input ref={fileInputRef} type="file" accept=".kml,.geojson,.json"
                  onChange={handleFileUpload} className="hidden" />

                {/* AOI status */}
                {aoi && (
                  <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <span className="text-green-600 mt-0.5">✓</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-green-700">AOI Active</p>
                      <p className="text-xs text-green-600">Source: {aoiSource === "file" ? "Uploaded file" : "Drawn on map"}</p>
                    </div>
                    <button onClick={clearAoi}
                      className="text-xs text-red-500 hover:text-red-700 font-semibold shrink-0 px-1.5 py-0.5 rounded hover:bg-red-50">
                      Clear
                    </button>
                  </div>
                )}

                {isDrawing && !aoi && (
                  <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                    <p className="font-semibold mb-0.5">Drawing mode active</p>
                    <p>• Click to add vertices</p>
                    <p>• Double-click to close polygon</p>
                    <p>• <kbd className="bg-blue-100 px-1 rounded">Esc</kbd> to cancel</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── SECTION: EXPORT */}
          <div className="border-t border-slate-200">
            <SectionHeader label="📥 Export" open={openSections.export} onToggle={() => toggleSection("export")} />
            {openSections.export && (
              <div className="p-3 space-y-3">
                {/* Format selection */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Output Formats</p>
                  <div className="flex gap-2 flex-wrap">
                    {FORMAT_OPTIONS.map((f) => (
                      <label key={f.value}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-xs font-medium transition-colors ${
                          selectedFormats.includes(f.value)
                            ? "bg-blue-600 border-blue-600 text-white"
                            : "border-slate-200 text-slate-700 hover:border-blue-400"
                        }`}>
                        <input type="checkbox" checked={selectedFormats.includes(f.value)}
                          onChange={() => setSelectedFormats((p) => p.includes(f.value) ? p.filter((x) => x !== f.value) : [...p, f.value])}
                          className="sr-only" />
                        {f.label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Calculate cost */}
                <button onClick={handlePreview}
                  disabled={!aoi || selectedLayers.length === 0 || loadingPreview}
                  className="w-full py-2 bg-slate-700 text-white text-sm font-semibold rounded-lg hover:bg-slate-600 disabled:opacity-40 transition-colors">
                  {loadingPreview ? "⏳ Calculating…" : "🧮 Calculate Cost"}
                </button>

                {/* Preview results */}
                {Object.keys(previewResults).length > 0 && (
                  <div className="bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
                    <div className="divide-y divide-slate-100">
                      {Object.entries(previewResults).map(([slug, r]) => (
                        <div key={slug} className="flex items-center justify-between px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <LayerSymbol slug={slug} geomType={layers.find((l) => l.slug === slug)?.geom_type || ""} size={12} />
                            <span className="text-xs text-slate-700">{slug}</span>
                          </div>
                          {r.error
                            ? <span className="text-xs text-red-500">No data</span>
                            : <span className="text-xs text-slate-500">{(r.feature_count || 0).toLocaleString()} ft</span>
                          }
                        </div>
                      ))}
                    </div>
                    <div className="px-3 py-2 bg-slate-100 border-t border-slate-200 space-y-0.5">
                      <div className="flex justify-between text-xs text-slate-600">
                        <span>Total features</span><span className="font-semibold">{totalFeatures.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-600">
                        <span>Est. size</span><span className="font-semibold">{totalMb.toFixed(2)} MB</span>
                      </div>
                      <div className={`flex justify-between text-xs font-bold ${creditsNeeded > 0 ? "text-blue-700" : "text-green-700"}`}>
                        <span>Cost</span>
                        <span>{creditsNeeded > 0 ? `${creditsNeeded} credits` : "Free"}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Download button */}
                <button onClick={handleDownload}
                  disabled={!aoi || selectedLayers.length === 0 || selectedFormats.length === 0 || Object.keys(previewResults).length === 0}
                  className="w-full py-3 bg-green-600 text-white text-sm font-bold rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm">
                  {Object.keys(previewResults).length === 0
                    ? "📥 Run Calculate Cost first"
                    : creditsNeeded > credits
                    ? `⚠️ Need ${creditsNeeded} cr (you have ${credits})`
                    : `📥 Download${creditsNeeded > 0 ? ` (${creditsNeeded} cr)` : " — Free"}`}
                </button>

                {lastClip && (
                  <div className="p-2.5 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
                    <p className="font-semibold">✓ Download ready!</p>
                    <p className="truncate text-green-600 mt-0.5">{lastClip.filename}</p>
                    <p className="text-green-500">{lastClip.size_mb} MB · {lastClip.total_features.toLocaleString()} features</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── SECTION: HISTORY */}
          <div className="border-t border-slate-200">
            <button onClick={() => { toggleSection("history"); if (!openSections.history) fetchHistory(); }}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800 text-white text-xs font-bold uppercase tracking-widest hover:bg-slate-700 transition-colors select-none">
              <span>📋 Download History</span>
              <span className={`transition-transform duration-200 ${openSections.history ? "rotate-180" : ""}`}>▾</span>
            </button>
            {openSections.history && (
              <div className="p-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-slate-500">{history.length} records</span>
                  <button onClick={fetchHistory} disabled={historyLoading}
                    className="text-xs text-blue-600 hover:underline disabled:opacity-50">
                    {historyLoading ? "…" : "↺ Refresh"}
                  </button>
                </div>

                {history.length === 0 && !historyLoading && (
                  <div className="text-center py-6 text-slate-400">
                    <p className="text-2xl mb-1">📭</p>
                    <p className="text-xs">No downloads yet</p>
                  </div>
                )}

                <div className="space-y-2">
                  {history.map((rec) => (
                    <div key={rec.download_id} className="border border-slate-200 rounded-xl p-2.5 bg-white hover:border-blue-300 transition-colors">
                      <div className="flex gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-700 truncate">{rec.filename}</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {rec.layers.slice(0, 3).map((l) => (
                              <span key={l} className="text-xs px-1.5 py-0.5 rounded" style={{ background: (LAYER_COLORS[l] || "#888") + "20", color: LAYER_COLORS[l] || "#888" }}>
                                {l}
                              </span>
                            ))}
                            {rec.layers.length > 3 && <span className="text-xs text-slate-400">+{rec.layers.length - 3}</span>}
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            {rec.size_mb} MB · {new Date(rec.created_at).toLocaleDateString()}
                            {rec.credits_used > 0 && ` · ${rec.credits_used} cr`}
                          </p>
                        </div>
                        <button onClick={() => handleRedownload(rec)}
                          disabled={!rec.s3_key || redownloading === rec.download_id}
                          title={rec.s3_key ? "Re-download for free" : "File expired"}
                          className={`shrink-0 self-start mt-0.5 px-2 py-1 text-xs rounded-lg font-semibold transition-colors ${
                            rec.s3_key
                              ? "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                              : "bg-slate-100 text-slate-400 cursor-not-allowed"
                          }`}>
                          {redownloading === rec.download_id ? "…" : rec.s3_key ? "↓" : "–"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Bottom padding */}
          <div className="h-4 shrink-0" />
        </aside>

        {/* ══ MAP ══ */}
        <main className="flex-1 relative overflow-hidden">
          <div ref={mapContainer} className="absolute inset-0" />

          {!mapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-100 z-10">
              <div className="text-center text-slate-500">
                <div className="text-5xl mb-3 animate-spin">🌏</div>
                <p className="font-semibold">Loading map…</p>
              </div>
            </div>
          )}

          {/* Layer legend overlay */}
          {mapReady && visibleOnMap.current.size > 0 && (
            <div className="absolute bottom-8 right-4 z-10 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-3 min-w-[140px]">
              <p className="text-xs font-bold text-slate-600 uppercase mb-2 tracking-wide">Legend</p>
              <div className="space-y-1.5">
                {Array.from(visibleOnMap.current).map((slug) => {
                  const meta = layers.find((l) => l.slug === slug);
                  return (
                    <div key={slug} className="flex items-center gap-2">
                      <LayerSymbol slug={slug} geomType={meta?.geom_type || "linestring"} size={14} />
                      <span className="text-xs text-slate-700">{meta?.name_en || slug}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Drawing hint */}
          {isDrawing && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-blue-600 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg flex items-center gap-2 animate-pulse">
              ✏️ Click to add points · Double-click to finish · Esc to cancel
            </div>
          )}
        </main>
      </div>

      {/* ══ TOAST NOTIFICATIONS ══ */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id}
            className={`px-4 py-2.5 rounded-xl shadow-xl text-sm font-medium max-w-xs pointer-events-auto transition-all ${
              t.type === "error" ? "bg-red-600 text-white" :
              t.type === "success" ? "bg-green-600 text-white" :
              "bg-slate-800 text-white"}`}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* ══ MODALS ══ */}

      {/* Email modal */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-7">
            <div className="text-center mb-5">
              <div className="text-4xl mb-2">🇹🇭</div>
              <h2 className="text-xl font-bold text-slate-800">Welcome to Thai GeoData Hub</h2>
              <p className="text-slate-500 text-sm mt-1">Enter your email to track downloads & credits</p>
            </div>
            <EmailForm onSubmit={(email) => {
              localStorage.setItem("geodata_email", email);
              setUserId(email);
              setShowEmailModal(false);
            }} />
          </div>
        </div>
      )}

      {/* Confirm download */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <h2 className="text-lg font-bold text-slate-800 mb-4">Confirm Download</h2>
            <div className="bg-slate-50 rounded-xl p-4 mb-4 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-slate-600">Layers</span><span className="font-semibold">{selectedLayers.join(", ")}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Features</span><span className="font-semibold">{totalFeatures.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Credits</span><span className="font-bold text-blue-600">−{creditsNeeded}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Balance after</span><span className={`font-bold ${credits >= creditsNeeded ? "text-green-600" : "text-red-600"}`}>{credits - creditsNeeded}</span></div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowConfirm(false)} className="flex-1 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-semibold hover:bg-slate-200 transition-colors">Cancel</button>
              <button onClick={executeDownload} className="flex-1 py-2.5 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-colors">Download</button>
            </div>
          </div>
        </div>
      )}

      {/* Top-up modal */}
      {showTopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-slate-800">Buy Credits</h2>
              <button onClick={() => setShowTopup(false)} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
            </div>
            <div className="space-y-3">
              {CREDIT_PACKS.map((p) => (
                <button key={p.credits} onClick={() => handleTopup(p)}
                  className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all hover:shadow-md ${
                    p.popular ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-blue-300"}`}>
                  <div className="text-left">
                    <p className="font-bold text-slate-800">{p.label}</p>
                    <p className="text-sm text-slate-500">{p.credits.toLocaleString()} credits</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-blue-600">฿{p.price_thb.toLocaleString()}</p>
                    {p.popular && <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">Popular</span>}
                  </div>
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-4 text-center">Secure checkout via Stripe</p>
          </div>
        </div>
      )}

      {downloading && <Spinner message="Clipping & packaging your data…" />}
    </div>
  );
}

// ─────────────────────────────────────────────
// Email form (split out to keep main component clean)
// ─────────────────────────────────────────────

function EmailForm({ onSubmit }: { onSubmit: (email: string) => void }) {
  const [email, setEmail] = React.useState("");
  const [err, setErr] = React.useState("");
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const t = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) { setErr("Enter a valid email address."); return; }
      onSubmit(t);
    }} className="space-y-3">
      <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }}
        placeholder="you@email.com" autoFocus
        className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      {err && <p className="text-red-500 text-xs">{err}</p>}
      <button type="submit"
        className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors">
        Start Exploring →
      </button>
      <p className="text-xs text-slate-400 text-center">No password. Your email is your account ID.</p>
    </form>
  );
}
