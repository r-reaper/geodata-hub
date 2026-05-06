FROM python:3.12-slim

WORKDIR /app

# System libs required by GeoPandas / Fiona / GDAL on Linux
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgdal-dev \
    gdal-bin \
    libproj-dev \
    libgeos-dev \
    libpq-dev \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install heavy geo dependencies first (own layer for Docker cache)
RUN pip install --no-cache-dir \
    numpy==1.26.4 \
    shapely==2.0.4 \
    pyproj==3.6.1 \
    fiona==1.9.6 \
    geopandas==0.14.4

# Install the rest
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source (data files are downloaded from R2 at runtime — see main.py startup)
COPY backend/ ./backend/
COPY scripts/ ./scripts/
COPY data/    ./data/

ENV PYTHONPATH=/app/backend:/app
ENV APP_ENV=production

EXPOSE 8000

HEALTHCHECK --interval=60s --timeout=15s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Railway injects PORT env var — use ${PORT:-8000} so it works locally too
CMD uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}
