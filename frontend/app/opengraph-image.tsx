import { ImageResponse } from 'next/og'

// Next.js auto-generates an OG image at /opengraph-image when it sees this
// file in app/. Used for LINE / Facebook / X / Slack link previews.
// No static PNG file needed; the image is rendered server-side on demand
// and cached on the edge.
export const runtime = 'edge'
export const alt = 'Thai GeoData Hub — free Thai GIS data clipped by area'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          background:
            'linear-gradient(135deg, #0F172A 0%, #1E3A8A 50%, #0F766E 100%)',
          padding: '72px 80px',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Top row: flag + tagline chip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div
            style={{
              fontSize: 96,
              lineHeight: 1,
              filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.4))',
            }}
          >
            🇹🇭
          </div>
          <div
            style={{
              padding: '10px 20px',
              background: 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 999,
              fontSize: 22,
              fontWeight: 500,
              color: '#E2E8F0',
            }}
          >
            Free · Open data · No signup
          </div>
        </div>

        {/* Main title */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div
            style={{
              fontSize: 84,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -2,
            }}
          >
            Thai GeoData Hub
          </div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 400,
              color: '#CBD5E1',
              lineHeight: 1.3,
              maxWidth: 1000,
            }}
          >
            Clip Thai OSM, buildings, population &amp; elevation by your area of
            interest. Download as SHP, GeoJSON, or KML.
          </div>
        </div>

        {/* Bottom row: layer badges */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            fontSize: 20,
            color: '#E2E8F0',
          }}
        >
          {[
            '🛣 Roads',
            '🏢 Buildings (2.7M)',
            '👥 Population',
            '🏔 Elevation 30m',
            '🌳 Land use',
            '📍 POIs',
            '🇹🇭 Admin boundaries',
          ].map((s) => (
            <span
              key={s}
              style={{
                padding: '8px 16px',
                background: 'rgba(255,255,255,0.10)',
                border: '1px solid rgba(255,255,255,0.20)',
                borderRadius: 8,
              }}
            >
              {s}
            </span>
          ))}
        </div>
      </div>
    ),
    { ...size }
  )
}
