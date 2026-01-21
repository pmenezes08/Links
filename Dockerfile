# Dockerfile for C-Point Main App (app.c-point.co)
# Deploys to Google Cloud Run

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
COPY client/dist/ ./client/dist/

# Expose port
EXPOSE 8080

# Run with gunicorn
# --preload: Load app once before forking workers (faster startup)
# --timeout 120: 2 min timeout for requests
# --graceful-timeout 30: Time for graceful shutdown
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "8", "--timeout", "120", "--graceful-timeout", "30", "--preload", "bodybuilding_app:app"]
