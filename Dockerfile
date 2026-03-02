# Dockerfile for C-Point Main App (app.c-point.co)
# Deploys to Google Cloud Run
# Builds React client as part of image - no pre-built client/dist needed

FROM node:20-slim AS client-builder
WORKDIR /client
COPY client/package.json client/package-lock.json ./
RUN npm ci 2>/dev/null || npm install
COPY client/ ./
RUN npm run build

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY bodybuilding_app.py .
COPY redis_cache.py .
COPY encryption_endpoints.py .
COPY signal_endpoints.py .
COPY backend/ ./backend/
COPY templates/ ./templates/
COPY static/ ./static/
# Copy built React client from builder stage
COPY --from=client-builder /client/dist ./client/dist

# Cloud Run sets PORT; default 8080
ENV PORT=8080
EXPOSE 8080

# Run with gunicorn (use PORT for Cloud Run compatibility)
# --preload: Load app once before forking workers (faster startup)
# --timeout 120: 2 min timeout for requests
# --graceful-timeout 30: Time for graceful shutdown
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT} --workers 1 --threads 8 --timeout 120 --graceful-timeout 30 --preload bodybuilding_app:app"]
