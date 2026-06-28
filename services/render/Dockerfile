# cpoint-render: headless-Chromium render worker for the Steve Builder pipeline.
# The official Playwright Python image ships Chromium + all system deps, pinned
# to a matching playwright version — so we never install browsers ourselves.
FROM mcr.microsoft.com/playwright/python:v1.49.0-jammy

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./app.py

ENV PORT=8080
# One worker per instance (Cloud Run runs concurrency=1); a few threads cover the
# health checks. --timeout covers a slow cold render.
CMD exec gunicorn --bind :$PORT --workers 1 --threads 2 --timeout 120 app:app
