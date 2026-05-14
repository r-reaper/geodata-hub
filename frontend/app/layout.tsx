import type { Metadata } from 'next'
import { IBM_Plex_Sans_Thai } from 'next/font/google'
import './globals.css'

// IBM Plex Sans Thai — minimal modern font, supports both Thai and Latin
// glyphs in a single family. Loaded via next/font/google for self-hosted
// performance and no CLS.
const plexThai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['300', '400', '500', '600'],
  display: 'swap',
  variable: '--font-plex-thai',
})

// Site URL is used to absolute-ize OG image paths. Override via
// NEXT_PUBLIC_SITE_URL in Vercel if the production hostname changes.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || 'https://geodata-hub.vercel.app'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Thai GeoData Hub · ดาวน์โหลดข้อมูล GIS ไทยฟรี',
    template: '%s · Thai GeoData Hub',
  },
  description:
    'Free Thai GIS data by area of interest — OpenStreetMap, building footprints, population, elevation. Clip and download as SHP, GeoJSON, or KML. ดาวน์โหลดข้อมูล GIS ของไทยฟรี โดยเลือกพื้นที่ที่ต้องการ',
  keywords: [
    'Thailand GIS', 'OSM Thailand', 'Thai shapefile', 'Thailand boundaries',
    'WorldPop Thailand', 'SRTM Thailand', 'Microsoft Buildings Thailand',
    'GIS ไทย', 'ดาวน์โหลด shapefile ไทย', 'ข้อมูลแผนที่ไทย',
  ],
  authors: [{ name: 'Kampanart', url: 'https://buymeacoffee.com/kampanart' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    alternateLocale: ['th_TH'],
    url: SITE_URL,
    siteName: 'Thai GeoData Hub',
    title: 'Thai GeoData Hub · Free Thai GIS data by area',
    description:
      'Clip and download Thai OSM, buildings, population, and elevation data for any area of interest. Free, open licenses.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Thai GeoData Hub — interactive map of Thailand with downloadable GIS layers',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Thai GeoData Hub · Free Thai GIS data',
    description:
      'Clip Thai spatial data by area of interest — free, open-licensed, multi-format export.',
    images: ['/og-image.png'],
  },
  robots: { index: true, follow: true },
  // Drop a 1200×630 PNG at `frontend/public/og-image.png` to make link
  // previews (LINE, Facebook, X, Slack) show a real screenshot of the map.
  // Until that file exists, the OG image link will 404 but everything else
  // (title, description, structured data) still works fine.
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={plexThai.variable}>
      <head>
        <link
          href='https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.css'
          rel='stylesheet'
        />
      </head>
      <body className="antialiased font-sans">{children}</body>
    </html>
  )
}
