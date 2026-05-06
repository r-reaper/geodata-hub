# 🇹🇭 Thai GeoData Hub

> Micro-SaaS platform for browsing, previewing, and clipping Thai spatial data (administrative boundaries, roads, water bodies, buildings) by Area of Interest (AOI).

---

## 🗺️ Architecture

```
OSM Overpass API
       ↓
osm_fetcher.py        ← Pulls raw OSM data for Thailand
       ↓
  PostGIS / PostgreSQL   ← Stores & indexes spatial data
       ↓
FastAPI Backend         ← REST API (layers, preview, clip, download)
       ↓
Next.js Frontend        ← Mapbox GL JS AOI selector + download UI
       ↓
User Browser            ← Downloads clipped .zip (SHP / GeoJSON / KML)
```

---

## 📁 Project Structure

```
GeoData_Hub/
├── scripts/
│   ├── db_schema.sql          ← PostGIS tables + indexes + triggers
│   ├── osm_fetcher.py         ← Overpass API → PostGIS pipeline
│   └── clipper_service.py     ← Core clipping logic + ZIP packaging
├── backend/
│   ├── main.py                ← FastAPI app (all endpoints)
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── components/
│   │   └── MapSelector.tsx   ← Interactive AOI map component
│   └── ...                   ← Next.js App Router setup
├── docker-compose.yml
└── README.md
```

---

## ⚡ Quick Start

### 1. Spin up infrastructure
```bash
docker compose up -d db
```
Waits for PostgreSQL to be ready (healthcheck).

### 2. Run schema
```bash
docker compose up -d   # also starts API
```
Or manually:
```bash
psql -h localhost -U geodata_admin -d geodata_hub -f scripts/db_schema.sql
```

### 3. Fetch OSM data (first time)
```bash
cd scripts
python osm_fetcher.py --ensure-schema --layer all
```

### 4. Start API
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 5. Start Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## 🌐 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/layers` | List all available spatial layers |
| GET | `/layers/{slug}` | Get metadata for one layer |
| POST | `/preview` | Calculate feature count + size for AOI |
| POST | `/clip-data` | Clip layers to AOI → return ZIP |
| GET | `/credits/{user_id}` | Check user download credits |
| POST | `/credits/topup` | Add credits to user account |
| GET | `/health` | Health check |
| POST | `/admin/refresh/{slug}` | Trigger OSM data refresh |

---

## 📦 Fetching OSM Data

```bash
# All layers
python osm_fetcher.py --layer all --ensure-schema

# Individual layers
python osm_fetcher.py --layer roads --ensure-schema
python osm_fetcher.py --layer buildings --ensure-schema
python osm_fetcher.py --layer waterways --ensure-schema
```

Thailand bbox is split into 12 tiles automatically to avoid Overpass API timeout.

---

## 🗂️ Clip & Download Pipeline

```
User draws polygon on Mapbox map
        ↓
POST /preview → estimates features + MB per layer
        ↓
User selects formats (SHP / GeoJSON / KML)
        ↓
POST /clip-data
        ↓
  GeoPandas: spatial intersection (clip)
  GeoPandas: export to multiple drivers
  ZIP all files together
        ↓
Return download link / trigger browser download
```

---

## 💰 Credit System (Placeholder)

Each download deducts credits proportional to feature count.
Plans: `free` (0 credits = disabled), `starter`, `pro`.

```sql
-- Add credits
INSERT INTO user_credits (user_id, credits) VALUES ('user-uuid', 1000)
  ON CONFLICT (user_id) DO UPDATE SET credits = credits + 1000;
```

---

## 🔄 Auto-Refresh (Cron)

```bash
# Every Sunday at 2 AM Thailand time (UTC+7 = 19:00 UTC)
0 19 * * 0 cd /app/scripts && python osm_fetcher.py --layer all >> /var/log/geodata_refresh.log 2>&1
```

---

## 🔑 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://...` | PostgreSQL connection string |
| `MAPBOX_TOKEN` | (set in component) | Mapbox GL JS access token |

---

## ⚠️ TODO

- [ ] Wire up `/credits/topup` Stripe checkout integration
- [ ] S3/MinIO for pre-signed download URLs (currently uses temp files)
- [ ] Redis rate limiting on API endpoints
- [ ] Webhook for download completion notification
- [ ] Admin dashboard for layer management
- [ ] Thai address geocoding (THAI-GIS or ONEE API)
