// Thai GeoData Hub — Next.js App Router page

import dynamic from "next/dynamic";

// Dynamic import to avoid SSR issues with Mapbox
const MapSelector = dynamic(() => import("@/components/MapSelector"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen bg-gray-100">
      <div className="text-center">
        <div className="text-5xl mb-4 animate-spin">🌏</div>
        <p className="text-gray-600 font-medium">Loading map engine...</p>
      </div>
    </div>
  ),
});

export default function HomePage() {
  return <MapSelector />;
}
