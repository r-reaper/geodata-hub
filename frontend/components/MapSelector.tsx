// Thai GeoData Hub — MapSelector Component v3
// Features: S3 + Stripe + Credits + Layer Map Preview + Download History

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
}

interface PreviewResult {
  slug: string;
  feature_count: number;
  estimated_mb_shp?: number;
  estimated_mb_geojson?: number;
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

interface CreditBalance {
  user_id: string;
  credits: number;
  mode?: string;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const LAYERS_CATALOG: LayerInfo[] = [
  { slug: "roads",      name_en: "Road Network",            name_th: "เส้นทางจราจร",          geom_type: "Linestring", feature_count: 0 },
  { slug: "waterways",  name_en: "Waterways",                name_th: "แหล่งน้ำ",               geom_type: "Linestring", feature_count: 0 },
  { slug: "railways",   name_en: "Railways",                 name_th: "ทางรถไฟ",               geom_type: "Linestring", feature_count: 0 },
  { slug: "buildings",  name_en: "Buildings",                name_th: "อาคาร/สิ่งปลูกสร้าง",    geom_type: "Polygon",    feature_count: 0 },
  { slug: "landuse",    name_en: "Land Use",                 name_th: "การใช้ประโยชน์ที่ดิน",    geom_type: "Polygon",    feature_count: 0 },
  { slug: "natural",    name_en: "Natural Features",         name_th: "ลักษณะทางธรรมชาติ",     geom_type: "Polygon",    feature_count: 0 },
  { slug: "pois",       name_en: "Points of Interest",       name_th: "สถานที่สำคัญ",           geom_type: "Point",      feature_count: 0 },
  { slug: "province",   name_en: "Province Boundaries",      name_th: "ขอบเขตจังหวัด",         geom_type: "Polygon",    feature_count: 0 },
  { slug: "amphoe",     name_en: "District Boundaries",      name_th: "ขอบเขตอำเภอ",           geom_type: "Polygon",    feature_count: 0 },
  { slug: "tambon",     name_en: "Sub-district Boundaries",  name_th: "ขอบเขตตำบล",           geom_type: "Polygon",    feature_count: 0 },
];

const FORMAT_OPTIONS = [
  { value: "shp",     label: "Shapefile (.shp)",   icon: "📦" },
  { value: "geojson", label: "GeoJSON (.geojson)",  icon: "🗺️" },
  { value: "kml",     label: "KML (.kml)",          icon: "📍" },
];

const CREDIT_PACKS = [
  { credits: 100,  price_thb: 100,  label: "Starter",   popular: false },
  { credits: 500,  price_thb: 450,  label: "Explorer",  popular: true  },
  { credits: 1000, price_thb: 800,  label: "Pro",       popular: false },
  { credits: 5000, price_thb: 3500, label: "Enterprise",popular: false },
];

// Layer preview colors on the map
const PREVIEW_COLORS: Record<string, string> = {
  roads:      "#E74C3C",
  waterways:  "#3498DB",
  railways:   "#8E44AD",
  buildings:  "#F39C12",
  landuse:    "#27AE60",
  natural:    "#1ABC9C",
  pois:       "#E91E63",
  province:   "#2ECC71",
  amphoe:     "#9B59B6",
  tambon:     "#FF5722",
};

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function Spinner({ message = "Processing..." }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl p-6 flex flex-col items-center gap-3">
        <div className="text-4xl animate-spin">🌏</div>
        <p className="text-gray-700 font-medium">{message}</p>
        <div className="w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600 animate-pulse rounded-full w-3/4" />
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ creditsNeeded, userCredits, onConfirm, onCancel }: {
  creditsNeeded: number; userCredits: number;
  onConfirm: () => void; onCancel: () => void;
}) {
  const canAfford = userCredits >= creditsNeeded;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-2">📥 Confirm Download</h2>
        <p className="text-gray-600 text-sm mb-4">
          This will cost <strong className="text-blue-600">{creditsNeeded} credits</strong>.
        </p>
        <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm space-y-1">
          <div className="flex justify-between"><span>Balance:</span><span className="font-medium">{userCredits} cr</span></div>
          <div className="flex justify-between text-red-500"><span>Cost:</span><span className="font-medium">−{creditsNeeded} cr</span></div>
          <hr className="my-1" />
          <div className="flex justify-between"><span>After:</span>
            <span className={`font-bold ${canAfford ? "text-green-600" : "text-red-600"}`}>{userCredits - creditsNeeded} cr</span>
          </div>
        </div>
        {!canAfford && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            ⚠️ Not enough credits. <a href="/credits" className="underline font-medium">Top up →</a>
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium">Cancel</button>
          <button onClick={onConfirm} disabled={!canAfford} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed">
            {canAfford ? "Confirm" : "Insufficient"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TopupModal({ packs, onSelect, onClose, loading }: {
  packs: typeof CREDIT_PACKS;
  onSelect: (pack: typeof CREDIT_PACKS[0]) => void;
  onClose: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-800">💰 Top Up Credits</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
        <div className="space-y-3">
          {packs.map((pack) => (
            <button key={pack.credits} onClick={() => onSelect(pack)} disabled={loading}
              className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all ${
                pack.popular ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-300"}`}>
              <div className="text-left">
                <p className="font-bold text-gray-800">{pack.label}</p>
                <p className="text-sm text-gray-500">{pack.credits.toLocaleString()} credits</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-blue-600">฿{pack.price_thb.toLocaleString()}</p>
                {pack.popular && <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">Popular</span>}
              </div>
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-4 text-center">Powered by Stripe — secure checkout</p>
      </div>
    </div>
  );
}

function EmailModal({ onSubmit }: { onSubmit: (email: string) => void }) {
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-7">
        <div className="text-center mb-5">
          <div className="text-4xl mb-2">🇹🇭</div>
          <h2 className="text-xl font-bold text-gray-800">Welcome to Thai GeoData Hub</h2>
          <p className="text-gray-500 text-sm mt-1">Enter your email to track downloads and credits</p>
        </div>
        <form onSubmit={(e) => {
          e.preventDefault();
          const t = email.trim().toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) { setError("Enter a valid email."); return; }
          onSubmit(t);
        }} className="space-y-3">
          <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }}
            placeholder="you@email.com" autoFocus
            className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition">
            Start Exploring →
          </button>
        </form>
        <p className="text-xs text-gray-400 text-center mt-3">No password needed. Your email is your account ID.</p>
      </div>
    </div>
  );
}

function CreditBadge({ balance, onTopup }: { balance: number; onTopup: () => void }) {
  return (
    <div className="flex items-center gap-2 bg-blue-700 text-white px-4 py-2 rounded-full text-sm">
      <span>💳</span>
      <span className="font-semibold">{balance.toLocaleString()}</span>
      <span className="text-blue-200">credits</span>
      <button onClick={onTopup} className="ml-2 bg-blue-500 hover:bg-blue-400 px-3 py-0.5 rounded-full text-xs font-medium transition">
        + Top up
      </button>
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

  // ── Map state
  const [mapReady, setMapReady] = useState(false);

  // ── AOI
  const [aoi, setAoi] = useState<AOIFeature | null>(null);
  const [aoiCoords, setAoiCoords] = useState<number[][][] | null>(null);

  // ── User & credits
  const [userId, setUserId] = useState<string>(() =>
    typeof window !== "undefined" ? (localStorage.getItem("geodata_email") || "") : ""
  );
  const [showEmailModal, setShowEmailModal] = useState<boolean>(() =>
    typeof window !== "undefined" ? !localStorage.getItem("geodata_email") : true
  );
  const [creditBalance, setCreditBalance] = useState<CreditBalance>({ user_id: "", credits: 0 });

  // ── Sidebar tabs
  const [activeTab, setActiveTab] = useState<"layers" | "downloads">("layers");

  // ── Layer selection
  const [layers, setLayers] = useState<LayerInfo[]>(LAYERS_CATALOG);
  const [selectedLayers, setSelectedLayers] = useState<string[]>(["roads"]);
  const [selectedFormats, setSelectedFormats] = useState<string[]>(["shp", "geojson"]);

  // ── Layer map preview
  const [loadingPreviewSlug, setLoadingPreviewSlug] = useState<string | null>(null);
  const previewLayersOnMap = useRef<Set<string>>(new Set());

  // ── AOI Preview (feature count)
  const [previewResults, setPreviewResults] = useState<Record<string, PreviewResult>>({});
  const [loadingPreview, setLoadingPreview] = useState(false);

  // ── Download
  const [downloading, setDownloading] = useState(false);
  const [clipResult, setClipResult] = useState<ClipResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Modals
  const [showConfirm, setShowConfirm] = useState(false);
  const [showTopup, setShowTopup] = useState(false);
  const [topupLoading, setTopupLoading] = useState(false);

  // ── Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // ── Download history
  const [downloadHistory, setDownloadHistory] = useState<DownloadRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [redownloading, setRedownloading] = useState<string | null>(null);

  // ── Effects
  useEffect(() => {
    fetchLayers();
    if (userId) fetchCredits();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (activeTab === "downloads" && userId) {
      fetchHistory();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, userId]);

  // ── Initialize map
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [100.9925, 15.8700],
      zoom: 6,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(new mapboxgl.ScaleControl(), "bottom-left");

    map.on("load", () => {
      // AOI layer
      map.addSource("aoi", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "aoi-fill", type: "fill", source: "aoi", paint: { "fill-color": "#3182CE", "fill-opacity": 0.15 } });
      map.addLayer({ id: "aoi-line", type: "line", source: "aoi", paint: { "line-color": "#3182CE", "line-width": 2 } });

      // Search-result highlight layer
      map.addSource("search-aoi", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "search-aoi-fill", type: "fill", source: "search-aoi", paint: { "fill-color": "#F59E0B", "fill-opacity": 0.2 } });
      map.addLayer({ id: "search-aoi-line", type: "line", source: "search-aoi", paint: { "line-color": "#F59E0B", "line-width": 3 } });

      setMapReady(true);
    });

    // ── Polygon drawing
    let drawingPoints: [number, number][] = [];
    const drawingMarkers: mapboxgl.Marker[] = [];

    const startDrawing = () => {
      map.getCanvas().style.cursor = "crosshair";

      const onClick = (e: mapboxgl.MapMouseEvent) => {
        const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        drawingPoints.push(lngLat);

        const el = document.createElement("div");
        el.style.cssText = "width:10px;height:10px;background:#3182CE;border-radius:50%;border:2px solid white;";
        const m = new mapboxgl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
        drawingMarkers.push(m);

        if (drawingPoints.length >= 2) {
          const lineData: GeoJSON.Feature = { type: "Feature", geometry: { type: "LineString", coordinates: drawingPoints }, properties: {} };
          if (map.getSource("draw-line")) {
            (map.getSource("draw-line") as mapboxgl.GeoJSONSource).setData(lineData);
          } else {
            map.addSource("draw-line", { type: "geojson", data: lineData });
            map.addLayer({ id: "draw-line", type: "line", source: "draw-line", paint: { "line-color": "#3182CE", "line-width": 2 } });
          }
        }
      };

      const onDblClick = (e: mapboxgl.MapMouseEvent) => {
        e.preventDefault();
        if (drawingPoints.length >= 3) {
          const coords = [...drawingPoints, drawingPoints[0]];
          setAoiCoords([coords]);
          const feature: AOIFeature = { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} };
          setAoi(feature);
          const src = map.getSource("aoi") as mapboxgl.GeoJSONSource;
          src?.setData({ type: "FeatureCollection", features: [feature] });
        }
        drawingMarkers.forEach((m) => m.remove());
        drawingMarkers.length = 0;
        drawingPoints = [];
        cleanup();
      };

      const cleanup = () => {
        map.getCanvas().style.cursor = "";
        map.off("click", onClick);
        map.off("dblclick", onDblClick);
        if (map.getLayer("draw-line")) map.removeLayer("draw-line");
        if (map.getSource("draw-line")) map.removeSource("draw-line");
      };

      const onKeydown = (e: KeyboardEvent) => {
        if (e.key === "Escape") { drawingMarkers.forEach((m) => m.remove()); drawingMarkers.length = 0; drawingPoints = []; cleanup(); }
      };

      map.on("click", onClick);
      map.on("dblclick", onDblClick);
      map.getContainer().addEventListener("keydown", onKeydown, { once: true });
    };

    map.on("load", startDrawing);
    mapRef.current = map;

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ─────────────────────────────────────────────
  // Layer map preview helpers
  // ─────────────────────────────────────────────

  const addLayerPreview = useCallback(async (slug: string) => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    setLoadingPreviewSlug(slug);
    try {
      const bounds = map.getBounds();
      const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
      const resp = await fetch(`${API_BASE}/layer-sample/${slug}?bbox=${bbox}&limit=200`);
      if (!resp.ok) return;
      const geojson = await resp.json();

      const sourceId = `preview-${slug}`;
      const layerId  = `preview-${slug}-layer`;
      const color    = PREVIEW_COLORS[slug] || "#888888";
      const meta     = LAYERS_CATALOG.find((l) => l.slug === slug);
      const geomType = (meta?.geom_type || "").toLowerCase();

      if (map.getSource(sourceId)) {
        (map.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(geojson);
      } else {
        map.addSource(sourceId, { type: "geojson", data: geojson });
      }

      if (!map.getLayer(layerId)) {
        if (geomType === "point") {
          map.addLayer({ id: layerId, type: "circle", source: sourceId,
            paint: { "circle-color": color, "circle-radius": 5, "circle-opacity": 0.85 } });
        } else if (geomType === "polygon") {
          map.addLayer({ id: layerId, type: "fill", source: sourceId,
            paint: { "fill-color": color, "fill-opacity": 0.25, "fill-outline-color": color } });
        } else {
          map.addLayer({ id: layerId, type: "line", source: sourceId,
            paint: { "line-color": color, "line-width": 2, "line-opacity": 0.85 } });
        }
      }

      previewLayersOnMap.current.add(slug);
    } catch (err) {
      console.warn(`Layer preview failed for ${slug}:`, err);
    } finally {
      setLoadingPreviewSlug(null);
    }
  }, [mapReady]);

  const removeLayerPreview = useCallback((slug: string) => {
    const map = mapRef.current;
    if (!map) return;
    const sourceId = `preview-${slug}`;
    const layerId  = `preview-${slug}-layer`;
    if (map.getLayer(layerId))  map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    previewLayersOnMap.current.delete(slug);
  }, []);

  // ─────────────────────────────────────────────
  // API calls
  // ─────────────────────────────────────────────

  const handleEmailSubmit = (email: string) => {
    localStorage.setItem("geodata_email", email);
    setUserId(email);
    setShowEmailModal(false);
  };

  const fetchCredits = async () => {
    try {
      const resp = await fetch(`${API_BASE}/payments/credits/${userId}`);
      if (resp.ok) setCreditBalance(await resp.json());
    } catch {
      setCreditBalance({ user_id: userId, credits: 0, mode: "demo" });
    }
  };

  const fetchLayers = async () => {
    try {
      const resp = await fetch(`${API_BASE}/layers`);
      if (resp.ok) {
        const data = await resp.json();
        setLayers(data.length ? data : LAYERS_CATALOG);
      }
    } catch { /* keep static catalog */ }
  };

  const fetchHistory = async () => {
    if (!userId) return;
    setHistoryLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/history/${userId}`);
      if (resp.ok) {
        const data = await resp.json();
        setDownloadHistory(data.downloads || []);
      }
    } catch { /* ignore */ }
    finally { setHistoryLoading(false); }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || searchQuery.length < 2) return;
    setSearching(true);
    try {
      const resp = await fetch(`${API_BASE}/search-location?q=${encodeURIComponent(searchQuery.trim())}`);
      if (resp.ok) {
        const data = await resp.json();
        setSearchResults(data.results || []);
      }
    } catch { /* ignore */ }
    finally { setSearching(false); }
  };

  const handleSelectSearchResult = (result: SearchResult) => {
    if (!mapRef.current) return;
    mapRef.current.flyTo({ center: [result.lng, result.lat], zoom: 12, duration: 1500 });
    if (result.bbox) {
      const bbox = result.bbox;
      const coords: [number, number][] = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]], [bbox[0], bbox[1]]];
      const feature: AOIFeature = { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} };
      const src = mapRef.current.getSource("search-aoi") as mapboxgl.GeoJSONSource;
      src?.setData({ type: "FeatureCollection", features: [feature] });
      mapRef.current.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 50, duration: 1500 });
    }
    setSearchResults([]);
    setSearchQuery("");
  };

  const handlePreview = async () => {
    if (!aoi || selectedLayers.length === 0) { setError("Draw an AOI and select at least one layer."); return; }
    setLoadingPreview(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aoi, layers: selectedLayers, formats: selectedFormats }),
      });
      if (!resp.ok) throw new Error((await resp.json()).detail || "Preview failed");
      const data = await resp.json();
      setPreviewResults(data.layers || {});
    } catch (err: unknown) {
      setError(`Preview failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingPreview(false);
    }
  };

  const calculateCreditsNeeded = (): number => {
    const totalFeatures = Object.values(previewResults).reduce((s, r) => s + (r?.feature_count || 0), 0);
    const totalMb = Object.values(previewResults).reduce((s, r) => s + (r?.estimated_mb_geojson || 0), 0);
    if (totalFeatures <= 50) return 0;
    return Math.max(5, Math.floor((totalFeatures - 50) / 100) + Math.max(0, Math.floor((totalMb - 5) / 10)));
  };

  const handleDownloadClick = async () => {
    if (!aoi || selectedLayers.length === 0) { setError("Draw an AOI and select a layer."); return; }
    if (Object.keys(previewResults).length === 0) await handlePreview();
    const needed = calculateCreditsNeeded();
    if (needed > 0 && creditBalance.credits < needed) {
      setError(`Need ${needed} credits, you have ${creditBalance.credits}. Please top up.`);
      setShowTopup(true);
      return;
    }
    if (needed > 0) setShowConfirm(true);
    else await executeDownload(needed);
  };

  const executeDownload = async (creditsNeeded: number) => {
    setShowConfirm(false);
    setDownloading(true);
    setError(null);
    setClipResult(null);
    try {
      const resp = await fetch(`${API_BASE}/clip-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aoi, layers: selectedLayers, formats: selectedFormats, user_id: userId }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        if (resp.status === 402) { setError(`❌ ${err.detail}`); setShowTopup(true); return; }
        throw new Error(err.detail || "Clip failed");
      }
      const result: ClipResult = await resp.json();
      setClipResult(result);
      await fetchCredits();

      // Refresh history if on downloads tab
      if (activeTab === "downloads") fetchHistory();

      // Trigger download
      const url = result.presigned_url || `${API_BASE}/download/${result.download_id}`;
      const a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (err: unknown) {
      setError(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDownloading(false);
    }
  };

  const handleTopupSelect = async (pack: typeof CREDIT_PACKS[0]) => {
    setTopupLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/payments/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, amount: pack.credits,
          redirect_url: `${window.location.origin}/credits?success=1`,
          cancel_url: `${window.location.origin}/credits?canceled=1` }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      window.location.href = data.checkout_url;
    } catch (err: unknown) {
      setError(`Top-up failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTopupLoading(false);
    }
  };

  const handleRedownload = async (record: DownloadRecord) => {
    setRedownloading(record.download_id);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE}/redownload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, download_id: record.download_id }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.detail || "Re-download failed");
      }
      const data = await resp.json();
      const a = document.createElement("a");
      a.href = data.presigned_url; a.target = "_blank"; a.rel = "noopener noreferrer";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (err: unknown) {
      setError(`Re-download failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRedownloading(null);
    }
  };

  // ─────────────────────────────────────────────
  // Layer toggle (with map preview)
  // ─────────────────────────────────────────────

  const toggleLayer = (slug: string) => {
    const isSelected = selectedLayers.includes(slug);
    setSelectedLayers((prev) => isSelected ? prev.filter((l) => l !== slug) : [...prev, slug]);

    if (mapReady) {
      if (isSelected) {
        removeLayerPreview(slug);
      } else {
        addLayerPreview(slug);
      }
    }
  };

  const toggleFormat = (fmt: string) =>
    setSelectedFormats((prev) => prev.includes(fmt) ? prev.filter((f) => f !== fmt) : [...prev, fmt]);

  const clearAoi = () => {
    setAoi(null); setAoiCoords(null); setPreviewResults({}); setClipResult(null); setError(null);
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (map.getSource("aoi") as mapboxgl.GeoJSONSource)?.setData({ type: "FeatureCollection", features: [] });
    (map.getSource("search-aoi") as mapboxgl.GeoJSONSource)?.setData({ type: "FeatureCollection", features: [] });
  };

  // ─────────────────────────────────────────────
  // Derived values
  // ─────────────────────────────────────────────

  const totalEstimatedMb = Object.values(previewResults).reduce((s, r) => s + (r?.estimated_mb_geojson || 0), 0);
  const totalFeatures = Object.values(previewResults).reduce((s, r) => s + (r?.feature_count || 0), 0);
  const creditsNeeded = calculateCreditsNeeded();

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* ── Header */}
      <header className="bg-blue-700 text-white px-6 py-3 flex items-center justify-between shadow-md z-10">
        <div>
          <h1 className="text-lg font-bold">🇹🇭 Thai GeoData Hub</h1>
          <p className="text-blue-200 text-xs">Select Area → Choose Layers → Download</p>
        </div>
        <div className="flex items-center gap-4">
          {userId && (
            <span className="text-blue-200 text-xs hidden sm:block truncate max-w-[160px]" title={userId}>{userId}</span>
          )}
          <CreditBadge balance={creditBalance.credits} onTopup={() => setShowTopup(true)} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar */}
        <aside className="w-80 bg-white border-r border-gray-200 flex flex-col shadow-lg overflow-hidden">

          {/* ── Search */}
          <div className="p-4 border-b border-gray-200 shrink-0">
            <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">🔍 Search Thailand</label>
            <div className="flex gap-2">
              <input type="text" value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="e.g. Chiang Mai, กรุงเทพ..."
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={handleSearch} disabled={searching}
                className="bg-blue-600 text-white px-3 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
                {searching ? "…" : "Go"}
              </button>
            </div>
            {searchResults.length > 0 && (
              <ul className="mt-2 bg-gray-50 rounded border border-gray-200 max-h-40 overflow-y-auto">
                {searchResults.map((r, i) => (
                  <li key={i} onClick={() => handleSelectSearchResult(r)}
                    className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 border-b border-gray-100 last:border-0 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-800">{r.name_en}</p>
                      <p className="text-xs text-gray-500">{r.name_th}</p>
                    </div>
                    <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">{r.type}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Tabs */}
          <div className="flex border-b border-gray-200 shrink-0">
            {(["layers", "downloads"] as const).map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                  activeTab === tab
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "text-gray-500 hover:text-gray-700"}`}>
                {tab === "layers" ? "📂 Layers" : "📋 My Downloads"}
              </button>
            ))}
          </div>

          {/* ── Layers Tab */}
          {activeTab === "layers" && (
            <div className="flex-1 overflow-y-auto flex flex-col">

              {/* Layer selection */}
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-500 uppercase">Layers</label>
                  <span className="text-xs text-gray-400">Click map to preview</span>
                </div>
                <div className="space-y-1.5">
                  {layers.map((layer) => {
                    const isSelected = selectedLayers.includes(layer.slug);
                    const isLoadingPreview = loadingPreviewSlug === layer.slug;
                    const hasPreview = previewLayersOnMap.current.has(layer.slug);
                    const dotColor = PREVIEW_COLORS[layer.slug] || "#888";
                    return (
                      <label key={layer.slug}
                        className={`flex items-center gap-3 p-2 rounded border cursor-pointer transition ${
                          isSelected ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-300"}`}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleLayer(layer.slug)}
                          className="w-4 h-4 text-blue-600 rounded shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{layer.name_en}</p>
                          <p className="text-xs text-gray-500 truncate">{layer.name_th}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isLoadingPreview && <span className="text-xs animate-spin">⏳</span>}
                          {!isLoadingPreview && hasPreview && (
                            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: dotColor }} title="Visible on map" />
                          )}
                          <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{layer.geom_type}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Format selection */}
              <div className="p-4 border-b border-gray-200">
                <label className="text-xs font-semibold text-gray-500 uppercase mb-2 block">📦 Formats</label>
                <div className="space-y-1.5">
                  {FORMAT_OPTIONS.map((fmt) => (
                    <label key={fmt.value}
                      className={`flex items-center gap-3 p-2 rounded border cursor-pointer transition ${
                        selectedFormats.includes(fmt.value) ? "border-blue-500 bg-blue-50" : "border-gray-200"}`}>
                      <input type="checkbox" checked={selectedFormats.includes(fmt.value)} onChange={() => toggleFormat(fmt.value)}
                        className="w-4 h-4 shrink-0" />
                      <span className="text-sm">{fmt.icon} {fmt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* AOI status */}
              <div className="p-4 border-b border-gray-200">
                {aoi ? (
                  <div className="mb-3 p-3 bg-blue-50 rounded border border-blue-200">
                    <p className="text-sm text-blue-700 font-medium">✅ AOI Selected</p>
                    <p className="text-xs text-blue-500 mt-1">{((aoiCoords?.[0]?.length ?? 1) - 1)} vertices</p>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 mb-3">Click on the map to draw a polygon AOI</p>
                )}
                <div className="flex gap-2">
                  <button onClick={handlePreview} disabled={!aoi || selectedLayers.length === 0 || loadingPreview}
                    className="flex-1 bg-gray-100 text-gray-700 py-2 rounded text-sm hover:bg-gray-200 disabled:opacity-50">
                    {loadingPreview ? "⏳ Calculating…" : "🔍 Preview Count"}
                  </button>
                  {aoi && (
                    <button onClick={clearAoi} className="px-3 py-2 bg-red-50 text-red-600 rounded text-sm hover:bg-red-100">✕</button>
                  )}
                </div>
              </div>

              {/* Preview results */}
              {Object.keys(previewResults).length > 0 && (
                <div className="p-4 border-b border-gray-200 bg-yellow-50">
                  <label className="text-xs font-semibold text-yellow-700 uppercase mb-2 block">📊 AOI Preview</label>
                  <div className="space-y-1.5">
                    {Object.entries(previewResults).map(([slug, result]) => (
                      <div key={slug} className="bg-white rounded border p-2">
                        <p className="text-sm font-medium text-gray-800">{slug}</p>
                        <p className="text-xs text-gray-500">{(result.feature_count || 0).toLocaleString()} features</p>
                        {result.estimated_mb_geojson !== undefined && (
                          <p className="text-xs text-gray-400">~{(result.estimated_mb_geojson || 0).toFixed(2)} MB</p>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 p-2 bg-yellow-100 rounded text-xs space-y-1">
                    <div className="flex justify-between"><span>Total features:</span><span className="font-semibold">{totalFeatures.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Est. size:</span><span className="font-semibold">~{totalEstimatedMb.toFixed(2)} MB</span></div>
                    {creditsNeeded > 0 && (
                      <div className="flex justify-between text-blue-700"><span>Credits needed:</span><span className="font-bold">{creditsNeeded}</span></div>
                    )}
                  </div>
                </div>
              )}

              {/* Download section */}
              <div className="p-4 mt-auto">
                {error && (
                  <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-xs flex gap-2">
                    <span>⚠️</span><span>{error}</span>
                  </div>
                )}
                {clipResult && (
                  <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded text-green-700 text-xs">
                    <p className="font-semibold">✅ Download started!</p>
                    <p className="text-green-600 mt-1 truncate">{clipResult.filename}</p>
                    <p className="text-green-500">{clipResult.size_mb} MB · {clipResult.total_features.toLocaleString()} features</p>
                    {(clipResult.credits_used ?? 0) > 0 && (
                      <p className="text-green-400 mt-0.5">−{clipResult.credits_used} credits</p>
                    )}
                  </div>
                )}
                <button onClick={handleDownloadClick}
                  disabled={!aoi || selectedLayers.length === 0 || selectedFormats.length === 0}
                  className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm">
                  📥 {aoi ? `Download (${creditsNeeded} cr)` : "Draw AOI First"}
                </button>
                <p className="text-xs text-gray-400 mt-2 text-center">
                  {selectedLayers.length} layer(s) · {selectedFormats.length} format(s)
                </p>
              </div>
            </div>
          )}

          {/* ── Downloads Tab */}
          {activeTab === "downloads" && (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-semibold text-gray-500 uppercase">Download History</label>
                <button onClick={fetchHistory} disabled={historyLoading}
                  className="text-xs text-blue-600 hover:underline disabled:opacity-50">
                  {historyLoading ? "Loading…" : "↺ Refresh"}
                </button>
              </div>

              {error && (
                <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
                  ⚠️ {error}
                </div>
              )}

              {!historyLoading && downloadHistory.length === 0 && (
                <div className="text-center py-10 text-gray-400">
                  <p className="text-3xl mb-2">📭</p>
                  <p className="text-sm font-medium">No downloads yet</p>
                  <p className="text-xs mt-1">Draw an AOI and download data to see history here.</p>
                </div>
              )}

              <div className="space-y-3">
                {downloadHistory.map((record) => {
                  const date = new Date(record.created_at).toLocaleDateString("en-GB", {
                    day: "2-digit", month: "short", year: "numeric",
                  });
                  const hasS3 = Boolean(record.s3_key);
                  return (
                    <div key={record.download_id}
                      className="border border-gray-200 rounded-xl p-3 bg-white hover:border-blue-300 transition">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-800 truncate" title={record.filename}>
                            {record.filename}
                          </p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {record.layers.map((l) => (
                              <span key={l} className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{l}</span>
                            ))}
                          </div>
                          <p className="text-xs text-gray-400 mt-1">
                            {record.size_mb} MB · {record.total_features?.toLocaleString() ?? 0} features · {date}
                          </p>
                          {record.credits_used > 0 && (
                            <p className="text-xs text-blue-500">−{record.credits_used} credits</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleRedownload(record)}
                          disabled={!hasS3 || redownloading === record.download_id}
                          title={!hasS3 ? "File no longer available in cloud storage" : "Re-download for free"}
                          className={`shrink-0 px-2.5 py-1.5 text-xs rounded-lg font-medium transition ${
                            hasS3
                              ? "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                              : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}>
                          {redownloading === record.download_id ? "…" : hasS3 ? "↓ Download" : "Expired"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        {/* ── Map */}
        <main ref={mapContainer} className="flex-1 relative">
          {!mapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
              <div className="text-center text-gray-500">
                <div className="text-5xl mb-4 animate-spin">🌏</div>
                <p className="font-medium">Loading map engine…</p>
              </div>
            </div>
          )}
          {mapReady && (
            <div className="absolute top-4 left-4 z-10 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-3 text-xs max-w-[180px]">
              <p className="font-semibold text-gray-700 mb-1">🖱️ Draw AOI</p>
              <ol className="text-gray-500 space-y-0.5">
                <li>1. Click to add vertices</li>
                <li>2. Double-click to close</li>
                <li>3. Esc to cancel</li>
              </ol>
              {previewLayersOnMap.current.size > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-200">
                  <p className="font-semibold text-gray-600 mb-1">Map Layers:</p>
                  <div className="space-y-0.5">
                    {Array.from(previewLayersOnMap.current).map((slug) => (
                      <div key={slug} className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full inline-block shrink-0"
                          style={{ background: PREVIEW_COLORS[slug] || "#888" }} />
                        <span className="text-gray-600 truncate">{slug}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ── Modals */}
      {showEmailModal && <EmailModal onSubmit={handleEmailSubmit} />}
      {downloading && <Spinner message="Preparing your download…" />}
      {showConfirm && (
        <ConfirmModal
          creditsNeeded={creditsNeeded}
          userCredits={creditBalance.credits}
          onConfirm={() => executeDownload(creditsNeeded)}
          onCancel={() => setShowConfirm(false)}
        />
      )}
      {showTopup && (
        <TopupModal
          packs={CREDIT_PACKS}
          onSelect={handleTopupSelect}
          onClose={() => setShowTopup(false)}
          loading={topupLoading}
        />
      )}
    </div>
  );
}
