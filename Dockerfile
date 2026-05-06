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

CMD uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 2
