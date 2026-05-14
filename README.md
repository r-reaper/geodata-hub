# Thai GeoData Hub

> Free, open Thai GIS data — clipped and downloaded by area of interest.
> 15 layers across OSM, Microsoft Buildings, WorldPop, and NASA SRTM.

**Live:** [geodata-hub.vercel.app](https://geodata-hub.vercel.app)

---

## What it does

Draw a polygon (or upload a GeoJSON / KML) anywhere in Thailand, pick layers,
hit download. You get a ZIP containing the clipped data as **SHP**, **GeoJSON**,
and **KML**, plus per-source `ATTRIBUTION.txt` and `LICENSE.txt` files.

No signup. No paywall. Donation-supported (PromptPay + Buy Me a Coffee).

### Layers available (15 active)

| Source | Layers |
|---|---|
| **OpenStreetMap** (ODbL) | Provinces, Districts, Sub-districts, Roads, Waterways, Railways, Buildings, Land use, Natural, Parks, Temples, POIs |
| **Microsoft Building Footprints** (ODbL) | Buildings (urban subset — 2.73M across 8 metros) |
| **WorldPop** (CC BY 4.0) | Population grid 2020 (100 m) |
| **NASA SRTM** (public domain) | Elevation 30 m DEM |

Not redistributed (would require explicit permission): RTSD topomaps,
DOL cadastre, GISTDA satellite, GADM, Google Buildings v3.

---

## Architecture

```
┌──────────────────────────┐         ┌──────────────────────────┐
│  Next.js (Vercel)        │ ─────►  │  FastAPI (Railway)       │
│  - Mapbox GL JS          │  REST   │  - Layer catalog         │
│  - i18n (TH / EN)        │ ◄─────  │  - AOI clip pipeline     │
│  - PostHog analytics     │         │  - Multi-format export   │
└──────────────────────────┘         └────────┬─────────────────┘
                                              │
                                              ▼
                          ┌────────────────────────────────┐
                          │ Local volume (Railway disk)    │
                          │  data/{slug}.fgb   (FlatGeobuf)│
                          │  data/{slug}.tif   (rasters)   │
                          │  data/*_metadata.json          │
                          └────────────────────────────────┘
                                              ▲
                                              │ initial seed
                          ┌────────────────────────────────┐
                          │ Cloudflare R2 (S3-compat)      │
                          │  Backup of all source layers   │
                          └────────────────────────────────┘
```

- **Storage model:** file-based (FlatGeobuf for vectors, GeoTIFF for rasters).
  No Postgres / PostGIS in production — kept simpler so the free-tier
  Railway container starts in seconds.
- **State:** `credits.json` and `history.json` on container disk. Donation-only
  mode, so losing them on redeploy is acceptable.

---

## Project structure

```
GeoData_Hub/
├── backend/                 FastAPI app (deployed on Railway)
│   ├── main.py              REST endpoints
│   ├── payments.py          Stripe (currently disabled — donation mode)
│   ├── history.py           Download history (file-backed)
│   └── requirements.txt
│
├── frontend/                Next.js 14 app router (deployed on Vercel)
│   ├── app/
│   │   ├── page.tsx               Landing → MapSelector
│   │   ├── attributions/page.tsx  Source credits + licenses
│   │   ├── privacy/page.tsx       Privacy policy (TH / EN)
│   │   ├── credits/page.tsx       Donation success page
│   │   ├── icon.svg               Favicon
│   │   └── opengraph-image.tsx    Auto-generated link previews
│   ├── components/
│   │   └── MapSelector.tsx        Main app (map + sidebar + modals)
│   └── lib/
│       ├── i18n.ts                90+ bilingual strings
│       ├── analytics.ts           PostHog wrapper (17 events)
│       └── changelog.ts           Versioned release notes
│
├── scripts/                 One-off data ingestion (run locally)
│   ├── osm_fetcher.py             Overpass API → FlatGeobuf
│   ├── ms_buildings_fetcher.py    Microsoft Global Buildings → FGB
│   ├── ms_buildings_urban_crop.py 4.7 GB → 542 MB urban subset
│   ├── worldpop_fetcher.py        WorldPop GeoTIFF
│   ├── srtm_fetcher.py            OpenTopography SRTM 30m
│   ├── clipper_service.py         AOI clipping (vector + raster)
│   ├── raster_clipper.py          Rasterio crop + reproject
│   ├── s3_storage.py              R2 / S3 uploads + presigned URLs
│   ├── attribution.py             Generates per-ZIP credit files
│   └── convert_to_fgb.py          GeoJSON → FlatGeobuf utility
│
├── data/                    Layer metadata (per-slug JSON, tracked in git)
│                            Actual .fgb / .tif files live on Railway disk
│
├── Dockerfile               Railway build entry
└── railway.toml             Railway config
```

---

## Local development

```bash
# Backend (FastAPI)
cd backend
python -m venv .venv && source .venv/bin/activate  # or .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (Next.js)
cd frontend
npm install
echo 'NEXT_PUBLIC_API_URL=http://localhost:8000' > .env.local
npm run dev
```

Visit http://localhost:3000.

For layer data, either:
- copy `.fgb` / `.tif` files into `data/` from the R2 bucket, or
- run `scripts/osm_fetcher.py --layer roads` etc. to fetch fresh

---

## Deployment

| Component | Host | Trigger |
|---|---|---|
| Frontend | Vercel | `git push` to main |
| Backend  | Railway | `git push` to main |
| Data     | Cloudflare R2 | Manual upload via `scripts/s3_storage.py` |

Required env vars on Railway:
```
S3_ENDPOINT_URL, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET_NAME
ALLOWED_ORIGINS=https://geodata-hub.vercel.app
```

Required env vars on Vercel:
```
NEXT_PUBLIC_API_URL=https://<your>.up.railway.app
NEXT_PUBLIC_POSTHOG_KEY=phc_...   (optional — no-op if unset)
NEXT_PUBLIC_MAPBOX_TOKEN=pk....
```

---

## Licenses

- **Code:** open source (see project root, no LICENSE file enforced yet —
  contributions welcome under MIT-style terms).
- **Data:** each layer keeps its upstream license. ATTRIBUTION.txt and
  LICENSE.txt are bundled in every download ZIP. ODbL data (OSM, Microsoft
  Buildings) means derivative databases must also be ODbL.

See `/attributions` page on the live site for the full table.

---

## Contact

- 💬 Feedback / layer requests: click the **Feedback** button on the site,
  or email kamp.guitar@gmail.com
- ☕ Support: [buymeacoffee.com/kampanart](https://buymeacoffee.com/kampanart)
- 🇹🇭 PromptPay QR is on the donation modal
