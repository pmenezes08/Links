# C.Point App - Production Dockerfile
# Flask Backend + React Frontend

FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    default-libmysqlclient-dev \
    pkg-config \
    libffi-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir gunicorn

# Copy application code
COPY bodybuilding_app.py .
COPY signal_endpoints.py .
COPY backend/ ./backend/
COPY templates/ ./templates/
COPY static/ ./static/

# Copy pre-built React frontend
# Run `cd client && npm run build` before building Docker image
COPY client/dist/ ./client/dist/

# Create necessary directories
RUN mkdir -p uploads instance

# Set environment variables
ENV PORT=8080
ENV PYTHONUNBUFFERED=1
ENV FLASK_ENV=production

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Run with gunicorn
# - Workers: 2 (suitable for 1 CPU)
# - Threads: 4 (handles concurrent requests)
# - Timeout: 120s (for long-running requests like file uploads)
CMD exec gunicorn \
    --bind :$PORT \
    --workers 2 \
    --threads 4 \
    --timeout 120 \
    --access-logfile - \
    --error-logfile - \
    --capture-output \
    --enable-stdio-inheritance \
    bodybuilding_app:app
