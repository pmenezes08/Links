# Dockerfile for C-Point Main App (app.c-point.co)
# Deploys to Google Cloud Run
# Builds React client as part of image - no pre-built client/dist needed

FROM node:20-slim AS client-builder
WORKDIR /client
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY client/package.json client/package-lock.json ./
RUN npm install --legacy-peer-deps
COPY client/ ./
RUN npm run build

# Stage 2: Python app with built client
FROM python:3.11-slim

WORKDIR /app

# Python optimizations for faster startup
ENV PYTHONDONTWRITEBYTECODE=0 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install system dependencies and clean up in same layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y --auto-remove gcc \
    || true

# Copy application files
COPY bodybuilding_app.py .
COPY redis_cache.py .
COPY encryption_endpoints.py .
COPY signal_endpoints.py .
COPY backend/ ./backend/
COPY templates/ ./templates/
COPY static/ ./static/
COPY --from=client-builder /client/dist ./client/dist/

# Pre-compile Python files to bytecode for faster cold starts
RUN python -m compileall -q /app/bodybuilding_app.py /app/redis_cache.py /app/backend/ 2>/dev/null || true

# Cloud Run sets PORT; default 8080
ENV PORT=8080
EXPOSE 8080

# --preload: Load app once before forking workers (faster startup)
# --worker-tmp-dir /dev/shm: Use RAM for worker heartbeat (avoids slow disk I/O)
# --timeout 120: 2 min timeout for requests
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT} --workers 1 --threads 8 --timeout 120 --graceful-timeout 30 --preload --worker-tmp-dir /dev/shm bodybuilding_app:app"]
