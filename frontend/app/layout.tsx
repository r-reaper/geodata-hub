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

export const metadata: Metadata = {
  title: 'Thai GeoData Hub',
  description: 'Browse, preview, and download Thai spatial data by area of interest — free OSM clipping with multi-format export.',
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
