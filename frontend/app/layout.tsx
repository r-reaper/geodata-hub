import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Thai GeoData Hub',
  description: 'Browse, preview, and download Thai spatial data by AOI',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link
          href='https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.css'
          rel='stylesheet'
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  )
}
