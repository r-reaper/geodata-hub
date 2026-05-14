// Thai GeoData Hub — MapSelector v6
// Adds: email login, credits, Stripe purchase, history drawer, free re-download,
// prominent loading states, AOI persistence, credit-cost preview, first-visit
// walkthrough, toast queue.

"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useT, type Lang } from "../lib/i18n";
import { APP_VERSION, CHANGELOG } from "../lib/changelog";
import { initAnalytics, events as track, identify, track as rawTrack } from "../lib/analytics";

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

interface SearchResult {
  name_en: string;
  name_th: string;
  lng: number;
  lat: number;
  bbox?: number[];
}

interface DownloadRecord {
  download_id: string;
  filename: string;
  layers: string[];
  formats: string[];
  size_mb: number;
  total_features: number;
  s3_key: string | null;
  credits_used: number;
  created_at: string;
}

interface Toast {
  id: number;
  msg: string;
  type: "info" | "success" | "error";
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

const LAYERS: LayerInfo[] = [
  { slug: "province",         name_en: "Provinces",            name_th: "จังหวัด",          geom_type: "Polygon",    feature_count: 0 },
  { slug: "amphoe",           name_en: "Districts",            name_th: "อำเภอ",            geom_type: "Polygon",    feature_count: 0 },
  { slug: "tambon",           name_en: "Sub-districts",        name_th: "ตำบล",             geom_type: "Polygon",    feature_count: 0 },
  { slug: "roads",            name_en: "Roads",                name_th: "ถนน",              geom_type: "Linestring", feature_count: 0 },
  { slug: "waterways",        name_en: "Waterways",            name_th: "แหล่งน้ำ",         geom_type: "Linestring", feature_count: 0 },
  { slug: "railways",         name_en: "Railways",             name_th: "ทางรถไฟ",          geom_type: "Linestring", feature_count: 0 },
  { slug: "buildings",        name_en: "Buildings (OSM)",      name_th: "อาคาร (OSM)",      geom_type: "Polygon",    feature_count: 0 },
  { slug: "ms_buildings",       name_en: "Buildings (Microsoft)",        name_th: "อาคาร (Microsoft)",        geom_type: "Polygon", feature_count: 0 },
  { slug: "ms_buildings_urban", name_en: "Buildings (Microsoft, urban)", name_th: "อาคาร (Microsoft, เมืองหลัก)", geom_type: "Polygon", feature_count: 0 },
  { slug: "google_buildings", name_en: "Buildings (Google)",   name_th: "อาคาร (Google)",   geom_type: "Polygon",    feature_count: 0 },
  { slug: "landuse",          name_en: "Land Use",             name_th: "การใช้ที่ดิน",     geom_type: "Polygon",    feature_count: 0 },
  { slug: "natural",          name_en: "Natural",              name_th: "ธรรมชาติ",         geom_type: "Polygon",    feature_count: 0 },
  { slug: "parks",            name_en: "National Parks",       name_th: "อุทยาน",           geom_type: "Polygon",    feature_count: 0 },
  { slug: "temples",          name_en: "Temples",              name_th: "วัด",              geom_type: "Point",      feature_count: 0 },
  { slug: "pois",             name_en: "POIs",                 name_th: "สถานที่สำคัญ",     geom_type: "Point",      feature_count: 0 },
  { slug: "worldpop",         name_en: "Population (2020)",    name_th: "ประชากร (2020)",   geom_type: "Raster",     feature_count: 0 },
  { slug: "srtm",             name_en: "Elevation (SRTM 30m)", name_th: "ความสูง (SRTM 30 ม.)", geom_type: "Raster", feature_count: 0 },
];

const LAYER_COLORS: Record<string, string> = {
  province:         "#8B5CF6", amphoe:    "#3B82F6", tambon:    "#06B6D4",
  roads:            "#EF4444", waterways: "#0EA5E9", railways:  "#7C3AED",
  buildings:        "#F97316", landuse:   "#22C55E", natural:   "#14B8A6",
  parks:            "#16A34A", temples:   "#EAB308", pois:      "#EC4899",
  ms_buildings:     "#FB923C", ms_buildings_urban: "#EA580C", google_buildings: "#FACC15",
  worldpop:         "#DC2626",                       srtm:             "#78350F",
};

const QUICK_LOCATIONS = [
  { name: "Bangkok", lng: 100.5018, lat: 13.7563, zoom: 11 },
  { name: "Chiang Mai", lng: 98.9818, lat: 18.7883, zoom: 11 },
  { name: "Phuket", lng: 98.3929, lat: 7.8804, zoom: 11 },
  { name: "Pattaya", lng: 100.8870, lat: 12.9276, zoom: 12 },
];

const CREDIT_PACKS = [
  { credits: 100,  price_thb: 100,  label: "Starter",    popular: false, hint: "Try it out" },
  { credits: 500,  price_thb: 450,  label: "Explorer",   popular: true,  hint: "Most popular · 10% off" },
  { credits: 1000, price_thb: 800,  label: "Pro",        popular: false, hint: "20% off" },
  { credits: 5000, price_thb: 3500, label: "Enterprise", popular: false, hint: "30% off" },
];

const STORAGE = {
  email:       "geodata_email",
  aoi:         "geodata_aoi",
  seenIntro:   "geodata_seen_intro",
  crs:         "geodata_target_crs",
  seenVersion: "geodata_seen_version",
};

const CRS_OPTIONS = [
  { code: "EPSG:4326",  short: "WGS 84",           label: "WGS 84 — Lat/Lon (geographic)",            hint: "Default · global standard · web/GPS" },
  { code: "EPSG:3857",  short: "Web Mercator",     label: "Web Mercator — meters",                    hint: "Google Maps / OSM tile standard" },
  { code: "EPSG:32647", short: "UTM 47N",          label: "UTM Zone 47N — meters",                    hint: "Western Thailand · Phuket / Krabi" },
  { code: "EPSG:32648", short: "UTM 48N",          label: "UTM Zone 48N — meters",                    hint: "Central/East Thailand · Bangkok / Isaan" },
];

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Mirror of backend `calculate_credits_needed` (main.py:95). */
function calculateCreditsNeeded(features: number, mbShp: number): number {
  if (features <= 50) return 0;
  const featureCredits = Math.floor((features - 50) / 100);
  const sizeCredits = Math.max(0, Math.floor((mbShp - 5) / 10));
  return Math.max(5, featureCredits + sizeCredits);
}

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
  const coords = feature.geometry.type === "Polygon"
    ? feature.geometry.coordinates[0]
    : feature.geometry.coordinates[0][0];
  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    area += (coords[i + 1][0] - coords[i][0]) * (coords[i + 1][1] + coords[i][1]);
  }
  return Math.abs(area / 2) * 12300;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch { return iso; }
}

function isValidEmail(s: string): boolean {
  return /\S+@\S+\.\S+/.test(s.trim());
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function MapSelector() {
  // ── i18n
  const { t, lang, toggle: toggleLang } = useT();

  // ── Refs
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const startDrawingRef = useRef<() => void>(() => {});
  const cancelDrawingRef = useRef<() => void>(() => {});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const visibleLayersRef = useRef<Set<string>>(new Set());
  const toastIdRef = useRef(0);
  const setAoiOnMapRef = useRef<(f: AOIFeature | null) => void>(() => {});

  // ── State (UI)
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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [formats, setFormats] = useState<Set<string>>(new Set(["geojson"]));

  // ── State (auth + commerce)
  const [userId, setUserId] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [loadingCredits, setLoadingCredits] = useState(false);
  const [history, setHistory] = useState<DownloadRecord[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [failedDownloadId, setFailedDownloadId] = useState<string | null>(null);

  // ── State (modals)
  const [showLogin, setShowLogin] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false); // bottom-sheet drawer on small screens
  const [showIntro, setShowIntro] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | "download" | "buy">(null);
  const [layerInfoSlug, setLayerInfoSlug] = useState<string | null>(null);
  const [targetCrs, setTargetCrs] = useState<string>("EPSG:4326");
  const [showDownloadPrompt, setShowDownloadPrompt] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [hasUnseenChangelog, setHasUnseenChangelog] = useState(false);

  // ─────────────────────────────────────────────
  // Toast queue
  // ─────────────────────────────────────────────
  const showToast = useCallback((msg: string, type: Toast["type"] = "info", durationMs = 4000) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev.slice(-2), { id, msg, type }]); // max 3 visible
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), durationMs);
  }, []);

  // ─────────────────────────────────────────────
  // Auth (soft login via email)
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    initAnalytics();
    const saved = localStorage.getItem(STORAGE.email);
    if (saved && isValidEmail(saved)) {
      setUserId(saved);
      identify(saved);
    }
    if (!localStorage.getItem(STORAGE.seenIntro)) setShowIntro(true);
    const savedCrs = localStorage.getItem(STORAGE.crs);
    if (savedCrs && CRS_OPTIONS.some((o) => o.code === savedCrs)) setTargetCrs(savedCrs);
    // Show "NEW" badge if user hasn't seen the current version's changelog
    const seenVersion = localStorage.getItem(STORAGE.seenVersion);
    if (seenVersion !== APP_VERSION) setHasUnseenChangelog(true);
  }, []);

  const openChangelog = () => {
    setShowChangelog(true);
    setHasUnseenChangelog(false);
    try { localStorage.setItem(STORAGE.seenVersion, APP_VERSION); } catch {}
    track.changelogOpened(APP_VERSION);
  };

  const refreshCredits = useCallback(async (uid: string | null = userId) => {
    if (!uid) { setCredits(null); return; }
    setLoadingCredits(true);
    try {
      const r = await fetch(`${API_BASE}/payments/credits/${encodeURIComponent(uid)}`);
      if (r.ok) {
        const d = await r.json();
        setCredits(d.credits ?? 0);
      }
    } catch {} finally { setLoadingCredits(false); }
  }, [userId]);

  useEffect(() => {
    if (userId) refreshCredits(userId);
  }, [userId, refreshCredits]);

  const handleLogin = (email: string) => {
    if (!isValidEmail(email)) {
      showToast("Please enter a valid email address", "error");
      return;
    }
    const e = email.trim().toLowerCase();
    localStorage.setItem(STORAGE.email, e);
    setUserId(e);
    identify(e);
    track.signedIn("email");
    setShowLogin(false);
    showToast(t("toast.signedIn", { email: e }), "success");
    // After login, resume any pending action
    if (pendingAction === "download") setTimeout(() => runDownload(e), 100);
    if (pendingAction === "buy") setTimeout(() => setShowCredits(true), 100);
    setPendingAction(null);
  };

  const handleLogout = () => {
    localStorage.removeItem(STORAGE.email);
    setUserId(null);
    setCredits(null);
    setHistory(null);
    identify(null);
    track.signedOut();
    showToast(t("toast.signedOut"), "info");
  };

  // ─────────────────────────────────────────────
  // API health
  // ─────────────────────────────────────────────
  const checkApi = useCallback(async () => {
    setApiOk(null);
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(20000) });
        if (r.ok) { setApiOk(true); return; }
      } catch {}
      if (i < 2) await new Promise((r) => setTimeout(r, 5000));
    }
    setApiOk(false);
    showToast("Backend is waking up — try again in 30 s if it doesn't recover", "error");
  }, [showToast]);

  useEffect(() => { checkApi(); }, [checkApi]);

  // Layer counts
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

    map.on("error", (e: any) => {
      const err = e?.error;
      const status = err?.status;
      const msg = err?.message || "Unknown Mapbox error";
      if (status === 401 || status === 403 || /forbidden|unauthorized|access token/i.test(msg)) {
        setMapError(`Mapbox token rejected (${status || "auth"}): ${msg}.`);
      } else if (!mapReady) {
        setMapError(`Map failed to load: ${msg}`);
      }
      // eslint-disable-next-line no-console
      console.error("[Mapbox]", e);
    });

    const resize = () => map.resize();
    const ro = new ResizeObserver(resize);
    if (mapContainer.current) ro.observe(mapContainer.current);
    window.addEventListener("resize", resize);
    setTimeout(resize, 100);

    // ── Drawing state machine
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
      // High-contrast crosshair cursor: dark cross with white halo so it stays
      // visible whether the basemap underneath is light (default streets) or
      // dark (water, forest, satellite). The default browser `crosshair` is a
      // 1-px black line that disappears against dark map tiles.
      map.getCanvas().style.cursor =
        "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'><circle cx='14' cy='14' r='2.5' fill='%232563EB' stroke='white' stroke-width='1.5'/><line x1='14' y1='1' x2='14' y2='9' stroke='white' stroke-width='3'/><line x1='14' y1='1' x2='14' y2='9' stroke='%23111827' stroke-width='1.5'/><line x1='14' y1='19' x2='14' y2='27' stroke='white' stroke-width='3'/><line x1='14' y1='19' x2='14' y2='27' stroke='%23111827' stroke-width='1.5'/><line x1='1' y1='14' x2='9' y2='14' stroke='white' stroke-width='3'/><line x1='1' y1='14' x2='9' y2='14' stroke='%23111827' stroke-width='1.5'/><line x1='19' y1='14' x2='27' y2='14' stroke='white' stroke-width='3'/><line x1='19' y1='14' x2='27' y2='14' stroke='%23111827' stroke-width='1.5'/></svg>\") 14 14, crosshair";

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
          showToast(t("toast.minPoints"), "info");
          return;
        }
        const coords = [...drawing.points, drawing.points[0]];
        const feat: AOIFeature = { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} };
        setAoi(feat);
        try { localStorage.setItem(STORAGE.aoi, JSON.stringify(feat)); } catch {}
        const src = map.getSource("aoi") as mapboxgl.GeoJSONSource | undefined;
        src?.setData({ type: "FeatureCollection", features: [feat] });
        // Centroid for analytics
        const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
        const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
        track.aoiDrawn(approxAreaKm2(feat), cx, cy);
        cleanup();
        setIsDrawing(false);
        showToast(t("toast.areaDefined"), "success");
      };

      drawing.onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") { cleanup(); setIsDrawing(false); showToast(t("toast.cancelled"), "info"); }
      };

      map.on("click", drawing.onClick);
      map.on("dblclick", drawing.onDbl);
      document.addEventListener("keydown", drawing.onKey);
    };

    const cancel = () => { cleanup(); setIsDrawing(false); };

    startDrawingRef.current = start;
    cancelDrawingRef.current = cancel;

    setAoiOnMapRef.current = (feat: AOIFeature | null) => {
      const src = map.getSource("aoi") as mapboxgl.GeoJSONSource | undefined;
      src?.setData({ type: "FeatureCollection", features: feat ? [feat] : [] });
    };

    map.on("load", () => {
      map.addSource("aoi", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "aoi-fill", type: "fill", source: "aoi", paint: { "fill-color": "#2563EB", "fill-opacity": 0.12 } });
      map.addLayer({ id: "aoi-line", type: "line", source: "aoi", paint: { "line-color": "#2563EB", "line-width": 2.5, "line-dasharray": [4, 2] } });
      setMapReady(true);

      // Restore saved AOI (if any)
      try {
        const raw = localStorage.getItem(STORAGE.aoi);
        if (raw) {
          const feat = JSON.parse(raw) as AOIFeature;
          if (feat?.geometry?.type === "Polygon" || feat?.geometry?.type === "MultiPolygon") {
            setAoi(feat);
            (map.getSource("aoi") as mapboxgl.GeoJSONSource)?.setData({ type: "FeatureCollection", features: [feat] });
            // Zoom to it
            const coords = feat.geometry.type === "Polygon" ? feat.geometry.coordinates[0] : feat.geometry.coordinates[0][0];
            const lons = coords.map((c) => c[0]);
            const lats = coords.map((c) => c[1]);
            map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 80, animate: false });
          }
        }
      } catch {}
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
    showToast(t("toast.layerLoading", { layer: slug }), "info", 2500);
    try {
      const b = map.getBounds();
      const bbox = b ? `bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}&` : "";
      const r = await fetch(`${API_BASE}/layer-sample/${slug}?${bbox}limit=300`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) {
        const err = await r.json().catch(() => ({})).then((d: any) => d.detail || `HTTP ${r.status}`);
        throw new Error(err);
      }
      const fc = await r.json();
      if (!fc.features?.length) { showToast(t("toast.layerNoView", { layer: slug }), "info"); return; }

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
    try { localStorage.removeItem(STORAGE.aoi); } catch {}
    setAoiOnMapRef.current(null);
    track.aoiCleared();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const feat = parseAOIFile(text, file.name);
    if (!feat) {
      showToast(t("toast.parseFail"), "error");
      return;
    }
    setAoi(feat);
    try { localStorage.setItem(STORAGE.aoi, JSON.stringify(feat)); } catch {}
    setAoiOnMapRef.current(feat);
    const coords = feat.geometry.type === "Polygon" ? feat.geometry.coordinates[0] : feat.geometry.coordinates[0][0];
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    mapRef.current?.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 60 });
    track.aoiUploaded((file.name.split(".").pop() || "unknown").toLowerCase());
    showToast(t("toast.aoiLoaded", { file: file.name }), "success");
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
  // Layer/format toggles
  // ─────────────────────────────────────────────
  const toggleLayerSelected = (slug: string) => {
    let wasSelected = false;
    setSelectedLayers((prev) => {
      const n = new Set(prev);
      wasSelected = n.has(slug);
      if (wasSelected) n.delete(slug); else n.add(slug);
      return n;
    });
    setPreview(null);
    track.layerSelected(slug, wasSelected ? "deselect" : "select");
  };

  const toggleLayerVisible = (slug: string) => {
    if (visibleLayersRef.current.has(slug)) {
      hideLayerFromMap(slug);
    } else {
      showLayerOnMap(slug);
      track.layerPreviewClicked(slug);
    }
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
    track.previewCountRequested(Array.from(selectedLayers), aoi ? approxAreaKm2(aoi) : 0);
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
      showToast(t("toast.previewFail", { err: e.message || String(e) }), "error");
    } finally {
      setLoadingPreview(false);
    }
  };

  const runDownload = async (uidOverride?: string) => {
    const uid = uidOverride || userId;
    if (!aoi || selectedLayers.size === 0) return;

    // Donation model: all downloads are free; user_id only used for history.
    setFailedDownloadId(null);
    setLoadingDownload(true);
    const downloadStartedAt = Date.now();
    track.downloadClicked(
      Array.from(selectedLayers),
      Array.from(formats),
      targetCrs,
      preview ? Object.values(preview).reduce((s, p) => s + (p.feature_count || 0), 0) : undefined,
    );
    try {
      const r = await fetch(`${API_BASE}/clip-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aoi,
          layers: Array.from(selectedLayers),
          formats: Array.from(formats),
          user_id: uid || null,
          target_crs: targetCrs,
        }),
      });
      const data = await r.json().catch(() => ({} as any));
      if (!r.ok) {
        if (data?.download_id) setFailedDownloadId(data.download_id);
        throw new Error(data?.detail || `HTTP ${r.status}`);
      }
      // success — clear any prior failure
      setFailedDownloadId(null);
      track.downloadSucceeded(
        data.size_mb || 0,
        (Date.now() - downloadStartedAt) / 1000,
        data.total_features || 0,
      );
      if (data.presigned_url) {
        window.open(data.presigned_url, "_blank");
        showToast(t("toast.downloadOk", { file: data.filename }), "success");
      } else if (data.download_id) {
        window.open(`${API_BASE}/download/${data.download_id}`, "_blank");
      }
      // Refresh credits after a paid download
      if (uid) refreshCredits(uid);
      // Refresh history if drawer is open
      if (showHistory && uid) loadHistory(uid);
    } catch (e: any) {
      track.downloadFailed(e.message || String(e));
      showToast(t("toast.downloadFail", { err: e.message || String(e) }), "error");
    } finally {
      setLoadingDownload(false);
    }
  };

  // ─────────────────────────────────────────────
  // History + re-download
  // ─────────────────────────────────────────────
  const loadHistory = useCallback(async (uid: string | null = userId) => {
    if (!uid) { setHistory([]); return; }
    setLoadingHistory(true);
    try {
      const r = await fetch(`${API_BASE}/history/${encodeURIComponent(uid)}`);
      if (r.ok) {
        const d = await r.json();
        setHistory(d.downloads || []);
      } else {
        setHistory([]);
      }
    } catch { setHistory([]); } finally { setLoadingHistory(false); }
  }, [userId]);

  const openHistory = () => {
    if (!userId) {
      showToast(t("history.signinFirst"), "info");
      setShowLogin(true);
      return;
    }
    setShowHistory(true);
    loadHistory(userId);
  };

  const reDownload = async (download_id: string) => {
    if (!userId) { setShowLogin(true); return; }
    track.redownloadClicked(download_id);
    try {
      const r = await fetch(`${API_BASE}/redownload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, download_id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.detail || `HTTP ${r.status}`);
      window.open(data.presigned_url, "_blank");
      showToast(t("toast.redownloadOk", { file: data.filename || download_id }), "success");
      setFailedDownloadId(null);
    } catch (e: any) {
      showToast(t("toast.downloadFail", { err: e.message || String(e) }), "error");
    }
  };

  // ─────────────────────────────────────────────
  // Stripe checkout
  // ─────────────────────────────────────────────
  const startCheckout = async (creditAmount: number) => {
    if (!userId) {
      setPendingAction("buy");
      setShowLogin(true);
      return;
    }
    try {
      const origin = window.location.origin;
      const r = await fetch(`${API_BASE}/payments/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          amount: creditAmount,
          redirect_url: `${origin}/credits?success=1`,
          cancel_url: `${origin}/credits?canceled=1`,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.checkout_url) throw new Error(data?.detail || `HTTP ${r.status}`);
      window.location.href = data.checkout_url;
    } catch (e: any) {
      showToast(`Could not start checkout: ${e.message || e}`, "error");
    }
  };

  // ─────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────
  const aoiAreaKm2 = aoi ? approxAreaKm2(aoi) : 0;
  const totalPreviewFeatures = preview
    ? Object.values(preview).reduce((s, p) => s + (p.feature_count || 0), 0)
    : 0;
  const totalPreviewMb = preview
    ? Object.values(preview).reduce((s, p) => s + (p.estimated_mb_shp || 0), 0)
    : 0;
  const creditsCost = preview
    ? calculateCreditsNeeded(totalPreviewFeatures, totalPreviewMb)
    : 0;
  const canDownload = aoi && selectedLayers.size > 0 && formats.size > 0 && !loadingDownload;
  const anyLoading = loadingLayer !== null || loadingPreview || loadingDownload || loadingCredits || loadingHistory;

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
            <code className="bg-slate-100 px-1.5 py-0.5 rounded text-red-600 text-xs">NEXT_PUBLIC_MAPBOX_TOKEN</code> is not set in Vercel.
          </p>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <div
      className="app-shell"
      style={{
        display: "grid",
        gridTemplateRows: "56px 1fr",
        gridTemplateColumns: "360px 1fr",
        gridTemplateAreas: '"header header" "side map"',
        // 100dvh = dynamic viewport height. Fixes iOS Safari where 100vh
        // includes the URL bar that later collapses, leaving the map with
        // 0 visible height. Falls back to 100vh on browsers that don't
        // support dvh (covered by the height: 100vh duplicate above? no —
        // we set 100dvh only; modern Safari/Chrome/FF all support it 2022+).
        height: "100dvh",
        width: "100vw",
        background: "#f8fafc",
        overflow: "hidden",
      }}
    >
      {/* ── Top bar ── */}
      <header
        style={{ gridArea: "header" }}
        className="app-header bg-white border-b border-slate-200 px-5 flex items-center justify-between shadow-sm z-20"
      >
        <div className="flex items-center gap-3">
          {/* Mobile-only hamburger to open the bottom-sheet drawer */}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="mobile-only items-center justify-center w-8 h-8 rounded-md hover:bg-slate-100 text-slate-700 text-lg"
            title="Menu"
            aria-label="Open menu"
          >
            ≡
          </button>
          <span className="text-2xl">🇹🇭</span>
          <div>
            <h1 className="text-slate-900 leading-tight font-medium">{t("app.title")}</h1>
            <p className="app-tagline text-xs text-slate-500 leading-tight font-light">{t("app.tagline")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {/* API status badges — hidden on mobile to save space (banner in sidebar covers it) */}
          {apiOk === false && (
            <span className="desktop-only px-2 py-1 rounded-md bg-red-50 text-red-700 text-xs border border-red-200">
              {t("app.offline")}
            </span>
          )}
          {apiOk === true && (
            <span className="desktop-only px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs border border-emerald-200">
              {t("app.online")}
            </span>
          )}

          {/* Outstanding colorful Donate button — primary CTA, visible everywhere */}
          <button
            onClick={() => { setShowCredits(true); track.donateModalOpened("header"); }}
            className="relative flex items-center gap-1.5 px-4 py-2 rounded-md bg-gradient-to-r from-pink-500 via-rose-500 to-orange-500 hover:from-pink-600 hover:via-rose-600 hover:to-orange-600 text-white font-medium text-sm transition shadow-md hover:shadow-lg ring-2 ring-pink-200 hover:ring-pink-300"
            title="Support this project"
          >
            <span className="text-base">💝</span>
            <span>Donate</span>
          </button>

          {/* Secondary actions — desktop only. Mobile users find these
              in the bottom-sheet drawer toolbar (rendered below). */}
          <button
            onClick={openHistory}
            className="desktop-only px-3 py-1.5 rounded-md hover:bg-slate-100 text-slate-700 text-xs"
            title={t("history.title")}
          >
            {t("btn.history")}
          </button>
          <button
            onClick={() => { setShowFeedback(true); rawTrack("feedback_opened"); }}
            className="desktop-only px-3 py-1.5 rounded-md hover:bg-blue-50 text-blue-700 text-xs border border-blue-200"
            title={t("feedback.title")}
          >
            💬 {t("btn.feedback")}
          </button>
          <a
            href="/attributions"
            className="desktop-only px-3 py-1.5 rounded-md hover:bg-slate-100 text-slate-700 text-xs"
            title="Data sources & licenses"
          >
            {t("btn.sources")}
          </a>
          <a
            href="/privacy"
            className="desktop-only px-3 py-1.5 rounded-md hover:bg-slate-100 text-slate-500 text-xs"
            title={t("btn.privacy")}
          >
            {t("btn.privacy")}
          </a>
          <button
            onClick={openChangelog}
            className="desktop-only relative px-2 py-1.5 rounded-md hover:bg-slate-100 text-slate-500 text-[11px] font-mono"
            title={t("changelog.title")}
          >
            v{APP_VERSION}
            {hasUnseenChangelog && (
              <span className="absolute -top-1 -right-1 px-1 py-0 rounded-full bg-pink-500 text-white text-[8px] font-bold leading-tight">
                {t("changelog.badgeNew")}
              </span>
            )}
          </button>
          <button
            onClick={() => { const from = lang; toggleLang(); track.langSwitched(from, from === "en" ? "th" : "en"); }}
            className="px-2.5 py-1.5 rounded-md hover:bg-slate-100 text-slate-700 text-xs border border-slate-200"
            title={lang === "en" ? "เปลี่ยนเป็นภาษาไทย" : "Switch to English"}
          >
            {t("btn.lang")}
          </button>

          {/* Sign in / out */}
          {userId ? (
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-md hover:bg-slate-100 text-slate-600 text-xs"
              title={t("toast.signedIn", { email: userId })}
            >
              {userId.split("@")[0]} · {t("btn.signout")}
            </button>
          ) : (
            <button
              onClick={() => setShowLogin(true)}
              className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs"
            >
              {t("btn.signin")}
            </button>
          )}
        </div>
      </header>

      {/* ── Side panel ── */}
      <aside
        style={{ gridArea: "side", overflowY: "auto" }}
        className="app-side bg-white border-r border-slate-200 flex flex-col"
        data-open={mobileOpen ? "true" : "false"}
      >
        {/* Mobile-only secondary toolbar — exposes Feedback / History /
            Sources / Privacy / What's New that we hid from the cramped
            mobile header. Grid of 5 chunky tap targets. */}
        <div className="mobile-only flex-wrap gap-2 px-3 pt-2 pb-3 border-b border-slate-100" style={{ display: undefined }}>
          <div className="grid grid-cols-3 gap-2 w-full">
            <button
              onClick={() => { setShowFeedback(true); rawTrack("feedback_opened"); setMobileOpen(false); }}
              className="py-2 px-2 rounded-md bg-blue-50 text-blue-700 text-xs border border-blue-200"
            >
              💬 {t("btn.feedback")}
            </button>
            <button
              onClick={() => { openHistory(); setMobileOpen(false); }}
              className="py-2 px-2 rounded-md bg-slate-50 text-slate-700 text-xs border border-slate-200"
            >
              {t("btn.history")}
            </button>
            <a
              href="/attributions"
              className="flex items-center justify-center py-2 px-2 rounded-md bg-slate-50 text-slate-700 text-xs border border-slate-200"
            >
              {t("btn.sources")}
            </a>
            <a
              href="/privacy"
              className="flex items-center justify-center py-2 px-2 rounded-md bg-slate-50 text-slate-600 text-xs border border-slate-200"
            >
              {t("btn.privacy")}
            </a>
            <button
              onClick={() => { openChangelog(); setMobileOpen(false); }}
              className="relative py-2 px-2 rounded-md bg-slate-50 text-slate-600 text-[11px] font-mono border border-slate-200"
            >
              v{APP_VERSION}
              {hasUnseenChangelog && (
                <span className="absolute -top-1 -right-1 px-1 py-0 rounded-full bg-pink-500 text-white text-[8px] font-bold leading-tight">
                  {t("changelog.badgeNew")}
                </span>
              )}
            </button>
            {apiOk === false ? (
              <span className="flex items-center justify-center py-2 px-2 rounded-md bg-red-50 text-red-700 text-[11px] border border-red-200">
                {t("app.offline")}
              </span>
            ) : (
              <span className="flex items-center justify-center py-2 px-2 rounded-md bg-emerald-50 text-emerald-700 text-[11px] border border-emerald-200">
                {t("app.online")}
              </span>
            )}
          </div>
        </div>

        {/* Prominent error banner when backend is unreachable. The tiny red
            badge in the header is too easy to miss — when /health fails the
            user sees zero layer counts and doesn't know why. */}
        {apiOk === false && (
          <div className="m-3 p-4 rounded-lg bg-red-50 border border-red-200">
            <div className="flex items-start gap-2">
              <span className="text-2xl leading-none">⚠️</span>
              <div className="flex-1">
                <div className="text-sm font-medium text-red-900">{t("err.api.title")}</div>
                <div className="text-xs text-red-800 mt-1 font-light">{t("err.api.body")}</div>
                <button
                  onClick={() => { checkApi(); rawTrack("api_retry_clicked"); }}
                  className="mt-2 px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-medium"
                >
                  {t("err.api.retry")}
                </button>
              </div>
            </div>
          </div>
        )}
        {apiOk === null && (
          <div className="m-3 p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-2">
            <svg className="animate-spin h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <span className="text-xs text-slate-600 font-light">{t("err.api.connecting")}</span>
          </div>
        )}

        {/* STEP 1 */}
        <Section step={1} title={t("step1.title")} done={!!aoi}>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("step1.placeholder")}
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

        {/* STEP 2 */}
        <Section step={2} title={t("step2.title")} done={!!aoi} disabled={!mapReady}>
          {!aoi ? (
            <div className="space-y-2">
              {!isDrawing ? (
                <>
                  <button
                    onClick={startDraw}
                    disabled={!mapReady}
                    className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-md text-sm flex items-center justify-center gap-2"
                  >
                    {t("step2.draw")}
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-2 px-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-sm flex items-center justify-center gap-2"
                  >
                    {t("step2.upload")}
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
                  <p className="text-xs text-blue-900 mb-1">{t("step2.drawing.title")}</p>
                  <p className="text-xs text-blue-800 mb-2 font-light">{t("step2.drawing.help")}</p>
                  <button
                    onClick={cancelDraw}
                    className="w-full py-1.5 px-3 bg-white border border-blue-300 hover:bg-blue-50 text-blue-700 rounded-md text-xs"
                  >
                    {t("step2.cancel")}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3">
              <div className="flex justify-between items-start mb-1">
                <span className="text-sm text-emerald-900">{t("step2.done")}</span>
              </div>
              <p className="text-xs text-emerald-800 mb-2 font-light">{t("step2.approx", { km: aoiAreaKm2.toFixed(1) })}</p>
              <button
                onClick={clearAoi}
                className="w-full py-1.5 px-3 bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-700 rounded-md text-xs"
              >
                {t("step2.clear")}
              </button>
            </div>
          )}
        </Section>

        {/* STEP 3 */}
        <Section
          step={3}
          title={t("step3.title")}
          done={selectedLayers.size > 0}
          disabled={!aoi}
          hint={!aoi ? t("step3.needaoi") : t("step3.selected", { n: selectedLayers.size })}
        >
          <div className="space-y-1">
            {/* Hide layers that aren't available — keeps UI clean on free tier */}
            {layers.filter((l) => l.status !== "no_data").map((l) => {
              const sel = selectedLayers.has(l.slug);
              const vis = visibleLayers.has(l.slug);
              const loading = loadingLayer === l.slug;
              const color = LAYER_COLORS[l.slug];
              const isRaster = l.geom_type.toLowerCase() === "raster";
              const noData = l.status === "no_data";
              const disabled = !aoi || noData;
              const layerName = lang === "th" && l.name_th ? l.name_th : l.name_en;
              const featureLabel = isRaster
                ? t("step3.raster")
                : noData
                  ? t("step3.soon")
                  : t("step3.features", { n: l.feature_count.toLocaleString() });
              return (
                <div
                  key={l.slug}
                  className={`flex items-center gap-2 p-2 rounded-md border ${sel ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"} ${noData ? "opacity-60" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={sel}
                    onChange={() => !disabled && toggleLayerSelected(l.slug)}
                    disabled={disabled}
                    className="w-4 h-4 cursor-pointer"
                    title={noData ? "Data still being prepared" : ""}
                  />
                  <LayerSymbol geomType={l.geom_type} color={color} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-900 leading-tight truncate flex items-center gap-1">
                      {layerName}
                      {noData && <span className="text-[9px] px-1 rounded bg-amber-100 text-amber-800">SOON</span>}
                      {isRaster && !noData && <span className="text-[9px] px-1 rounded bg-purple-100 text-purple-800">RASTER</span>}
                    </div>
                    <div className="text-[11px] text-slate-500 leading-tight font-light">{featureLabel}</div>
                  </div>
                  <button
                    onClick={() => { setLayerInfoSlug(l.slug); track.layerInfoOpened(l.slug); }}
                    title="View layer details"
                    className="w-7 h-7 rounded text-xs flex items-center justify-center text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                  >
                    ⓘ
                  </button>
                  {!isRaster && (
                    <button
                      onClick={() => toggleLayerVisible(l.slug)}
                      disabled={loading || !mapReady || noData}
                      title={vis ? "Hide on map" : "Show on map"}
                      className={`w-8 h-8 rounded text-xs flex items-center justify-center transition ${vis ? "bg-slate-800 text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-600"} disabled:opacity-30`}
                    >
                      {loading ? <Spinner /> : (vis ? "👁" : "👁︎")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        {/* STEP 4 */}
        <Section step={4} title={t("step4.title")} disabled={!aoi || selectedLayers.size === 0}>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-slate-700 mb-1.5">{t("step4.formats")}</p>
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

            <div>
              <p className="text-xs text-slate-700 mb-1.5">{t("step4.crs")}</p>
              <select
                value={targetCrs}
                onChange={(e) => {
                  setTargetCrs(e.target.value);
                  try { localStorage.setItem(STORAGE.crs, e.target.value); } catch {}
                }}
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {CRS_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.short} ({o.code}) — {o.hint}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-500 mt-1 leading-tight font-light">
                {t("step4.crsHint")}
              </p>
            </div>

            <button
              onClick={runPreview}
              disabled={!aoi || selectedLayers.size === 0 || loadingPreview}
              className="w-full py-2 px-3 text-sm rounded-md bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 flex items-center justify-center gap-2"
            >
              {loadingPreview ? <><Spinner /> {t("step4.previewing")}</> : t("step4.preview")}
            </button>

            {preview && (
              <div className="bg-slate-50 border border-slate-200 rounded-md p-2.5">
                <div className="flex justify-between items-baseline mb-1.5">
                  <span className="text-xs text-slate-700">
                    {t("step4.total", { n: totalPreviewFeatures.toLocaleString() })}
                  </span>
                  <span className="text-xs font-medium text-emerald-700">{t("step4.free")}</span>
                </div>
                <div className="space-y-0.5 text-xs text-slate-600 font-light">
                  {Object.entries(preview).map(([slug, p]) => {
                    const layer = LAYERS.find((l) => l.slug === slug);
                    const name = layer ? (lang === "th" && layer.name_th ? layer.name_th : layer.name_en) : slug;
                    return (
                      <div key={slug} className="flex justify-between">
                        <span>{name}</span>
                        <span className="font-mono">{p.error ? <span className="text-red-600">err</span> : p.feature_count.toLocaleString()}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Failed-download retry banner */}
            {failedDownloadId && !loadingDownload && (
              <div className="bg-red-50 border border-red-200 rounded-md p-2.5 flex items-center justify-between gap-2">
                <span className="text-xs text-red-800">{t("step4.retry")}</span>
                <button
                  onClick={() => reDownload(failedDownloadId)}
                  className="px-2 py-1 text-xs rounded bg-white border border-red-300 hover:bg-red-50 text-red-700"
                >
                  {t("step4.retryBtn")}
                </button>
              </div>
            )}

            <button
              onClick={() => {
                if (!canDownload) return;
                // Show the donate nudge first; user picks Continue or Donate.
                setShowDownloadPrompt(true);
              }}
              disabled={!canDownload}
              className="w-full py-3 px-3 text-sm rounded-md font-medium bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white shadow-sm flex items-center justify-center gap-2"
            >
              {loadingDownload ? <><Spinner light /> {t("step4.downloading")}</> : t("step4.download")}
            </button>
            <p className="text-[11px] text-slate-500 text-center font-light">
              {t("step4.footer")}
            </p>
          </div>
        </Section>
      </aside>

      {/* ── Map ── */}
      <main style={{ gridArea: "map", position: "relative", overflow: "hidden" }}>
        <div
          ref={mapContainer}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" }}
        />

        {!mapReady && !mapError && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-100/80 backdrop-blur-sm z-10">
            <div className="text-center">
              <div className="text-4xl animate-pulse">🌏</div>
              <p className="text-sm text-slate-600 mt-2 font-light">{t("tip.loading")}</p>
            </div>
          </div>
        )}

        {mapError && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/95 z-10 p-6">
            <div className="max-w-lg bg-red-50 border border-red-200 rounded-xl p-6 shadow-lg">
              <div className="text-3xl mb-2">⚠️</div>
              <h3 className="text-red-900 mb-2 font-medium">{t("tip.maperror")}</h3>
              <p className="text-sm text-red-800 mb-4 break-words font-light">{mapError}</p>
            </div>
          </div>
        )}

        {/* Top progress bar — visible whenever any background fetch is in flight */}
        {anyLoading && !loadingDownload && (
          <div className="absolute top-0 left-0 right-0 h-0.5 z-30 overflow-hidden">
            <div className="h-full w-1/3 bg-blue-500 animate-[loading_1.2s_ease-in-out_infinite]"
                 style={{ animation: "loading-bar 1.2s ease-in-out infinite" }} />
          </div>
        )}

        {/* Floating tip */}
        {mapReady && !aoi && !isDrawing && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white rounded-full shadow-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 flex items-center gap-2 font-light">
            <span className="text-blue-600">▸</span>
            {t("tip.draw")}
          </div>
        )}
        {isDrawing && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-blue-600 rounded-full shadow-lg px-4 py-2 text-sm text-white flex items-center gap-2">
            <span className="animate-pulse">●</span>
            {t("tip.drawing")}
          </div>
        )}
      </main>

      {/* ── Toasts ── */}
      <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-50 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`max-w-sm rounded-lg shadow-lg px-4 py-3 text-sm border pointer-events-auto ${
              t.type === "error" ? "bg-red-50 text-red-900 border-red-200" :
              t.type === "success" ? "bg-emerald-50 text-emerald-900 border-emerald-200" :
              "bg-slate-800 text-white border-slate-700"
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>

      {/* ── Modals ── */}
      {showLogin && (
        <EmailLoginModal
          onClose={() => { setShowLogin(false); setPendingAction(null); }}
          onSubmit={handleLogin}
        />
      )}

      {showCredits && (
        <DonateModal onClose={() => setShowCredits(false)} />
      )}

      {showFeedback && (
        <FeedbackModal onClose={() => setShowFeedback(false)} />
      )}

      {showHistory && (
        <HistoryDrawer
          onClose={() => setShowHistory(false)}
          history={history}
          loading={loadingHistory}
          onRedownload={reDownload}
        />
      )}

      {showIntro && (
        <IntroModal
          onClose={() => {
            setShowIntro(false);
            try { localStorage.setItem(STORAGE.seenIntro, "1"); } catch {}
            track.introCompleted();
          }}
        />
      )}

      {showChangelog && (
        <ChangelogModal onClose={() => setShowChangelog(false)} />
      )}

      {layerInfoSlug && (
        <LayerDetailsModal
          slug={layerInfoSlug}
          apiBase={API_BASE}
          onClose={() => setLayerInfoSlug(null)}
        />
      )}

      {showDownloadPrompt && (
        <PreDownloadPrompt
          onClose={() => setShowDownloadPrompt(false)}
          onContinue={() => {
            setShowDownloadPrompt(false);
            track.preDownloadDecision("continue");
            runDownload();
          }}
          onDonate={() => {
            setShowDownloadPrompt(false);
            track.preDownloadDecision("donate");
            track.donateModalOpened("pre_download");
            setShowCredits(true);
          }}
        />
      )}

      {loadingDownload && <DownloadProgressOverlay />}

      {/* CSS for loading bar animation */}
      <style jsx global>{`
        @keyframes loading-bar {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function Spinner({ light = false }: { light?: boolean }) {
  return (
    <svg
      className={`animate-spin h-3.5 w-3.5 ${light ? "text-white" : "text-slate-600"}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

function Section({
  step, title, done = false, disabled = false, hint, children,
}: {
  step: number; title: string; done?: boolean; disabled?: boolean; hint?: string;
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

// ── Email login modal (soft auth)
function EmailLoginModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (e: string) => void }) {
  const { t } = useT();
  const [email, setEmail] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="text-3xl mb-2">✉️</div>
        <h2 className="text-lg text-slate-900 mb-1 font-medium">{t("login.title")}</h2>
        <p className="text-sm text-slate-600 mb-4 font-light">
          {t("login.subtitle")}
        </p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit(email)}
          autoFocus
          placeholder={t("login.placeholder")}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-md border border-slate-300 hover:bg-slate-50 text-sm text-slate-700"
          >
            {t("login.cancel")}
          </button>
          <button
            onClick={() => onSubmit(email)}
            disabled={!isValidEmail(email)}
            className="flex-1 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-sm text-white"
          >
            {t("login.continue")}
          </button>
        </div>
        <p className="mt-3 text-[11px] text-slate-500 font-light">
          {t("login.privacy")}
        </p>
      </div>
    </div>
  );
}

// ── Feedback / suggest-a-layer modal
// Lightweight: no backend endpoint. User picks a type, types a message,
// and we open their email client with a prefilled `mailto:` to kamp.guitar@gmail.com.
// Free, works on every device, and the inbox doubles as our roadmap board.
function FeedbackModal({ onClose }: { onClose: () => void }) {
  const { t, lang } = useT();
  const [kind, setKind] = useState<"feedback" | "layer" | "data" | "bug">("feedback");
  const [msg, setMsg] = useState("");
  const [email, setEmail] = useState(() => {
    try { return localStorage.getItem(STORAGE.email) || ""; } catch { return ""; }
  });

  const subjects: Record<typeof kind, string> = {
    feedback: "[Feedback] ",
    layer:    "[Layer request] ",
    data:     "[Share data] ",
    bug:      "[Bug] ",
  };

  const send = () => {
    if (!msg.trim()) return;
    rawTrack("feedback_submitted", { kind, has_email: !!email, lang });
    const subject = encodeURIComponent(subjects[kind] + msg.slice(0, 60));
    const body = encodeURIComponent(
      `Type: ${kind}\n` +
      `From: ${email || "(anonymous)"}\n` +
      `Language: ${lang}\n` +
      `Page: ${typeof window !== "undefined" ? window.location.href : ""}\n\n` +
      `--- Message ---\n${msg}\n`
    );
    window.location.href = `mailto:kamp.guitar@gmail.com?subject=${subject}&body=${body}`;
    setTimeout(onClose, 200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-xl text-slate-900 font-medium">💬 {t("feedback.title")}</h2>
            <p className="text-sm text-slate-600 mt-0.5 font-light">{t("feedback.subtitle")}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {(["feedback", "layer", "data", "bug"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`text-xs py-2 px-3 rounded-lg border transition ${
                kind === k
                  ? "bg-blue-50 border-blue-400 text-blue-900 font-medium"
                  : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
              }`}
            >
              {t(`feedback.kind.${k}`)}
            </button>
          ))}
        </div>

        <label className="block text-xs text-slate-600 mb-1">{t("feedback.emailLabel")}</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full mb-3 px-3 py-2 rounded-md border border-slate-200 focus:border-blue-400 focus:outline-none text-sm"
        />

        <label className="block text-xs text-slate-600 mb-1">{t("feedback.msgLabel")}</label>
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder={t(`feedback.placeholder.${kind}`)}
          rows={5}
          className="w-full mb-4 px-3 py-2 rounded-md border border-slate-200 focus:border-blue-400 focus:outline-none text-sm resize-none"
        />

        <button
          onClick={send}
          disabled={!msg.trim()}
          className="w-full py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-medium transition"
        >
          {t("feedback.send")}
        </button>
        <p className="mt-3 text-[11px] text-slate-500 font-light text-center">
          {t("feedback.privacy")}
        </p>
      </div>
    </div>
  );
}

// ── Credits / buy-pack modal
function DonateModal({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-xl text-slate-900 font-medium">{t("donate.title")}</h2>
            <p className="text-sm text-slate-600 mt-0.5 font-light">{t("donate.subtitle")}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>

        {/* ─── PromptPay (Thai, primary) ─── */}
        <div className="border border-slate-200 rounded-xl p-4 bg-slate-50" onClick={() => track.donateMethodClicked("promptpay")}>
          <p className="text-xs text-slate-700 mb-3 font-medium">{t("donate.promptpay")}</p>

          <div className="flex justify-center mb-3">
            <img
              src="/promptpay-qr.png"
              alt="PromptPay QR code"
              width={220}
              height={220}
              className="rounded-lg border border-slate-200 bg-white"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>

          <p className="text-[11px] text-slate-500 mb-2 text-center font-light">{t("donate.promptpayScan")}</p>

          <div className="bg-white border border-slate-200 rounded-lg p-2.5 text-center">
            <div className="text-[10px] text-slate-500 mb-0.5 font-light">{t("donate.promptpayNumber")}</div>
            <div className="font-mono text-lg text-slate-900 tracking-wider">083-256-2524</div>
            <div className="text-[10px] text-slate-500 mt-1 font-light">{t("donate.promptpayAccount")}</div>
          </div>
        </div>

        {/* ─── Buy Me a Coffee (international) ─── */}
        <a
          href="https://buymeacoffee.com/kampanart"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track.donateMethodClicked("bmac")}
          className="mt-3 flex flex-col items-center justify-center gap-0.5 w-full py-3 px-4 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-medium rounded-lg transition shadow-sm border border-yellow-500"
        >
          <span className="text-base">☕ Buy Me a Coffee</span>
          <span className="text-[10px] font-light opacity-80">{t("donate.bmacHint")}</span>
        </a>

        {/* ─── Free ways to support ─── */}
        <div className="mt-4 pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-700 mb-2 font-medium">{t("donate.altTitle")}</p>
          <div className="space-y-1.5">
            <ShareButton label={t("donate.altShare")} />
            <a
              href="https://github.com/r-reaper/geodata-hub"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track.donateMethodClicked("github_star")}
              className="flex items-center justify-center gap-2 w-full py-1.5 px-3 text-xs text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md font-light"
            >
              {t("donate.altStar")}
            </a>
            <a
              href="https://github.com/r-reaper/geodata-hub/issues/new"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track.donateMethodClicked("report_bug")}
              className="flex items-center justify-center gap-2 w-full py-1.5 px-3 text-xs text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md font-light"
            >
              {t("donate.altReport")}
            </a>
          </div>
        </div>

        <p className="mt-4 text-[11px] text-slate-500 text-center font-light">
          {t("donate.footer")}
        </p>
      </div>
    </div>
  );
}

// ── Changelog / "What's new" modal ────────────
// Driven by frontend/lib/changelog.ts. Click the version chip in the header
// to open it. The pink "NEW" badge disappears after first open (tracked in
// localStorage under STORAGE.seenVersion).
function ChangelogModal({ onClose }: { onClose: () => void }) {
  const { t, lang } = useT();
  const TAG_STYLES: Record<string, string> = {
    feature: "bg-blue-100 text-blue-800",
    fix:     "bg-emerald-100 text-emerald-800",
    data:    "bg-purple-100 text-purple-800",
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-xl text-slate-900 font-medium">{t("changelog.title")}</h2>
            <p className="text-xs text-slate-500 mt-0.5 font-light">{t("changelog.subtitle")}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>

        <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          {CHANGELOG.map((entry) => {
            const title = lang === "th" ? entry.title_th : entry.title_en;
            const items = lang === "th" ? entry.items_th : entry.items_en;
            return (
              <div key={entry.version}>
                <div className="flex items-baseline gap-2 mb-1.5">
                  <span className="text-sm font-mono text-slate-900 font-medium">v{entry.version}</span>
                  {entry.tag && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${TAG_STYLES[entry.tag] || "bg-slate-100 text-slate-700"}`}>
                      {entry.tag.toUpperCase()}
                    </span>
                  )}
                  <span className="text-[11px] text-slate-400 font-light">{entry.date}</span>
                </div>
                <p className="text-sm text-slate-900 mb-1.5">{title}</p>
                <ul className="space-y-0.5">
                  {items.map((it, i) => (
                    <li key={i} className="text-xs text-slate-700 leading-relaxed font-light pl-1">
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex justify-between items-center pt-3 border-t border-slate-100">
          <a
            href="https://github.com/r-reaper/geodata-hub/commits/main"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline font-light"
          >
            {t("changelog.viewAll")}
          </a>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"
          >
            {t("changelog.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Pre-download donate nudge ─────────────────
// Shown when user clicks the green "Download" button. Two clear actions:
// (1) Continue → starts the actual /clip-data download
// (2) Donate   → opens the full DonateModal (user can return and click again)
function PreDownloadPrompt({
  onClose, onContinue, onDonate,
}: {
  onClose: () => void;
  onContinue: () => void;
  onDonate: () => void;
}) {
  const { t } = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="text-center mb-4">
          <div className="text-3xl mb-2">💝</div>
          <h2 className="text-lg text-slate-900 font-medium">{t("predownload.title")}</h2>
          <p className="text-sm text-slate-600 mt-1 font-light">{t("predownload.subtitle")}</p>
        </div>

        <div className="space-y-2">
          {/* Primary action — Continue download */}
          <button
            onClick={onContinue}
            autoFocus
            className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-md font-medium transition"
          >
            {t("predownload.continue")}
          </button>

          {/* Secondary — Donate */}
          <button
            onClick={onDonate}
            className="w-full py-2.5 px-4 bg-pink-50 hover:bg-pink-100 border border-pink-200 text-pink-900 text-sm rounded-md transition"
          >
            {t("predownload.donate")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ShareButton({ label }: { label: string }) {
  const onShare = async () => {
    track.donateMethodClicked("share");
    const url = typeof window !== "undefined" ? window.location.origin : "";
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Thai GeoData Hub",
          text: "Free Thai OSM downloads with AOI clipping",
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        alert("Link copied to clipboard!");
      }
    } catch {}
  };
  return (
    <button
      onClick={onShare}
      className="flex items-center justify-center gap-2 w-full py-1.5 px-3 text-xs text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md font-light"
    >
      {label}
    </button>
  );
}

// ── History drawer (right slide-in)
function HistoryDrawer({
  onClose, history, loading, onRedownload,
}: {
  onClose: () => void;
  history: DownloadRecord[] | null;
  loading: boolean;
  onRedownload: (id: string) => void;
}) {
  const { t } = useT();
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center">
          <div>
            <h2 className="text-slate-900 font-medium">{t("history.title")}</h2>
            <p className="text-xs text-slate-500 font-light">{t("history.subtitle")}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading && (
            <div className="text-center text-sm text-slate-500 py-8 font-light">{t("history.loading")}</div>
          )}
          {!loading && history && history.length === 0 && (
            <div className="text-center text-sm text-slate-500 py-12 font-light">
              <div className="text-3xl mb-2">📭</div>
              {t("history.empty")}
            </div>
          )}
          {!loading && history && history.map((rec) => (
            <div key={rec.download_id} className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-2">
              <div className="flex justify-between items-start gap-2 mb-1">
                <span className="text-sm text-slate-900 truncate">{rec.filename}</span>
                <span className="text-[11px] text-slate-500 whitespace-nowrap font-light">{formatDate(rec.created_at)}</span>
              </div>
              <div className="text-xs text-slate-600 mb-2 font-light">
                {rec.layers.length} layers · {rec.total_features.toLocaleString()} features · {rec.size_mb.toFixed(1)} MB
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                {rec.layers.slice(0, 4).map((l) => (
                  <span key={l} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">{l}</span>
                ))}
                {rec.layers.length > 4 && <span className="text-[10px] text-slate-500">+{rec.layers.length - 4}</span>}
              </div>
              <button
                onClick={() => onRedownload(rec.download_id)}
                disabled={!rec.s3_key}
                className="w-full py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white"
              >
                {rec.s3_key ? t("history.again") : t("history.expired")}
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── First-visit walkthrough
function IntroModal({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const steps = [
    { n: 1, t: t("intro.s1.t"), d: t("intro.s1.d") },
    { n: 2, t: t("intro.s2.t"), d: t("intro.s2.d") },
    { n: 3, t: t("intro.s3.t"), d: t("intro.s3.d") },
    { n: 4, t: t("intro.s4.t"), d: t("intro.s4.d") },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="text-4xl mb-3">🇹🇭</div>
        <h2 className="text-xl text-slate-900 mb-1 font-medium">{t("intro.title")}</h2>
        <p className="text-sm text-slate-600 mb-5 font-light">
          {t("intro.subtitle")}
        </p>
        <div className="space-y-3 mb-5">
          {steps.map((s) => (
            <div key={s.n} className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-medium flex items-center justify-center">{s.n}</span>
              <div>
                <div className="font-medium text-sm text-slate-900">{s.t}</div>
                <div className="text-xs text-slate-600 font-light">{s.d}</div>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm"
        >
          {t("intro.cta")}
        </button>
      </div>
    </div>
  );
}

// ── Layer details modal (info icon → comprehensive metadata)
interface LayerDetails {
  slug: string;
  name_en: string;
  name_th: string;
  geom_type: string;
  data_type: string;
  feature_count: number;
  bbox: number[] | null;
  crs_native: string;
  crs_available: string[];
  source: string;
  source_url: string;
  license: string;
  license_url: string;
  attribution: string;
  last_refreshed: string | null;
  description: string;
  schema: Array<{ name: string; type: string }>;
  sample: Record<string, any>;
}

function LayerDetailsModal({ slug, apiBase, onClose }: { slug: string; apiBase: string; onClose: () => void }) {
  const { t, lang } = useT();
  const [details, setDetails] = useState<LayerDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${apiBase}/layers/${slug}/details`, { signal: AbortSignal.timeout(30000) });
        if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
        const d = await r.json();
        if (!cancelled) setDetails(d);
      } catch (e: any) {
        if (!cancelled) setErr(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug, apiBase]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center p-5 border-b border-slate-200">
          <div>
            <h2 className="text-lg text-slate-900 font-medium">{lang === "th" && details?.name_th ? details.name_th : (details?.name_en || slug)}</h2>
            <p className="text-xs text-slate-500 font-light">{lang === "th" ? details?.name_en : details?.name_th}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 text-sm">
          {loading && <div className="text-center text-slate-500 py-8 font-light">{t("details.loading")}</div>}
          {err && <div className="text-red-700 bg-red-50 border border-red-200 rounded p-3 text-xs">{err}</div>}
          {details && (
            <div className="space-y-4">
              {details.description && (
                <p className="text-slate-700 font-light">{details.description}</p>
              )}

              {/* Quick facts grid */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Fact label={t("details.geometry")}     value={details.geom_type} />
                <Fact label={t("details.featureCount")} value={details.feature_count.toLocaleString()} />
                <Fact label={t("details.crs")}          value={details.crs_native} />
                <Fact label={t("details.updated")}      value={details.last_refreshed ? new Date(details.last_refreshed).toLocaleDateString() : "—"} />
              </div>

              {/* Source / license */}
              <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-xs space-y-1.5">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">{t("details.source")}</span>
                  <a href={details.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-right">
                    {details.source} ↗
                  </a>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">{t("details.license")}</span>
                  <a href={details.license_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-right">
                    {details.license} ↗
                  </a>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">{t("details.attribution")}</span>
                  <code className="text-slate-900 text-[11px] text-right">{details.attribution}</code>
                </div>
              </div>

              {/* Available CRS output formats */}
              {details.crs_available?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-700 mb-1.5">{t("details.crsAvailable")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {details.crs_available.map((c) => (
                      <span key={c} className="text-[10px] px-2 py-1 rounded bg-blue-50 text-blue-800 border border-blue-200">{c}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Attribute schema */}
              {details.schema?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-700 mb-1.5">{t("details.schema", { n: details.schema.length })}</p>
                  <div className="border border-slate-200 rounded-md overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="text-left px-2 py-1 text-slate-700">{t("details.schemaField")}</th>
                          <th className="text-left px-2 py-1 text-slate-700">{t("details.schemaType")}</th>
                          <th className="text-left px-2 py-1 text-slate-700">{t("details.schemaSample")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.schema.map((s, i) => (
                          <tr key={s.name} className={i % 2 ? "bg-slate-50" : ""}>
                            <td className="px-2 py-1 font-mono text-slate-900">{s.name}</td>
                            <td className="px-2 py-1 text-slate-600">{s.type}</td>
                            <td className="px-2 py-1 text-slate-700 truncate max-w-xs">
                              {(() => {
                                const v = details.sample?.[s.name];
                                if (v === null || v === undefined) return <span className="text-slate-400">null</span>;
                                const str = typeof v === "object" ? JSON.stringify(v) : String(v);
                                return str.length > 50 ? str.slice(0, 50) + "…" : str;
                              })()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Bbox */}
              {details.bbox && details.bbox.length === 4 && (
                <div>
                  <p className="text-xs text-slate-700 mb-1.5">{t("details.bbox")}</p>
                  <code className="text-[11px] bg-slate-100 px-2 py-1 rounded block">
                    [{details.bbox.map((n) => n.toFixed(3)).join(", ")}]
                  </code>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">{label}</div>
      <div className="text-sm text-slate-900 font-medium truncate">{value}</div>
    </div>
  );
}

// ── Full-screen download progress overlay
function DownloadProgressOverlay() {
  const { t, lang } = useT();
  const subtitle = lang === "th"
    ? "กำลังตัดชั้นข้อมูลและรวมไฟล์ ใช้เวลา 5–30 วินาทีสำหรับพื้นที่ใหญ่"
    : "Clipping layers and bundling files. This can take 5–30 seconds for large areas.";
  const note = lang === "th"
    ? "ถ้าเบราว์เซอร์บล็อกการดาวน์โหลด ลองกดปุ่ม Retry ใต้รายการ — ไฟล์ถูกบันทึกแล้ว ดาวน์โหลดซ้ำได้ฟรี"
    : "If your browser blocks the download, check the retry banner — your file is saved and re-downloadable for free.";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-8 text-center">
        <div className="flex justify-center mb-4">
          <svg className="animate-spin h-12 w-12 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
        <h3 className="text-slate-900 mb-1 font-medium">{t("step4.downloading")}</h3>
        <p className="text-sm text-slate-600 font-light">{subtitle}</p>
        <p className="text-xs text-slate-400 mt-3 font-light">{note}</p>
      </div>
    </div>
  );
}
