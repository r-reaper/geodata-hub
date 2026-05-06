FROM python:3.12-slim

WORKDIR /app

# Install pip deps first (cached layer)
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code and data
COPY backend/ ./backend/
COPY scripts/ ./scripts/
COPY data/    ./data/

ENV PYTHONPATH=/app/backend:/app
ENV APP_ENV=production

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
