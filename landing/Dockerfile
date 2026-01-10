# Dockerfile for C-Point Landing Page
FROM python:3.11-slim

WORKDIR /app

# Install Flask and gunicorn
RUN pip install --no-cache-dir flask gunicorn

# Copy the server script
COPY server.py /app/server.py

# Copy the built landing page
COPY dist /app/dist

# Expose port
EXPOSE 8080

# Run with gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--threads", "4", "server:app"]
