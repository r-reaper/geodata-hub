// Thai GeoData Hub — MapSelector Component v2
// S3 + Stripe + Credit System + Thai Geocoding

"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface AOIFeature extends GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> {
  // extends the standard GeoJSON Feature type
}

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
  estimated_mb_kml?: number;
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

interface SearchResult {
  osm_id?: number;
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

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "YOUR_MAPBOX_TOKEN_HERE";
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const LAYERS_CATALOG: LayerInfo[] = [
  { slug: "roads",      name_en: "Road Network",               name_th: "เส้นทางจราจร",     geom_type: "Linestring", feature_count: 0 },
  { slug: "waterways", name_en: "Waterways",                    name_th: "แหล่งน้ำ",           geom_type: "Linestring", feature_count: 0 },
  { slug: "buildings", name_en: "Buildings",                   name_th: "อาคาร/สิ่งปลูกสร้าง",  geom_type: "Polygon",    feature_count: 0 },
  { slug: "province",  name_en: "Province Boundaries",         name_th: "ขอบเขตจังหวัด",     geom_type: "Polygon",    feature_count: 0 },
  { slug: "amphoe",    name_en: "District Boundaries",          name_th: "ขอบเขตอำเภอ",       geom_type: "Polygon",    feature_count: 0 },
  { slug: "tambon",    name_en: "Sub-district Boundaries",     name_th: "ขอบเขตตำบล",       geom_type: "Polygon",    feature_count: 0 },
];

const FORMAT_OPTIONS = [
  { value: "shp",     label: "Shapefile (.shp)", icon: "📦" },
  { value: "geojson", label: "GeoJSON (.geojson)", icon: "🗺️" },
  { value: "kml",     label: "KML (.kml)",        icon: "🁢" },
];

// Credit pricing tiers
const CREDIT_PACKS = [
  { credits: 100,  price_thb: 100,  label: "Starter",  popular: false },
  { credits: 500,  price_thb: 450,  label: "Explorer", popular: true  },
  { credits: 1000, price_thb: 800,  label: "Pro",      popular: false },
  { credits: 5000, price_thb: 3500, label: "Enterprise",popular: false },
];

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

interface ConfirmModalProps {
  creditsNeeded: number;
  userCredits: number;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmModal({ creditsNeeded, userCredits, onConfirm, onCancel }: ConfirmModalProps) {
  const canAfford = userCredits >= creditsNeeded;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-2">📥 Confirm Download</h2>
        <p className="text-gray-600 text-sm mb-4">
          This operation will cost <strong className="text-blue-600">{creditsNeeded} credits</strong>.
        </p>
        <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm">
          <div className="flex justify-between"><span>Your balance:</span><span className="font-medium">{userCredits} credits</span></div>
          <div className="flex justify-between"><span>Cost:</span><span className="font-medium text-red-500">-{creditsNeeded}</span></div>
          <hr className="my-2" />
          <div className="flex justify-between"><span>After:</span><span className={`font-bold ${canAfford ? "text-green-600" : "text-red-600"}`}>{userCredits - creditsNeeded} credits</span></div>
        </div>
        {!canAfford && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            ⚠️ Insufficient credits.{" "}
            <a href="/credits" className="underline font-medium">Top up here →</a>
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={!canAfford} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed">
            {canAfford ? "Confirm" : "Insufficient Credits"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface TopupModalProps {
  packs: { credits: number; price_thb: number; label: string; popular: boolean }[];
  onSelect: (pack: { credits: number; price_thb: number; label: string }) => void;
  onClose: () => void;
  loading: boolean;
}

function TopupModal({ packs, onSelect, onClose, loading }: TopupModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-800">💰 Top Up Credits</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
        <div className="space-y-3">
          {packs.map((pack) => (
            <button
              key={pack.credits}
              onClick={() => onSelect(pack)}
              disabled={loading}
              className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all ${
                pack.popular ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-300"
              }`}
            >
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

interface CreditBadgeProps {
  balance: number;
  onTopup: () => void;
}

interface EmailModalProps {
  onSubmit: (email: string) => void;
}

function EmailModal({ onSubmit }: EmailModalProps) {
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Please enter a valid email address.");
      return;
    }
    onSubmit(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-7">
        <div className="text-center mb-5">
          <div className="text-4xl mb-2">🇹🇭</div>
          <h2 className="text-xl font-bold text-gray-800">Welcome to Thai GeoData Hub</h2>
          <p className="text-gray-500 text-sm mt-1">Enter your email to track downloads and credits</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(""); }}
            placeholder="you@email.com"
            autoFocus
            className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            Start Exploring →
          </button>
        </form>
        <p className="text-xs text-gray-400 text-center mt-3">No password needed. Your email is your account ID.</p>
      </div>
    </div>
  );
}

function CreditBadge({ balance, onTopup }: CreditBadgeProps) {
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
  const [userId, setUserId] = useState<string>(() => localStorage.getItem("geodata_email") || "");
  const [showEmailModal, setShowEmailModal] = useState<boolean>(() => !localStorage.getItem("geodata_email"));
  const [creditBalance, setCreditBalance] = useState<CreditBalance>({ user_id: "", credits: 0 });

  // ── Selection
  const [layers, setLayers] = useState<LayerInfo[]>(LAYERS_CATALOG);
  const [selectedLayers, setSelectedLayers] = useState<string[]>(["roads"]);
  const [selectedFormats, setSelectedFormats] = useState<string[]>(["shp", "geojson"]);

  // ── Preview
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

  // ── Fetch credits on mount / when userId changes
  useEffect(() => {
    fetchLayers();
    if (userId) fetchCredits();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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
      map.addSource("aoi", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({ id: "aoi-fill", type: "fill", source: "aoi", paint: { "fill-color": "#3182CE", "fill-opacity": 0.15 } });
      map.addLayer({ id: "aoi-line", type: "line", source: "aoi" });
      map.addLayer({ id: "aoi-vertices", type: "circle", source: "aoi" });

      // Add search-result highlight layer
      map.addSource("search-aoi", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "search-aoi-fill", type: "fill", source: "search-aoi", paint: { "fill-color": "#F59E0B", "fill-opacity": 0.2 } });
      map.addLayer({ id: "search-aoi-line", type: "line", source: "search-aoi", paint: { "line-color": "#F59E0B", "line-width": 3 } });

      setMapReady(true);
    });

    // ── Polygon drawing
    let drawingPoints: [number, number][] = [];
    let drawingMarkers: mapboxgl.Marker[] = [];

    const startDrawing = () => {
      map.getCanvas().style.cursor = "crosshair";

      const onClick = (e: mapboxgl.MapMouseEvent) => {
        const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        drawingPoints.push(lngLat);

        const el = document.createElement("div");
        el.style.cssText = "width:12px;height:12px;background:#3182CE;border-radius:50%;border:2px solid white;cursor:pointer;";
        new mapboxgl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
        drawingMarkers.push(new mapboxgl.Marker({ element: el }).setLngLat(lngLat));

        if (drawingPoints.length >= 2) {
          if (map.getSource("draw-line")) {
            (map.getSource("draw-line") as mapboxgl.GeoJSONSource).setData({
              type: "Feature",
              geometry: { type: "LineString", coordinates: drawingPoints },
              properties: {},
            });
          } else {
            map.addSource("draw-line", {
              type: "geojson",
              data: { type: "Feature", geometry: { type: "LineString", coordinates: drawingPoints }, properties: {} },
            });
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
          updateAoiLayer(map, feature);
        }
        clearDrawing(map, drawingMarkers);
        cleanup();
      };

      const cleanup = () => {
        map.getCanvas().style.cursor = "";
        map.off("click", onClick);
        map.off("dblclick", onDblClick);
        if (map.getLayer("draw-line")) map.removeLayer("draw-line");
        if (map.getSource("draw-line")) map.removeSource("draw-line");
      };

      map.on("click", onClick);
      map.on("dblclick", onDblClick);

      const onKeydown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          clearDrawing(map, drawingMarkers);
          cleanup();
        }
      };
      map.on("keydown", onKeydown);
    };

    map.on("load", startDrawing);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  const updateAoiLayer = (map: mapboxgl.Map, feature: GeoJSON.Feature) => {
    const src = map.getSource("aoi") as mapboxgl.GeoJSONSource;
    if (src) src.setData({ type: "FeatureCollection", features: [feature] });
  };

  const clearDrawing = (map: mapboxgl.Map, markers: mapboxgl.Marker[]) => {
    markers.forEach((m) => m.remove());
    if (map.getLayer("draw-line")) map.removeLayer("draw-line");
    if (map.getSource("draw-line")) map.removeSource("draw-line");
    map.getCanvas().style.cursor = "";
  };

  const drawSearchAoi = useCallback((bbox: number[]) => {
    if (!mapRef.current || !mapReady) return;
    const map = mapRef.current;
    // bbox: [minx, miny, maxx, maxy]
    const coords: [number, number][] = [
      [bbox[0], bbox[1]], [bbox[2], bbox[1]],
      [bbox[2], bbox[3]], [bbox[0], bbox[3]], [bbox[0], bbox[1]],
    ];
    const feature: AOIFeature = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [coords] },
      properties: {},
    };
    const src = map.getSource("search-aoi") as mapboxgl.GeoJSONSource;
    if (src) src.setData({ type: "FeatureCollection", features: [feature] });
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 50, duration: 1500 });
  }, [mapReady]);

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
      if (resp.ok) {
        const data = await resp.json();
        setCreditBalance(data);
      }
    } catch {
      // fallback demo credits
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
    } catch {
      // keep static catalog
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || searchQuery.length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE}/search-location?q=${encodeURIComponent(searchQuery.trim())}`);
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setSearchResults(data.results || []);
    } catch (err: any) {
      console.error("Search failed:", err);
    } finally {
      setSearching(false);
    }
  };

  const handleSelectSearchResult = (result: SearchResult) => {
    if (!mapRef.current) return;
    mapRef.current.flyTo({ center: [result.lng, result.lat], zoom: 12, duration: 1500 });
    if (result.bbox) drawSearchAoi(result.bbox);
    setSearchResults([]);
    setSearchQuery("");
  };

  const handlePreview = async () => {
    if (!aoi || selectedLayers.length === 0) {
      setError("Please draw an AOI and select at least one layer.");
      return;
    }
    setLoadingPreview(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aoi, layers: selectedLayers, formats: selectedFormats }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.detail || "Preview failed");
      }
      const data = await resp.json();
      setPreviewResults(data.layers || {});
    } catch (err: any) {
      setError(`Preview failed: ${err.message}`);
    } finally {
      setLoadingPreview(false);
    }
  };

  const calculateCreditsNeeded = (): number => {
    const totalFeatures = Object.values(previewResults).reduce((sum, r) => sum + (r?.feature_count || 0), 0);
    const totalMb = Object.values(previewResults).reduce((sum, r) => sum + (r?.estimated_mb_geojson || 0), 0);
    if (totalFeatures <= 50) return 0;
    const featureCredits = Math.floor((totalFeatures - 50) / 100);
    const sizeCredits = Math.max(0, Math.floor((totalMb - 5) / 10));
    return Math.max(5, featureCredits + sizeCredits);
  };

  const handleDownloadClick = async () => {
    if (!aoi || selectedLayers.length === 0) {
      setError("Please draw an AOI and select at least one layer.");
      return;
    }
    // Run preview first if not yet run
    if (Object.keys(previewResults).length === 0) {
      await handlePreview();
    }
    const needed = calculateCreditsNeeded();
    if (needed > 0 && creditBalance.credits < needed) {
      setError(`Insufficient credits. You need ${needed} but have ${creditBalance.credits}. Please top up.`);
      setShowTopup(true);
      return;
    }
    if (needed > 0) {
      setShowConfirm(true);
    } else {
      await executeDownload(needed);
    }
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
        body: JSON.stringify({
          aoi,
          layers: selectedLayers,
          formats: selectedFormats,
          user_id: userId,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        if (resp.status === 402) {
          setError(`❌ Insufficient credits: ${err.detail}`);
          setShowTopup(true);
          return;
        }
        throw new Error(err.detail || "Clip failed");
      }
      const result: ClipResult = await resp.json();
      setClipResult(result);

      // Refresh credit balance
      await fetchCredits();

      // Trigger download via presigned URL
      const downloadUrl = result.presigned_url || `${API_BASE}/download/${result.download_id}`;
      if (result.presigned_url) {
        // Open presigned URL in new tab to trigger download
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        // Fallback: direct download from local endpoint
        window.location.href = downloadUrl;
      }
    } catch (err: any) {
      setError(`Download failed: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  const handleTopupSelect = async (pack: { credits: number; price_thb: number; label: string }) => {
    setTopupLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/payments/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          amount: pack.credits,
          redirect_url: `${window.location.origin}/credits?success=1`,
          cancel_url: `${window.location.origin}/credits?canceled=1`,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      // Redirect to Stripe Checkout
      window.location.href = data.checkout_url;
    } catch (err: any) {
      setError(`Top-up failed: ${err.message}`);
    } finally {
      setTopupLoading(false);
    }
  };

  // ─────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────

  const totalEstimatedMb = Object.values(previewResults).reduce((sum, r) => sum + (r?.estimated_mb_geojson || 0), 0);
  const totalFeatures = Object.values(previewResults).reduce((sum, r) => sum + (r?.feature_count || 0), 0);
  const creditsNeeded = calculateCreditsNeeded();

  const toggleLayer = (slug: string) =>
    setSelectedLayers((prev) => prev.includes(slug) ? prev.filter((l) => l !== slug) : [...prev, slug]);

  const toggleFormat = (fmt: string) =>
    setSelectedFormats((prev) => prev.includes(fmt) ? prev.filter((f) => f !== fmt) : [...prev, fmt]);

  const clearAoi = () => {
    if (!mapRef.current || !mapReady) return;
    setAoi(null);
    setAoiCoords(null);
    setPreviewResults({});
    setClipResult(null);
    setError(null);
    const src = mapRef.current.getSource("aoi") as mapboxgl.GeoJSONSource;
    src?.setData({ type: "FeatureCollection", features: [] });
    const searchSrc = mapRef.current.getSource("search-aoi") as mapboxgl.GeoJSONSource;
    searchSrc?.setData({ type: "FeatureCollection", features: [] });
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* ── Header */}
      <header className="bg-blue-700 text-white px-6 py-3 flex items-center justify-between shadow-md">
        <div>
          <h1 className="text-lg font-bold">🇹🇭 Thai GeoData Hub</h1>
          <p className="text-blue-200 text-xs">Select Area → Choose Layers → Download</p>
        </div>
        <div className="flex items-center gap-4">
          {userId && (
            <span className="text-blue-200 text-xs hidden sm:block truncate max-w-[160px]" title={userId}>
              {userId}
            </span>
          )}
          <CreditBadge balance={creditBalance.credits} onTopup={() => setShowTopup(true)} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar */}
        <aside className="w-80 bg-white border-r border-gray-200 flex flex-col overflow-y-auto shadow-lg">

          {/* Location search */}
          <div className="p-4 border-b border-gray-200">
            <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">🔍 Search Thailand</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="e.g. Chiang Mai, กรุงเทพ..."
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button onClick={handleSearch} disabled={searching} className="bg-blue-600 text-white px-3 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
                {searching ? "..." : "Go"}
              </button>
            </div>
            {searchResults.length > 0 && (
              <ul className="mt-2 bg-gray-50 rounded border border-gray-200 max-h-48 overflow-y-auto">
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

          {/* Layer selection */}
          <div className="p-4 border-b border-gray-200">
            <label className="text-xs font-semibold text-gray-500 uppercase mb-2 block">📂 Layers</label>
            <div className="space-y-1.5">
              {layers.map((layer) => (
                <label key={layer.slug}
                  className={`flex items-center gap-3 p-2 rounded border cursor-pointer transition ${selectedLayers.includes(layer.slug) ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-300"}`}>
                  <input type="checkbox" checked={selectedLayers.includes(layer.slug)} onChange={() => toggleLayer(layer.slug)} className="w-4 h-4 text-blue-600 rounded" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{layer.name_en}</p>
                    <p className="text-xs text-gray-500 truncate">{layer.name_th}</p>
                  </div>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{layer.geom_type}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Format selection */}
          <div className="p-4 border-b border-gray-200">
            <label className="text-xs font-semibold text-gray-500 uppercase mb-2 block">📦 Formats</label>
            <div className="space-y-1.5">
              {FORMAT_OPTIONS.map((fmt) => (
                <label key={fmt.value}
                  className={`flex items-center gap-3 p-2 rounded border cursor-pointer transition ${selectedFormats.includes(fmt.value) ? "border-blue-500 bg-blue-50" : "border-gray-200"}`}>
                  <input type="checkbox" checked={selectedFormats.includes(fmt.value)} onChange={() => toggleFormat(fmt.value)} className="w-4 h-4" />
                  <span className="text-sm">{fmt.icon} {fmt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* AOI status & actions */}
          <div className="p-4 border-b border-gray-200">
            {aoi ? (
              <div className="mb-3 p-3 bg-blue-50 rounded border border-blue-200">
                <p className="text-sm text-blue-700 font-medium">✅ AOI Selected</p>
                <p className="text-xs text-blue-500 mt-1">{String(((aoiCoords?.[0]?.length ?? 0) - 1 || 0))} vertices</p>
              </div>
            ) : (
              <p className="text-xs text-gray-400 mb-3">Click on the map to draw a polygon AOI</p>
            )}
            <div className="flex gap-2">
              <button onClick={handlePreview} disabled={!aoi || selectedLayers.length === 0 || loadingPreview}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded text-sm hover:bg-gray-200 disabled:opacity-50">
                {loadingPreview ? "⏳ Calculating..." : "🔍 Preview"}
              </button>
              {aoi && (
                <button onClick={clearAoi} className="px-3 py-2 bg-red-50 text-red-600 rounded text-sm hover:bg-red-100">
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Preview results */}
          {Object.keys(previewResults).length > 0 && (
            <div className="p-4 border-b border-gray-200 bg-yellow-50">
              <label className="text-xs font-semibold text-yellow-700 uppercase mb-2 block">📊 Preview</label>
              <div className="space-y-1.5">
                {Object.entries(previewResults).map(([slug, result]) => (
                  <div key={slug} className="bg-white rounded border p-2">
                    <p className="text-sm font-medium text-gray-800">{slug}</p>
                    <p className="text-xs text-gray-500">{result.feature_count?.toLocaleString() ?? 0} features</p>
                    {result.estimated_mb_geojson !== undefined && (
                      <p className="text-xs text-gray-400">~{(result.estimated_mb_geojson ?? 0).toFixed(2)} MB</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 p-2 bg-yellow-100 rounded text-xs space-y-1">
                <div className="flex justify-between"><span>Total features:</span><span className="font-semibold">{(totalFeatures ?? 0).toLocaleString()}</span></div>
                <div className="flex justify-between"><span>Est. size:</span><span className="font-semibold">~{(totalEstimatedMb ?? 0).toFixed(2)} MB</span></div>
                {creditsNeeded > 0 && (
                  <div className="flex justify-between text-blue-700"><span>Credits needed:</span><span className="font-bold">{creditsNeeded}</span></div>
                )}
              </div>
            </div>
          )}

          {/* Download section */}
          <div className="p-4 mt-auto">
            {error && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-xs flex items-start gap-2">
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}
            {clipResult && (
              <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded text-green-700 text-xs">
                <p className="font-semibold">✅ Download started!</p>
                <p className="text-green-600 mt-1">{clipResult.filename}</p>
                <p className="text-green-500">{clipResult.size_mb} MB | {clipResult.total_features.toLocaleString()} features</p>
                {clipResult.credits_used !== undefined && clipResult.credits_used > 0 && (
                  <p className="text-green-400 mt-1">-{clipResult.credits_used} credits</p>
                )}
              </div>
            )}
            <button
              onClick={handleDownloadClick}
              disabled={!aoi || selectedLayers.length === 0 || selectedFormats.length === 0}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm"
            >
              📥 {aoi ? `Download (${creditsNeeded} cr)` : "Draw AOI First"}
            </button>
            <p className="text-xs text-gray-400 mt-2 text-center">
              {selectedLayers.length} layer(s) · {selectedFormats.length} format(s)
            </p>
          </div>
        </aside>

        {/* ── Map */}
        <main ref={mapContainer} className="flex-1 relative">
          {!mapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
              <div className="text-center text-gray-500">
                <div className="text-5xl mb-4 animate-spin">🌏</div>
                <p className="font-medium">Loading map engine...</p>
              </div>
            </div>
          )}
          {mapReady && (
            <div className="absolute top-4 left-4 z-10 bg-white rounded shadow p-3 text-xs">
              <p className="font-semibold text-gray-700 mb-1">🖱️ Draw AOI</p>
              <ol className="text-gray-500 space-y-0.5">
                <li>1. Click to add vertices</li>
                <li>2. Double-click to close</li>
                <li>3. Esc to cancel</li>
              </ol>
            </div>
          )}
        </main>
      </div>

      {/* ── Modals */}
      {showEmailModal && <EmailModal onSubmit={handleEmailSubmit} />}
      {downloading && <Spinner message="Preparing your download..." />}
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